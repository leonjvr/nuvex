"""Unit tests — lifecycle: state machine, registry, and invocation queuing."""
from __future__ import annotations

import asyncio
import pytest

from src.brain.lifecycle import (
    LifecycleState,
    TRANSITIONS,
    _registry,
    get_registry_state,
    set_registry_state,
    get_queued_count,
    queue_invocation,
    _drain_queue,
    _get_or_create,
)


@pytest.fixture(autouse=True)
def clear_registry():
    """Reset the in-memory registry between tests."""
    _registry.clear()
    yield
    _registry.clear()


# ---------------------------------------------------------------------------
# LifecycleState enum
# ---------------------------------------------------------------------------

class TestLifecycleState:
    def test_enum_values_are_strings(self):
        for state in LifecycleState:
            assert isinstance(state.value, str)

    def test_running_state_exists(self):
        assert LifecycleState.Running.value == "running"

    def test_finished_state_exists(self):
        assert LifecycleState.Finished.value == "finished"

    def test_failed_state_exists(self):
        assert LifecycleState.Failed.value == "failed"

    def test_spawning_state_exists(self):
        assert LifecycleState.Spawning.value == "spawning"


# ---------------------------------------------------------------------------
# TRANSITIONS map
# ---------------------------------------------------------------------------

class TestTransitions:
    def test_running_can_transition_to_finished(self):
        assert "finished" in TRANSITIONS["running"]

    def test_running_can_transition_to_failed(self):
        assert "failed" in TRANSITIONS["running"]

    def test_spawning_cannot_transition_to_running_directly(self):
        assert "running" not in TRANSITIONS["spawning"]

    def test_terminated_has_no_outgoing_transitions(self):
        assert TRANSITIONS["terminated"] == set()

    def test_finished_can_go_back_to_ready_for_prompt(self):
        assert "ready_for_prompt" in TRANSITIONS["finished"]

    def test_failed_can_go_back_to_ready_for_prompt(self):
        assert "ready_for_prompt" in TRANSITIONS["failed"]


# ---------------------------------------------------------------------------
# Registry operations
# ---------------------------------------------------------------------------

class TestRegistry:
    def test_get_registry_state_returns_none_for_unknown(self):
        assert get_registry_state("nobody") is None

    def test_set_then_get_registry_state(self):
        set_registry_state("agent-x", "running")
        assert get_registry_state("agent-x") == "running"

    def test_overwrite_state(self):
        set_registry_state("agent-x", "running")
        set_registry_state("agent-x", "finished")
        assert get_registry_state("agent-x") == "finished"

    def test_get_queued_count_returns_zero_for_unknown(self):
        assert get_queued_count("nobody") == 0

    def test_get_queued_count_returns_zero_for_idle_agent(self):
        set_registry_state("agent-x", "idle")
        assert get_queued_count("agent-x") == 0


# ---------------------------------------------------------------------------
# queue_invocation
# ---------------------------------------------------------------------------

class TestQueueInvocation:
    @pytest.mark.asyncio
    async def test_idle_agent_runs_immediately(self):
        called = []

        async def fn():
            called.append(True)
            return "result"

        set_registry_state("agent-x", "idle")
        result = await queue_invocation("agent-x", fn)

        assert result == "result"
        assert len(called) == 1

    @pytest.mark.asyncio
    async def test_unknown_agent_runs_immediately(self):
        """Agents not in registry should be treated as not-running."""
        called = []

        async def fn():
            called.append(True)
            return "done"

        result = await queue_invocation("new-agent", fn)
        assert result == "done"

    @pytest.mark.asyncio
    async def test_concurrent_invocations_are_serialised(self):
        """Concurrent queue_invocation calls must execute one at a time (semaphore).

        This prevents the MCP process leak: if two requests arrive while the
        agent is starting, both used to immediately enter load_mcp_tools and
        spawn separate npx processes.  Now the second blocks on the semaphore
        until the first completes.
        """
        order: list[str] = []
        gate = asyncio.Event()

        async def slow_fn():
            order.append("slow_start")
            await gate.wait()        # holds the semaphore until released
            order.append("slow_end")
            return "slow"

        async def fast_fn():
            order.append("fast")
            return "fast"

        # Launch slow first (it will hold the semaphore)
        slow_task = asyncio.create_task(queue_invocation("agent-y", slow_fn))
        await asyncio.sleep(0)       # let slow_start execute

        # fast_fn is queued behind the semaphore
        fast_task = asyncio.create_task(queue_invocation("agent-y", fast_fn))
        await asyncio.sleep(0)

        # While slow holds the lock, queued_count reflects both tasks
        assert get_queued_count("agent-y") == 2

        # Release slow; fast should run next
        gate.set()
        slow_result = await slow_task
        fast_result = await fast_task

        assert slow_result == "slow"
        assert fast_result == "fast"
        # Strict ordering: slow fully completes before fast starts
        assert order == ["slow_start", "slow_end", "fast"]

    @pytest.mark.asyncio
    async def test_drain_queue_is_noop(self):
        """_drain_queue is a no-op stub; calling it should not raise."""
        await _drain_queue("nonexistent-agent")
        set_registry_state("agent-z", "idle")
        await _drain_queue("agent-z")  # nothing to drain
