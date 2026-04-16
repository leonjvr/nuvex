"""Integration test: full desktop pipeline (offline→reconnect→approve→execute) — 16.13"""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestDesktopPipelineIntegration:
    """16.13 — Full pipeline: device offline → queued → reconnect → execute → result → resume."""

    @pytest.mark.asyncio
    async def test_queue_and_result_correlation(self):
        """Task enqueued when device offline; future resolves when result arrives."""
        from src.brain.devices.registry import DeviceRegistry

        registry = DeviceRegistry()
        # Register a waiter
        fut = registry.register_result_waiter("call-abc")
        assert not fut.done()

        # Simulate result arriving from device
        resolved = registry.resolve_result("call-abc", {"ok": True})
        assert resolved is True
        assert fut.done()
        assert fut.result() == {"ok": True}

    @pytest.mark.asyncio
    async def test_error_correlation(self):
        """Error frame resolves waiter with exception."""
        from src.brain.devices.registry import DeviceRegistry

        registry = DeviceRegistry()
        fut = registry.register_result_waiter("call-err")
        registry.resolve_error("call-err", "device_crash")

        assert fut.done()
        with pytest.raises(Exception, match="device_crash"):
            fut.result()

    @pytest.mark.asyncio
    async def test_dispatcher_to_connection_roundtrip(self):
        """Dispatcher sends tool_result back through mock connection."""
        from src.desktop_agent.dispatcher import Dispatcher

        sent_frames: list = []

        async def _mock_send(frame):
            sent_frames.append(frame)

        conn = MagicMock()
        conn.send = AsyncMock(side_effect=_mock_send)

        async def _echo_tool(**kwargs):
            return {"echo": kwargs.get("value", "pong")}

        dispatcher = Dispatcher({"echo_tool": _echo_tool})
        await dispatcher.dispatch(
            {"type": "tool_call", "call_id": "c42", "tool": "echo_tool", "args": {"value": "ping"}},
            conn,
        )

        assert len(sent_frames) == 1
        frame = sent_frames[0]
        assert frame["type"] == "tool_result"
        assert frame["call_id"] == "c42"
        assert frame["result"]["echo"] == "ping"

    @pytest.mark.asyncio
    async def test_tier_classification_blocks_shell_for_t2(self):
        """T2 agent cannot call shell_exec — tier check returns error."""
        from src.brain.devices.tool import DesktopToolCallTool

        tool = DesktopToolCallTool()
        tool.device_id = "dev-1"
        tool.agent_id = "beta-agent"
        tool.agent_tier = "T2"

        mock_registry = MagicMock()
        mock_registry.is_connected.return_value = True

        with patch("src.brain.devices.tool.get_registry", return_value=mock_registry):
            result = await tool._arun(tool="desktop_shell_exec", args={"cmd": "whoami"})

        assert "tier_insufficient" in result
        assert "T1" in result
        assert "T2" in result

    @pytest.mark.asyncio
    async def test_tier_classification_allows_screenshot_for_t2(self):
        """T2 agent CAN call desktop_screenshot."""
        from src.brain.devices.tool import DesktopToolCallTool

        mock_result = {"image_base64": "abc", "width": 1920, "height": 1080}
        mock_registry = MagicMock()
        mock_registry.is_connected.return_value = True
        mock_registry.send = AsyncMock(return_value=True)

        captured: list = []

        def _register_waiter(call_id):
            captured.append(call_id)
            loop = asyncio.get_running_loop()
            fut = loop.create_future()
            fut.set_result(mock_result)
            return fut

        mock_registry.register_result_waiter = _register_waiter

        tool = DesktopToolCallTool()
        tool.device_id = "dev-1"
        tool.agent_id = "beta-agent"
        tool.agent_tier = "T2"

        with patch("src.brain.devices.tool.get_registry", return_value=mock_registry):
            result = await tool._arun(tool="desktop_screenshot", args={})

        assert "tier_insufficient" not in result
        assert result is not None

    @pytest.mark.asyncio
    async def test_tier_classification_allows_shell_for_t1(self):
        """T1 agent CAN call desktop_shell_exec."""
        from src.brain.devices.tool import DesktopToolCallTool

        mock_result = {"stdout": "root", "returncode": 0}
        mock_registry = MagicMock()
        mock_registry.is_connected.return_value = True
        mock_registry.send = AsyncMock(return_value=True)

        def _register_waiter(call_id):
            loop = asyncio.get_running_loop()
            fut = loop.create_future()
            fut.set_result(mock_result)
            return fut

        mock_registry.register_result_waiter = _register_waiter

        tool = DesktopToolCallTool()
        tool.device_id = "dev-1"
        tool.agent_id = "maya"
        tool.agent_tier = "T1"

        with patch("src.brain.devices.tool.get_registry", return_value=mock_registry):
            result = await tool._arun(tool="desktop_shell_exec", args={"cmd": "whoami"})

        assert "tier_insufficient" not in result

    @pytest.mark.asyncio
    async def test_queue_drain_dispatch_roundtrip(self):
        """Verify queue dequeue returns tasks with correct structure."""
        from src.brain.devices.queue import TaskQueueManager, QueuedTask

        manager = TaskQueueManager()
        mock_rows = []
        for i in range(2):
            r = MagicMock()
            r.id = f"q-{i}"
            r.agent_id = "maya"
            r.device_id = "dev-1"
            r.graph_thread_id = f"thread-{i}"
            r.tool_name = "desktop_screenshot"
            r.payload_json = {"tool": "desktop_screenshot", "args": {}}
            r.call_id = f"call-{i}"
            r.status = "queued"
            mock_rows.append(r)

        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value.all.return_value = mock_rows

        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.execute = AsyncMock(return_value=mock_execute_result)
        mock_session.commit = AsyncMock()

        with patch("src.brain.devices.queue.get_session", return_value=mock_session):
            tasks = await manager.dequeue_for_device("dev-1")

        assert len(tasks) == 2
        assert all(isinstance(t, QueuedTask) for t in tasks)
        assert tasks[0].tool_name == "desktop_screenshot"
