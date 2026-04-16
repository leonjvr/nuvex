"""Tests for merge_policies — task 18.3."""
from __future__ import annotations

import pytest
from src.brain.governance.policy_merge import merge_policies


class TestMergePoliciesForbiddenTools:
    """18.3 — forbidden_tools: union of all three tiers."""

    def test_union_of_forbidden_tools(self):
        result = merge_policies(
            global_policies={"forbidden_tools": ["tool_a", "tool_b"]},
            org_policies={"forbidden_tools": ["tool_c"]},
            agent_policies={"forbidden_tools": ["tool_d"]},
        )
        forbidden = set(result["forbidden_tools"])
        assert {"tool_a", "tool_b", "tool_c", "tool_d"} == forbidden

    def test_global_only_forbidden(self):
        result = merge_policies(
            global_policies={"forbidden_tools": ["global_only"]},
            org_policies={},
            agent_policies={},
        )
        assert "global_only" in result["forbidden_tools"]

    def test_deduplication_in_union(self):
        result = merge_policies(
            global_policies={"forbidden_tools": ["dup"]},
            org_policies={"forbidden_tools": ["dup"]},
            agent_policies={"forbidden_tools": ["dup"]},
        )
        # After union+dedup, only one entry
        assert result["forbidden_tools"].count("dup") == 1

    def test_empty_forbidden_tools(self):
        result = merge_policies({}, {}, {})
        assert result.get("forbidden_tools", []) == []


class TestMergePoliciesBudgets:
    """18.3 — budgets: minimum (strictest) across tiers."""

    def test_agent_has_lowest_budget(self):
        result = merge_policies(
            global_policies={"budgets": {"daily_usd": 100.0}},
            org_policies={"budgets": {"daily_usd": 50.0}},
            agent_policies={"budgets": {"daily_usd": 20.0}},
        )
        # Minimum — most restrictive wins
        assert result["budgets"]["daily_usd"] == 20.0

    def test_org_has_lowest_budget(self):
        result = merge_policies(
            global_policies={"budgets": {"daily_usd": 100.0}},
            org_policies={"budgets": {"daily_usd": 10.0}},
            agent_policies={"budgets": {"daily_usd": 50.0}},
        )
        assert result["budgets"]["daily_usd"] == 10.0

    def test_no_weakening_of_global_budget(self):
        """Agent cannot exceed global budget cap."""
        result = merge_policies(
            global_policies={"budgets": {"daily_usd": 5.0}},
            org_policies={},
            agent_policies={"budgets": {"daily_usd": 1000.0}},
        )
        assert result["budgets"]["daily_usd"] == 5.0

    def test_missing_budget_uses_available(self):
        result = merge_policies(
            global_policies={"budgets": {"daily_usd": 50.0}},
            org_policies={},
            agent_policies={},
        )
        assert result["budgets"]["daily_usd"] == 50.0


class TestMergePoliciesConditions:
    """18.3 — conditions: AND logic (all conditions must be satisfied)."""

    def test_and_of_all_conditions(self):
        result = merge_policies(
            global_policies={"conditions": [{"type": "time_window", "start": "09:00"}]},
            org_policies={"conditions": [{"type": "ip_allowlist", "ips": ["10.0.0.0/8"]}]},
            agent_policies={"conditions": [{"type": "rate_limit", "rpm": 10}]},
        )
        assert len(result.get("conditions", [])) == 3

    def test_empty_conditions_merged_cleanly(self):
        result = merge_policies({}, {}, {})
        assert result.get("conditions", []) == []

    def test_global_condition_preserved(self):
        result = merge_policies(
            global_policies={"conditions": [{"type": "mandatory_check"}]},
            org_policies={},
            agent_policies={},
        )
        assert any(c.get("type") == "mandatory_check" for c in result.get("conditions", []))
