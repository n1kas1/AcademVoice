"""
Academ.voice API — FastAPI + asyncpg + LiveKit Server SDK.

Эндпоинты:
- GET    /me                  — мой профиль (создаст юзера если первый раз)
- PATCH  /me                  — обновить факультет/курс
- POST   /match/join          — попробовать сразу матчнуться или встать в очередь
- GET    /match/poll          — клиент опрашивает, пока ждёт собеседника
- POST   /match/leave         — выйти из очереди
- POST   /call/skip           — пометить конец звонка (я ушёл)
- POST   /call/reaction       — лайк/дизлайк, опц. сохранить контакт
- POST   /call/report         — пожаловаться

Аутентификация — заголовок `Authorization: tma <telegram_initData>`.
"""

import uuid
import asyncio
from typing import Optional
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import CORS_ORIGINS, LIVEKIT_WS_URL
from .tg_auth import extract_user_from_header, TgUser
from .db import init_pool, close_pool, pool
from .livekit_tokens import make_token
from .events import log_event
from . import notify


# In-memory мьютекс на матчинг. Для горизонтального масштабирования
# заменим на Postgres advisory lock.
_match_lock = asyncio.Lock()

# Записи старше этого срока — выбрасываем из очереди, считая что вкладка закрылась.
QUEUE_TTL_SECONDS = 60


async def _clean_stale_queue() -> None:
    """Удаляем зависшие записи (юзер закрыл вкладку, не позвав /match/leave)."""
    async with pool().acquire() as c:
        await c.execute(
            "delete from queue where joined_at < now() - make_interval(secs => $1)",
            QUEUE_TTL_SECONDS,
        )


def get_user(authorization: str = Header(default="")) -> TgUser:
    try:
        return extract_user_from_header(authorization)
    except Exception as e:
        raise HTTPException(401, f"auth: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    yield
    await notify.close_client()
    await close_pool()


app = FastAPI(lifespan=lifespan, title="Academ.voice API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============ helpers ============

async def upsert_user(u: TgUser) -> dict:
    """Создаёт/обновляет базовые поля. faculty/course не трогает."""
    async with pool().acquire() as c:
        await c.execute(
            """
            insert into users (tg_id, username, first_name)
            values ($1, $2, $3)
            on conflict (tg_id) do update
              set username   = excluded.username,
                  first_name = excluded.first_name,
                  updated_at = now()
            """,
            u.id, u.username, u.first_name,
        )
        row = await c.fetchrow("select * from users where tg_id=$1", u.id)
    return dict(row)


async def get_user_row(tg_id: int) -> Optional[dict]:
    async with pool().acquire() as c:
        row = await c.fetchrow("select * from users where tg_id=$1", tg_id)
    return dict(row) if row else None


async def touch_streak(tg_id: int) -> None:
    """Обновляет стрик ежедневного возврата (TZ Europe/Moscow). Идемпотентно за день."""
    async with pool().acquire() as c:
        await c.execute(
            """
            update users set
              streak_count = case
                when streak_day = (now() at time zone 'Europe/Moscow')::date
                  then streak_count
                when streak_day = (now() at time zone 'Europe/Moscow')::date - 1
                  then streak_count + 1
                else 1
              end,
              streak_day = (now() at time zone 'Europe/Moscow')::date
            where tg_id = $1
            """,
            tg_id,
        )


async def find_active_call(tg_id: int) -> Optional[dict]:
    """Активный звонок этого юзера (если есть)."""
    async with pool().acquire() as c:
        row = await c.fetchrow(
            """
            select * from calls
            where ended_at is null
              and (a_tg_id = $1 or b_tg_id = $1)
            order by started_at desc
            limit 1
            """,
            tg_id,
        )
    return dict(row) if row else None


async def peer_info(call: dict, me_tg_id: int) -> dict:
    peer_id = call["b_tg_id"] if call["a_tg_id"] == me_tg_id else call["a_tg_id"]
    peer = await get_user_row(peer_id) or {"tg_id": peer_id, "first_name": "—"}
    return {
        "tg_id": peer["tg_id"],
        "first_name": peer.get("first_name", "—"),
        "username": peer.get("username"),
        "faculty": peer.get("faculty"),
        "course": peer.get("course"),
    }


async def build_match_response(call: dict, me_tg_id: int) -> dict:
    p = await peer_info(call, me_tg_id)
    me = await get_user_row(me_tg_id)
    token = make_token(
        identity=f"u{me_tg_id}",
        room_name=call["room_name"],
        name=(me or {}).get("first_name", "User"),
    )
    return {
        "status": "matched",
        "room_name": call["room_name"],
        "token": token,
        "ws_url": LIVEKIT_WS_URL,
        "peer": p,
    }


async def _notify_mutual(call: dict) -> None:
    """Push обоим участникам о взаимной симпатии — догоняет того, кто уже вышел из апп."""
    room = call["room_name"]
    a_id, b_id = call["a_tg_id"], call["b_tg_id"]
    a = await get_user_row(a_id) or {}
    b = await get_user_row(b_id) or {}

    def _text(peer: dict) -> str:
        un = peer.get("username")
        if un:
            return (
                "💞 Взаимная симпатия в Академ.voice!\n"
                f"Вы оба отправили сердечко — напишите собеседнику: t.me/{un}"
            )
        name = peer.get("first_name") or "собеседник"
        return (
            "💞 Взаимная симпатия в Академ.voice!\n"
            f"Вы с {name} оба отправили сердечко. Откройте приложение, чтобы продолжить."
        )

    # respect_cap=False: транзакционный push (заслуженный), но push_log не даст дубля.
    # Обоим параллельно; try/except — т.к. зовётся как orphaned task (create_task).
    try:
        await asyncio.gather(
            notify.push_user(
                a_id, _text(b), "mutual", dedup_key=f"mutual:{room}", respect_cap=False
            ),
            notify.push_user(
                b_id, _text(a), "mutual", dedup_key=f"mutual:{room}", respect_cap=False
            ),
        )
    except Exception as e:  # noqa: BLE001
        import sys

        print(f"[mutual] notify error room={room}: {e}", file=sys.stderr)


# ============ /me ============

class ProfilePatch(BaseModel):
    faculty: str
    course: str


def _me_payload(row: dict) -> dict:
    return {
        "tg_id": row["tg_id"],
        "username": row.get("username"),
        "first_name": row["first_name"],
        "faculty": row.get("faculty"),
        "course": row.get("course"),
        # Bool-флаг достаточен фронту для роутинга, точную дату не отдаём.
        "rules_accepted": row.get("rules_accepted_at") is not None,
        "allow_pm": row.get("allow_pm", False),
        "streak": row.get("streak_count", 0),
    }


@app.get("/me")
async def me(u: TgUser = Depends(get_user)):
    await upsert_user(u)
    await touch_streak(u.id)
    row = await get_user_row(u.id)
    if row is None:  # практически недостижимо: юзер только что upsert-нут в этом же запросе
        raise HTTPException(404, "user not found")
    await log_event(u.id, "app_open", {"has_profile": bool(row.get("faculty"))})
    return _me_payload(row)


@app.patch("/me")
async def update_me(p: ProfilePatch, u: TgUser = Depends(get_user)):
    await upsert_user(u)
    async with pool().acquire() as c:
        await c.execute(
            "update users set faculty=$2, course=$3, updated_at=now() where tg_id=$1",
            u.id, p.faculty, p.course,
        )
    row = await get_user_row(u.id)
    return _me_payload(row)


@app.post("/me/accept-rules")
async def accept_rules(u: TgUser = Depends(get_user)):
    """Юзер согласился с правилами. Идемпотентно, не перезаписывает дату."""
    await upsert_user(u)
    async with pool().acquire() as c:
        await c.execute(
            """
            update users
               set rules_accepted_at = coalesce(rules_accepted_at, now()),
                   updated_at        = now()
             where tg_id = $1
            """,
            u.id,
        )
    row = await get_user_row(u.id)
    return _me_payload(row)


@app.post("/me/allow-pm")
async def allow_pm(u: TgUser = Depends(get_user)):
    """Юзер разрешил боту писать ему (Telegram requestWriteAccess). Идемпотентно."""
    await upsert_user(u)
    async with pool().acquire() as c:
        await c.execute("update users set allow_pm=true where tg_id=$1", u.id)
    return {"ok": True}


# ============ /match ============

@app.post("/match/join")
async def match_join(u: TgUser = Depends(get_user)):
    await upsert_user(u)
    await _clean_stale_queue()
    await log_event(u.id, "queue_join")

    async with _match_lock:
        # Уже в активной комнате? (например, peer встал и матчнул нас раньше)
        active = await find_active_call(u.id)
        if active:
            return await build_match_response(active, u.id)

        async with pool().acquire() as c:
            # Первый ждущий (не я), исключая тех, с кем недавно говорили:
            # пара заблокирована, пока у КАЖДОГО calls_count не вырос на >=4
            # относительно снимка на момент последней встречи.
            waiting = await c.fetchrow(
                """
                select q.tg_id
                from queue q
                join users me   on me.tg_id   = $1
                join users them on them.tg_id = q.tg_id
                where q.tg_id <> $1
                  and not exists (
                    select 1 from (
                      select a_tg_id, b_tg_id, a_calls_at, b_calls_at
                      from calls
                      where ((a_tg_id = $1 and b_tg_id = q.tg_id)
                          or (b_tg_id = $1 and a_tg_id = q.tg_id))
                        and a_calls_at is not null and b_calls_at is not null
                      order by started_at desc
                      limit 1
                    ) last
                    where (me.calls_count
                           - case when last.a_tg_id = $1 then last.a_calls_at
                                  else last.b_calls_at end) < 4
                       or (them.calls_count
                           - case when last.a_tg_id = q.tg_id then last.a_calls_at
                                  else last.b_calls_at end) < 4
                  )
                order by q.joined_at
                limit 1
                """,
                u.id,
            )

            if waiting:
                peer_id = waiting["tg_id"]
                # Удаляем обоих из очереди.
                await c.execute(
                    "delete from queue where tg_id = any($1::bigint[])",
                    [peer_id, u.id],
                )
                # Счётчик звонков обоим +1 и снимок для anti-rematch («4 звонка у каждого»).
                await c.execute(
                    "update users set calls_count = calls_count + 1 "
                    "where tg_id = any($1::bigint[])",
                    [peer_id, u.id],
                )
                snaps = {
                    r["tg_id"]: r["calls_count"]
                    for r in await c.fetch(
                        "select tg_id, calls_count from users where tg_id = any($1::bigint[])",
                        [peer_id, u.id],
                    )
                }
                room_name = f"r_{uuid.uuid4().hex[:10]}"
                await c.execute(
                    """
                    insert into calls (room_name, a_tg_id, b_tg_id, a_calls_at, b_calls_at)
                    values ($1, $2, $3, $4, $5)
                    """,
                    room_name, peer_id, u.id, snaps.get(peer_id), snaps.get(u.id),
                )
                call = await c.fetchrow(
                    "select * from calls where room_name=$1", room_name
                )
                await log_event(
                    u.id, "match_success", {"room_name": room_name, "source": "join"}
                )
                return await build_match_response(dict(call), u.id)

            # Никого — встаём в очередь.
            await c.execute(
                """
                insert into queue (tg_id) values ($1)
                on conflict (tg_id) do update set joined_at = now()
                """,
                u.id,
            )
    return {"status": "queued"}


@app.get("/match/poll")
async def match_poll(u: TgUser = Depends(get_user)):
    # Каждый поллинг продляем TTL текущего юзера + чистим зомби.
    await _clean_stale_queue()
    async with pool().acquire() as c:
        await c.execute(
            "update queue set joined_at = now() where tg_id = $1", u.id
        )
    active = await find_active_call(u.id)
    if active:
        async with pool().acquire() as c:
            await c.execute("delete from queue where tg_id=$1", u.id)
        await log_event(
            u.id, "match_success", {"room_name": active["room_name"], "source": "poll"}
        )
        return await build_match_response(active, u.id)
    return {"status": "queued"}


@app.post("/match/leave")
async def match_leave(u: TgUser = Depends(get_user)):
    async with pool().acquire() as c:
        await c.execute("delete from queue where tg_id=$1", u.id)
    return {"ok": True}


# ============ /call ============

class SkipBody(BaseModel):
    room_name: str


@app.post("/call/skip")
async def call_skip(body: SkipBody, u: TgUser = Depends(get_user)):
    async with pool().acquire() as c:
        await c.execute(
            "update calls set ended_at = now() where room_name=$1 and ended_at is null",
            body.room_name,
        )
        dur = await c.fetchval(
            """
            select extract(epoch from coalesce(ended_at, now()) - started_at)
            from calls where room_name=$1
            """,
            body.room_name,
        )
    await log_event(
        u.id,
        "call_complete",
        {"room_name": body.room_name, "duration_secs": int(dur) if dur is not None else None},
    )
    return {"ok": True}


class ReactionBody(BaseModel):
    room_name: str
    reaction: str
    save_contact: bool = False


@app.post("/call/reaction")
async def call_reaction(body: ReactionBody, u: TgUser = Depends(get_user)):
    if body.reaction not in ("like", "dislike"):
        raise HTTPException(400, "bad reaction")

    async with pool().acquire() as c:
        await c.execute(
            """
            insert into reactions (room_name, from_tg_id, reaction, save_contact)
            values ($1, $2, $3, $4)
            on conflict (room_name, from_tg_id) do update
              set reaction = excluded.reaction,
                  save_contact = excluded.save_contact
            """,
            body.room_name, u.id, body.reaction, body.save_contact,
        )
        rs = await c.fetch(
            "select * from reactions where room_name=$1", body.room_name
        )

    await log_event(
        u.id,
        "reaction",
        {
            "room_name": body.room_name,
            "reaction": body.reaction,
            "save_contact": body.save_contact,
        },
    )

    if len(rs) == 2 and all(
        r["reaction"] == "like" and r["save_contact"] for r in rs
    ):
        call = await find_active_call(u.id)
        if not call:
            async with pool().acquire() as c:
                call_row = await c.fetchrow(
                    "select * from calls where room_name=$1", body.room_name
                )
                call = dict(call_row) if call_row else None
        if call:
            await log_event(u.id, "mutual_match", {"room_name": body.room_name})
            # Не блокируем ответ на медленном Telegram API — пушим в фоне.
            asyncio.create_task(_notify_mutual(call))
            p = await peer_info(call, u.id)
            return {"mutual": True, "peer_username": p.get("username")}
    return {"mutual": False}


class ReportBody(BaseModel):
    room_name: str
    reason: str = "user_report"


@app.post("/call/report")
async def call_report(body: ReportBody, u: TgUser = Depends(get_user)):
    async with pool().acquire() as c:
        await c.execute(
            "insert into reports (room_name, from_tg_id, reason) values ($1,$2,$3)",
            body.room_name, u.id, body.reason,
        )
    return {"ok": True}


# ============ /stats ============

@app.get("/stats")
async def stats(u: TgUser = Depends(get_user)):
    """Соц-пруф для экрана Searching: сколько народу в очереди и сколько
    звонков было за последний час."""
    await _clean_stale_queue()
    async with pool().acquire() as c:
        q_size = await c.fetchval("select count(*) from queue")
        calls_hour = await c.fetchval(
            "select count(*) from calls where started_at > now() - interval '1 hour'"
        )
        users_24h = await c.fetchval(
            "select count(*) from users where updated_at > now() - interval '24 hours'"
        )
    return {
        "queue_size": int(q_size or 0),
        "calls_last_hour": int(calls_hour or 0),
        "active_24h": int(users_24h or 0),
    }


# Результат разговора — клиент опрашивает после звонка, чтобы понять,
# случился ли мьютуал. peer мог нажать сердечко уже после нашего ухода.
@app.get("/call/{room_name}/result")
async def call_result(room_name: str, u: TgUser = Depends(get_user)):
    async with pool().acquire() as c:
        rs = await c.fetch(
            "select * from reactions where room_name=$1", room_name
        )
        call = await c.fetchrow(
            "select * from calls where room_name=$1", room_name
        )
    if not call:
        raise HTTPException(404, "call not found")
    call = dict(call)
    # участник?
    if u.id not in (call["a_tg_id"], call["b_tg_id"]):
        raise HTTPException(403, "not your call")

    if (
        len(rs) == 2
        and all(r["reaction"] == "like" for r in rs)
        and all(r["save_contact"] for r in rs)
    ):
        p = await peer_info(call, u.id)
        return {"mutual": True, "peer_username": p.get("username"), "peer_first_name": p.get("first_name")}
    return {"mutual": False}


# ============ health ============

@app.get("/")
async def root():
    return {"ok": True, "service": "academ.voice"}


@app.get("/health")
async def health():
    try:
        async with pool().acquire() as c:
            await c.fetchval("select 1")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(503, f"db: {e}")
