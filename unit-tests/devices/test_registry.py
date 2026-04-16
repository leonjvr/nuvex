"""Unit tests: DeviceRegistry — 16.1"""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.brain.devices.registry import DeviceRegistry


class TestDeviceRegistry:
    """16.1 — DeviceRegistry register/unregister/get/is_connected/list_connected lifecycle."""

    def setup_method(self):
        self.registry = DeviceRegistry()

    def _mock_ws(self):
        ws = MagicMock()
        ws.send_json = AsyncMock(return_value=None)
        return ws

    def test_register_makes_connected(self):
        ws = self._mock_ws()
        self.registry.register("dev-1", ws)
        assert self.registry.is_connected("dev-1")

    def test_unregister_removes_device(self):
        ws = self._mock_ws()
        self.registry.register("dev-1", ws)
        self.registry.unregister("dev-1")
        assert not self.registry.is_connected("dev-1")

    def test_get_returns_ws(self):
        ws = self._mock_ws()
        self.registry.register("dev-2", ws)
        assert self.registry.get("dev-2") is ws

    def test_get_returns_none_for_unknown(self):
        assert self.registry.get("does-not-exist") is None

    def test_list_connected_empty(self):
        assert self.registry.list_connected() == []

    def test_list_connected_returns_registered_ids(self):
        ws1, ws2 = self._mock_ws(), self._mock_ws()
        self.registry.register("dev-a", ws1)
        self.registry.register("dev-b", ws2)
        connected = self.registry.list_connected()
        assert "dev-a" in connected
        assert "dev-b" in connected

    def test_unregister_missing_device_is_noop(self):
        # Should not raise
        self.registry.unregister("nonexistent")

    @pytest.mark.asyncio
    async def test_send_returns_true_when_connected(self):
        ws = self._mock_ws()
        self.registry.register("dev-1", ws)
        result = await self.registry.send("dev-1", {"type": "heartbeat"})
        assert result is True
        ws.send_json.assert_called_once_with({"type": "heartbeat"})

    @pytest.mark.asyncio
    async def test_send_returns_false_when_not_connected(self):
        result = await self.registry.send("dev-not-there", {"type": "heartbeat"})
        assert result is False

    @pytest.mark.asyncio
    async def test_send_unregisters_on_failure(self):
        ws = self._mock_ws()
        ws.send_json = AsyncMock(side_effect=RuntimeError("broken"))
        self.registry.register("dev-1", ws)
        result = await self.registry.send("dev-1", {"type": "heartbeat"})
        assert result is False
        assert not self.registry.is_connected("dev-1")

    def test_result_waiter_resolve(self):
        async def _run():
            fut = self.registry.register_result_waiter("call-123")
            ok = self.registry.resolve_result("call-123", {"status": "ok"})
            assert ok is True
            result = await fut
            assert result == {"status": "ok"}
        asyncio.run(_run())

    def test_result_waiter_error(self):
        async def _run():
            fut = self.registry.register_result_waiter("call-456")
            ok = self.registry.resolve_error("call-456", "broken")
            assert ok is True
            with pytest.raises(RuntimeError, match="broken"):
                await fut
        asyncio.run(_run())

    def test_resolve_unknown_call_id_returns_false(self):
        assert self.registry.resolve_result("no-such-call", {}) is False
