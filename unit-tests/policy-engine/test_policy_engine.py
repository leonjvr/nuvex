"""Integration tests — Policy Engine (spec 25.8).

Scenarios:
  - Time-based rule denies an after-hours deployment action.
  - Rate-limit rule blocks the 11th call within a window.
  - AND / OR / NOT condition composition.
  - First-match / approve fallback.
  - evaluate_with_ratelimit delegates to count_calls_in_window correctly.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from src.brain.governance.policy_engine import (
    PolicyContext,
    PolicyDecision,
    PolicyEngine,
    PolicyRule,
    _eval_condition,
    build_default_engine,
    evaluate_with_ratelimit,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _deploy_ctx(hour: int = 14, agent: str = "maya") -> PolicyContext:
    """Build a deployment PolicyContext with a synthetic hour in metadata."""
    return PolicyContext(
        agent_id=agent,
        action_type="tool_call",
        payload={"tool_name": "deploy", "target": "production"},
        metadata={"hour_utc": hour},
    )


def _call_ctx(action: str = "api_call", agent: str = "maya") -> PolicyContext:
    return PolicyContext(
        agent_id=agent,
        action_type=action,
        payload={},
        metadata={},
    )


# ---------------------------------------------------------------------------
# 25.8-A — Time-based policy denies after-hours deployment
# ---------------------------------------------------------------------------

class TestTimeBasedPolicy:
    """After-hours deployment rule: deny tool_call to 'deploy' when hour_utc < 8 or > 20."""

    def _engine_with_after_hours_rule(self) -> PolicyEngine:
        engine = PolicyEngine(default_action="approve")
        engine.add_rule(PolicyRule(
            name="deny_after_hours_deploy",
            condition={
                "op": "and",
                "conditions": [
                    {"field": "action_type", "comparator": "eq", "value": "tool_call"},
                    {"field": "payload.tool_name", "comparator": "eq", "value": "deploy"},
                    {
                        "op": "or",
                        "conditions": [
                            {"field": "metadata.hour_utc", "comparator": "lt", "value": 8},
                            {"field": "metadata.hour_utc", "comparator": "gt", "value": 20},
                        ],
                    },
                ],
            },
            action="deny",
            reason="Deployment outside business hours (08:00–20:00 UTC) is not permitted",
        ))
        return engine

    def test_after_hours_deploy_is_denied(self):
        """23:00 UTC → denied."""
        engine = self._engine_with_after_hours_rule()
        decision = engine.evaluate(_deploy_ctx(hour=23))
        assert decision.action == "deny"
        assert decision.matched_rule == "deny_after_hours_deploy"

    def test_early_hours_deploy_is_denied(self):
        """03:00 UTC → denied."""
        engine = self._engine_with_after_hours_rule()
        decision = engine.evaluate(_deploy_ctx(hour=3))
        assert decision.action == "deny"

    def test_business_hours_deploy_is_approved(self):
        """14:00 UTC → approved (falls through to default)."""
        engine = self._engine_with_after_hours_rule()
        decision = engine.evaluate(_deploy_ctx(hour=14))
        assert decision.action == "approve"

    def test_boundary_hour_8_is_approved(self):
        """Exactly 08:00 is within hours — approved."""
        engine = self._engine_with_after_hours_rule()
        decision = engine.evaluate(_deploy_ctx(hour=8))
        assert decision.action == "approve"

    def test_boundary_hour_20_is_approved(self):
        """Exactly 20:00 is within hours — approved."""
        engine = self._engine_with_after_hours_rule()
        decision = engine.evaluate(_deploy_ctx(hour=20))
        assert decision.action == "approve"

    def test_non_deploy_tool_not_blocked_after_hours(self):
        """read_file at 23:00 must not be blocked by the deploy rule."""
        engine = self._engine_with_after_hours_rule()
        ctx = PolicyContext(
            agent_id="maya",
            action_type="tool_call",
            payload={"tool_name": "read_file"},
            metadata={"hour_utc": 23},
        )
        decision = engine.evaluate(ctx)
        assert decision.action == "approve"


# ---------------------------------------------------------------------------
# 25.8-B — Rate limit blocks the 11th call
# ---------------------------------------------------------------------------

class TestRateLimitPolicy:
    """evaluate_with_ratelimit blocks when count_calls_in_window returns >= max_calls."""

    def _engine_with_rate_rule(self, max_calls: int = 10) -> PolicyEngine:
        engine = PolicyEngine(default_action="approve")
        engine.add_rule(PolicyRule(
            name="rate_limit_api_call",
            condition={"calls_in_window": {"window_seconds": 60, "max_calls": max_calls}},
            action="deny",
            reason="Rate limit exceeded: too many calls within 60 seconds",
        ))
        return engine

    @pytest.mark.asyncio
    async def test_tenth_call_is_allowed(self):
        """9 previous calls in window → count=9 < 10 → approve falls through default."""
        engine = self._engine_with_rate_rule(max_calls=10)
        ctx = _call_ctx()
        with patch(
            "src.brain.governance.policy_engine.count_calls_in_window",
            new=AsyncMock(return_value=9),
        ):
            decision = await evaluate_with_ratelimit(engine, ctx)
        assert decision.action == "approve"

    @pytest.mark.asyncio
    async def test_eleventh_call_is_blocked(self):
        """10 calls already in window → count=10 >= 10 → deny (11th is blocked)."""
        engine = self._engine_with_rate_rule(max_calls=10)
        ctx = _call_ctx()
        with patch(
            "src.brain.governance.policy_engine.count_calls_in_window",
            new=AsyncMock(return_value=10),
        ):
            decision = await evaluate_with_ratelimit(engine, ctx)
        assert decision.action == "deny"
        assert decision.matched_rule == "rate_limit_api_call"

    @pytest.mark.asyncio
    async def test_rate_limit_message_is_present(self):
        """Denied response includes the rate-limit reason string."""
        engine = self._engine_with_rate_rule(max_calls=5)
        ctx = _call_ctx()
        with patch(
            "src.brain.governance.policy_engine.count_calls_in_window",
            new=AsyncMock(return_value=5),
        ):
            decision = await evaluate_with_ratelimit(engine, ctx)
        assert "Rate limit" in decision.reason

    @pytest.mark.asyncio
    async def test_rate_limit_not_triggered_for_different_engine_rules(self):
        """Engine with no calls_in_window rules falls through to synchronous evaluation."""
        engine = PolicyEngine(default_action="approve")
        ctx = _call_ctx()
        decision = await evaluate_with_ratelimit(engine, ctx)
        assert decision.action == "approve"
        assert decision.matched_rule is None


# ---------------------------------------------------------------------------
# Condition evaluator — AND / OR / NOT composition
# ---------------------------------------------------------------------------

class TestConditionEvaluator:
    def test_leaf_eq_match(self):
        ctx = _call_ctx(action="tool_call")
        cond = {"field": "action_type", "comparator": "eq", "value": "tool_call"}
        assert _eval_condition(cond, ctx) is True

    def test_leaf_eq_no_match(self):
        ctx = _call_ctx(action="tool_call")
        cond = {"field": "action_type", "comparator": "eq", "value": "model_invoke"}
        assert _eval_condition(cond, ctx) is False

    def test_and_all_true(self):
        ctx = _call_ctx(action="tool_call", agent="maya")
        cond = {
            "op": "and",
            "conditions": [
                {"field": "action_type", "comparator": "eq", "value": "tool_call"},
                {"field": "agent_id", "comparator": "eq", "value": "maya"},
            ],
        }
        assert _eval_condition(cond, ctx) is True

    def test_and_short_circuits_on_false(self):
        ctx = _call_ctx(action="model_invoke")
        cond = {
            "op": "and",
            "conditions": [
                {"field": "action_type", "comparator": "eq", "value": "tool_call"},
                {"field": "agent_id", "comparator": "eq", "value": "maya"},
            ],
        }
        assert _eval_condition(cond, ctx) is False

    def test_or_any_true(self):
        ctx = PolicyContext(
            agent_id="maya",
            action_type="tool_call",
            payload={},
            metadata={"hour_utc": 3},
        )
        cond = {
            "op": "or",
            "conditions": [
                {"field": "metadata.hour_utc", "comparator": "lt", "value": 8},
                {"field": "metadata.hour_utc", "comparator": "gt", "value": 20},
            ],
        }
        assert _eval_condition(cond, ctx) is True

    def test_not_negates(self):
        ctx = _call_ctx(action="tool_call")
        cond = {
            "op": "not",
            "condition": {"field": "action_type", "comparator": "eq", "value": "model_invoke"},
        }
        assert _eval_condition(cond, ctx) is True

    def test_payload_field_resolution(self):
        ctx = PolicyContext(
            agent_id="maya",
            action_type="tool_call",
            payload={"tool_name": "shell", "command": "rm -rf /"},
            metadata={},
        )
        cond = {"field": "payload.command", "comparator": "contains", "value": "rm -rf"}
        assert _eval_condition(cond, ctx) is True

    def test_unknown_field_returns_false(self):
        ctx = _call_ctx()
        cond = {"field": "nonexistent_key", "comparator": "eq", "value": "x"}
        assert _eval_condition(cond, ctx) is False


# ---------------------------------------------------------------------------
# Built-in engine rules — deny_rm_rf and escalate_budget_high
# ---------------------------------------------------------------------------

class TestDefaultEngine:
    def test_rm_rf_is_denied(self):
        engine = build_default_engine()
        ctx = PolicyContext(
            agent_id="maya",
            action_type="tool_call",
            payload={"tool_name": "shell", "command": "rm -rf /tmp/secrets"},
            metadata={},
        )
        decision = engine.evaluate(ctx)
        assert decision.action == "deny"
        assert decision.matched_rule == "deny_rm_rf"

    def test_benign_shell_command_not_blocked(self):
        engine = build_default_engine()
        ctx = PolicyContext(
            agent_id="maya",
            action_type="tool_call",
            payload={"tool_name": "shell", "command": "echo hello"},
            metadata={},
        )
        decision = engine.evaluate(ctx)
        assert decision.action == "approve"

    def test_high_budget_escalates(self):
        engine = build_default_engine()
        ctx = PolicyContext(
            agent_id="maya",
            action_type="model_invoke",
            payload={},
            metadata={"budget_fraction": 0.95},
        )
        decision = engine.evaluate(ctx)
        assert decision.action == "escalate"
        assert decision.matched_rule == "escalate_budget_high"

    def test_normal_budget_not_escalated(self):
        engine = build_default_engine()
        ctx = PolicyContext(
            agent_id="maya",
            action_type="model_invoke",
            payload={},
            metadata={"budget_fraction": 0.50},
        )
        decision = engine.evaluate(ctx)
        assert decision.action == "approve"

    def test_first_match_wins(self):
        """A deny rule added before escalate must fire first."""
        engine = build_default_engine()
        engine.rules.insert(0, PolicyRule(
            name="first_rule",
            condition={"field": "agent_id", "comparator": "eq", "value": "maya"},
            action="warn",
            reason="first match wins",
        ))
        ctx = PolicyContext(
            agent_id="maya",
            action_type="model_invoke",
            payload={},
            metadata={"budget_fraction": 0.95},
        )
        decision = engine.evaluate(ctx)
        assert decision.action == "warn"
        assert decision.matched_rule == "first_rule"
