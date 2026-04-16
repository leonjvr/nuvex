"""Unit tests — routing: message classifier and model resolver."""
from __future__ import annotations

import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Message classifier
# ---------------------------------------------------------------------------

class TestClassifier:
    def test_audio_marker_gives_voice_response(self):
        from src.brain.routing.classifier import classify

        assert classify("[Audio] please explain this") == "voice_response"

    def test_voice_marker_gives_voice_response(self):
        from src.brain.routing.classifier import classify

        assert classify("[Voice] hey there") == "voice_response"

    def test_short_non_code_gives_trivial_reply(self):
        from src.brain.routing.classifier import classify

        assert classify("hi") == "trivial_reply"
        assert classify("ok thanks") == "trivial_reply"

    def test_code_keywords_give_code_generation(self):
        from src.brain.routing.classifier import classify

        assert classify("fix the bug in my python script") == "code_generation"
        assert classify("refactor this function") == "code_generation"
        assert classify("implement a class for user management") == "code_generation"

    def test_long_message_without_code_is_conversation(self):
        from src.brain.routing.classifier import classify

        long_text = "Can you tell me about the history of the Roman Empire and how it fell?" * 2
        assert classify(long_text) == "conversation"

    def test_traceback_triggers_code_generation(self):
        from src.brain.routing.classifier import classify

        assert classify("I have a traceback in production") == "code_generation"

    def test_shell_keyword_triggers_code_generation(self):
        from src.brain.routing.classifier import classify

        assert classify("write a bash script to backup my database") == "code_generation"

    def test_voice_takes_priority_over_code(self):
        from src.brain.routing.classifier import classify

        assert classify("[Audio] fix the bug in my python code") == "voice_response"


# ---------------------------------------------------------------------------
# Model resolver
# ---------------------------------------------------------------------------

class TestModelResolver:
    def _mock_cfg(self, fast="groq/llama", primary="claude-3-5-sonnet", code="gpt-4o"):
        cfg = MagicMock()
        agent = MagicMock()
        model_cfg = MagicMock()
        model_cfg.fast = fast
        model_cfg.primary = primary
        model_cfg.code = code
        routing = MagicMock()
        routing.simple_reply = "fast"
        routing.conversation = "primary"
        routing.code_generation = "code"
        routing.voice_response = "fast"
        agent.model = model_cfg
        agent.routing = routing
        cfg.agents.get.return_value = agent
        return cfg

    def test_simple_reply_uses_fast_model(self):
        from src.brain.routing.router import resolve_model

        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", side_effect=Exception("no monitor")):
                model, tier = resolve_model("maya", "simple_reply")

        assert model == "groq/llama"
        assert tier == "fast"

    def test_code_generation_uses_code_model(self):
        from src.brain.routing.router import resolve_model

        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", side_effect=Exception("no monitor")):
                model, tier = resolve_model("maya", "code_generation")

        assert model == "gpt-4o"

    def test_unknown_agent_returns_default(self):
        from src.brain.routing.router import resolve_model

        cfg = MagicMock()
        cfg.agents.get.return_value = None

        with patch("src.brain.routing.router.get_cached_config", return_value=cfg):
            model, tier = resolve_model("unknown-agent", "conversation")

        assert model == "gpt-4o-mini"
        assert tier == "standard"

    def test_config_exception_falls_back_to_default(self):
        from src.brain.routing.router import resolve_model

        with patch("src.brain.routing.router.get_cached_config", side_effect=RuntimeError("config missing")):
            model, tier = resolve_model("maya", "conversation")

        assert model == "gpt-4o-mini"
        assert tier == "standard"

    def test_health_monitor_prefers_healthy_model(self):
        from src.brain.routing.router import resolve_model

        monitor = MagicMock()
        monitor.prefer_alternative.return_value = "claude-3-5-sonnet"

        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", return_value=monitor):
                model, _ = resolve_model("maya", "conversation")

        assert model == "claude-3-5-sonnet"

    def test_resolve_model_decision_has_reason_and_provider(self):
        from src.brain.routing.router import resolve_model_decision

        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", side_effect=Exception("no monitor")):
                decision = resolve_model_decision("maya", "simple_reply")

        assert decision["model_name"] == "groq/llama"
        assert decision["tier"] == "fast"
        assert decision["provider"] == "groq"
        assert decision["decision_reason"] == "routing_config"
        assert decision["fallback_used"] is False

    def test_resolve_model_decision_marks_health_fallback(self):
        from src.brain.routing.router import resolve_model_decision

        monitor = MagicMock()
        monitor.prefer_alternative.return_value = "gpt-4o"

        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", return_value=monitor):
                decision = resolve_model_decision("maya", "conversation")

        assert decision["model_name"] == "gpt-4o"
        assert decision["fallback_used"] is True
        assert decision["decision_reason"] == "health_fallback"


# ---------------------------------------------------------------------------
# Detailed classifier
# ---------------------------------------------------------------------------


class TestDetailedClassifier:
    def test_task_type_preserved(self):
        from src.brain.routing.classifier import classify_detailed

        result = classify_detailed("fix the bug in my python code")
        assert result.task_type == "code_generation"
        assert result.output_type == "code"

    def test_voice_output_type(self):
        from src.brain.routing.classifier import classify_detailed

        result = classify_detailed("[Voice] hello")
        assert result.task_type == "voice_response"
        assert result.output_type == "voice"

    def test_complexity_increases_with_length(self):
        from src.brain.routing.classifier import classify_detailed

        short = classify_detailed("hi there")
        long = classify_detailed("Can you explain the history of the Roman Empire? " * 20)
        assert long.complexity_score > short.complexity_score

    def test_multi_step_raises_complexity(self):
        from src.brain.routing.classifier import classify_detailed

        simple = classify_detailed("explain what AI is")
        stepped = classify_detailed("First explain what AI is, then give examples, finally summarise")
        assert stepped.complexity_score > simple.complexity_score

    def test_backtick_block_raises_complexity(self):
        from src.brain.routing.classifier import classify_detailed

        no_code = classify_detailed("explain sorting algorithms")
        with_code = classify_detailed("explain sorting algorithms\n```python\nx = 1\n```")
        assert with_code.complexity_score > no_code.complexity_score

    def test_high_risk_keywords_set_risk_class(self):
        from src.brain.routing.classifier import classify_detailed

        result = classify_detailed("please delete the production database credentials")
        assert result.risk_class == "high"

    def test_medium_risk_for_deploy(self):
        from src.brain.routing.classifier import classify_detailed

        result = classify_detailed("deploy the new version to the server")
        assert result.risk_class == "medium"

    def test_low_risk_for_generic_query(self):
        from src.brain.routing.classifier import classify_detailed

        result = classify_detailed("what is the capital of France?")
        assert result.risk_class == "low"

    def test_tool_likelihood_for_search(self):
        from src.brain.routing.classifier import classify_detailed

        result = classify_detailed("search for the latest news about AI and look up the author")
        assert result.tool_likelihood > 0.0

    def test_no_tool_keywords_gives_zero_likelihood(self):
        from src.brain.routing.classifier import classify_detailed

        result = classify_detailed("tell me a joke about penguins")
        assert result.tool_likelihood == 0.0

    def test_budget_pressure_clamped_above(self):
        from src.brain.routing.classifier import classify_detailed

        result = classify_detailed("hi", budget_pressure=2.5)
        assert result.budget_pressure == 1.0

    def test_budget_pressure_clamped_below(self):
        from src.brain.routing.classifier import classify_detailed

        result = classify_detailed("hi", budget_pressure=-0.5)
        assert result.budget_pressure == 0.0


# ---------------------------------------------------------------------------
# Signal-aware router
# ---------------------------------------------------------------------------


class TestSignalRouter:
    def _mock_cfg(self, fast="groq/llama", primary="claude-3-5-sonnet", code="gpt-4o"):
        cfg = MagicMock()
        agent = MagicMock()
        model_cfg = MagicMock()
        model_cfg.fast = fast
        model_cfg.primary = primary
        model_cfg.code = code
        routing = MagicMock()
        routing.simple_reply = "fast"
        routing.conversation = "primary"
        routing.code_generation = "code"
        routing.voice_response = "fast"
        agent.model = model_cfg
        agent.routing = routing
        cfg.agents.get.return_value = agent
        return cfg

    def test_none_signals_returns_base_decision(self):
        from src.brain.routing.router import resolve_model_with_signals

        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", side_effect=Exception("no monitor")):
                result = resolve_model_with_signals("maya", "simple_reply", signals=None)

        assert result["model_name"] == "groq/llama"
        assert "signals" not in result

    def test_signals_dict_appended_when_no_override(self):
        from src.brain.routing.classifier import ClassificationResult
        from src.brain.routing.router import resolve_model_with_signals

        signals = ClassificationResult(
            task_type="conversation",
            complexity_score=0.3,
            output_type="text",
            tool_likelihood=0.0,
            risk_class="low",
            budget_pressure=0.1,
        )
        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", side_effect=Exception("no monitor")):
                result = resolve_model_with_signals("maya", "conversation", signals=signals, theta=0.5)

        assert "signals" in result
        assert result["signals"]["theta"] == 0.5
        assert result["signals"]["risk_class"] == "low"

    def test_high_complexity_high_risk_promotes_from_fast(self):
        from src.brain.routing.classifier import ClassificationResult
        from src.brain.routing.router import resolve_model_with_signals

        signals = ClassificationResult(
            task_type="simple_reply",
            complexity_score=0.9,
            output_type="text",
            tool_likelihood=0.0,
            risk_class="high",
            budget_pressure=0.0,
        )
        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", side_effect=Exception("no monitor")):
                result = resolve_model_with_signals("maya", "simple_reply", signals=signals, theta=0.5)

        assert result["decision_reason"] == "signals_promoted"
        assert result["model_name"] == "gpt-4o"  # code-tier model

    def test_budget_pressure_demotes_to_fast(self):
        from src.brain.routing.classifier import ClassificationResult
        from src.brain.routing.router import resolve_model_with_signals

        signals = ClassificationResult(
            task_type="conversation",
            complexity_score=0.1,
            output_type="text",
            tool_likelihood=0.1,
            risk_class="low",
            budget_pressure=0.9,
        )
        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", side_effect=Exception("no monitor")):
                result = resolve_model_with_signals("maya", "conversation", signals=signals, theta=0.5)

        assert result["decision_reason"] == "signals_demoted_budget"
        assert result["model_name"] == "groq/llama"  # fast model

    def test_no_demotion_when_already_fast(self):
        from src.brain.routing.classifier import ClassificationResult
        from src.brain.routing.router import resolve_model_with_signals

        signals = ClassificationResult(
            task_type="simple_reply",
            complexity_score=0.05,
            output_type="text",
            tool_likelihood=0.0,
            risk_class="low",
            budget_pressure=0.95,
        )
        with patch("src.brain.routing.router.get_cached_config", return_value=self._mock_cfg()):
            with patch("src.brain.health.get_health_monitor", side_effect=Exception("no monitor")):
                result = resolve_model_with_signals("maya", "simple_reply", signals=signals, theta=0.5)

        # Already fast tier — no demotion applied
        assert result["decision_reason"] != "signals_demoted_budget"


# ---------------------------------------------------------------------------
# Threshold sweep utility
# ---------------------------------------------------------------------------


class TestThresholdSweep:
    def test_empty_samples_returns_empty(self):
        from src.brain.routing.threshold_sweep import sweep_theta

        assert sweep_theta([]) == []

    def test_default_thetas_nine_steps(self):
        from src.brain.routing.threshold_sweep import SweepSample, sweep_theta

        samples = [SweepSample(complexity_score=0.5, task_succeeded=True, model_cost_usd=0.01)]
        results = sweep_theta(samples)
        thetas = [r.theta for r in results]
        assert thetas == sorted(thetas)
        assert len(thetas) == 9  # 0.1 → 0.9

    def test_higher_theta_promotes_fewer_samples(self):
        from src.brain.routing.threshold_sweep import SweepSample, sweep_theta

        samples = [
            SweepSample(complexity_score=0.6, task_succeeded=True, model_cost_usd=0.01, risk_class="medium")
        ]
        low = sweep_theta(samples, thetas=[0.3])
        high = sweep_theta(samples, thetas=[0.9])
        assert low[0].n_promoted > high[0].n_promoted

    def test_promoted_samples_cost_more(self):
        from src.brain.routing.threshold_sweep import SweepSample, sweep_theta

        samples = [
            SweepSample(complexity_score=0.8, task_succeeded=True, model_cost_usd=0.01, risk_class="medium")
        ]
        low_theta = sweep_theta(samples, thetas=[0.5], power_cost_multiplier=5.0)
        high_theta = sweep_theta(samples, thetas=[0.9], power_cost_multiplier=5.0)
        # theta=0.5: 0.8 > 0.5 → promoted → cost * 5; theta=0.9: 0.8 < 0.9 → not promoted
        assert low_theta[0].avg_cost_per_attempt_usd > high_theta[0].avg_cost_per_attempt_usd

    def test_cost_per_success_none_when_no_successes(self):
        from src.brain.routing.threshold_sweep import SweepSample, sweep_theta

        samples = [SweepSample(complexity_score=0.5, task_succeeded=False, model_cost_usd=0.01)]
        results = sweep_theta(samples, thetas=[0.5])
        assert results[0].cost_per_success_usd is None

    def test_low_risk_samples_never_promoted(self):
        from src.brain.routing.threshold_sweep import SweepSample, sweep_theta

        samples = [
            SweepSample(complexity_score=0.99, task_succeeded=True, model_cost_usd=0.01, risk_class="low")
        ]
        results = sweep_theta(samples, thetas=[0.1])
        assert results[0].n_promoted == 0

    def test_best_theta_returns_highest_success_rate(self):
        from src.brain.routing.threshold_sweep import SweepResult, best_theta

        results = [
            SweepResult(theta=0.3, success_rate=0.6, cost_per_success_usd=0.05,
                        avg_cost_per_attempt_usd=0.03, n_promoted=3, n_samples=10),
            SweepResult(theta=0.7, success_rate=0.8, cost_per_success_usd=0.03,
                        avg_cost_per_attempt_usd=0.024, n_promoted=1, n_samples=10),
        ]
        best = best_theta(results)
        assert best is not None
        assert best.theta == 0.7

    def test_best_theta_filtered_by_cost_budget(self):
        from src.brain.routing.threshold_sweep import SweepResult, best_theta

        results = [
            SweepResult(theta=0.3, success_rate=0.9, cost_per_success_usd=0.10,
                        avg_cost_per_attempt_usd=0.09, n_promoted=5, n_samples=10),
            SweepResult(theta=0.7, success_rate=0.7, cost_per_success_usd=0.04,
                        avg_cost_per_attempt_usd=0.028, n_promoted=1, n_samples=10),
        ]
        best = best_theta(results, cost_budget_per_success_usd=0.05)
        assert best is not None
        assert best.theta == 0.7  # only candidate within budget
