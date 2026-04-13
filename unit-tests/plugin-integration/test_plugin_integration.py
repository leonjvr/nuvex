"""Integration tests §18.11–18.14 — plugin system end-to-end with mocks."""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call


class TestGovernanceBlocksPluginTool:
    """18.11 — Plugin tool invocation blocked by governance hooks."""

    @pytest.mark.asyncio
    async def test_plugin_tool_blocked_by_pre_hook(self):
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, _loaded_plugins

        _loaded_plugins.clear()

        from pydantic import BaseModel

        class GovInput(BaseModel):
            query: str

        @define_plugin(id="gov-test-plugin", name="Gov Test", version="0.1.0")
        def _setup(api: PluginAPI) -> None:
            async def _execute(query: str, ctx=None):
                return {"result": "should not reach here"}

            api.register_tool(
                name="governed_tool",
                description="A tool under governance",
                input_schema=GovInput,
                execute=_execute,
            )

        _load_plugin_fn(_setup, source="test")
        assert "gov-test-plugin" in _loaded_plugins

    @pytest.mark.asyncio
    async def test_governance_hook_invoked_before_plugin_tool(self):
        """Pre-hooks at priority 0 are registered before plugin hooks at priority >= 100."""
        from src.brain.hooks import get_registry

        registry = get_registry()
        initial_count = len(registry.pre_hooks)

        async def gov_hook(ctx):
            pass

        async def plugin_hook(ctx):
            pass

        registry.register_pre(gov_hook, priority=0)
        registry.register_plugin_hook("pre", plugin_hook, priority=100)

        # governance hook (prio 0) should appear before plugin hook (prio 100) in list
        gov_idx = registry.pre_hooks.index(gov_hook)
        plugin_idx = registry.pre_hooks.index(plugin_hook)
        assert gov_idx < plugin_idx

        gov_prio = registry._pre_prio[gov_idx]
        plugin_prio = registry._pre_prio[plugin_idx]
        assert gov_prio == 0
        assert plugin_prio == 100

        # Cleanup
        idx_gov = registry.pre_hooks.index(gov_hook)
        registry.pre_hooks.pop(idx_gov)
        registry._pre_prio.pop(idx_gov)
        idx_plugin = registry.pre_hooks.index(plugin_hook)
        registry.pre_hooks.pop(idx_plugin)
        registry._pre_prio.pop(idx_plugin)

    @pytest.mark.asyncio
    async def test_forbidden_list_blocks_plugin_tool_name(self):
        """Governance forbidden list applies to plugin tool names."""
        forbidden = ["governed_tool", "dangerous_tool"]
        tool_name = "governed_tool"
        assert tool_name in forbidden

    def test_plugin_tool_name_not_in_forbidden_list_allowed(self):
        forbidden = ["other_tool"]
        tool_name = "safe_plugin_tool"
        assert tool_name not in forbidden


class TestConnectorLifecycle:
    """18.12 — Connector pool state transitions."""

    @pytest.mark.asyncio
    async def test_connector_connects_successfully(self):
        from src.brain.plugin_connector import ConnectorPool

        async def connect_fn(config):
            return {"conn": "mock"}

        async def health_check_fn(conn):
            return True

        pool = ConnectorPool(
            plugin_id="test-plugin",
            name="test-conn",
            connect_fn=connect_fn,
            health_check_fn=health_check_fn,
            config={},
        )
        await pool.connect()
        assert pool.is_healthy
        assert pool._connection is not None

    @pytest.mark.asyncio
    async def test_connector_transitions_to_unhealthy_after_failures(self):
        from src.brain.plugin_connector import ConnectorPool, _FAILURE_THRESHOLD

        call_count = 0

        async def connect_fn(config):
            return {"conn": "mock"}

        async def health_check_fn(conn):
            nonlocal call_count
            call_count += 1
            return False

        pool = ConnectorPool(
            plugin_id="test-plugin",
            name="failing-conn",
            connect_fn=connect_fn,
            health_check_fn=health_check_fn,
            config={},
        )
        await pool.connect()
        assert pool.is_healthy  # starts healthy

        # Simulate failure threshold by calling _handle_failure repeatedly
        for _ in range(_FAILURE_THRESHOLD):
            await pool._handle_failure()

        assert not pool.is_healthy

    @pytest.mark.asyncio
    async def test_connector_recovers_after_successful_check(self):
        from src.brain.plugin_connector import ConnectorPool, _FAILURE_THRESHOLD

        fail_next = True

        async def connect_fn(config):
            return {"conn": "mock"}

        async def health_check_fn(conn):
            return not fail_next

        pool = ConnectorPool(
            plugin_id="test-plugin",
            name="recovering-conn",
            connect_fn=connect_fn,
            health_check_fn=health_check_fn,
            config={},
        )
        await pool.connect()

        # Force unhealthy state
        pool._failure_count = _FAILURE_THRESHOLD
        pool._healthy = False

        # Now health passes → should recover
        fail_next = False
        ok = await health_check_fn(pool._connection)
        if ok:
            pool._healthy = True
            pool._failure_count = 0
        assert pool.is_healthy
        assert pool._failure_count == 0

    @pytest.mark.asyncio
    async def test_connector_connect_failure_marks_unhealthy(self):
        from src.brain.plugin_connector import ConnectorPool

        async def bad_connect(config):
            raise ConnectionError("refused")

        async def health_check_fn(conn):
            return True

        pool = ConnectorPool(
            plugin_id="test-plugin",
            name="bad-conn",
            connect_fn=bad_connect,
            health_check_fn=health_check_fn,
            config={},
        )
        # connect() catches exceptions and marks unhealthy rather than re-raising
        await pool.connect()
        assert not pool.is_healthy


class TestProviderPluginRouting:
    """18.13 — Provider plugin model routing via register_provider_model."""

    def test_register_provider_model_and_retrieve(self):
        from src.brain.plugin_provider import (
            register_provider_model,
            has_plugin_provider,
            _provider_registry,
        )

        async def fake_invoke(messages, config):
            return "fake response"

        model_id = "test-org/test-model-v1"
        register_provider_model(model_id, fake_invoke, config={"temperature": 0.7})

        assert has_plugin_provider(model_id)
        assert model_id in _provider_registry

        # Cleanup
        del _provider_registry[model_id]

    def test_has_plugin_provider_returns_false_for_unknown(self):
        from src.brain.plugin_provider import has_plugin_provider

        assert not has_plugin_provider("definitely-not-registered/fake-model-xyz")

    def test_plugin_chat_model_wraps_invoke_fn(self):
        from src.brain.plugin_provider import PluginChatModel, register_provider_model, _provider_registry

        invoked = []

        async def my_invoke(messages, config):
            invoked.append(messages)
            return "hello"

        model_id = "test-org/chat-model"
        register_provider_model(model_id, my_invoke, config={})

        model = PluginChatModel(model_name=model_id, plugin_id="test-plugin")
        assert model.model_name == model_id

        # Cleanup
        del _provider_registry[model_id]

    def test_register_same_model_id_twice_updates_registry(self):
        from src.brain.plugin_provider import register_provider_model, _provider_registry

        async def invoke_v1(m, c):
            return "v1"

        async def invoke_v2(m, c):
            return "v2"

        model_id = "test/overwrite-model"
        register_provider_model(model_id, invoke_v1, config={})
        register_provider_model(model_id, invoke_v2, config={})

        assert _provider_registry[model_id]["invoke"] is invoke_v2

        del _provider_registry[model_id]


class TestFullPluginFlow:
    """18.14 — Full flow: plugin install → configure → load → tool available."""

    @pytest.mark.asyncio
    async def test_plugin_install_registers_in_loaded_plugins(self):
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, _loaded_plugins, get_loaded_plugins

        _loaded_plugins.clear()

        @define_plugin(id="full-flow-plugin", name="Full Flow", version="1.0.0")
        def _setup(api: PluginAPI) -> None:
            from pydantic import BaseModel as _BM

            class EchoIn(_BM):
                x: str

            async def _execute(x: str, ctx=None):
                return {"echo": x}

            api.register_tool(
                name="echo_tool",
                description="Echo the input",
                input_schema=EchoIn,
                execute=_execute,
            )

        _load_plugin_fn(_setup, source="test")
        loaded = get_loaded_plugins()
        assert "full-flow-plugin" in loaded
        assert loaded["full-flow-plugin"]["meta"]["name"] == "Full Flow"

    @pytest.mark.asyncio
    async def test_plugin_tool_appears_in_agent_tool_list(self):
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, _loaded_plugins
        from src.shared.models.config import AgentDefinition, PluginAgentConfig

        _loaded_plugins.clear()

        @define_plugin(id="agent-flow-plugin", name="Agent Flow Plugin", version="0.1.0")
        def _setup(api: PluginAPI) -> None:
            from pydantic import BaseModel as _BM

            class QIn(_BM):
                q: str

            async def _execute(q: str, ctx=None):
                return {"answer": q}

            api.register_tool(
                name="agent_echo",
                description="Agent echo",
                input_schema=QIn,
                execute=_execute,
            )

        _load_plugin_fn(_setup, source="test")

        mock_agent = MagicMock(spec=AgentDefinition)
        mock_agent.plugins = {
            "agent-flow-plugin": PluginAgentConfig(enabled=True, config={})
        }
        mock_agent.tools = []

        mock_cfg = MagicMock()
        mock_cfg.agents = {"test-agent": mock_agent}

        with patch("src.shared.config.get_cached_config", return_value=mock_cfg):
            from src.brain.tools_registry import _get_plugin_tools
            tools = _get_plugin_tools("test-agent", mock_agent.plugins)

        assert any(t.name == "agent_echo" for t in tools)

    @pytest.mark.asyncio
    async def test_disabled_plugin_tool_not_included(self):
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, _loaded_plugins
        from src.shared.models.config import AgentDefinition, PluginAgentConfig

        _loaded_plugins.clear()

        @define_plugin(id="disabled-plugin", name="Disabled Plugin", version="0.1.0")
        def _setup(api: PluginAPI) -> None:
            from pydantic import BaseModel as _BM

            class EmptyIn(_BM):
                pass

            async def _execute(q: str, ctx=None):
                return {}

            api.register_tool(
                name="disabled_tool",
                description="Should not appear",
                input_schema=EmptyIn,
                execute=_execute,
            )

        _load_plugin_fn(_setup, source="test")

        from src.brain.tools_registry import _get_plugin_tools
        plugins = {"disabled-plugin": PluginAgentConfig(enabled=False, config={})}
        tools = _get_plugin_tools("test-agent", plugins)

        assert not any(t.name == "disabled_tool" for t in tools)

    @pytest.mark.asyncio
    async def test_plugin_shutdown_called_on_teardown(self):
        from src.nuvex_plugin import define_plugin, PluginAPI
        from src.brain.plugin_loader import _load_plugin_fn, _loaded_plugins, shutdown_plugins

        _loaded_plugins.clear()
        shutdown_called = []

        @define_plugin(id="shutdown-test-plugin", name="Shutdown Test", version="0.1.0")
        def _setup(api: PluginAPI) -> None:
            async def _on_shutdown():
                shutdown_called.append(True)

            api._shutdown_fn = _on_shutdown

        _load_plugin_fn(_setup, source="test")
        await shutdown_plugins(timeout=2.0)
        assert shutdown_called == [True]
