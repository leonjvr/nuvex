"""halt_diminishing_returns node — terminates the graph after consecutive low-yield turns (§29)."""
from __future__ import annotations

import logging
from typing import Any

from ..state import AgentState

log = logging.getLogger(__name__)


async def halt_diminishing_returns(state: AgentState) -> dict[str, Any]:
    """Terminal node: emit halted.diminishing_returns event and set finished=True."""
    last_delta = 0
    last = state.messages[-1] if state.messages else None
    if last:
        usage = getattr(last, "usage_metadata", None) or {}
        last_delta = usage.get("output_tokens", 0)

    log.warning(
        "halt_diminishing_returns: agent=%s low_yield_turns=%d last_delta=%d",
        state.agent_id,
        state.low_yield_turns,
        last_delta,
    )

    try:
        from .. import events
        await events.publish(
            "halted.diminishing_returns",
            {"low_yield_turns": state.low_yield_turns, "last_delta": last_delta},
            agent_id=state.agent_id,
            invocation_id=state.invocation_id,
        )
    except Exception as exc:
        log.warning("halt_diminishing_returns: event publish failed: %s", exc)

    return {"finished": True}
