"""Diminishing-returns low-yield turn counter — §29."""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)


def compute_low_yield(state: "AgentState", output_tok: int, has_tool_calls: bool) -> int:  # type: ignore[name-defined]
    """Compute updated low_yield_turns counter (§29).

    Tool-call turns carry the counter forward unchanged.
    Non-tool turns below the threshold increment; above it resets to 0.
    Returns 0 when diminishing_returns is disabled.
    """
    try:
        from ...shared.config import get_cached_config, get_agent
        cfg = get_cached_config()
        agent_def = get_agent(cfg, state.agent_id)
        dr_cfg = agent_def.diminishing_returns if agent_def else None
    except Exception:
        dr_cfg = None

    if dr_cfg is None or not dr_cfg.enabled:
        return 0

    if has_tool_calls:
        return state.low_yield_turns  # carry forward unchanged per spec

    if output_tok < dr_cfg.min_tokens_per_turn:
        return state.low_yield_turns + 1

    return 0  # reset when above threshold


# Legacy alias for unit-tests that imported the private name
_compute_low_yield = compute_low_yield
