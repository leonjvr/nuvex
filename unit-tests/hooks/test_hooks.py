"""Unit tests — hooks: pre/post hook execution, abort, input mutation, timeout."""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock

from src.brain.hooks import (
    HookContext,
    HookRegistry,
    _HOOK_TIMEOUT,
    _run_hooks,
    run_pre_hooks,
    run_post_hooks,
    _registry,
)


@pytest.fixture(autouse=True)
def clear_hook_registry():
    """Isolate hook registry between tests."""
    original_pre = list(_registry.pre_hooks)
    original_post = list(_registry.post_hooks)
    _registry.pre_hooks.clear()
    _registry.post_hooks.clear()
    yield
    _registry.pre_hooks.clear()
    _registry.post_hooks.clear()
    _registry.pre_hooks.extend(original_pre)
    _registry.post_hooks.extend(original_post)


def _ctx(**kwargs) -> HookContext:
    defaults = dict(agent_id="maya", thread_id="t1", tool_name="shell", tool_input={})
    defaults.update(kwargs)
    return HookContext(**defaults)


# ---------------------------------------------------------------------------
# HookContext
# ---------------------------------------------------------------------------

class TestHookContext:
    def test_defaults_abort_false(self):
        ctx = _ctx()
        assert ctx.abort is False
        assert ctx.abort_reason == ""

    def test_defaults_mutated_input_none(self):
        ctx = _ctx()
        assert ctx.mutated_input is None

    def test_can_set_abort(self):
        ctx = _ctx()
        ctx.abort = True
        ctx.abort_reason = "blocked"
        assert ctx.abort is True


# ---------------------------------------------------------------------------
# Hook execution order
# ---------------------------------------------------------------------------

class TestHookExecutionOrder:
    @pytest.mark.asyncio
    async def test_hooks_called_in_registration_order(self):
        calls = []

        async def hook_a(ctx):
            calls.append("a")

        async def hook_b(ctx):
            calls.append("b")

        registry = HookRegistry()
        registry.register_pre(hook_a)
        registry.register_pre(hook_b)

        await _run_hooks(registry.pre_hooks, _ctx())
        assert calls == ["a", "b"]

    @pytest.mark.asyncio
    async def test_all_hooks_called_even_if_one_raises(self):
        calls = []

        async def bad_hook(ctx):
            raise RuntimeError("fail")

        async def good_hook(ctx):
            calls.append("good")

        registry = HookRegistry()
        registry.register_pre(bad_hook)
        registry.register_pre(good_hook)

        await _run_hooks(registry.pre_hooks, _ctx())
        assert "good" in calls


# ---------------------------------------------------------------------------
# Abort support (21.7)
# ---------------------------------------------------------------------------

class TestHookAbort:
    @pytest.mark.asyncio
    async def test_hook_can_set_abort(self):
        async def aborting_hook(ctx: HookContext):
            ctx.abort = True
            ctx.abort_reason = "test abort"

        _registry.pre_hooks.append(aborting_hook)
        ctx = _ctx()
        await run_pre_hooks(ctx)

        assert ctx.abort is True
        assert ctx.abort_reason == "test abort"

    @pytest.mark.asyncio
    async def test_abort_not_set_without_hook(self):
        ctx = _ctx()
        await run_pre_hooks(ctx)
        assert ctx.abort is False


# ---------------------------------------------------------------------------
# Input mutation (21.6)
# ---------------------------------------------------------------------------

class TestHookInputMutation:
    @pytest.mark.asyncio
    async def test_hook_can_mutate_input(self):
        async def mutating_hook(ctx: HookContext):
            ctx.mutated_input = {"command": "echo safe"}

        _registry.pre_hooks.append(mutating_hook)
        ctx = _ctx(tool_input={"command": "dangerous"})
        await run_pre_hooks(ctx)

        assert ctx.mutated_input == {"command": "echo safe"}

    @pytest.mark.asyncio
    async def test_mutated_input_persists_through_all_hooks(self):
        async def first(ctx: HookContext):
            ctx.mutated_input = {"v": 1}

        async def second(ctx: HookContext):
            # Second hook reads mutated input set by first
            assert ctx.mutated_input == {"v": 1}

        _registry.pre_hooks.extend([first, second])
        ctx = _ctx()
        await run_pre_hooks(ctx)


# ---------------------------------------------------------------------------
# Hook timeout (21.9)
# ---------------------------------------------------------------------------

class TestHookTimeout:
    def test_hook_timeout_is_5_seconds(self):
        assert _HOOK_TIMEOUT == 5.0

    @pytest.mark.asyncio
    async def test_slow_hook_does_not_block_execution(self):
        """A hook that sleeps longer than timeout must not prevent subsequent hooks from running."""
        calls = []

        async def slow_hook(ctx):
            await asyncio.sleep(10)  # will be cancelled by timeout
            calls.append("slow")

        async def fast_hook(ctx):
            calls.append("fast")

        registry = HookRegistry()
        registry.register_pre(slow_hook)
        registry.register_pre(fast_hook)

        import asyncio as _asyncio
        from unittest.mock import patch
        # Patch timeout to 0.01s to keep test fast
        with patch("src.brain.hooks._HOOK_TIMEOUT", 0.01):
            await _run_hooks(registry.pre_hooks, _ctx())

        assert "fast" in calls
        assert "slow" not in calls
