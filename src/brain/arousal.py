"""Arousal state manager — computes and persists agent arousal scores (Section 30)."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from .db import get_session

log = logging.getLogger(__name__)

# Arousal score weights (must sum to 1.0)
W_IDLE = 0.25
W_PRESSURE = 0.30
W_BURN = 0.10
W_MESSAGES = 0.25
W_RECOVERY = 0.10

# Saturation values for each factor
IDLE_SATURATION_S = 7200.0      # 2 hours
PRESSURE_SATURATION = 5
BURN_SATURATION_USD = 2.0       # per day
MESSAGES_SATURATION = 10
RECOVERY_SATURATION = 3

# Routing modulation thresholds
HIGH_AROUSAL_THRESHOLD = 0.75
MID_AROUSAL_THRESHOLD = 0.60
LOW_AROUSAL_THRESHOLD = 0.20

# Proactive wake thresholds
PROACTIVE_PRESSURE_MIN = 3
PROACTIVE_IDLE_MIN_S = 3600.0
PROACTIVE_SCORE_MIN = 0.70
PROACTIVE_UNREAD_MIN = 1

NEUTRAL_FALLBACK_SCORE = 0.50


@dataclass
class ArousalSignals:
    idle_seconds: float = 0.0
    pending_task_pressure: int = 0
    budget_burn_3day_avg: float = 0.0
    unread_channel_messages: int = 0
    recovery_event_count_24h: int = 0


def compute_arousal_score(signals: ArousalSignals) -> float:
    """Pure function: compute arousal score [0.0, 1.0] from signals."""
    idle_factor = 1.0 - min(signals.idle_seconds / IDLE_SATURATION_S, 1.0)
    pressure_factor = min(signals.pending_task_pressure / PRESSURE_SATURATION, 1.0)
    burn_factor = min(signals.budget_burn_3day_avg / BURN_SATURATION_USD, 1.0)
    message_factor = min(signals.unread_channel_messages / MESSAGES_SATURATION, 1.0)
    recovery_factor = min(signals.recovery_event_count_24h / RECOVERY_SATURATION, 1.0)

    score = (
        W_IDLE * idle_factor
        + W_PRESSURE * pressure_factor
        + W_BURN * burn_factor
        + W_MESSAGES * message_factor
        + W_RECOVERY * recovery_factor
    )
    return max(0.0, min(1.0, score))


async def read_arousal(agent_id: str) -> float:
    """Read last_arousal_score for agent from DB. Returns NEUTRAL_FALLBACK_SCORE on any failure."""
    try:
        async with get_session() as session:
            result = await session.execute(
                text("SELECT last_arousal_score FROM arousal_state WHERE agent_id = :aid"),
                {"aid": agent_id},
            )
            row = result.fetchone()
            if row is None:
                log.debug("arousal: no row for agent=%s, using neutral fallback", agent_id)
                return NEUTRAL_FALLBACK_SCORE
            return float(row[0])
    except ProgrammingError:
        log.warning("arousal: arousal_state table does not exist — using neutral fallback")
        return NEUTRAL_FALLBACK_SCORE
    except Exception as exc:
        log.warning("arousal: read failed for agent=%s: %s — using neutral fallback", agent_id, exc)
        return NEUTRAL_FALLBACK_SCORE


async def _collect_signals(agent_id: str) -> ArousalSignals:
    """Query DB for all arousal signals for the given agent."""
    signals = ArousalSignals()
    try:
        async with get_session() as session:
            # last_invocation_at from arousal_state (may not exist yet)
            try:
                res = await session.execute(
                    text(
                        "SELECT last_invocation_at FROM arousal_state WHERE agent_id = :aid"
                    ),
                    {"aid": agent_id},
                )
                row = res.fetchone()
                if row and row[0]:
                    delta = datetime.now(timezone.utc) - row[0].replace(tzinfo=timezone.utc)
                    signals.idle_seconds = max(0.0, delta.total_seconds())
            except Exception:
                pass

            # pending tasks
            try:
                res = await session.execute(
                    text(
                        "SELECT COUNT(*) FROM tasks "
                        "WHERE assigned_agent = :aid AND status = 'pending'"
                    ),
                    {"aid": agent_id},
                )
                signals.pending_task_pressure = int(res.scalar() or 0)
            except Exception:
                pass

            # budget burn (3-day average)
            try:
                res = await session.execute(
                    text(
                        "SELECT COALESCE(AVG(daily_total), 0) FROM ("
                        "  SELECT date_trunc('day', created_at) AS day, SUM(cost_usd) AS daily_total"
                        "  FROM outcomes"
                        "  WHERE agent_id = :aid AND created_at >= NOW() - INTERVAL '3 days'"
                        "  GROUP BY 1"
                        ") sub"
                    ),
                    {"aid": agent_id},
                )
                signals.budget_burn_3day_avg = float(res.scalar() or 0.0)
            except Exception:
                pass

            # recovery events (24h)
            try:
                res = await session.execute(
                    text(
                        "SELECT COUNT(*) FROM recovery_log "
                        "WHERE agent_id = :aid "
                        "AND created_at >= NOW() - INTERVAL '24 hours'"
                    ),
                    {"aid": agent_id},
                )
                signals.recovery_event_count_24h = int(res.scalar() or 0)
            except Exception:
                pass
    except Exception as exc:
        log.warning("arousal: signal collection failed for agent=%s: %s", agent_id, exc)
    return signals


async def update_arousal(agent_id: str) -> dict[str, Any]:
    """Collect signals, compute score, upsert arousal_state row, return updated dict."""
    signals = await _collect_signals(agent_id)
    score = compute_arousal_score(signals)

    row_data = {
        "agent_id": agent_id,
        "idle_seconds": signals.idle_seconds,
        "pending_task_pressure": signals.pending_task_pressure,
        "budget_burn_3day_avg": signals.budget_burn_3day_avg,
        "unread_channel_messages": signals.unread_channel_messages,
        "recovery_event_count_24h": signals.recovery_event_count_24h,
        "last_arousal_score": score,
        "updated_at": datetime.now(timezone.utc),
    }

    try:
        async with get_session() as session:
            await session.execute(
                text(
                    "INSERT INTO arousal_state "
                    "(agent_id, idle_seconds, pending_task_pressure, budget_burn_3day_avg, "
                    " unread_channel_messages, recovery_event_count_24h, last_arousal_score, updated_at) "
                    "VALUES (:agent_id, :idle_seconds, :pending_task_pressure, :budget_burn_3day_avg, "
                    " :unread_channel_messages, :recovery_event_count_24h, :last_arousal_score, :updated_at) "
                    "ON CONFLICT (agent_id) DO UPDATE SET "
                    "  idle_seconds = EXCLUDED.idle_seconds, "
                    "  pending_task_pressure = EXCLUDED.pending_task_pressure, "
                    "  budget_burn_3day_avg = EXCLUDED.budget_burn_3day_avg, "
                    "  unread_channel_messages = EXCLUDED.unread_channel_messages, "
                    "  recovery_event_count_24h = EXCLUDED.recovery_event_count_24h, "
                    "  last_arousal_score = EXCLUDED.last_arousal_score, "
                    "  updated_at = EXCLUDED.updated_at"
                ),
                row_data,
            )
            await session.commit()
    except Exception as exc:
        log.error("update_arousal: upsert failed for agent=%s: %s", agent_id, exc)

    return {**row_data, "last_arousal_score": score, "signals": signals}


def get_model_tier_override(arousal_score: float, task_type: str) -> str | None:
    """Return tier override string or None if no override applies."""
    if arousal_score > HIGH_AROUSAL_THRESHOLD and task_type != "simple_reply":
        return "performance"
    if arousal_score > MID_AROUSAL_THRESHOLD:
        return "balanced"
    if arousal_score < LOW_AROUSAL_THRESHOLD:
        return "fast"
    return None


def should_proactive_wake(
    pending_task_pressure: int,
    idle_seconds: float,
    last_arousal_score: float,
    unread_channel_messages: int,
) -> bool:
    """Return True when all proactive wake conditions are met."""
    return (
        pending_task_pressure >= PROACTIVE_PRESSURE_MIN
        and idle_seconds >= PROACTIVE_IDLE_MIN_S
        and last_arousal_score >= PROACTIVE_SCORE_MIN
        and unread_channel_messages >= PROACTIVE_UNREAD_MIN
    )
