"""Data classification governance node.

Verifies that the agent's tier permits access to the data classification
level indicated by the action payload. Cross-division access is blocked.
"""
from __future__ import annotations

import logging
from enum import IntEnum

from ..state import AgentState

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Classification levels (higher = more sensitive)
# ---------------------------------------------------------------------------

class DataClass(IntEnum):
    PUBLIC = 0
    INTERNAL = 1
    CONFIDENTIAL = 2
    RESTRICTED = 3


# Map agent tier → maximum data classification they may access
_TIER_MAX: dict[str, DataClass] = {
    "T1": DataClass.RESTRICTED,   # T1 (trusted) — unrestricted
    "T2": DataClass.CONFIDENTIAL,
    "T3": DataClass.INTERNAL,
    "T4": DataClass.PUBLIC,
}

# Some tool names are inherently high-classification
_TOOL_CLASS_HINTS: dict[str, DataClass] = {
    "write_file": DataClass.INTERNAL,
    "shell": DataClass.CONFIDENTIAL,
    "web_fetch": DataClass.PUBLIC,
    "read_file": DataClass.INTERNAL,
    "send_message": DataClass.INTERNAL,
}


def _infer_classification(tool_name: str, payload: dict) -> DataClass:
    """Heuristically infer the data classification of a tool call."""
    base = _TOOL_CLASS_HINTS.get(tool_name, DataClass.INTERNAL)

    # Escalate for sensitive paths / content
    path = str(payload.get("path", ""))
    if any(s in path for s in ("/etc/", "/root/", "credentials", "secret", ".env", "passwd")):
        base = DataClass.RESTRICTED

    command = str(payload.get("command", ""))
    if any(s in command for s in ("passwd", "secret", "token", "credential", "private_key")):
        base = DataClass.RESTRICTED

    return base


def check_classification(state: AgentState) -> AgentState:
    """Classification check node — block cross-tier data access."""
    from ...shared.config import get_cached_config

    config = get_cached_config()
    agent_def = config.agents.get(state.agent_id)
    tier = getattr(agent_def, "tier", "T2") if agent_def else "T2"
    max_allowed = _TIER_MAX.get(tier, DataClass.INTERNAL)

    # Inspect next pending tool call (if any)
    pending = state.metadata.get("pending_tool_name", "")
    pending_input = state.metadata.get("pending_tool_input", {})

    if not pending:
        return state  # Nothing to check

    required = _infer_classification(pending, pending_input)

    if required > max_allowed:
        log.warning(
            "classification: BLOCKED agent=%s tier=%s tool=%s required=%s max=%s",
            state.agent_id, tier, pending, required.name, max_allowed.name,
        )
        state.governance_decisions.append({
            "check": "classification",
            "tool": pending,
            "decision": "denied",
            "reason": (
                f"Tool '{pending}' requires {required.name} clearance; "
                f"agent tier {tier} is limited to {max_allowed.name}"
            ),
        })
        state.error = f"Access denied: {required.name} data classification required"

    return state
