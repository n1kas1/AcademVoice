"""
Лёгкий лог событий для аналитики (воронка, retention).

Никогда не бросает наружу: аналитика не должна ломать пользовательский запрос.
"""

import json
import sys
from typing import Optional

from .db import pool


async def log_event(
    tg_id: Optional[int], event_type: str, props: Optional[dict] = None
) -> None:
    try:
        async with pool().acquire() as c:
            await c.execute(
                "insert into events (tg_id, event_type, props) values ($1, $2, $3::jsonb)",
                tg_id,
                event_type,
                json.dumps(props or {}),
            )
    except Exception as e:  # noqa: BLE001 — аналитика не влияет на запрос
        print(f"[events] log_event failed: {e}", file=sys.stderr)
