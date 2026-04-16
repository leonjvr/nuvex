"""Unit tests for §1 Plugin SDK Package — define_plugin, PluginAPI, etc."""
from __future__ import annotations

import pytest
from pydantic import BaseModel


class TestDefinePlugin:
    """18.1 — define_plugin decorator."""

    def test_metadata_stored_on_function(self):
        from src.nuvex_plugin import define_plugin, PluginAPI

        @define_plugin(id="test-plugin", name="Test Plugin", version="1.0.0")
        def register(api: PluginAPI) -> None:
            pass

        meta = register.__plugin_metadata__
        assert meta["id"] == "test-plugin"
        assert meta["name"] == "Test Plugin"
        assert meta["version"] == "1.0.0"
        assert meta["permissions"] == []

    def test_permissions_stored(self):
        from src.nuvex_plugin import define_plugin, PluginAPI

        @define_plugin(id="p", name="P", permissions=["network", "env:API_KEY"])
        def register(api: PluginAPI) -> None:
            pass

        assert register.__plugin_metadata__["permissions"] == ["network", "env:API_KEY"]

    def test_requires_stored(self):
        from src.nuvex_plugin import define_plugin, PluginAPI

        @define_plugin(id="p2", name="P2", requires=["other-plugin"])
        def register(api: PluginAPI) -> None:
            pass

        assert register.__plugin_metadata__["requires"] == ["other-plugin"]

    def test_missing_id_raises(self):
        from src.nuvex_plugin import PluginDefinitionError, define_plugin

        with pytest.raises(PluginDefinitionError):
            @define_plugin(id="", name="Missing ID")
            def register(api):
                pass

    def test_missing_name_raises(self):
        from src.nuvex_plugin import PluginDefinitionError, define_plugin

        with pytest.raises(PluginDefinitionError):
            @define_plugin(id="my-plugin", name="")
            def register(api):
                pass

    def test_default_version(self):
        from src.nuvex_plugin import define_plugin, PluginAPI

        @define_plugin(id="p3", name="P3")
        def register(api: PluginAPI) -> None:
            pass

        assert register.__plugin_metadata__["version"] == "0.1.0"


class TestPluginAPIRegisterTool:
    """18.2 — PluginAPI.register_tool."""

    def _make_api(self, permissions=None):
        from src.nuvex_plugin import PluginAPI
        return PluginAPI("test-plugin", "Test Plugin", permissions or [])

    def test_tool_registered_successfully(self):
        class MySchema(BaseModel):
            query: str

        api = self._make_api()
        api.register_tool("search", "Search tool", MySchema, lambda ctx, args: None)
        assert "search" in api._tools

    def test_tool_schema_stored(self):
        class MySchema(BaseModel):
            query: str

        api = self._make_api()
        api.register_tool("search", "desc", MySchema, lambda ctx, args: None)
        assert api._tools["search"]["input_schema"] is MySchema

    def test_optional_flag_stored(self):
        class MySchema(BaseModel):
            x: int

        api = self._make_api()
        api.register_tool("opt-tool", "desc", MySchema, lambda ctx, args: None, optional=True)
        assert api._tools["opt-tool"]["optional"] is True

    def test_duplicate_name_raises_conflict_error(self):
        from src.nuvex_plugin import PluginConflictError

        class MySchema(BaseModel):
            x: int

        api = self._make_api()
        api.register_tool("tool", "desc", MySchema, lambda ctx, args: None)
        with pytest.raises(PluginConflictError):
            api.register_tool("tool", "desc2", MySchema, lambda ctx, args: None)

    def test_non_pydantic_schema_raises(self):
        from src.nuvex_plugin import PluginDefinitionError

        api = self._make_api()
        with pytest.raises(PluginDefinitionError):
            api.register_tool("bad", "desc", dict, lambda ctx, args: None)

    def test_register_hook_valid_priority(self):
        api = self._make_api()
        api.register_hook("pre_tool", lambda ctx: None, priority=100)
        assert len(api._hooks) == 1
        assert api._hooks[0]["priority"] == 100

    def test_register_hook_below_100_raises(self):
        from src.nuvex_plugin import PluginPermissionError

        api = self._make_api()
        with pytest.raises(PluginPermissionError):
            api.register_hook("pre_tool", lambda ctx: None, priority=50)

    def test_register_hook_priority_0_raises(self):
        from src.nuvex_plugin import PluginPermissionError

        api = self._make_api()
        with pytest.raises(PluginPermissionError):
            api.register_hook("post_tool", lambda ctx: None, priority=0)

    def test_register_connector(self):
        class ConfSchema(BaseModel):
            url: str

        api = self._make_api()
        api.register_connector("my-conn", ConfSchema, lambda c: None, lambda: True)
        assert "my-conn" in api._connectors

    def test_register_provider(self):
        api = self._make_api()
        api.register_provider("my-provider", "My Provider", ["my/model"], lambda m, c, t: None)
        assert "my-provider" in api._providers

    def test_register_channel(self):
        api = self._make_api()
        api.register_channel("my-chan", "My Channel", lambda m: None, lambda: None, lambda: True)
        assert "my-chan" in api._channels

    def test_register_config_schema(self):
        api = self._make_api()
        schema = {"api_key": {"type": "string", "secret": True}}
        api.register_config_schema(schema)
        assert api._config_schema == schema

    def test_register_http_route(self):
        api = self._make_api()
        api.register_http_route("/webhook", lambda req: None, ["POST"])
        assert len(api._http_routes) == 1
        assert api._http_routes[0]["path"] == "/webhook"


class TestExecutionContext:
    """ExecutionContext dataclass."""

    def test_fields(self):
        from src.nuvex_plugin import ExecutionContext

        ctx = ExecutionContext(agent_id="agent1", thread_id="thread1", plugin_config={"key": "val"})
        assert ctx.agent_id == "agent1"
        assert ctx.thread_id == "thread1"
        assert ctx.plugin_config == {"key": "val"}

    def test_default_plugin_config(self):
        from src.nuvex_plugin import ExecutionContext

        ctx = ExecutionContext(agent_id="a", thread_id="t")
        assert ctx.plugin_config == {}


class TestHookResult:
    """HookResult dataclass."""

    def test_defaults(self):
        from src.nuvex_plugin import HookResult

        r = HookResult()
        assert r.block is False
        assert r.require_approval is False
        assert r.reason is None

    def test_block(self):
        from src.nuvex_plugin import HookResult

        r = HookResult(block=True, reason="forbidden")
        assert r.block is True
        assert r.reason == "forbidden"
