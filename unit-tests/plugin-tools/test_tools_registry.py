"""Unit tests for §7 Tools Registry Refactor — plugin tool collection."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


class TestGetToolsForAgent:
    """18.9 — get_tools_for_agent built-in + plugin tools, per-agent filtering."""

    @pytest.mark.asyncio
    async def test_returns_builtin_tools_by_default(self):
        from src.brain.tools_registry import get_tools_for_agent

        with patch("src.shared.config.get_cached_config") as mock_cfg:
            mock_cfg.side_effect = Exception("no config")
            tools = await get_tools_for_agent("maya")
        # Should return filtered list without crashing
        assert isinstance(tools, list)

    @pytest.mark.asyncio
    async def test_plugin_tools_included_for_enabled_plugins(self):
        from pydantic import BaseModel
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, _loaded_plugins

        _loaded_plugins.clear()

        class MyInput(BaseModel):
            query: str

        async def execute(ctx, args):
            return "ok"

        @define_plugin(id="test-plugin", name="Test Plugin")
        def register(api: PluginAPI):
            api.register_tool("plugin-tool", "desc", MyInput, execute)

        _load_plugin_fn(register, "test")

        mock_agent = MagicMock()
        mock_agent.tier = "T2"
        mock_agent.mcp_servers = {}
        mock_agent.skills = []
        mock_agent.workspace = None
        mock_agent.plugins = {"test-plugin": MagicMock(enabled=True)}

        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent

        with patch("src.shared.config.get_cached_config", return_value=mock_cfg):
            from src.brain.tools_registry import get_tools_for_agent
            tools = await get_tools_for_agent("maya")

        plugin_tool_names = [t.name for t in tools]
        assert "plugin-tool" in plugin_tool_names

        _loaded_plugins.clear()

    @pytest.mark.asyncio
    async def test_disabled_plugin_tools_excluded(self):
        from pydantic import BaseModel
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, _loaded_plugins

        _loaded_plugins.clear()

        class MyInput(BaseModel):
            query: str

        @define_plugin(id="disabled-plugin", name="Disabled Plugin")
        def register(api: PluginAPI):
            api.register_tool("disabled-tool", "desc", MyInput, lambda c, a: "ok")

        _load_plugin_fn(register, "test")

        mock_agent = MagicMock()
        mock_agent.tier = "T2"
        mock_agent.mcp_servers = {}
        mock_agent.skills = []
        mock_agent.workspace = None
        mock_agent.plugins = {"disabled-plugin": MagicMock(enabled=False)}

        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent

        with patch("src.shared.config.get_cached_config", return_value=mock_cfg):
            from src.brain.tools_registry import get_tools_for_agent
            tools = await get_tools_for_agent("maya")

        plugin_tool_names = [t.name for t in tools]
        assert "disabled-tool" not in plugin_tool_names

        _loaded_plugins.clear()

    @pytest.mark.asyncio
    async def test_plugin_not_loaded_skipped_gracefully(self):
        from src.brain.plugin_loader import _loaded_plugins

        _loaded_plugins.clear()

        mock_agent = MagicMock()
        mock_agent.tier = "T2"
        mock_agent.mcp_servers = {}
        mock_agent.skills = []
        mock_agent.workspace = None
        mock_agent.plugins = {"nonexistent-plugin": MagicMock(enabled=True)}

        mock_cfg = MagicMock()
        mock_cfg.agents.get.return_value = mock_agent

        with patch("src.shared.config.get_cached_config", return_value=mock_cfg):
            from src.brain.tools_registry import get_tools_for_agent
            tools = await get_tools_for_agent("maya")
        # Should not crash, just return without plugin tools
        assert isinstance(tools, list)
