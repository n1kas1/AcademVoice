"""
Чистый PostgreSQL через asyncpg. Один пул на процесс.

Миграция накатывается на старте: api/migrations.sql. Идемпотентно
(create table if not exists), так что запускать можно безопасно.
"""

from pathlib import Path
import asyncpg

from .config import DATABASE_URL

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            DATABASE_URL, min_size=1, max_size=10, command_timeout=10
        )
        await _run_migrations()
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    assert _pool is not None, "DB pool not initialized — call init_pool() first"
    return _pool


async def _run_migrations() -> None:
    sql_path = Path(__file__).resolve().parent.parent / "migrations.sql"
    if not sql_path.exists():
        return
    sql = sql_path.read_text(encoding="utf-8")
    async with pool().acquire() as c:
        await c.execute(sql)
