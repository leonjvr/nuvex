"""Unit tests — arousal state: score computation, proactive wake, DB read (Section 30).

Spec:
- compute_arousal_score: idle_seconds=7200, others=0 → score <= 0.30
- compute_arousal_score: pending=5, unread=10, idle=0 → score >= 0.65
- compute_arousal_score: score is clamped to [0.0, 1.0]
- W_IDLE + W_PRESSURE + W_BURN + W_MESSAGES + W_RECOVERY == 1.0
- should_proactive_wake: pressure>=3, idle>=4500, score>=0.72, unread>=2 → True
- should_proactive_wake: unread=0 → False even if other conditions met
- should_proactive_wake: idle_seconds=120 → False (not idle enough)
- read_arousal: missing row → returns NEUTRAL_FALLBACK_SCORE (0.50), no exception
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.brain.arousal import (
    ArousalSignals,
    NEUTRAL_FALLBACK_SCORE,
    W_BURN,
    W_IDLE,
    W_MESSAGES,
    W_PRESSURE,
    W_RECOVERY,
    compute_arousal_score,
    read_arousal,
    should_proactive_wake,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_session_cm(session: AsyncMock) -> AsyncMock:
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


# ---------------------------------------------------------------------------
# TestArousalScoreComputation
# ---------------------------------------------------------------------------

class TestArousalScoreComputation:
    """spec: compute_arousal_score pure function behaves per spec formula."""

    def test_arousal_score_idle(self):
        """idle_seconds=7200, all pressure sources=0 → score <= 0.30 (mostly idle, low arousal)."""
        signals = ArousalSignals(
            idle_seconds=7200.0,
            pending_task_pressure=0,
            budget_burn_3day_avg=0.0,
            unread_channel_messages=0,
            recovery_event_count_24h=0,
        )
        score = compute_arousal_score(signals)
        # idle_factor = 1 - clamp(7200/7200, 0, 1) = 0
        # All other factors = 0
        # score = W_IDLE * 0 + 0 + 0 + 0 + 0 = 0.0
        assert score <= 0.30, f"Expected idle score <= 0.30, got {score}"

    def test_arousal_score_high_pressure(self):
        """pending=5, unread=10, idle=0 → score >= 0.65."""
        signals = ArousalSignals(
            idle_seconds=0.0,
            pending_task_pressure=5,
            budget_burn_3day_avg=0.0,
            unread_channel_messages=10,
            recovery_event_count_24h=0,
        )
        score = compute_arousal_score(signals)
        # idle_factor = 1-0 = 1.0 → W_IDLE * 1.0 = 0.25
        # pressure_factor = 5/5 = 1.0 → W_PRESSURE * 1.0 = 0.30
        # burn_factor = 0 → 0
        # message_factor = 10/10 = 1.0 → W_MESSAGES * 1.0 = 0.25
        # recovery = 0 → 0
        # total = 0.25 + 0.30 + 0 + 0.25 + 0 = 0.80
        assert score >= 0.65, f"Expected high pressure score >= 0.65, got {score}"

    def test_arousal_score_clamped_max(self):
        """Score never exceeds 1.0 even with maximum signals."""
        signals = ArousalSignals(
            idle_seconds=0.0,
            pending_task_pressure=100,
            budget_burn_3day_avg=100.0,
            unread_channel_messages=100,
            recovery_event_count_24h=100,
        )
        score = compute_arousal_score(signals)
        assert score <= 1.0, f"Score must not exceed 1.0, got {score}"

    def test_arousal_score_clamped_min(self):
        """Score never goes below 0.0 even with pathological inputs."""
        signals = ArousalSignals(
            idle_seconds=9999999.0,
            pending_task_pressure=0,
            budget_burn_3day_avg=0.0,
            unread_channel_messages=0,
            recovery_event_count_24h=0,
        )
        score = compute_arousal_score(signals)
        assert score >= 0.0, f"Score must not be negative, got {score}"

    def test_arousal_weights_sum_to_one(self):
        """All arousal weights must sum to exactly 1.0 (as per spec)."""
        total = W_IDLE + W_PRESSURE + W_BURN + W_MESSAGES + W_RECOVERY
        assert abs(total - 1.0) < 1e-9, (
            f"Weights must sum to 1.0, got {total} "
            f"(W_IDLE={W_IDLE}, W_PRESSURE={W_PRESSURE}, W_BURN={W_BURN}, "
            f"W_MESSAGES={W_MESSAGES}, W_RECOVERY={W_RECOVERY})"
        )


# ---------------------------------------------------------------------------
# TestProactiveWake
# ---------------------------------------------------------------------------

class TestProactiveWake:
    """spec: should_proactive_wake triggers only when all four conditions are met."""

    def test_proactive_wake_fires(self):
        """pressure=3, idle=4500, score=0.72, unread=2 → True."""
        result = should_proactive_wake(
            pending_task_pressure=3,
            idle_seconds=4500.0,
            last_arousal_score=0.72,
            unread_channel_messages=2,
        )
        assert result is True

    def test_proactive_wake_skipped_no_unread(self):
        """unread=0 → False even if all other conditions are met."""
        result = should_proactive_wake(
            pending_task_pressure=5,
            idle_seconds=5000.0,
            last_arousal_score=0.85,
            unread_channel_messages=0,
        )
        assert result is False

    def test_proactive_wake_skipped_recently_active(self):
        """idle_seconds=120 → False (agent is recently active, not idle enough)."""
        result = should_proactive_wake(
            pending_task_pressure=5,
            idle_seconds=120.0,
            last_arousal_score=0.85,
            unread_channel_messages=5,
        )
        assert result is False


# ---------------------------------------------------------------------------
# TestReadArousal
# ---------------------------------------------------------------------------

class TestReadArousal:
    """spec: read_arousal returns NEUTRAL_FALLBACK_SCORE when agent row is missing."""

    async def test_missing_arousal_defaults_neutral(self):
        """read_arousal on missing DB row returns 0.50 without raising."""
        mock_result = MagicMock()
        mock_result.fetchone.return_value = None  # row missing

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=mock_result)

        with patch(
            "src.brain.arousal.get_session",
            return_value=_make_session_cm(mock_session),
        ):
            score = await read_arousal("nonexistent-agent")

        assert score == NEUTRAL_FALLBACK_SCORE
        assert score == 0.50
