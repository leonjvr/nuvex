"""Event-driven agent triggers.

Subscribes to event bus lanes that should cause a graph.ainvoke() run:

  - cron.execution  → run the agent named in the cron payload (§22.6)
  - arousal.proactive_wake → wake the idle agent (§30.3.2)

Both handlers use _invoke_internal which already handles queue serialisation,
model resolution, and thread persistence.
"""
from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)


async def _handle_cron_execution(payload: dict[str, Any]) -> None:
    """Translate a cron.execution event into a graph invocation."""
    agent_id: str | None = payload.get("agent_id")
    cron_name: str = payload.get("cron_name", "unnamed-cron-job")
    task: str = payload.get("task", "")
    if not agent_id:
        log.warning("triggers: cron.execution missing agent_id — skipping")
        return

    message = task or f"Scheduled cron job '{cron_name}' has fired. Carry out your scheduled duties."
    thread_id = f"cron:{agent_id}:{cron_name}"
    log.info("triggers: cron.execution → invoking agent=%s job=%s", agent_id, cron_name)
    try:
        from .routers.invoke import _invoke_internal
        await _invoke_internal(
            agent_id=agent_id,
            message=message,
            thread_id=thread_id,
            channel="cron",
            sender="system",
        )
    except Exception as exc:
        log.error("triggers: cron.execution invoke failed agent=%s job=%s: %s", agent_id, cron_name, exc)


async def _handle_proactive_wake(payload: dict[str, Any]) -> None:
    """Translate an arousal.proactive_wake event into a graph invocation."""
    agent_id: str | None = payload.get("agent_id")
    trigger_reason: str = payload.get("trigger_reason", "proactive_wake")
    arousal_score: float = payload.get("arousal_score") or 0.0
    if not agent_id:
        log.warning("triggers: arousal.proactive_wake missing agent_id — skipping")
        return

    message = (
        f"You have been proactively woken (reason: {trigger_reason}, "
        f"arousal_score: {arousal_score:.2f}). "
        "Review your pending tasks and take the most important next action."
    )
    thread_id = f"arousal:{agent_id}:proactive"
    log.info("triggers: arousal.proactive_wake → invoking agent=%s reason=%s", agent_id, trigger_reason)
    try:
        from .routers.invoke import _invoke_internal
        await _invoke_internal(
            agent_id=agent_id,
            message=message,
            thread_id=thread_id,
            channel="arousal",
            sender="system",
        )
    except Exception as exc:
        log.error("triggers: proactive_wake invoke failed agent=%s: %s", agent_id, exc)


def register_trigger_subscribers() -> None:
    """Subscribe both handlers to their event lanes.

    Called once at brain startup (server.py lifespan).
    """
    from .events import subscribe
    subscribe("cron.execution", _handle_cron_execution)
    subscribe("arousal.proactive_wake", _handle_proactive_wake)
    log.info("triggers: subscribed to cron.execution and arousal.proactive_wake")
