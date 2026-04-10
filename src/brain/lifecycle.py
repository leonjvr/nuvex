"""Agent lifecycle manager — track idle/active/suspended/error states."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Awaitable

from sqlalchemy import select

from .db import get_session
from .models.agent import Agent
from .models.lifecycle import AgentLifecycleEvent

log = logging.getLogger(__name__)


class LifecycleState(str, Enum):
    Spawning = "spawning"
    TrustRequired = "trust_required"
    ReadyForPrompt = "ready_for_prompt"
    Running = "running"
    Finished = "finished"
    Failed = "failed"
    # Legacy states for DB compatibility
    idle = "idle"
    active = "active"
    suspended = "suspended"
    error = "error"
    terminated = "terminated"


VALID_STATES = {s.value for s in LifecycleState}

# Valid lifecycle transitions (from → set of allowed tos)
TRANSITIONS: dict[str, set[str]] = {
    "spawning": {"trust_required", "ready_for_prompt", "failed"},
    "trust_required": {"ready_for_prompt", "failed"},
    "ready_for_prompt": {"running", "failed"},
    "running": {"finished", "failed", "ready_for_prompt"},
    "finished": {"ready_for_prompt", "spawning"},
    "failed": {"ready_for_prompt", "spawning"},
    # Legacy
    "idle": {"active", "suspended", "terminated"},
    "active": {"idle", "error", "terminated"},
    "suspended": {"idle", "terminated"},
    "error": {"idle", "terminated"},
    "terminated": set(),
}

InvocationFn = Callable[[], Awaitable[Any]]


@dataclass
class _RegistryEntry:
    state: str = LifecycleState.idle.value
    last_state_change: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    queued_count: int = 0
    _queue: asyncio.Queue[InvocationFn] = field(default_factory=asyncio.Queue)
    # Semaphore(1): only one invocation may hold the MCP-spawning hot path at a time.
    # Concurrent retries wait here rather than each spawning their own npx processes.
    _sem: asyncio.Semaphore = field(default_factory=lambda: asyncio.Semaphore(1))


# In-memory registry: agent_id → _RegistryEntry
_registry: dict[str, _RegistryEntry] = {}


def _get_or_create(agent_id: str) -> _RegistryEntry:
    if agent_id not in _registry:
        _registry[agent_id] = _RegistryEntry()
    return _registry[agent_id]


def get_registry_state(agent_id: str) -> str | None:
    """Return the in-memory lifecycle state for an agent."""
    entry = _registry.get(agent_id)
    return entry.state if entry else None


def set_registry_state(agent_id: str, state: str) -> None:
    """Update the in-memory registry state."""
    entry = _get_or_create(agent_id)
    entry.state = state
    entry.last_state_change = datetime.now(timezone.utc)


def get_queued_count(agent_id: str) -> int:
    return _registry.get(agent_id, _RegistryEntry()).queued_count


async def queue_invocation(agent_id: str, fn: InvocationFn) -> Any:
    """Serialise invocations per agent to prevent MCP process leaks.

    Only one invocation may run at a time per agent.  Additional calls block on
    the per-agent semaphore and are served in arrival order.  This prevents the
    race where concurrent retries each spawn their own npx MCP processes before
    the first invoke has reached the lifecycle_start graph node (which is the
    point that would normally flip state → Running).
    """
    entry = _get_or_create(agent_id)
    entry.queued_count += 1
    try:
        async with entry._sem:
            return await fn()
    finally:
        entry.queued_count -= 1


async def _drain_queue(agent_id: str) -> None:
    """No-op kept for backward compatibility and legacy DB state transitions.

    Serialisation is now handled by the per-agent semaphore inside
    queue_invocation — there is no internal asyncio.Queue to drain.
    """


async def set_agent_state(agent_id: str, state: str, reason: str = "") -> None:
    """Transition an agent to a new lifecycle state and persist it."""
    if state not in VALID_STATES:
        raise ValueError(f"Invalid lifecycle state: {state}")

    set_registry_state(agent_id, state)

    async with get_session() as session:
        result = await session.execute(select(Agent).where(Agent.id == agent_id))
        row: Agent | None = result.scalar_one_or_none()
        if row is None:
            log.warning("lifecycle: unknown agent_id=%s", agent_id)
            return
        prev_state = row.lifecycle_state
        log.info("lifecycle: agent=%s %s → %s reason=%s", agent_id, prev_state, state, reason)
        row.lifecycle_state = state
        now = datetime.now(timezone.utc)
        row.updated_at = now
        # Persist error details on the agent row so diagnostics can surface them
        if state in ("error", "failed") and reason:
            row.last_error = reason
            row.last_error_at = now
        # Insert lifecycle event
        session.add(AgentLifecycleEvent(
            agent_id=agent_id,
            from_state=prev_state,
            to_state=state,
            invocation_id=None,
            reason=reason[:500] if reason else None,
        ))
        await session.commit()

    # Drain queued invocations when agent becomes available
    if state in (LifecycleState.Finished.value, LifecycleState.Failed.value,
                 LifecycleState.ReadyForPrompt.value, LifecycleState.idle.value):
        asyncio.ensure_future(_drain_queue(agent_id))


async def get_agent_state(agent_id: str) -> str | None:
    # Prefer in-memory (faster) — fall back to DB
    mem_state = get_registry_state(agent_id)
    if mem_state is not None:
        return mem_state
    async with get_session() as session:
        result = await session.execute(
            select(Agent.lifecycle_state).where(Agent.id == agent_id)
        )
        db_state = result.scalar_one_or_none()
        if db_state:
            set_registry_state(agent_id, db_state)
        return db_state


async def record_agent_note(agent_id: str, note: str) -> None:
    """Insert an informational lifecycle event without changing state.

    Used to surface non-error events (e.g. model fallback) in the diagnostics
    timeline without triggering a state transition.
    """
    async with get_session() as session:
        result = await session.execute(select(Agent).where(Agent.id == agent_id))
        row: Agent | None = result.scalar_one_or_none()
        if row is None:
            return
        current = row.lifecycle_state
        session.add(AgentLifecycleEvent(
            agent_id=agent_id,
            from_state=current,
            to_state=current,
            invocation_id=None,
            reason=note[:500],
        ))
        await session.commit()
