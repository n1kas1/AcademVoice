"""
Push-уведомления через Telegram Bot API (sendMessage).

Единая воронка push_user(): проверяет согласие (allow_pm), идемпотентность
(push_log) и частотный кап (last_pushed_at). Никогда не роняет вызывающий код.
"""

import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from .config import TELEGRAM_BOT_TOKEN, PUSH_ENABLED
from .db import pool
from .events import log_event

_API = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

# Частотный кап для НЕ-транзакционных push (реактивация): не чаще раза в ~20ч.
_REACT_CAP = timedelta(hours=20)


def mutual_text(peer: dict) -> str:
    """Текст push о взаимной симпатии (peer — собеседник получателя)."""
    head = "💞 Взаимная симпатия в Академ.voice!\n"
    un = peer.get("username")
    if un:
        return head + f"Вы оба отправили сердечко — напишите собеседнику: t.me/{un}"
    name = peer.get("first_name") or "собеседник"
    return head + f"Вы с {name} оба отправили сердечко. Откройте приложение, чтобы продолжить."

_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=8.0)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def _send(tg_id: int, text: str) -> bool:
    """Низкоуровневая отправка. True при успехе. При 403 (бот заблокирован) снимает allow_pm."""
    try:
        r = await _get_client().post(
            f"{_API}/sendMessage",
            json={
                "chat_id": tg_id,
                "text": text,
                "disable_web_page_preview": True,
            },
        )
        if r.status_code == 200:
            return True
        if r.status_code == 403:
            # Бот заблокирован / доступ отозван — больше не пытаемся писать этому юзеру.
            async with pool().acquire() as c:
                await c.execute(
                    "update users set allow_pm=false where tg_id=$1", tg_id
                )
            return False
        print(
            f"[notify] sendMessage {tg_id} -> {r.status_code}: {r.text[:200]}",
            file=sys.stderr,
        )
        return False
    except Exception as e:  # noqa: BLE001 — push не должен ронять запрос
        print(f"[notify] sendMessage error {tg_id}: {e}", file=sys.stderr)
        return False


async def push_user(
    tg_id: int,
    text: str,
    kind: str,
    *,
    dedup_key: Optional[str] = None,
    respect_cap: bool = True,
) -> bool:
    """
    Единая воронка push. Возвращает True, если сообщение реально отправлено.

    kind         — категория для аналитики (push_sent.props.kind).
    dedup_key    — если задан, один и тот же (tg_id, dedup_key) шлётся ровно один раз.
    respect_cap  — для реактивации (True): не чаще раза в _REACT_CAP. Транзакционные
                   push (mutual) ставят False.
    """
    if not PUSH_ENABLED:
        return False
    try:
        async with pool().acquire() as c:
            row = await c.fetchrow(
                "select allow_pm, last_pushed_at from users where tg_id=$1", tg_id
            )
            if not row or not row["allow_pm"]:
                return False
            if respect_cap and row["last_pushed_at"] is not None:
                # last_pushed_at — timestamptz → aware datetime; сравниваем в Python,
                # без второго запроса и без интервала-строки в SQL.
                if row["last_pushed_at"] > datetime.now(timezone.utc) - _REACT_CAP:
                    return False
            # Идемпотентность: занимаем (tg_id, dedup_key); если занят — уже слали.
            if dedup_key:
                claimed = await c.fetchval(
                    "insert into push_log (tg_id, dedup_key) values ($1, $2) "
                    "on conflict do nothing returning tg_id",
                    tg_id,
                    dedup_key,
                )
                if claimed is None:
                    return False
    except Exception as e:  # noqa: BLE001
        print(f"[notify] push_user precheck error {tg_id}: {e}", file=sys.stderr)
        return False

    ok = await _send(tg_id, text)
    if ok:
        try:
            async with pool().acquire() as c:
                await c.execute(
                    "update users set last_pushed_at=now() where tg_id=$1", tg_id
                )
            await log_event(tg_id, "push_sent", {"kind": kind})
        except Exception as e:  # noqa: BLE001
            print(f"[notify] push_user postlog error {tg_id}: {e}", file=sys.stderr)
    elif dedup_key:
        # Отправка не удалась (таймаут/429/5xx/403) — освобождаем занятый ключ,
        # иначе ретрай этого же push молча отсёкся бы навсегда (потеря mutual-push).
        try:
            async with pool().acquire() as c:
                await c.execute(
                    "delete from push_log where tg_id=$1 and dedup_key=$2",
                    tg_id,
                    dedup_key,
                )
        except Exception as e:  # noqa: BLE001
            print(f"[notify] push_user dedup release error {tg_id}: {e}", file=sys.stderr)
    return ok
