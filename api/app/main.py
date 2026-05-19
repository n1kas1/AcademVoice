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


# ============ /me ============

class ProfilePatch(BaseModel):
    faculty: str
    course: str


@app.get("/me")
async def me(u: TgUser = Depends(get_user)):
    row = await upsert_user(u)
    return {
        "tg_id": row["tg_id"],
        "username": row.get("username"),
        "first_name": row["first_name"],
        "faculty": row.get("faculty"),
        "course": row.get("course"),
    }


@app.patch("/me")
async def update_me(p: ProfilePatch, u: TgUser = Depends(get_user)):
    await upsert_user(u)
    async with pool().acquire() as c:
        await c.execute(
            "update users set faculty=$2, course=$3, updated_at=now() where tg_id=$1",
            u.id, p.faculty, p.course,
        )
    row = await get_user_row(u.id)
    return {
        "tg_id": row["tg_id"],
        "username": row.get("username"),
        "first_name": row["first_name"],
        "faculty": row.get("faculty"),
        "course": row.get("course"),
    }


# ============ /match ============

@app.post("/match/join")
async def match_join(u: TgUser = Depends(get_user)):
    await upsert_user(u)
    await _clean_stale_queue()

    async with _match_lock:
        # Уже в активной комнате? (например, peer встал и матчнул нас раньше)
        active = await find_active_call(u.id)
        if active:
            return await build_match_response(active, u.id)

        async with pool().acquire() as c:
            # Берём первого ждущего, не я.
            waiting = await c.fetchrow(
                """
                select tg_id from queue
                where tg_id <> $1
                order by joined_at
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
                room_name = f"r_{uuid.uuid4().hex[:10]}"
                await c.execute(
                    """
                    insert into calls (room_name, a_tg_id, b_tg_id)
                    values ($1, $2, $3)
                    """,
                    room_name, peer_id, u.id,
                )
                call = await c.fetchrow(
                    "select * from calls where room_name=$1", room_name
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
