"""Outcome scorer and memory confidence updater (Section 29)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select, text

from .db import get_session
from .models.outcomes import MemoryRetrieval, Outcome, RoutingOutcome
from .state import AgentState

log = logging.getLogger(__name__)

# Confidence adjustment constants (spec §29.2.2)
BASE_SUCCESS_DELTA = 0.05
BASE_FAILURE_DELTA = -0.08
USER_CONFIRMED_MULTIPLIER = 2.0
CONFIDENCE_FLOOR = 0.1
CONFIDENCE_CEILING = 1.0
IMMUNITY_RETRIEVAL_COUNT = 5  # memories above this are immune from failure penalty


def _classify_error(state: AgentState) -> str | None:
    """Map terminal state flags to an error_class string."""
    if state.budget_exceeded:
        return "OutOfBudget"
    if state.iteration >= state.max_iterations and not state.finished:
        return None  # unclassified timeout
    return None


async def score_thread(state: AgentState, start_time: datetime) -> Outcome:
    """Write one outcomes row for the completed thread invocation."""
    now = datetime.now(timezone.utc)
    duration_s = (now - start_time).total_seconds() if start_time else 0.0

    succeeded = bool(state.finished and not state.error and not state.budget_exceeded)
    error_class = _classify_error(state)

    # Derive user_confirmed and denial_count from governance_audit
    user_confirmed = False
    denial_count = 0
    try:
        async with get_session() as session:
            result = await session.execute(
                text(
                    "SELECT decision FROM governance_audit "
                    "WHERE thread_id = :tid"
                ),
                {"tid": state.thread_id},
            )
            for (decision,) in result.fetchall():
                if decision == "approved":
                    user_confirmed = True
                elif decision == "denied":
                    denial_count += 1
    except Exception as exc:
        log.warning("score_thread: could not read governance_audit: %s", exc)

    # Collect tool names from tool_results
    tools_used: list[str] = [
        r.get("tool_name", "") for r in (state.tool_results or []) if r.get("tool_name")
    ]

    outcome = Outcome(
        thread_id=state.thread_id,
        agent_id=state.agent_id,
        invocation_id=state.invocation_id,
        succeeded=succeeded,
        user_confirmed=user_confirmed,
        cost_usd=state.cost_usd,
        duration_s=duration_s,
        tools_used=tools_used,
        denial_count=denial_count,
        iteration_count=state.iteration,
        error_class=error_class,
    )

    try:
        async with get_session() as session:
            session.add(outcome)
            await session.commit()
    except Exception as exc:
        log.error("score_thread: failed to persist outcome: %s", exc)

    return outcome


async def adjust_memory_confidence(thread_id: str, outcome: Outcome) -> None:
    """Adjust confidence scores for memories retrieved in this thread."""
    try:
        async with get_session() as session:
            result = await session.execute(
                select(MemoryRetrieval).where(MemoryRetrieval.thread_id == thread_id)
            )
            retrievals = result.scalars().all()

        if not retrievals:
            return

        # Compute delta
        delta = BASE_SUCCESS_DELTA if outcome.succeeded else BASE_FAILURE_DELTA
        if outcome.user_confirmed:
            delta *= USER_CONFIRMED_MULTIPLIER

        for retrieval in retrievals:
            try:
                async with get_session() as session:
                    # Load current memory
                    mem_result = await session.execute(
                        text(
                            "SELECT confidence, retrieval_count FROM memories "
                            "WHERE id = :mid"
                        ),
                        {"mid": retrieval.memory_id},
                    )
                    row = mem_result.fetchone()
                    if row is None:
                        continue

                    current_conf, retrieval_count = row

                    # Immunity: do not penalise well-established memories on failure
                    if delta < 0 and retrieval_count >= IMMUNITY_RETRIEVAL_COUNT:
                        log.debug(
                            "memory %s immune from failure penalty (retrieval_count=%d)",
                            retrieval.memory_id, retrieval_count,
                        )
                        continue

                    new_conf = max(CONFIDENCE_FLOOR, min(CONFIDENCE_CEILING, current_conf + delta))
                    await session.execute(
                        text(
                            "UPDATE memories SET confidence = :conf WHERE id = :mid"
                        ),
                        {"conf": new_conf, "mid": retrieval.memory_id},
                    )
                    await session.commit()
            except Exception as exc:
                log.warning("adjust_memory_confidence: memory_id=%s error: %s", retrieval.memory_id, exc)
    except Exception as exc:
        log.error("adjust_memory_confidence: failed for thread=%s: %s", thread_id, exc)


async def record_routing_outcome(
    agent_id: str,
    task_type: str,
    model_name: str,
    succeeded: bool,
    cost_usd: float,
    duration_s: float,
) -> None:
    """Write a routing_outcomes row for tracking per-model success rates."""
    row = RoutingOutcome(
        agent_id=agent_id,
        task_type=task_type,
        model_name=model_name,
        succeeded=succeeded,
        cost_usd=cost_usd,
        duration_s=duration_s,
    )
    try:
        async with get_session() as session:
            session.add(row)
            await session.commit()
    except Exception as exc:
        log.warning("record_routing_outcome: %s", exc)
