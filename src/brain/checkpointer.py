"""LangGraph checkpointer factory for the brain service.

Provides `get_checkpointer()` — an async context manager that yields:
  - `AsyncPostgresSaver` when DATABASE_URL is set and psycopg is available
  - `MemorySaver` as a fallback (tests, local dev without PostgreSQL)

Usage in graph compilation:
    async with get_checkpointer() as checkpointer:
        compiled = build_graph().compile(checkpointer=checkpointer)
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Any

from langgraph.checkpoint.memory import MemorySaver

log = logging.getLogger(__name__)


def _pg_url_from_db_url(db_url: str) -> str:
    """Convert SQLAlchemy async DB URL to a synchronous psycopg URL.

    psycopg-based checkpointer needs ``postgresql://`` (not
    ``postgresql+psycopg://``) with no async driver prefix.
    """
    url = db_url
    for prefix in ("postgresql+psycopg://", "postgresql+asyncpg://", "postgresql+psycopg2://"):
        if url.startswith(prefix):
            return "postgresql://" + url[len(prefix):]
    if url.startswith("postgres://"):
        return "postgresql://" + url[len("postgres://"):]
    return url


@asynccontextmanager
async def get_checkpointer() -> AsyncGenerator[Any, None]:
    """Yield a LangGraph checkpointer backed by PostgreSQL when available.

    Falls back to `MemorySaver` when:
      - DATABASE_URL is not set
      - psycopg / langgraph-checkpoint-postgres is not installed
      - Connection attempt fails
    """
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        log.debug("checkpointer: no DATABASE_URL — using MemorySaver")
        yield MemorySaver()
        return

    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        import psycopg  # noqa: F401 — ensure import succeeds before attempting connection
    except ImportError as exc:
        log.warning("checkpointer: postgres deps unavailable (%s) — using MemorySaver", exc)
        yield MemorySaver()
        return

    pg_url = _pg_url_from_db_url(db_url)
    try:
        async with AsyncPostgresSaver.from_conn_string(pg_url) as checkpointer:
            await checkpointer.setup()
            log.info("checkpointer: PostgreSQL checkpointer ready")
            yield checkpointer
    except Exception as exc:
        log.warning("checkpointer: failed to connect (%s) — using MemorySaver", exc)
        yield MemorySaver()
