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

    def test_short_non_code_gives_simple_reply(self):
        from src.brain.routing.classifier import classify

        assert classify("hi") == "simple_reply"
        assert classify("ok thanks") == "simple_reply"

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
