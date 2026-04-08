"""check_forbidden node — block calls to tools in the agent's forbidden list."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ...shared.config import get_cached_config
from ..models.denied_action import DeniedAction
from ..state import AgentState

log = logging.getLogger(__name__)


def check_forbidden(state: AgentState) -> dict[str, Any]:
    """
    If the last AI message contains tool calls that are on the forbidden list,
    strip them and set finished=True with an error message.
    """
    try:
        cfg = get_cached_config()
        agent_def = cfg.agents.get(state.agent_id)
        if agent_def is None or not agent_def.forbidden_tools:
            return {}
        forbidden = set(agent_def.forbidden_tools)
    except Exception:
        return {}

    last = state.messages[-1] if state.messages else None
    if not last or not getattr(last, "tool_calls", None):
        return {}

    blocked = [tc["name"] for tc in last.tool_calls if tc.get("name") in forbidden]
    if blocked:
        log.warning("agent=%s blocked forbidden tools: %s", state.agent_id, blocked)
        denials = [
            DeniedAction(
                tool_name=name,
                reason=f"Tool '{name}' is in the agent forbidden list",
                governance_stage="forbidden",
                timestamp=datetime.now(timezone.utc),
                invocation_id=state.invocation_id,
            )
            for name in blocked
        ]
        return {
            "finished": True,
            "error": f"Blocked: forbidden tools requested: {', '.join(blocked)}",
            "denied_actions": state.denied_actions + denials,
        }
    return {}
