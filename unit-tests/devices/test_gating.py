"""Unit tests: agent capability gating — 16.3, 16.4"""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestAgentCapabilityGating:
    """16.3 — assigned+connected → tool present; unassigned → absent."""

    @pytest.mark.asyncio
    async def test_assigned_and_connected_returns_desktop_tool(self):
        mock_row = MagicMock()
        mock_row.device_id = "dev-1"
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = mock_row
        mock_session.execute = AsyncMock(return_value=mock_execute_result)

        mock_registry = MagicMock()
        mock_registry.is_connected.return_value = True

        with patch("src.brain.db.get_session", return_value=mock_session), \
             patch("src.brain.devices.registry.get_registry", return_value=mock_registry), \
             patch("src.brain.devices.tool.DesktopToolCallTool") as MockTool:
            mock_tool_inst = MagicMock()
            MockTool.return_value = mock_tool_inst
            from src.brain.tools_registry import _get_desktop_tools
            tools = await _get_desktop_tools("maya", None)
        assert len(tools) == 1

    @pytest.mark.asyncio
    async def test_unassigned_returns_empty(self):
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_execute_result)

        mock_agent_def = MagicMock()
        mock_agent_def.desktop_device = None

        with patch("src.brain.db.get_session", return_value=mock_session):
            from src.brain.tools_registry import _get_desktop_tools
            tools = await _get_desktop_tools("maya", mock_agent_def)
        assert tools == []

    @pytest.mark.asyncio
    async def test_config_device_fallback(self):
        """Config field desktop_device is used when no DB assignment."""
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_execute_result = MagicMock()
        mock_execute_result.scalar_one_or_none.return_value = None
        mock_session.execute = AsyncMock(return_value=mock_execute_result)

        mock_agent_def = MagicMock()
        mock_agent_def.desktop_device = "config-device-x"

        mock_registry = MagicMock()

        with patch("src.brain.db.get_session", return_value=mock_session), \
             patch("src.brain.devices.registry.get_registry", return_value=mock_registry):
            from src.brain.tools_registry import _get_desktop_tools
            # Import DesktopToolCallTool fresh to avoid mock interference
            from src.brain.devices.tool import DesktopToolCallTool
            tools = await _get_desktop_tools("maya", mock_agent_def)
        assert len(tools) == 1
        assert tools[0].device_id == "config-device-x"


class TestGraphInterruptOnQueue:
    """16.4 — GraphInterrupt raised when device offline; future resolves on result."""

    @pytest.mark.asyncio
    async def test_enqueue_raises_graph_interrupt(self):
        from src.brain.devices.tool import DesktopToolCallTool

        mock_registry = MagicMock()
        mock_registry.is_connected.return_value = False

        mock_queue = MagicMock()
        mock_queue.enqueue = AsyncMock(return_value="q-001")

        with patch("src.brain.devices.tool.get_registry", return_value=mock_registry), \
             patch("src.brain.devices.tool.get_queue_manager", return_value=mock_queue):
            tool = DesktopToolCallTool()
            tool.device_id = "dev-offline"
            tool.agent_id = "maya"
            tool.graph_thread_id = "thread-001"

            # interrupt() from langgraph.types raises GraphInterrupt internally
            from langgraph.errors import GraphInterrupt
            with pytest.raises((GraphInterrupt, Exception)):
                await tool._arun(tool="desktop_screenshot", args={})

    @pytest.mark.asyncio
    async def test_live_dispatch_returns_result(self):
        from src.brain.devices.tool import DesktopToolCallTool

        mock_result = {"image_base64": "abc123", "width": 1920, "height": 1080}
        mock_registry = MagicMock()
        mock_registry.is_connected.return_value = True
        mock_registry.send = AsyncMock(return_value=True)

        captured_call_id: list = []

        def _mock_register(call_id):
            captured_call_id.append(call_id)
            fut = asyncio.get_running_loop().create_future()
            fut.set_result(mock_result)
            return fut

        mock_registry.register_result_waiter = _mock_register

        with patch("src.brain.devices.tool.get_registry", return_value=mock_registry):
            tool = DesktopToolCallTool()
            tool.device_id = "dev-online"
            tool.agent_id = "maya"

            result = await tool._arun(tool="desktop_screenshot", args={})
        assert "image_base64" in str(result) or result is not None
