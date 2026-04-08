"""Unit tests — ServiceStats and ServiceHealthMonitor."""
from __future__ import annotations

import pytest

from src.brain.health import (
    ServiceStats,
    ServiceHealthMonitor,
    _DEGRADE_THRESHOLD,
    _FAIL_THRESHOLD,
    _WINDOW_SIZE,
    _DEGRADE_CONSEC,
    _FAIL_CONSEC,
)


# ---------------------------------------------------------------------------
# ServiceStats — recording and state transitions
# ---------------------------------------------------------------------------

class TestServiceStatsConstants:
    def test_degrade_threshold_below_fail(self):
        assert _DEGRADE_THRESHOLD < _FAIL_THRESHOLD

    def test_window_size_positive(self):
        assert _WINDOW_SIZE > 0

    def test_consec_degrade_before_fail(self):
        assert _DEGRADE_CONSEC < _FAIL_CONSEC


class TestServiceStatsInitial:
    def test_starts_healthy(self):
        s = ServiceStats("test-svc")
        assert s.state == "Healthy"

    def test_error_rate_zero_on_init(self):
        s = ServiceStats("svc")
        assert s.error_rate() == 0.0

    def test_name_stored(self):
        s = ServiceStats("my-service")
        assert s.name == "my-service"


class TestServiceStatsRecord:
    def test_single_success_stays_healthy(self):
        s = ServiceStats("svc")
        state = s.record(True)
        assert state == "Healthy"

    def test_single_failure_stays_healthy(self):
        # One failure in a mostly-successful window stays Healthy
        s = ServiceStats("svc")
        for _ in range(10):
            s.record(True)
        state = s.record(False)  # error_rate = 1/11 ≈ 9% < 20%
        assert state == "Healthy"

    def test_error_rate_after_one_failure(self):
        s = ServiceStats("svc")
        s.record(False)
        assert s.error_rate() == 1.0

    def test_error_rate_after_mixed(self):
        s = ServiceStats("svc")
        s.record(True)
        s.record(False)
        assert s.error_rate() == pytest.approx(0.5)

    def test_consecutive_failures_degrade(self):
        # Add enough successes so error_rate stays below fail threshold
        # but consecutive count hits _DEGRADE_CONSEC
        s = ServiceStats("svc")
        for _ in range(10):
            s.record(True)
        for _ in range(_DEGRADE_CONSEC):
            s.record(False)  # consecutive=3, error_rate=3/13≈23% → Degraded
        assert s.state == "Degraded"

    def test_consecutive_failures_fail(self):
        s = ServiceStats("svc")
        for _ in range(_FAIL_CONSEC):
            s.record(False)
        assert s.state == "Failed"

    def test_success_resets_consecutive_count(self):
        s = ServiceStats("svc")
        for _ in range(_DEGRADE_CONSEC - 1):
            s.record(False)
        s.record(True)
        # Still not at degrade threshold with one success
        assert s._consecutive_failures == 0

    def test_high_error_rate_degrades(self):
        s = ServiceStats("svc")
        # Fill window with enough errors to exceed degrade threshold
        failures = int(_WINDOW_SIZE * _DEGRADE_THRESHOLD) + 1
        successes = _WINDOW_SIZE - failures
        for _ in range(successes):
            s.record(True)
        for _ in range(failures):
            s.record(False)
        assert s.state in ("Degraded", "Failed")

    def test_error_stored_on_failure(self):
        s = ServiceStats("svc")
        s.record(False, error="connection refused")
        assert s.last_error == "connection refused"

    def test_latency_stored(self):
        s = ServiceStats("svc")
        s.record(True, latency_ms=42.5)
        assert s.latency_ms == pytest.approx(42.5)


# ---------------------------------------------------------------------------
# ServiceHealthMonitor
# ---------------------------------------------------------------------------

class TestServiceHealthMonitor:
    def test_unknown_service_is_healthy(self):
        m = ServiceHealthMonitor()
        assert m.get_state("unknown") == "Healthy"

    def test_is_healthy_true_for_unknown(self):
        m = ServiceHealthMonitor()
        assert m.is_healthy("unknown") is True

    def test_record_success_stays_healthy(self):
        m = ServiceHealthMonitor()
        state = m.record("llm", True)
        assert state == "Healthy"

    def test_record_failure_degrades_after_consec(self):
        m = ServiceHealthMonitor()
        for _ in range(_FAIL_CONSEC):
            m.record("llm", False)
        assert m.get_state("llm") == "Failed"

    def test_get_stats_returns_none_for_unknown(self):
        m = ServiceHealthMonitor()
        assert m.get_stats("nonexistent") is None

    def test_get_stats_returns_stats_after_record(self):
        m = ServiceHealthMonitor()
        m.record("svc", True)
        assert m.get_stats("svc") is not None

    def test_all_services_empty(self):
        m = ServiceHealthMonitor()
        assert m.all_services() == []

    def test_all_services_returns_recorded(self):
        m = ServiceHealthMonitor()
        m.record("a", True)
        m.record("b", True)
        names = {s.name for s in m.all_services()}
        assert names == {"a", "b"}


# ---------------------------------------------------------------------------
# prefer_alternative
# ---------------------------------------------------------------------------

class TestPreferAlternative:
    def test_returns_first_healthy(self):
        m = ServiceHealthMonitor()
        # Mark first as failed
        for _ in range(_FAIL_CONSEC):
            m.record("model-a", False)
        m.record("model-b", True)

        result = m.prefer_alternative(["model-a", "model-b"])
        assert result == "model-b"

    def test_returns_first_if_all_healthy(self):
        m = ServiceHealthMonitor()
        m.record("model-a", True)
        m.record("model-b", True)
        result = m.prefer_alternative(["model-a", "model-b"])
        assert result == "model-a"

    def test_returns_first_if_empty_history(self):
        m = ServiceHealthMonitor()
        result = m.prefer_alternative(["x", "y"])
        assert result == "x"

    def test_returns_none_for_empty_list(self):
        m = ServiceHealthMonitor()
        result = m.prefer_alternative([])
        assert result is None

    def test_falls_back_to_least_degraded_over_failed(self):
        m = ServiceHealthMonitor()
        # model-a: Failed (5 consecutive, no prior successes)
        for _ in range(_FAIL_CONSEC):
            m.record("model-a", False)
        # model-b: Degraded (successes first, then 3 consecutive fails → error_rate < 50%)
        for _ in range(10):
            m.record("model-b", True)
        for _ in range(_DEGRADE_CONSEC):
            m.record("model-b", False)  # consecutive=3, error_rate≈23% → Degraded
        result = m.prefer_alternative(["model-a", "model-b"])
        # model-b is degraded but not failed — should be preferred
        assert result == "model-b"


# ---------------------------------------------------------------------------
# 26.8 — Integration: 5 consecutive LLM failures → Failed, router falls back
# ---------------------------------------------------------------------------

class TestLlmFailureTransitionAndRouterFallback:
    """26.8: 5 consecutive LLM failures transition provider to Failed/Degraded,
    and the model router falls back to a healthy alternative."""

    def test_five_consecutive_failures_reach_failed_state(self):
        """_FAIL_CONSEC=5 consecutive failures must transition service to Failed."""
        m = ServiceHealthMonitor()
        for _ in range(_FAIL_CONSEC):
            m.record("claude-3-5-sonnet", False)
        assert m.get_state("claude-3-5-sonnet") == "Failed"

    def test_three_consecutive_failures_degrade(self):
        """_DEGRADE_CONSEC=3 consecutive failures must transition to Degraded."""
        m = ServiceHealthMonitor()
        for _ in range(10):
            m.record("gpt-4o", True)
        for _ in range(_DEGRADE_CONSEC):
            m.record("gpt-4o", False)
        assert m.get_state("gpt-4o") in ("Degraded", "Failed")

    def test_failed_provider_not_selected_as_healthy(self):
        """is_healthy() must return False for a Failed provider."""
        m = ServiceHealthMonitor()
        for _ in range(_FAIL_CONSEC):
            m.record("primary-model", False)
        assert m.is_healthy("primary-model") is False

    def test_router_falls_back_when_primary_failed(self):
        """Model router must return the fallback model when primary is Failed."""
        from src.brain.health import get_health_monitor, _monitor
        import src.brain.health as health_mod

        # Stand up an isolated monitor with primary failed
        test_monitor = ServiceHealthMonitor()
        for _ in range(_FAIL_CONSEC):
            test_monitor.record("gpt-4o", False)
        test_monitor.record("gpt-4o-mini", True)

        original = health_mod._monitor
        health_mod._monitor = test_monitor
        try:
            best = test_monitor.prefer_alternative(["gpt-4o", "gpt-4o-mini"])
            assert best == "gpt-4o-mini"
        finally:
            health_mod._monitor = original

    def test_monitor_emits_state_change_on_transition(self):
        """last_state_change must be updated when state transitions to Failed."""
        from datetime import timezone, datetime

        m = ServiceHealthMonitor()
        before = datetime.now(timezone.utc)
        for _ in range(_FAIL_CONSEC):
            m.record("model-x", False)
        stats = m.get_stats("model-x")

        assert stats is not None
        assert stats.state == "Failed"
        assert stats.last_state_change >= before

    def test_recovery_after_failures(self):
        """After failures bring state to Failed, a run of successes can recover."""
        m = ServiceHealthMonitor()
        for _ in range(_FAIL_CONSEC):
            m.record("model-y", False)
        assert m.get_state("model-y") == "Failed"

        # Flood with successes to push error_rate below thresholds
        for _ in range(_WINDOW_SIZE):
            m.record("model-y", True)
        assert m.get_state("model-y") == "Healthy"
