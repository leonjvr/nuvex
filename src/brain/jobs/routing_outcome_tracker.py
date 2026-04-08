"""Weekly routing outcome tracker — surfaces underperforming model/task-type pairs (Section 29.6)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import text

from ..db import get_session

log = logging.getLogger(__name__)

MIN_SAMPLE_COUNT = 20
SUCCESS_RATE_THRESHOLD = 0.60
IMPROVEMENT_MARGIN = 0.15


async def run_routing_tracker() -> int:
    """Run the weekly routing outcome tracker.

    Returns the number of recommendations published.
    """
    log.info("routing_tracker: starting weekly run")
    stats = await _load_routing_stats()

    if not stats:
        log.info("routing_tracker: no routing outcome data available")
        return 0

    recommendations = _compute_recommendations(stats)
    published = 0

    for rec in recommendations:
        try:
            await _publish_recommendation(rec)
            published += 1
        except Exception as exc:
            log.warning("routing_tracker: publish failed: %s", exc)

    log.info("routing_tracker: published %d routing recommendations", published)
    return published


async def _load_routing_stats() -> list[dict]:
    """Load routing outcomes grouped by (agent_id, task_type, model_name)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    try:
        async with get_session() as session:
            result = await session.execute(
                text(
                    "SELECT agent_id, task_type, model_name, "
                    "       COUNT(*) AS sample_count, "
                    "       AVG(CASE WHEN succeeded THEN 1.0 ELSE 0.0 END) AS success_rate "
                    "FROM routing_outcomes "
                    "WHERE created_at >= :cutoff "
                    "GROUP BY agent_id, task_type, model_name "
                    "HAVING COUNT(*) >= :min_samples "
                    "ORDER BY agent_id, task_type, success_rate DESC"
                ),
                {"cutoff": cutoff, "min_samples": MIN_SAMPLE_COUNT},
            )
            return [dict(r) for r in result.mappings().all()]
    except Exception as exc:
        log.error("routing_tracker: failed to load stats: %s", exc)
        return []


def _compute_recommendations(stats: list[dict]) -> list[dict]:
    """Identify (agent_id, task_type) pairs where a better model exists."""
    # Group by (agent_id, task_type)
    groups: dict[tuple, list[dict]] = {}
    for row in stats:
        key = (row["agent_id"], row["task_type"])
        groups.setdefault(key, []).append(row)

    recommendations = []
    for (agent_id, task_type), models in groups.items():
        if len(models) < 2:
            continue

        # Current model = first one (sorted by success_rate DESC, so worst is last)
        # Find current default from config
        try:
            from ..routing.router import resolve_model
            current_model, _ = resolve_model(agent_id, task_type)
        except Exception:
            current_model = models[-1]["model_name"]

        current = next((m for m in models if m["model_name"] == current_model), None)
        if current is None:
            current = models[-1]  # worst-rated if current not in data

        current_rate = float(current["success_rate"])
        if current_rate >= SUCCESS_RATE_THRESHOLD:
            continue  # current model performing well enough

        # Find best alternative
        best = max(models, key=lambda m: float(m["success_rate"]))
        if best["model_name"] == current["model_name"]:
            continue
        if float(best["success_rate"]) - current_rate < IMPROVEMENT_MARGIN:
            continue

        recommendations.append({
            "agent_id": agent_id,
            "task_type": task_type,
            "current_model": current["model_name"],
            "recommended_model": best["model_name"],
            "current_success_rate": round(current_rate, 3),
            "recommended_success_rate": round(float(best["success_rate"]), 3),
            "sample_count": int(current["sample_count"]) + int(best["sample_count"]),
        })

    return recommendations


async def _publish_recommendation(rec: dict) -> None:
    from ..events import publish

    await publish(
        "routing.recommendation",
        rec,
        agent_id=rec["agent_id"],
    )
    log.info(
        "routing_tracker: recommendation for agent=%s task=%s: %s→%s (%.0f%% → %.0f%%)",
        rec["agent_id"],
        rec["task_type"],
        rec["current_model"],
        rec["recommended_model"],
        rec["current_success_rate"] * 100,
        rec["recommended_success_rate"] * 100,
    )
