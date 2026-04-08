"""Unit tests — outcomes: outcome scoring and memory confidence adjustment (Section 29).

Spec:
- score_thread: succeeded=True when finished=True, error=None, budget_exceeded=False
- score_thread: succeeded=False, error_class='OutOfBudget' when budget_exceeded=True
- adjust_memory_confidence: confidence increases by BASE_SUCCESS_DELTA on success
- adjust_memory_confidence: confidence decreases by BASE_FAILURE_DELTA on failure (non-immune)
- adjust_memory_confidence: confidence never drops below CONFIDENCE_FLOOR
- adjust_memory_confidence: memory with retrieval_count >= 5 is immune from failure penalty
- adjust_memory_confidence: user_confirmed=True doubles the delta
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from src.brain.outcomes import (
    BASE_FAILURE_DELTA,
    BASE_SUCCESS_DELTA,
    CONFIDENCE_FLOOR,
    IMMUNITY_RETRIEVAL_COUNT,
    USER_CONFIRMED_MULTIPLIER,
    adjust_memory_confidence,
    score_thread,
)
from src.brain.state import AgentState


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_state(**kwargs) -> AgentState:
    defaults = dict(
        agent_id="maya",
        thread_id="thread-test",
        invocation_id="inv-test",
        finished=True,
        error=None,
        budget_exceeded=False,
        cost_usd=0.005,
        iteration=3,
    )
    defaults.update(kwargs)
    return AgentState(**defaults)


def _make_session_cm(session: AsyncMock) -> AsyncMock:
    """Wrap mock_session in an async context manager that returns itself."""
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _empty_governance_result() -> MagicMock:
    r = MagicMock()
    r.fetchall.return_value = []
    return r


# ---------------------------------------------------------------------------
# TestOutcomeScorer
# ---------------------------------------------------------------------------

class TestOutcomeScorer:
    """spec: score_thread produces correct succeeded/error_class per thread terminal state."""

    async def test_outcome_scorer_success(self):
        state = _make_state(finished=True, error=None, budget_exceeded=False)
        start = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=_empty_governance_result())
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        with patch("src.brain.outcomes.get_session", return_value=_make_session_cm(mock_session)):
            outcome = await score_thread(state, start)

        assert outcome.succeeded is True
        assert outcome.error_class is None

    async def test_outcome_scorer_budget_halt(self):
        state = _make_state(finished=False, error=None, budget_exceeded=True)
        start = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=_empty_governance_result())
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        with patch("src.brain.outcomes.get_session", return_value=_make_session_cm(mock_session)):
            outcome = await score_thread(state, start)

        assert outcome.succeeded is False
        assert outcome.error_class == "OutOfBudget"


# ---------------------------------------------------------------------------
# TestMemoryConfidenceAdjustment
# ---------------------------------------------------------------------------

class TestMemoryConfidenceAdjustment:
    """spec: adjust_memory_confidence propagates outcome backward into memory confidence."""

    def _make_outcome(self, succeeded: bool, user_confirmed: bool = False) -> MagicMock:
        o = MagicMock()
        o.succeeded = succeeded
        o.user_confirmed = user_confirmed
        return o

    def _make_retrieval(self, memory_id: int = 99) -> MagicMock:
        r = MagicMock()
        r.memory_id = memory_id
        r.thread_id = "thread-test"
        return r

    async def test_confidence_increase_on_success(self):
        """Memory confidence rises by BASE_SUCCESS_DELTA when outcome succeeded=True."""
        outcome = self._make_outcome(succeeded=True, user_confirmed=False)
        retrieval = self._make_retrieval(memory_id=10)
        initial_confidence = 0.70
        retrieval_count = 3

        retrieval_result = MagicMock()
        retrieval_result.scalars.return_value.all.return_value = [retrieval]

        mem_result = MagicMock()
        mem_result.fetchone.return_value = (initial_confidence, retrieval_count)

        update_result = MagicMock()

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(
            side_effect=[retrieval_result, mem_result, update_result]
        )
        mock_session.commit = AsyncMock()

        with patch("src.brain.outcomes.get_session", return_value=_make_session_cm(mock_session)):
            await adjust_memory_confidence("thread-test", outcome)

        # Verify UPDATE was called with increased confidence
        update_call = mock_session.execute.call_args_list[-1]
        params = update_call[0][1]  # positional arg 1 = params dict
        expected_conf = min(1.0, initial_confidence + BASE_SUCCESS_DELTA)
        assert abs(params["conf"] - expected_conf) < 1e-9

    async def test_confidence_decrease_on_failure(self):
        """Memory confidence falls by BASE_FAILURE_DELTA when outcome succeeded=False (non-immune)."""
        outcome = self._make_outcome(succeeded=False, user_confirmed=False)
        retrieval = self._make_retrieval(memory_id=11)
        initial_confidence = 0.60
        retrieval_count = 2  # < IMMUNITY_RETRIEVAL_COUNT

        retrieval_result = MagicMock()
        retrieval_result.scalars.return_value.all.return_value = [retrieval]

        mem_result = MagicMock()
        mem_result.fetchone.return_value = (initial_confidence, retrieval_count)

        update_result = MagicMock()

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(
            side_effect=[retrieval_result, mem_result, update_result]
        )
        mock_session.commit = AsyncMock()

        with patch("src.brain.outcomes.get_session", return_value=_make_session_cm(mock_session)):
            await adjust_memory_confidence("thread-test", outcome)

        update_call = mock_session.execute.call_args_list[-1]
        params = update_call[0][1]
        expected_conf = max(CONFIDENCE_FLOOR, initial_confidence + BASE_FAILURE_DELTA)
        assert abs(params["conf"] - expected_conf) < 1e-9

    async def test_confidence_floor_respected(self):
        """Confidence never drops below CONFIDENCE_FLOOR even with large negative delta."""
        outcome = self._make_outcome(succeeded=False, user_confirmed=False)
        retrieval = self._make_retrieval(memory_id=12)
        initial_confidence = 0.12  # very close to floor
        retrieval_count = 1

        retrieval_result = MagicMock()
        retrieval_result.scalars.return_value.all.return_value = [retrieval]

        mem_result = MagicMock()
        mem_result.fetchone.return_value = (initial_confidence, retrieval_count)

        update_result = MagicMock()

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(
            side_effect=[retrieval_result, mem_result, update_result]
        )
        mock_session.commit = AsyncMock()

        with patch("src.brain.outcomes.get_session", return_value=_make_session_cm(mock_session)):
            await adjust_memory_confidence("thread-test", outcome)

        update_call = mock_session.execute.call_args_list[-1]
        params = update_call[0][1]
        assert params["conf"] >= CONFIDENCE_FLOOR

    async def test_immune_memory_not_penalized(self):
        """Memory with retrieval_count >= IMMUNITY_RETRIEVAL_COUNT is NOT penalized on failure."""
        outcome = self._make_outcome(succeeded=False, user_confirmed=False)
        retrieval = self._make_retrieval(memory_id=13)
        retrieval_count = IMMUNITY_RETRIEVAL_COUNT  # exactly at immune threshold

        retrieval_result = MagicMock()
        retrieval_result.scalars.return_value.all.return_value = [retrieval]

        mem_result = MagicMock()
        mem_result.fetchone.return_value = (0.80, retrieval_count)

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(
            side_effect=[retrieval_result, mem_result]
        )
        mock_session.commit = AsyncMock()

        with patch("src.brain.outcomes.get_session", return_value=_make_session_cm(mock_session)):
            await adjust_memory_confidence("thread-test", outcome)

        # Only 2 execute calls expected: retrieval query + memory select.
        # The UPDATE should NOT be called.
        assert mock_session.execute.call_count == 2
        assert mock_session.commit.call_count == 0

    async def test_user_confirmed_multiplier(self):
        """user_confirmed=True doubles the SUCCESS delta (0.05 → 0.10)."""
        outcome = self._make_outcome(succeeded=True, user_confirmed=True)
        retrieval = self._make_retrieval(memory_id=14)
        initial_confidence = 0.50
        retrieval_count = 2

        retrieval_result = MagicMock()
        retrieval_result.scalars.return_value.all.return_value = [retrieval]

        mem_result = MagicMock()
        mem_result.fetchone.return_value = (initial_confidence, retrieval_count)

        update_result = MagicMock()

        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(
            side_effect=[retrieval_result, mem_result, update_result]
        )
        mock_session.commit = AsyncMock()

        with patch("src.brain.outcomes.get_session", return_value=_make_session_cm(mock_session)):
            await adjust_memory_confidence("thread-test", outcome)

        update_call = mock_session.execute.call_args_list[-1]
        params = update_call[0][1]
        expected_delta = BASE_SUCCESS_DELTA * USER_CONFIRMED_MULTIPLIER
        expected_conf = min(1.0, initial_confidence + expected_delta)
        assert abs(params["conf"] - expected_conf) < 1e-9
