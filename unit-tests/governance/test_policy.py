"""Unit tests — governance: policy engine condition evaluation and decisions."""
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
# _eval_condition — leaf comparators
# ---------------------------------------------------------------------------

class TestEvalConditionLeaf:
    def _ctx(self, action_type="tool_call", payload=None, metadata=None):
        return PolicyContext(
            agent_id="test-agent",
            action_type=action_type,
            payload=payload or {},
            metadata=metadata or {},
        )

    def test_eq_match(self):
        cond = {"field": "action_type", "comparator": "eq", "value": "tool_call"}
        assert _eval_condition(cond, self._ctx("tool_call")) is True

    def test_eq_no_match(self):
        cond = {"field": "action_type", "comparator": "eq", "value": "model_invoke"}
        assert _eval_condition(cond, self._ctx("tool_call")) is False

    def test_neq(self):
        cond = {"field": "action_type", "comparator": "neq", "value": "tool_call"}
        assert _eval_condition(cond, self._ctx("model_invoke")) is True

    def test_in(self):
        cond = {"field": "action_type", "comparator": "in", "value": ["tool_call", "model_invoke"]}
        assert _eval_condition(cond, self._ctx("tool_call")) is True

    def test_not_in(self):
        cond = {"field": "action_type", "comparator": "not_in", "value": ["send_message"]}
        assert _eval_condition(cond, self._ctx("tool_call")) is True

    def test_contains(self):
        cond = {"field": "payload.command", "comparator": "contains", "value": "rm -rf"}
        ctx = self._ctx(payload={"command": "rm -rf /tmp"})
        assert _eval_condition(cond, ctx) is True

    def test_starts_with(self):
        cond = {"field": "agent_id", "comparator": "starts_with", "value": "test"}
        assert _eval_condition(cond, self._ctx()) is True

    def test_gt(self):
        cond = {"field": "metadata.budget_fraction", "comparator": "gt", "value": 0.8}
        ctx = self._ctx(metadata={"budget_fraction": 0.95})
        assert _eval_condition(cond, ctx) is True

    def test_lt(self):
        cond = {"field": "metadata.budget_fraction", "comparator": "lt", "value": 0.5}
        ctx = self._ctx(metadata={"budget_fraction": 0.3})
        assert _eval_condition(cond, ctx) is True

    def test_unknown_field_returns_false(self):
        cond = {"field": "nonexistent.field", "comparator": "eq", "value": "x"}
        assert _eval_condition(cond, self._ctx()) is False

    def test_unknown_comparator_returns_false(self):
        cond = {"field": "action_type", "comparator": "regex_match", "value": ".*"}
        assert _eval_condition(cond, self._ctx()) is False


# ---------------------------------------------------------------------------
# _eval_condition — boolean operators
# ---------------------------------------------------------------------------

class TestEvalConditionOperators:
    def _ctx(self):
        return PolicyContext("a", "tool_call", {"k": "v"})

    def test_and_all_true(self):
        cond = {
            "op": "and",
            "conditions": [
                {"field": "action_type", "comparator": "eq", "value": "tool_call"},
                {"field": "agent_id", "comparator": "eq", "value": "a"},
            ],
        }
        assert _eval_condition(cond, self._ctx()) is True

    def test_and_one_false(self):
        cond = {
            "op": "and",
            "conditions": [
                {"field": "action_type", "comparator": "eq", "value": "tool_call"},
                {"field": "agent_id", "comparator": "eq", "value": "wrongid"},
            ],
        }
        assert _eval_condition(cond, self._ctx()) is False

    def test_or_one_true(self):
        cond = {
            "op": "or",
            "conditions": [
                {"field": "action_type", "comparator": "eq", "value": "model_invoke"},
                {"field": "agent_id", "comparator": "eq", "value": "a"},
            ],
        }
        assert _eval_condition(cond, self._ctx()) is True

    def test_not_inverts(self):
        cond = {
            "op": "not",
            "condition": {"field": "action_type", "comparator": "eq", "value": "tool_call"},
        }
        assert _eval_condition(cond, self._ctx()) is False


# ---------------------------------------------------------------------------
# PolicyEngine.evaluate
# ---------------------------------------------------------------------------

class TestPolicyEngine:
    def test_first_matching_rule_wins(self):
        engine = PolicyEngine()
        engine.add_rule(PolicyRule(
            name="deny_all",
            condition={"field": "action_type", "comparator": "eq", "value": "tool_call"},
            action="deny",
            reason="all denied",
        ))
        engine.add_rule(PolicyRule(
            name="approve_all",
            condition={"field": "action_type", "comparator": "eq", "value": "tool_call"},
            action="approve",
            reason="all approved",
        ))
        ctx = PolicyContext("a", "tool_call", {})
        decision = engine.evaluate(ctx)
        assert decision.action == "deny"
        assert decision.matched_rule == "deny_all"

    def test_no_match_returns_default(self):
        engine = PolicyEngine(default_action="approve")
        ctx = PolicyContext("a", "tool_call", {})
        decision = engine.evaluate(ctx)
        assert decision.action == "approve"
        assert decision.matched_rule is None

    def test_deny_rm_rf_in_default_engine(self):
        engine = build_default_engine()
        ctx = PolicyContext(
            agent_id="maya",
            action_type="tool_call",
            payload={"tool_name": "shell", "command": "rm -rf /var"},
        )
        decision = engine.evaluate(ctx)
        assert decision.action == "deny"

    def test_non_destructive_shell_approved(self):
        engine = build_default_engine()
        ctx = PolicyContext(
            agent_id="maya",
            action_type="tool_call",
            payload={"tool_name": "shell", "command": "ls /tmp"},
        )
        decision = engine.evaluate(ctx)
        assert decision.action == "approve"


# ---------------------------------------------------------------------------
# evaluate_with_ratelimit
# ---------------------------------------------------------------------------

class TestEvaluateWithRatelimit:
    @pytest.mark.asyncio
    async def test_rate_limit_blocks_when_exceeded(self):
        engine = PolicyEngine()
        engine.add_rule(PolicyRule(
            name="rate-limit-shell",
            condition={"calls_in_window": {"window_seconds": 60, "max_calls": 5}},
            action="throttle",
            reason="too many calls",
        ))
        ctx = PolicyContext("maya", "shell", {})

        with patch(
            "src.brain.governance.policy_engine.count_calls_in_window",
            new=AsyncMock(return_value=5),
        ):
            decision = await evaluate_with_ratelimit(engine, ctx)

        assert decision.action == "throttle"
        assert decision.matched_rule == "rate-limit-shell"

    @pytest.mark.asyncio
    async def test_rate_limit_not_triggered_under_limit(self):
        engine = PolicyEngine()
        engine.add_rule(PolicyRule(
            name="rate-limit-shell",
            condition={"calls_in_window": {"window_seconds": 60, "max_calls": 10}},
            action="throttle",
            reason="too many calls",
        ))
        ctx = PolicyContext("maya", "shell", {})

        with patch(
            "src.brain.governance.policy_engine.count_calls_in_window",
            new=AsyncMock(return_value=3),
        ):
            decision = await evaluate_with_ratelimit(engine, ctx)

        # Falls through to default approve
        assert decision.action == "approve"

    @pytest.mark.asyncio
    async def test_regular_rules_still_evaluated(self):
        engine = PolicyEngine()
        engine.add_rule(PolicyRule(
            name="deny-tool",
            condition={"field": "action_type", "comparator": "eq", "value": "tool_call"},
            action="deny",
            reason="blocked",
        ))
        ctx = PolicyContext("maya", "tool_call", {})

        decision = await evaluate_with_ratelimit(engine, ctx)
        assert decision.action == "deny"
