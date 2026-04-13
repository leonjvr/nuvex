"""Unit tests — advisor escalation policy."""
from __future__ import annotations

import pytest


class TestShouldEscalateAdvisor:
    def test_disabled_when_base_not_eligible(self):
        from src.brain.routing.escalation import should_escalate_advisor

        use, reason = should_escalate_advisor(
            base_advisor_enabled=False,
            signals=None,
            metadata={},
        )
        assert use is False
        assert reason == "disabled"

    def test_always_on_when_no_signals(self):
        from src.brain.routing.escalation import should_escalate_advisor

        use, reason = should_escalate_advisor(
            base_advisor_enabled=True,
            signals=None,
            metadata={},
        )
        assert use is True
        assert reason == "always_on"

    def test_cap_exceeded_suppresses_advisor(self):
        from src.brain.routing.escalation import EscalationPolicy, should_escalate_advisor

        policy = EscalationPolicy(max_per_thread=2)
        use, reason = should_escalate_advisor(
            base_advisor_enabled=True,
            signals={"complexity_score": 0.9, "risk_class": "high"},
            metadata={"advisor_escalation_count": 2},
            policy=policy,
        )
        assert use is False
        assert reason == "cap_exceeded"

    def test_signals_escalated_for_high_complexity(self):
        from src.brain.routing.escalation import EscalationPolicy, should_escalate_advisor

        policy = EscalationPolicy(min_complexity=0.6)
        use, reason = should_escalate_advisor(
            base_advisor_enabled=True,
            signals={"complexity_score": 0.8, "risk_class": "low"},
            metadata={},
            policy=policy,
        )
        assert use is True
        assert reason == "signals_escalated"

    def test_signals_escalated_for_high_risk(self):
        from src.brain.routing.escalation import should_escalate_advisor

        use, reason = should_escalate_advisor(
            base_advisor_enabled=True,
            signals={"complexity_score": 0.2, "risk_class": "high"},
            metadata={},
        )
        assert use is True
        assert reason == "signals_escalated"

    def test_always_on_for_low_complexity_low_risk(self):
        from src.brain.routing.escalation import EscalationPolicy, should_escalate_advisor

        policy = EscalationPolicy(min_complexity=0.6)
        use, reason = should_escalate_advisor(
            base_advisor_enabled=True,
            signals={"complexity_score": 0.2, "risk_class": "low"},
            metadata={},
            policy=policy,
        )
        assert use is True
        assert reason == "always_on"

    def test_cap_check_uses_metadata_count(self):
        from src.brain.routing.escalation import EscalationPolicy, should_escalate_advisor

        policy = EscalationPolicy(max_per_thread=3)
        # count=2 < max=3 → still allowed
        use, reason = should_escalate_advisor(
            base_advisor_enabled=True,
            signals=None,
            metadata={"advisor_escalation_count": 2},
            policy=policy,
        )
        assert use is True

    def test_cap_check_at_exact_limit(self):
        from src.brain.routing.escalation import EscalationPolicy, should_escalate_advisor

        policy = EscalationPolicy(max_per_thread=3)
        use, reason = should_escalate_advisor(
            base_advisor_enabled=True,
            signals=None,
            metadata={"advisor_escalation_count": 3},
            policy=policy,
        )
        assert use is False
        assert reason == "cap_exceeded"


class TestIncrementAdvisorCount:
    def test_increments_from_zero(self):
        from src.brain.routing.escalation import increment_advisor_count

        result = increment_advisor_count({})
        assert result["advisor_escalation_count"] == 1

    def test_increments_existing_count(self):
        from src.brain.routing.escalation import increment_advisor_count

        result = increment_advisor_count({"advisor_escalation_count": 2})
        assert result["advisor_escalation_count"] == 3

    def test_preserves_other_keys(self):
        from src.brain.routing.escalation import increment_advisor_count

        result = increment_advisor_count({"routing_decision": {"model": "claude"}, "advisor_escalation_count": 1})
        assert result["routing_decision"]["model"] == "claude"
        assert result["advisor_escalation_count"] == 2

    def test_original_metadata_unchanged(self):
        from src.brain.routing.escalation import increment_advisor_count

        original = {"advisor_escalation_count": 1}
        increment_advisor_count(original)
        assert original["advisor_escalation_count"] == 1  # immutable copy
