"""Unit tests — routing modulation: arousal-based tier override and route_model node (Section 30.4).

Spec:
- get_model_tier_override: arousal=0.82, task!='simple_reply' → 'performance'
- get_model_tier_override: arousal=0.15 → 'fast'
- get_model_tier_override: arousal=0.50 → None (no override)
- route_model: model_hint in metadata → hint used, arousal is not consulted
- read_arousal: missing row → returns NEUTRAL_FALLBACK_SCORE (0.50)
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.brain.arousal import get_model_tier_override


# ---------------------------------------------------------------------------
# TestGetModelTierOverride
# ---------------------------------------------------------------------------

class TestGetModelTierOverride:
    """spec: pure function get_model_tier_override returns correct tier or None."""

    def test_routing_override_high_arousal(self):
        """arousal=0.82, task='code_generation' → 'performance' (high arousal, non-simple task)."""
        override = get_model_tier_override(0.82, "code_generation")
        assert override == "performance"

    def test_routing_override_low_arousal(self):
        """arousal=0.15 → 'fast' (agent is idle/under low pressure)."""
        override = get_model_tier_override(0.15, "simple_reply")
        assert override == "fast"

    def test_routing_no_override_mid(self):
        """arousal=0.50 → None (mid-range: no override triggers)."""
        override = get_model_tier_override(0.50, "conversation")
        assert override is None

    def test_routing_high_arousal_simple_reply_no_performance_override(self):
        """arousal=0.82 but task='simple_reply' → NOT 'performance' (spec: task hint guards this)."""
        override = get_model_tier_override(0.82, "simple_reply")
        # NOT "performance" — the check requires task != "simple_reply"
        assert override != "performance"


# ---------------------------------------------------------------------------
# TestRouteModelNode
# ---------------------------------------------------------------------------

class TestRouteModelNode:
    """spec: route_model node correctly uses model_hint and arousal-based tier override."""

    async def test_routing_task_hint_wins(self):
        """model_hint in metadata → active_model is the hint, arousal is not consulted."""
        from langchain_core.messages import HumanMessage
        from src.brain.nodes.route_model import route_model
        from src.brain.state import AgentState

        state = AgentState(
            agent_id="maya",
            thread_id="thread-hint",
            invocation_id="inv-hint",
            metadata={"model_hint": "anthropic/claude-3-haiku"},
            messages=[HumanMessage(content="Deploy the app")],
        )

        with (
            patch("src.brain.nodes.route_model.classify", return_value="code_generation"),
            patch(
                "src.brain.nodes.route_model.resolve_model",
                return_value=("default-model", "standard"),
            ),
        ):
            result = await route_model(state)

        assert result["active_model"] == "anthropic/claude-3-haiku"

    async def test_route_model_calls_arousal_when_no_hint(self):
        """Without a model_hint, route_model reads arousal and applies tier override."""
        from langchain_core.messages import HumanMessage
        from src.brain.nodes.route_model import route_model
        from src.brain.state import AgentState

        state = AgentState(
            agent_id="maya",
            thread_id="thread-no-hint",
            invocation_id="inv-no-hint",
            metadata={},
            messages=[HumanMessage(content="What is the weather?")],
        )

        with (
            patch("src.brain.nodes.route_model.classify", return_value="simple_reply"),
            patch(
                "src.brain.nodes.route_model.resolve_model",
                return_value=("default-model", "standard"),
            ),
            patch("src.brain.arousal.read_arousal", new_callable=AsyncMock, return_value=0.50),
        ):
            result = await route_model(state)

        # Mid-range arousal → no override → tier = "standard"
        assert result["model_tier"] == "standard"
        assert result["active_model"] == "default-model"
