"""API tests: device registration and WebSocket — 16.9, 16.10"""
from __future__ import annotations

import hashlib
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestDeviceRegisterEndpoint:
    """16.9 — POST /devices/register with valid/invalid/revoked tokens."""

    @pytest.mark.asyncio
    async def test_valid_token_registers_device(self):
        plaintext = "test-token-abc"
        token_hash = hashlib.sha256(plaintext.encode()).hexdigest()

        mock_token_row = MagicMock()
        mock_token_row.revoked_at = None
        mock_token_row.device_id = None
        mock_token_row.created_by = "operator"

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_token_row
        mock_session.execute = AsyncMock(return_value=mock_execute_result)
        mock_session.get = AsyncMock(return_value=None)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        with patch("src.brain.routers.devices.get_session", return_value=mock_session):
            from src.brain.routers.devices import register_device, RegisterRequest
            req = RegisterRequest(token=plaintext, device_name="My Desktop", platform="windows")
            response = await register_device(req)

        assert response.device_id is not None
        assert isinstance(response.session_key, str)

    @pytest.mark.asyncio
    async def test_invalid_token_raises_401(self):
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_execute_result)

        with patch("src.brain.routers.devices.get_session", return_value=mock_session):
            from src.brain.routers.devices import register_device, RegisterRequest
            from fastapi import HTTPException
            req = RegisterRequest(token="bad-token")
            with pytest.raises(HTTPException) as exc_info:
                await register_device(req)
        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_revoked_token_raises_401(self):
        from datetime import datetime, timezone
        mock_token_row = None  # revoked tokens excluded by WHERE clause

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_token_row
        mock_session.execute = AsyncMock(return_value=mock_execute_result)

        with patch("src.brain.routers.devices.get_session", return_value=mock_session):
            from src.brain.routers.devices import register_device, RegisterRequest
            from fastapi import HTTPException
            req = RegisterRequest(token="revoked-token")
            with pytest.raises(HTTPException) as exc_info:
                await register_device(req)
        assert exc_info.value.status_code == 401


class TestDeviceListEndpoint:
    """16.9 — GET /devices returns registered devices with connected status."""

    @pytest.mark.asyncio
    async def test_list_devices_returns_connected_status(self):
        mock_device = MagicMock()
        mock_device.id = "dev-1"
        mock_device.name = "Office PC"
        mock_device.platform = "windows"
        mock_device.last_seen_at = None

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value.all.return_value = [mock_device]
        mock_session.execute = AsyncMock(return_value=mock_execute_result)

        mock_registry = MagicMock()
        mock_registry.is_connected.return_value = True

        with patch("src.brain.routers.devices.get_session", return_value=mock_session), \
             patch("src.brain.routers.devices.get_registry", return_value=mock_registry):
            from src.brain.routers.devices import list_devices
            result = await list_devices()

        assert len(result) == 1
        assert result[0]["id"] == "dev-1"
        assert result[0]["is_connected"] is True


class TestWebSocketInternals:
    """16.10 — WS message handling: tool_result dispatch, drain queue."""

    @pytest.mark.asyncio
    async def test_handle_tool_result_resolves_waiter(self):
        from src.brain.devices.registry import DeviceRegistry

        registry = DeviceRegistry()

        # Register a waiter for a pending call
        fut = registry.register_result_waiter("call-xyz")

        mock_queue = MagicMock()
        mock_queue.get_by_call_id = AsyncMock(return_value=None)
        mock_queue.update_status_by_call_id = AsyncMock(return_value="q-1")

        message = {"type": "tool_result", "call_id": "call-xyz", "result": {"ok": True}}

        with patch("src.brain.routers.devices.get_queue_manager", return_value=mock_queue):
            from src.brain.routers.devices import _handle_message
            await _handle_message("dev-1", message, registry, mock_queue)

        assert fut.done()
        assert fut.result() == {"ok": True}

    @pytest.mark.asyncio
    async def test_handle_tool_error_rejects_waiter(self):
        from src.brain.devices.registry import DeviceRegistry

        registry = DeviceRegistry()
        fut = registry.register_result_waiter("call-err")

        mock_queue = MagicMock()
        mock_queue.get_by_call_id = AsyncMock(return_value=None)
        mock_queue.update_status_by_call_id = AsyncMock(return_value="q-1")

        message = {"type": "tool_error", "call_id": "call-err", "error": "crash"}

        with patch("src.brain.routers.devices.get_queue_manager", return_value=mock_queue):
            from src.brain.routers.devices import _handle_message
            await _handle_message("dev-1", message, registry, mock_queue)

        assert fut.done()
        with pytest.raises(Exception, match="crash"):
            fut.result()

    @pytest.mark.asyncio
    async def test_drain_queue_sends_queued_tasks(self):
        mock_task = MagicMock()
        mock_task.call_id = "call-q1"
        mock_task.tool_name = "desktop_screenshot"
        mock_task.payload = {"args": {}}

        mock_queue = MagicMock()
        mock_queue.dequeue_for_device = AsyncMock(return_value=[mock_task])
        mock_queue.update_status = AsyncMock(return_value=True)

        mock_ws = MagicMock()
        mock_ws.send_json = AsyncMock()

        with patch("src.brain.routers.devices.get_queue_manager", return_value=mock_queue):
            from src.brain.routers.devices import _drain_queue
            await _drain_queue("dev-1", mock_ws, mock_queue)

        mock_ws.send_json.assert_called_once()
        payload = mock_ws.send_json.call_args[0][0]
        assert payload["type"] == "queue_drain"
        assert len(payload["tasks"]) == 1
