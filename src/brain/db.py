"""Async PostgreSQL connection pool for the brain service."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

_engine = None
_session_factory = None


class Base(DeclarativeBase):
    pass


def _get_db_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    # Convert to async SQLAlchemy driver URL.
    # On Windows/Python 3.14, psycopg async can fail with ProactorEventLoop;
    # asyncpg is more robust in this environment.
    driver = "postgresql+asyncpg://" if os.name == "nt" else "postgresql+psycopg://"
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", driver, 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", driver, 1)
    return url


def init_engine() -> None:
    global _engine, _session_factory
    url = _get_db_url()
    connect_args = {"ssl": False} if url.startswith("postgresql+asyncpg://") else {}
    _engine = create_async_engine(
        url,
        connect_args=connect_args,
        pool_size=10,
        max_overflow=5,
        pool_pre_ping=True,
        echo=os.environ.get("DB_ECHO", "0") == "1",
    )
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


def get_engine():
    if _engine is None:
        init_engine()
    return _engine


def get_session_factory():
    if _session_factory is None:
        init_engine()
    return _session_factory


@asynccontextmanager
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency — yields an AsyncSession with commit/rollback."""
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def check_connection() -> bool:
    from sqlalchemy import text
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
