"""Unit tests for src/brain/checkpointer.py — task 3.9.

All tests mock psycopg / AsyncPostgresSaver so they run without a live DB
or libpq native library installed.
"""
from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langgraph.checkpoint.memory import MemorySaver


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_postgres_saver_mock():
    """Return an async context manager mock that yields a fake checkpointer."""
    fake_cp = MagicMock(name="AsyncPostgresSaver-instance")
    fake_cp.setup = AsyncMock()

    fake_cls = MagicMock(name="AsyncPostgresSaver")

    @asynccontextmanager
    async def _from_conn_string(url):
        yield fake_cp

    fake_cls.from_conn_string = _from_conn_string
    return fake_cls, fake_cp


# ---------------------------------------------------------------------------
# 3.9.1 — No DATABASE_URL → MemorySaver yielded
# ---------------------------------------------------------------------------

class TestNoDbUrl:
    @pytest.mark.asyncio
    async def test_yields_memory_saver_when_no_database_url(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from src.brain.checkpointer import get_checkpointer

        async with get_checkpointer() as cp:
            assert isinstance(cp, MemorySaver)

    @pytest.mark.asyncio
    async def test_yields_memory_saver_when_database_url_empty(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "")
        from src.brain.checkpointer import get_checkpointer

        async with get_checkpointer() as cp:
            assert isinstance(cp, MemorySaver)


# ---------------------------------------------------------------------------
# 3.9.2 — Import error → MemorySaver fallback
# ---------------------------------------------------------------------------

class TestImportError:
    @pytest.mark.asyncio
    async def test_falls_back_when_postgres_pkg_missing(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")

        import importlib
        import src.brain.checkpointer as _chk_mod

        orig_import = __builtins__.__import__ if hasattr(__builtins__, "__import__") else __import__

        def _mock_import(name, *args, **kwargs):
            if "langgraph.checkpoint.postgres" in name:
                raise ImportError("mocked missing package")
            return orig_import(name, *args, **kwargs)

        # Reload module with patched import
        with patch("builtins.__import__", side_effect=_mock_import):
            importlib.reload(_chk_mod)
            async with _chk_mod.get_checkpointer() as cp:
                assert isinstance(cp, MemorySaver)

        importlib.reload(_chk_mod)  # restore after test

    @pytest.mark.asyncio
    async def test_falls_back_when_psycopg_missing(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/db")

        import importlib
        import src.brain.checkpointer as _chk_mod

        orig_import = __builtins__.__import__ if hasattr(__builtins__, "__import__") else __import__

        def _mock_import(name, *args, **kwargs):
            if name == "psycopg":
                raise ImportError("mocked no libpq")
            return orig_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=_mock_import):
            importlib.reload(_chk_mod)
            async with _chk_mod.get_checkpointer() as cp:
                assert isinstance(cp, MemorySaver)

        importlib.reload(_chk_mod)


# ---------------------------------------------------------------------------
# 3.9.3 — Happy path: DATABASE_URL + mocked AsyncPostgresSaver
# ---------------------------------------------------------------------------

class TestHappyPath:
    @pytest.mark.asyncio
    async def test_yields_postgres_saver_when_deps_available(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@localhost/nuvex")

        fake_cls, fake_cp = _make_postgres_saver_mock()
        fake_psycopg = MagicMock(name="psycopg")

        with (
            patch.dict(sys.modules, {
                "langgraph.checkpoint.postgres": MagicMock(),
                "langgraph.checkpoint.postgres.aio": MagicMock(AsyncPostgresSaver=fake_cls),
                "psycopg": fake_psycopg,
            }),
        ):
            import importlib
            import src.brain.checkpointer as _chk_mod
            importlib.reload(_chk_mod)

            async with _chk_mod.get_checkpointer() as cp:
                assert cp is fake_cp
            fake_cp.setup.assert_awaited_once()

            importlib.reload(_chk_mod)

    @pytest.mark.asyncio
    async def test_setup_called_before_first_use(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/nuvex")

        fake_cls, fake_cp = _make_postgres_saver_mock()
        setup_called = []
        original_setup = fake_cp.setup

        async def _recording_setup():
            setup_called.append(True)
            return await original_setup()

        fake_cp.setup = _recording_setup

        with patch.dict(sys.modules, {
            "langgraph.checkpoint.postgres": MagicMock(),
            "langgraph.checkpoint.postgres.aio": MagicMock(AsyncPostgresSaver=fake_cls),
            "psycopg": MagicMock(),
        }):
            import importlib
            import src.brain.checkpointer as _chk_mod
            importlib.reload(_chk_mod)

            async with _chk_mod.get_checkpointer() as cp:
                pass

            assert len(setup_called) == 1
            importlib.reload(_chk_mod)


# ---------------------------------------------------------------------------
# 3.9.4 — URL translation
# ---------------------------------------------------------------------------

class TestUrlTranslation:
    def test_strips_psycopg_driver_prefix(self):
        from src.brain.checkpointer import _pg_url_from_db_url

        result = _pg_url_from_db_url("postgresql+psycopg://u:p@host/db")
        assert result == "postgresql://u:p@host/db"

    def test_strips_asyncpg_driver_prefix(self):
        from src.brain.checkpointer import _pg_url_from_db_url

        result = _pg_url_from_db_url("postgresql+asyncpg://u:p@host/db")
        assert result == "postgresql://u:p@host/db"

    def test_normalises_postgres_shorthand(self):
        from src.brain.checkpointer import _pg_url_from_db_url

        result = _pg_url_from_db_url("postgres://u:p@host/db")
        assert result == "postgresql://u:p@host/db"

    def test_leaves_plain_postgresql_url_unchanged(self):
        from src.brain.checkpointer import _pg_url_from_db_url

        url = "postgresql://u:p@host/db"
        assert _pg_url_from_db_url(url) == url


# ---------------------------------------------------------------------------
# 3.9.5 — Connection failure → MemorySaver fallback
# ---------------------------------------------------------------------------

class TestConnectionFailureFallback:
    @pytest.mark.asyncio
    async def test_falls_back_on_connection_error(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost/nuvex")

        fake_cls = MagicMock(name="AsyncPostgresSaver")

        @asynccontextmanager
        async def _failing_conn_string(url):
            raise OSError("connection refused")
            yield  # pragma: no cover

        fake_cls.from_conn_string = _failing_conn_string

        with patch.dict(sys.modules, {
            "langgraph.checkpoint.postgres": MagicMock(),
            "langgraph.checkpoint.postgres.aio": MagicMock(AsyncPostgresSaver=fake_cls),
            "psycopg": MagicMock(),
        }):
            import importlib
            import src.brain.checkpointer as _chk_mod
            importlib.reload(_chk_mod)

            async with _chk_mod.get_checkpointer() as cp:
                assert isinstance(cp, MemorySaver)

            importlib.reload(_chk_mod)


# ---------------------------------------------------------------------------
# 3.9.6 — graph.py accepts checkpointer parameter
# ---------------------------------------------------------------------------

class TestGraphCheckpointerWiring:
    def test_get_compiled_graph_accepts_checkpointer_kwarg(self):
        """get_compiled_graph(checkpointer=...) must not raise."""
        import src.brain.graph as _graph_mod

        # Reset cached graph so we can pass our own checkpointer
        _graph_mod._compiled_graph = None

        fake_cp = MemorySaver()
        graph = _graph_mod.get_compiled_graph(checkpointer=fake_cp)
        assert graph is not None

        # Second call returns the cached graph regardless
        graph2 = _graph_mod.get_compiled_graph(checkpointer=None)
        assert graph2 is graph

        # Restore cache state for subsequent tests
        _graph_mod._compiled_graph = None

    def test_get_compiled_graph_without_checkpointer_succeeds(self):
        import src.brain.graph as _graph_mod

        _graph_mod._compiled_graph = None
        graph = _graph_mod.get_compiled_graph()
        assert graph is not None
        _graph_mod._compiled_graph = None
