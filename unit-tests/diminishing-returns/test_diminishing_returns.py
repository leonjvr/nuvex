"""Unit tests for diminishing returns stop logic (§29)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_state(**overrides):
    """Return a minimal AgentState-like dict for testing."""
    from src.brain.state import AgentState
    defaults = dict(
        agent_id="test-agent",
        thread_id="thread-1",
        low_yield_turns=0,
        denied_actions=[],
    )
    defaults.update(overrides)
    return AgentState(**defaults)


def _make_dr_config(enabled=True, min_tokens=500, threshold=3):
    from src.shared.models.config import DiminishingReturnsConfig
    return DiminishingReturnsConfig(
        enabled=enabled,
        min_tokens_per_turn=min_tokens,
        consecutive_threshold=threshold,
    )


# ---------------------------------------------------------------------------
# Tests for _compute_low_yield
# ---------------------------------------------------------------------------

class TestComputeLowYield:
    def test_increments_when_below_threshold(self):
        from src.brain.nodes.call_llm import _compute_low_yield
        state = _make_state(low_yield_turns=1)
        dr = _make_dr_config(min_tokens=500)
        with patch("src.shared.config.get_cached_config") as mock_cfg, \
             patch("src.shared.config.get_agent") as mock_get_agent:
            mock_get_agent.return_value = MagicMock(diminishing_returns=dr)
            mock_cfg.return_value = MagicMock()
            result = _compute_low_yield(state, output_tok=200, has_tool_calls=False)
        assert result == 2

    def test_resets_when_above_threshold(self):
        from src.brain.nodes.call_llm import _compute_low_yield
        state = _make_state(low_yield_turns=2)
        dr = _make_dr_config(min_tokens=500)
        with patch("src.shared.config.get_cached_config") as mock_cfg, \
             patch("src.shared.config.get_agent") as mock_get_agent:
            mock_get_agent.return_value = MagicMock(diminishing_returns=dr)
            mock_cfg.return_value = MagicMock()
            result = _compute_low_yield(state, output_tok=600, has_tool_calls=False)
        assert result == 0

    def test_tool_call_turns_carry_forward(self):
        from src.brain.nodes.call_llm import _compute_low_yield
        state = _make_state(low_yield_turns=2)
        dr = _make_dr_config(min_tokens=500)
        with patch("src.shared.config.get_cached_config") as mock_cfg, \
             patch("src.shared.config.get_agent") as mock_get_agent:
            mock_get_agent.return_value = MagicMock(diminishing_returns=dr)
            mock_cfg.return_value = MagicMock()
            result = _compute_low_yield(state, output_tok=100, has_tool_calls=True)
        # counter carries forward unchanged — even below threshold
        assert result == 2

    def test_disabled_always_returns_zero(self):
        from src.brain.nodes.call_llm import _compute_low_yield
        state = _make_state(low_yield_turns=5)
        dr = _make_dr_config(enabled=False)
        with patch("src.shared.config.get_cached_config") as mock_cfg, \
             patch("src.shared.config.get_agent") as mock_get_agent:
            mock_get_agent.return_value = MagicMock(diminishing_returns=dr)
            mock_cfg.return_value = MagicMock()
            result = _compute_low_yield(state, output_tok=50, has_tool_calls=False)
        assert result == 0

    def test_three_consecutive_below_threshold(self):
        from src.brain.nodes.call_llm import _compute_low_yield
        dr = _make_dr_config(min_tokens=500, threshold=3)
        with patch("src.shared.config.get_cached_config") as mock_cfg, \
             patch("src.shared.config.get_agent") as mock_get_agent:
            mock_get_agent.return_value = MagicMock(diminishing_returns=dr)
            mock_cfg.return_value = MagicMock()

            s0 = _make_state(low_yield_turns=0)
            r1 = _compute_low_yield(s0, output_tok=200, has_tool_calls=False)
            assert r1 == 1

            s1 = _make_state(low_yield_turns=r1)
            r2 = _compute_low_yield(s1, output_tok=300, has_tool_calls=False)
            assert r2 == 2

            s2 = _make_state(low_yield_turns=r2)
            r3 = _compute_low_yield(s2, output_tok=100, has_tool_calls=False)
            assert r3 == 3

    def test_reset_after_two_then_above(self):
        from src.brain.nodes.call_llm import _compute_low_yield
        dr = _make_dr_config(min_tokens=500, threshold=3)
        with patch("src.shared.config.get_cached_config") as mock_cfg, \
             patch("src.shared.config.get_agent") as mock_get_agent:
            mock_get_agent.return_value = MagicMock(diminishing_returns=dr)
            mock_cfg.return_value = MagicMock()

            s0 = _make_state(low_yield_turns=0)
            r1 = _compute_low_yield(s0, output_tok=200, has_tool_calls=False)  # 1
            s1 = _make_state(low_yield_turns=r1)
            r2 = _compute_low_yield(s1, output_tok=300, has_tool_calls=False)  # 2
            s2 = _make_state(low_yield_turns=r2)
            r3 = _compute_low_yield(s2, output_tok=600, has_tool_calls=False)  # reset -> 0
            assert r3 == 0


# ---------------------------------------------------------------------------
# Tests for _is_diminishing_returns_halt
# ---------------------------------------------------------------------------

class TestIsDiminishingReturnsHalt:
    def test_halts_at_threshold(self):
        from src.brain.graph import _is_diminishing_returns_halt
        state = _make_state(low_yield_turns=3)
        dr = _make_dr_config(threshold=3)
        with patch("src.shared.config.get_cached_config") as mock_cfg:
            mock_cfg.return_value = MagicMock(
                agents={"test-agent": MagicMock(diminishing_returns=dr)}
            )
            assert _is_diminishing_returns_halt(state) is True

    def test_does_not_halt_below_threshold(self):
        from src.brain.graph import _is_diminishing_returns_halt
        state = _make_state(low_yield_turns=2)
        dr = _make_dr_config(threshold=3)
        with patch("src.shared.config.get_cached_config") as mock_cfg:
            mock_cfg.return_value = MagicMock(
                agents={"test-agent": MagicMock(diminishing_returns=dr)}
            )
            assert _is_diminishing_returns_halt(state) is False

    def test_disabled_never_halts(self):
        from src.brain.graph import _is_diminishing_returns_halt
        state = _make_state(low_yield_turns=100)
        dr = _make_dr_config(enabled=False)
        with patch("src.shared.config.get_cached_config") as mock_cfg:
            mock_cfg.return_value = MagicMock(
                agents={"test-agent": MagicMock(diminishing_returns=dr)}
            )
            assert _is_diminishing_returns_halt(state) is False


# ---------------------------------------------------------------------------
# Tests for halt_diminishing_returns node
# ---------------------------------------------------------------------------

class TestHaltDiminishingReturnsNode:
    @pytest.mark.asyncio
    async def test_sets_finished_true(self):
        from src.brain.nodes.halt_diminishing_returns import halt_diminishing_returns
        state = _make_state(low_yield_turns=3)
        with patch("src.brain.events.publish", new=AsyncMock()):
            result = await halt_diminishing_returns(state)
        assert result["finished"] is True

    @pytest.mark.asyncio
    async def test_emits_event(self):
        from src.brain.nodes.halt_diminishing_returns import halt_diminishing_returns
        state = _make_state(low_yield_turns=3)
        with patch("src.brain.events.publish", new=AsyncMock()) as mock_publish:
            await halt_diminishing_returns(state)
        mock_publish.assert_called_once()
        call_args = mock_publish.call_args
        assert call_args[0][0] == "halted.diminishing_returns"
        assert call_args[0][1]["low_yield_turns"] == 3
