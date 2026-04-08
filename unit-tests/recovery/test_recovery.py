"""Unit tests — recovery: failure classification and recipe selection."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.brain.recovery import (
    FailureScenario,
    RecoveryStep,
    _RECIPES,
    classify_failure,
    recover,
)


# ---------------------------------------------------------------------------
# FailureScenario taxonomy
# ---------------------------------------------------------------------------

class TestFailureScenario:
    def test_all_scenarios_have_recipes(self):
        for scenario in FailureScenario:
            assert scenario in _RECIPES, f"No recipe for {scenario}"

    def test_recipes_are_non_empty(self):
        for scenario, steps in _RECIPES.items():
            assert len(steps) > 0, f"Empty recipe for {scenario}"

    def test_every_step_is_valid_enum_value(self):
        valid_steps = {s.value for s in RecoveryStep}
        for scenario, steps in _RECIPES.items():
            for step in steps:
                assert step.value in valid_steps


# ---------------------------------------------------------------------------
# classify_failure
# ---------------------------------------------------------------------------

class TestClassifyFailure:
    def test_401_is_llm_api_error(self):
        # 401 triggers via error string keyword ("unauthorized")
        result = classify_failure(exc=None, error_str="unauthorized - invalid api key", http_status=None)
        assert result == FailureScenario.LlmApiError

    def test_429_is_llm_api_error(self):
        result = classify_failure(exc=None, error_str="", http_status=429)
        assert result == FailureScenario.LlmApiError

    def test_500_is_llm_api_error(self):
        result = classify_failure(exc=None, error_str="", http_status=500)
        assert result == FailureScenario.LlmApiError

    def test_timeout_string_detected(self):
        # Generic timeout (no "tool"/"exec" keyword) maps to LlmApiError
        result = classify_failure(exc=None, error_str="connection timeout", http_status=None)
        assert result == FailureScenario.LlmApiError

    def test_tool_timeout_string_detected(self):
        # Timeout with "tool" keyword maps to ToolExecutionTimeout
        result = classify_failure(exc=None, error_str="tool execution timeout", http_status=None)
        assert result == FailureScenario.ToolExecutionTimeout

    def test_context_length_exceeded_detected(self):
        result = classify_failure(exc=None, error_str="context length exceeded", http_status=None)
        assert result == FailureScenario.ContextWindowOverflow

    def test_out_of_budget_detected(self):
        result = classify_failure(exc=None, error_str="budget exceeded", http_status=None)
        assert result == FailureScenario.OutOfBudget

    def test_unknown_error_returns_unknown(self):
        result = classify_failure(exc=None, error_str="some mysterious error xyz", http_status=None)
        assert result == FailureScenario.Unknown

    def test_exception_type_detected(self):
        # TimeoutError message must contain "timeout" (not just "timed out") to match
        result = classify_failure(exc=TimeoutError("connection timeout"), error_str="", http_status=None)
        assert result == FailureScenario.LlmApiError

    def test_database_error_detected(self):
        # DatabaseConnectionLost triggered by "connection refused" keyword
        result = classify_failure(exc=None, error_str="connection refused by database", http_status=None)
        assert result == FailureScenario.DatabaseConnectionLost


# ---------------------------------------------------------------------------
# Recipe structure
# ---------------------------------------------------------------------------

class TestRecipeStructure:
    def test_llm_api_error_includes_fallback_model(self):
        steps = _RECIPES[FailureScenario.LlmApiError]
        assert RecoveryStep.switch_fallback_model in steps

    def test_llm_api_error_eventually_escalates(self):
        steps = _RECIPES[FailureScenario.LlmApiError]
        assert RecoveryStep.escalate in steps

    def test_database_connection_lost_halts(self):
        steps = _RECIPES[FailureScenario.DatabaseConnectionLost]
        assert RecoveryStep.halt in steps

    def test_out_of_budget_escalates(self):
        steps = _RECIPES[FailureScenario.OutOfBudget]
        assert RecoveryStep.escalate in steps

    def test_context_window_triggers_compaction(self):
        steps = _RECIPES[FailureScenario.ContextWindowOverflow]
        assert RecoveryStep.trigger_compaction in steps

    def test_tool_timeout_skips_tool(self):
        steps = _RECIPES[FailureScenario.ToolExecutionTimeout]
        assert RecoveryStep.skip_tool in steps


# ---------------------------------------------------------------------------
# 19.8 — Integration: LLM rate limit triggers retry then fallback model
# ---------------------------------------------------------------------------

class TestRateLimitRecoveryIntegration:
    """19.8: HTTP 429 rate limit triggers retry_with_delay then switch_fallback_model."""

    def _mock_session(self):
        session = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        session.add = MagicMock()
        session.commit = AsyncMock()
        return session

    @pytest.mark.asyncio
    async def test_429_classifies_as_llm_api_error(self):
        """HTTP 429 must map to LlmApiError."""
        scenario = classify_failure(http_status=429)
        assert scenario == FailureScenario.LlmApiError

    @pytest.mark.asyncio
    async def test_rate_limit_recipe_starts_with_retry(self):
        """LlmApiError recipe first step is retry_with_delay."""
        steps = _RECIPES[FailureScenario.LlmApiError]
        assert steps[0] == RecoveryStep.retry_with_delay

    @pytest.mark.asyncio
    async def test_rate_limit_recipe_includes_fallback_before_escalation(self):
        """switch_fallback_model appears before escalate in the LlmApiError recipe."""
        steps = _RECIPES[FailureScenario.LlmApiError]
        fallback_idx = steps.index(RecoveryStep.switch_fallback_model)
        escalate_idx = steps.index(RecoveryStep.escalate)
        assert fallback_idx < escalate_idx

    @pytest.mark.asyncio
    async def test_recover_429_sets_use_fallback_model(self):
        """recover() called with http_status=429 must set use_fallback_model=True."""
        session = self._mock_session()

        with (
            patch("src.brain.recovery.get_session", return_value=session),
            patch("src.brain.recovery.asyncio.sleep", new_callable=AsyncMock) as mock_sleep,
            patch("src.brain.recovery.get_agent_state", return_value="running"),
            patch("src.brain.recovery.set_agent_state", new_callable=AsyncMock),
        ):
            result = await recover(
                agent_id="agent-1",
                thread_id="thread-1",
                http_status=429,
                error_str="rate limit exceeded",
            )

        assert result["use_fallback_model"] is True
        assert result["scenario"] == FailureScenario.LlmApiError.value
        # retry_with_delay must have been taken (asyncio.sleep called)
        assert mock_sleep.called

    @pytest.mark.asyncio
    async def test_recover_429_records_steps_taken(self):
        """steps_taken must include retry_with_delay and switch_fallback_model."""
        session = self._mock_session()

        with (
            patch("src.brain.recovery.get_session", return_value=session),
            patch("src.brain.recovery.asyncio.sleep", new_callable=AsyncMock),
            patch("src.brain.recovery.get_agent_state", return_value="running"),
            patch("src.brain.recovery.set_agent_state", new_callable=AsyncMock),
        ):
            result = await recover(
                agent_id="agent-1",
                thread_id="thread-1",
                http_status=429,
                error_str="rate limit exceeded",
            )

        assert RecoveryStep.retry_with_delay.value in result["steps_taken"]
        assert RecoveryStep.switch_fallback_model.value in result["steps_taken"]

    @pytest.mark.asyncio
    async def test_recover_persists_to_db(self):
        """recover() must persist a recovery log entry to the database."""
        session = self._mock_session()

        with (
            patch("src.brain.recovery.get_session", return_value=session),
            patch("src.brain.recovery.asyncio.sleep", new_callable=AsyncMock),
            patch("src.brain.recovery.get_agent_state", return_value="running"),
            patch("src.brain.recovery.set_agent_state", new_callable=AsyncMock),
        ):
            await recover(
                agent_id="agent-1",
                thread_id="thread-1",
                http_status=429,
                error_str="rate limit exceeded",
            )

        session.add.assert_called_once()
        session.commit.assert_awaited_once()
