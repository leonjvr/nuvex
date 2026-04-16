"""Dashboard outcomes router — outcome scoring and arousal state."""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from ...brain.db import get_session

router = APIRouter(prefix="/api/outcomes", tags=["outcomes"])


@router.get("/summary")
async def outcomes_summary():
    """Per-agent outcome counts and success rate."""
    async with get_session() as session:
        result = await session.execute(
            text(
                "SELECT agent_id, "
                "COUNT(*) AS total, "
                "SUM(CASE WHEN succeeded THEN 1 ELSE 0 END) AS succeeded, "
                "AVG(cost_usd) AS avg_cost_usd, "
                "AVG(duration_s) AS avg_duration_s "
                "FROM outcomes "
                "GROUP BY agent_id "
                "ORDER BY agent_id"
            )
        )
        rows = result.mappings().all()
    return [dict(r) for r in rows]


@router.get("/recent")
async def recent_outcomes(limit: int = 50):
    """Most recent outcome rows."""
    async with get_session() as session:
        result = await session.execute(
            text(
                "SELECT thread_id, agent_id, succeeded, error_class, "
                "user_confirmed, cost_usd, duration_s, tools_used, "
                "denial_count, iteration_count, created_at "
                "FROM outcomes "
                "ORDER BY created_at DESC "
                "LIMIT :lim"
            ),
            {"lim": min(limit, 200)},
        )
        rows = result.mappings().all()
    return [dict(r) for r in rows]


@router.get("/arousal")
async def arousal_state():
    """Current arousal score for every agent."""
    async with get_session() as session:
        result = await session.execute(
            text(
                "SELECT agent_id, last_arousal_score, "
                "idle_seconds, pending_task_pressure, "
                "budget_burn_3day_avg, unread_channel_messages, "
                "recovery_event_count_24h, updated_at "
                "FROM arousal_state "
                "ORDER BY agent_id"
            )
        )
        rows = result.mappings().all()
    return [dict(r) for r in rows]


@router.get("/routing")
async def routing_outcomes(limit: int = 200):
    """Recent routing outcome rows for telemetry."""
    async with get_session() as session:
        result = await session.execute(
            text(
                "SELECT agent_id, invocation_id, task_type, model_name, route_metadata, succeeded, "
                "cost_usd, duration_s, created_at "
                "FROM routing_outcomes "
                "ORDER BY created_at DESC "
                "LIMIT :lim"
            ),
            {"lim": min(limit, 500)},
        )
        rows = result.mappings().all()
    return [dict(r) for r in rows]
