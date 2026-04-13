"""Unit tests for §6 Hook Registry Refactor — priority ordering."""
from __future__ import annotations

import pytest


class TestHookPriorityOrdering:
    """18.5 — Priority ordering: lower priority runs first, same priority = registration order."""

    @pytest.mark.asyncio
    async def test_lower_priority_runs_first(self):
        from src.brain.hooks import HookContext, HookRegistry, _run_pre_hooks

        calls = []

        async def hook_high(ctx):
            calls.append("high")

        async def hook_low(ctx):
            calls.append("low")

        registry = HookRegistry()
        registry.register_pre(hook_high, priority=100)
        registry.register_pre(hook_low, priority=0)

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="tool", tool_input={})
        await _run_pre_hooks(registry.pre_hooks, ctx)
        assert calls == ["low", "high"]

    @pytest.mark.asyncio
    async def test_same_priority_registration_order(self):
        from src.brain.hooks import HookContext, HookRegistry, _run_pre_hooks

        calls = []

        async def hook_first(ctx):
            calls.append("first")

        async def hook_second(ctx):
            calls.append("second")

        registry = HookRegistry()
        registry.register_pre(hook_first, priority=50)
        registry.register_pre(hook_second, priority=50)

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="tool", tool_input={})
        await _run_pre_hooks(registry.pre_hooks, ctx)
        assert calls == ["first", "second"]

    @pytest.mark.asyncio
    async def test_governance_before_plugin(self):
        from src.brain.hooks import HookContext, HookRegistry, _run_pre_hooks

        calls = []

        async def governance_hook(ctx):
            calls.append("governance")

        async def plugin_hook(ctx):
            calls.append("plugin")

        registry = HookRegistry()
        registry.register_pre(plugin_hook, priority=100)    # plugin
        registry.register_pre(governance_hook, priority=0)  # governance

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="tool", tool_input={})
        await _run_pre_hooks(registry.pre_hooks, ctx)
        assert calls[0] == "governance"
        assert calls[1] == "plugin"

    def test_register_plugin_hook_below_100_raises(self):
        from src.brain.hooks import HookRegistry
        from src.nuvex_plugin import PluginPermissionError

        registry = HookRegistry()

        async def bad_hook(ctx): pass

        with pytest.raises(PluginPermissionError):
            registry.register_plugin_hook("pre", bad_hook, priority=50)

    def test_register_plugin_hook_at_100_ok(self):
        from src.brain.hooks import HookRegistry

        registry = HookRegistry()

        async def good_hook(ctx): pass

        registry.register_plugin_hook("pre", good_hook, priority=100)
        assert good_hook in registry.pre_hooks

    def test_register_plugin_hook_zero_raises(self):
        from src.brain.hooks import HookRegistry
        from src.nuvex_plugin import PluginPermissionError

        registry = HookRegistry()

        async def bad_hook(ctx): pass

        with pytest.raises(PluginPermissionError):
            registry.register_plugin_hook("pre", bad_hook, priority=0)


class TestHookResultProcessing:
    """18.6 — HookResult processing: block, require_approval, None return, legacy ctx.abort."""

    @pytest.mark.asyncio
    async def test_block_stops_chain(self):
        from src.brain.hooks import HookContext, HookRegistry, HookResult, _run_pre_hooks

        calls = []

        async def blocking_hook(ctx):
            calls.append("blocking")
            return HookResult(block=True, reason="forbidden")

        async def after_hook(ctx):
            calls.append("after")

        registry = HookRegistry()
        registry.register_pre(blocking_hook)
        registry.register_pre(after_hook)

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="tool", tool_input={})
        await _run_pre_hooks(registry.pre_hooks, ctx)
        assert "blocking" in calls
        assert "after" not in calls
        assert ctx.abort is True
        assert "forbidden" in ctx.abort_reason

    @pytest.mark.asyncio
    async def test_require_approval_sets_flag(self):
        from src.brain.hooks import HookContext, HookRegistry, HookResult, _run_pre_hooks

        async def approval_hook(ctx):
            return HookResult(require_approval=True, reason="needs approval")

        registry = HookRegistry()
        registry.register_pre(approval_hook)

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="tool", tool_input={})
        await _run_pre_hooks(registry.pre_hooks, ctx)
        assert ctx.abort is True
        assert ctx.require_approval is True

    @pytest.mark.asyncio
    async def test_none_return_continues_chain(self):
        from src.brain.hooks import HookContext, HookRegistry, _run_pre_hooks

        calls = []

        async def hook_a(ctx):
            calls.append("a")
            return None

        async def hook_b(ctx):
            calls.append("b")

        registry = HookRegistry()
        registry.register_pre(hook_a)
        registry.register_pre(hook_b)

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="tool", tool_input={})
        await _run_pre_hooks(registry.pre_hooks, ctx)
        assert calls == ["a", "b"]

    @pytest.mark.asyncio
    async def test_legacy_ctx_abort_still_works(self):
        from src.brain.hooks import HookContext, HookRegistry, _run_pre_hooks

        async def legacy_hook(ctx):
            ctx.abort = True
            ctx.abort_reason = "legacy block"

        async def after_hook(ctx):
            pass  # legacy hooks don't use HookResult, so chain still runs

        registry = HookRegistry()
        registry.register_pre(legacy_hook)
        registry.register_pre(after_hook)

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="tool", tool_input={})
        await _run_pre_hooks(registry.pre_hooks, ctx)
        # Legacy hooks that set ctx.abort but return None don't stop the chain
        # (only HookResult.block stops the chain via _run_pre_hooks)
        assert ctx.abort is True


class TestHookContextPluginFields:
    """§6.4 — plugin_id and plugin_config fields on HookContext."""

    def test_plugin_id_field_exists(self):
        from src.brain.hooks import HookContext

        ctx = HookContext(
            agent_id="a", thread_id="t", tool_name="tool", tool_input={},
            plugin_id="my-plugin"
        )
        assert ctx.plugin_id == "my-plugin"

    def test_plugin_config_field_exists(self):
        from src.brain.hooks import HookContext

        ctx = HookContext(
            agent_id="a", thread_id="t", tool_name="tool", tool_input={},
            plugin_config={"api_key": "secret"}
        )
        assert ctx.plugin_config == {"api_key": "secret"}

    def test_backwards_compat_skill_fields(self):
        from src.brain.hooks import HookContext

        ctx = HookContext(
            agent_id="a", thread_id="t", tool_name="tool", tool_input={},
            skill_name="my-skill", skill_env={"KEY": "val"}
        )
        assert ctx.skill_name == "my-skill"
        assert ctx.skill_env == {"KEY": "val"}

    def test_defaults_are_none(self):
        from src.brain.hooks import HookContext

        ctx = HookContext(agent_id="a", thread_id="t", tool_name="tool", tool_input={})
        assert ctx.plugin_id is None
        assert ctx.plugin_config is None
