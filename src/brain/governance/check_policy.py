"""check_policy node — run PolicyEngine against every tool call before execution."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from langchain_core.messages import AIMessage

from ..state import AgentState
from ..models.denied_action import DeniedAction
from .policy_engine import PolicyContext, evaluate_with_ratelimit, get_policy_engine

log = logging.getLogger(__name__)


async def check_policy(state: AgentState) -> dict[str, Any]:
    """Evaluate governance policy rules against the last AI message's tool calls.

    If any call is denied, set finished=True with an error.
    Throttle / escalate actions are logged but execution continues (warn-only path).
    """
    last = state.messages[-1] if state.messages else None
    if not last or not getattr(last, "tool_calls", None):
        return {}

    engine = get_policy_engine()
    denied: list[str] = []
    denials: list[DeniedAction] = []
    warnings: list[str] = []

    for tc in last.tool_calls:
        tool_name = tc.get("name", "")
        ctx = PolicyContext(
            agent_id=state.agent_id,
            action_type="tool_call",
            payload={"tool_name": tool_name, **tc.get("args", {})},
            metadata={
                "budget_fraction": (state.cost_usd / 0.5) if state.cost_usd else 0.0,
                "iteration": state.iteration,
                "channel": state.channel,
            },
        )
        decision = await evaluate_with_ratelimit(engine, ctx)

        if decision.action == "deny":
            denied.append(f"{tool_name}: {decision.reason}")
            denials.append(DeniedAction(
                tool_name=tool_name,
                reason=decision.reason or f"Policy denied tool '{tool_name}'",
                governance_stage="policy",
                timestamp=datetime.now(timezone.utc),
                invocation_id=state.invocation_id,
            ))
        elif decision.action in ("escalate", "warn", "throttle"):
            log.warning(
                "agent=%s tool=%s policy=%s reason=%s",
                state.agent_id, tool_name, decision.action, decision.reason,
            )
            warnings.append(f"{tool_name}: [{decision.action}] {decision.reason}")

    if denied:
        log.warning("agent=%s policy denied tool calls: %s", state.agent_id, denied)
        return {
            "finished": True,
            "error": f"Policy denied: {'; '.join(denied)}",
            "denied_actions": state.denied_actions + denials,
        }

    return {}
