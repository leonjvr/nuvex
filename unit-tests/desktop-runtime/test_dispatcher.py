"""Unit tests: Dispatcher — 16.7"""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock

from src.desktop_agent.dispatcher import Dispatcher


class TestDispatcher:
    """16.7 — routes known tools, returns error for unknown tools."""

    def _make_conn(self):
        conn = MagicMock()
        conn.send = AsyncMock()
        return conn

    @pytest.mark.asyncio
    async def test_routes_known_tool(self):
        async def _screenshot(**kwargs):
            return {"image_base64": "abc", "width": 100, "height": 100, "monitor": 1}

        registry = {"desktop_screenshot": _screenshot}
        dispatcher = Dispatcher(registry)
        conn = self._make_conn()
        frame = {"type": "tool_call", "call_id": "c1", "tool": "desktop_screenshot", "args": {}}
        await dispatcher.dispatch(frame, conn)
        conn.send.assert_called_once()
        sent = conn.send.call_args[0][0]
        assert sent["type"] == "tool_result"
        assert sent["call_id"] == "c1"
        assert "image_base64" in sent["result"]

    @pytest.mark.asyncio
    async def test_returns_error_for_unknown_tool(self):
        dispatcher = Dispatcher({})
        conn = self._make_conn()
        frame = {"type": "tool_call", "call_id": "c2", "tool": "does_not_exist", "args": {}}
        await dispatcher.dispatch(frame, conn)
        conn.send.assert_called_once()
        sent = conn.send.call_args[0][0]
        assert sent["type"] == "tool_error"
        assert "unknown tool" in sent["error"]
        assert sent["category"] == "not_available"

    @pytest.mark.asyncio
    async def test_tool_exception_returns_tool_error(self):
        async def _bad_tool(**kwargs):
            raise RuntimeError("something went wrong")

        registry = {"bad_tool": _bad_tool}
        dispatcher = Dispatcher(registry)
        conn = self._make_conn()
        frame = {"type": "tool_call", "call_id": "c3", "tool": "bad_tool", "args": {}}
        await dispatcher.dispatch(frame, conn)
        conn.send.assert_called_once()
        sent = conn.send.call_args[0][0]
        assert sent["type"] == "tool_error"
        assert "something went wrong" in sent["error"]

    @pytest.mark.asyncio
    async def test_missing_call_id_still_handled(self):
        async def _tool(**kwargs):
            return {"ok": True}

        registry = {"my_tool": _tool}
        dispatcher = Dispatcher(registry)
        conn = self._make_conn()
        frame = {"type": "tool_call", "tool": "my_tool", "args": {}}
        await dispatcher.dispatch(frame, conn)
        sent = conn.send.call_args[0][0]
        assert sent["type"] == "tool_result"
        assert sent["call_id"] == ""
