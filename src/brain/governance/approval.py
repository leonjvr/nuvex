"""Approval gate — suspend invocation and wait for human approval via interrupt()."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from langgraph.types import interrupt

from ...shared.config import get_cached_config
from ..models.denied_action import DeniedAction
from ..state import AgentState

log = logging.getLogger(__name__)

# Tools considered destructive — require approval for T2 agents
_DESTRUCTIVE_TOOLS: set[str] = {
    "shell",
    "write_file",
    "delete_file",
    "execute_code",
}


def needs_approval(state: AgentState, tool_name: str) -> bool:
    """Return True if the tool call requires human approval.

    Tier-based trust routing (6.9):
      T1 — skip approval gate for all tools
      T2 — approval required for destructive tools only
      T3/T4 — approval required for ALL tool calls
    """
    try:
        cfg = get_cached_config()
        agent_def = cfg.agents.get(state.agent_id)
        tier = getattr(agent_def, "tier", "T2") if agent_def else "T2"
    except Exception:
        tier = "T2"

    if tier == "T1":
        return False
    if tier == "T2":
        return tool_name in _DESTRUCTIVE_TOOLS
    # T3, T4 — require approval for every tool call
    return True


async def approval_gate(state: AgentState) -> dict[str, Any]:
    """
    For any pending tool call that requires approval, suspend via interrupt().
    The resumed value should be True (approved) or False (denied).
    """
    last = state.messages[-1] if state.messages else None
    if not last or not getattr(last, "tool_calls", None):
        return {}

    for tc in last.tool_calls:
        tool_name = tc.get("name", "")
        if needs_approval(state, tool_name):
            log.info("Approval required for tool=%s agent=%s", tool_name, state.agent_id)
            approved: bool = interrupt(
                {
                    "type": "approval_request",
                    "agent_id": state.agent_id,
                    "tool": tool_name,
                    "args": tc.get("args", {}),
                }
            )
            if not approved:
                denial = DeniedAction(
                    tool_name=tool_name,
                    reason=f"Tool '{tool_name}' denied by approver",
                    governance_stage="approval",
                    timestamp=datetime.now(timezone.utc),
                    invocation_id=state.invocation_id,
                )
                return {
                    "finished": True,
                    "error": f"Tool '{tool_name}' denied by approver",
                    "approval_pending": False,
                    "approval_approved": False,
                    "denied_actions": state.denied_actions + [denial],
                }
            return {"approval_pending": False, "approval_approved": True}
    return {}
