"""Policy engine — rule-based governance decisions (approve / deny / escalate / warn / throttle)."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class PolicyContext:
    agent_id: str
    action_type: str  # e.g. "tool_call", "model_invoke", "send_message"
    payload: dict[str, Any]
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PolicyDecision:
    action: str  # "approve" | "deny" | "escalate" | "warn" | "throttle"
    reason: str
    matched_rule: str | None = None


# ---------------------------------------------------------------------------
# Condition evaluators
# ---------------------------------------------------------------------------

def _eval_condition(condition: dict, ctx: PolicyContext) -> bool:
    """Recursively evaluate AND/OR condition tree against PolicyContext."""
    op = condition.get("op")

    if op == "and":
        return all(_eval_condition(c, ctx) for c in condition.get("conditions", []))
    if op == "or":
        return any(_eval_condition(c, ctx) for c in condition.get("conditions", []))
    if op == "not":
        inner = condition.get("condition", {})
        return not _eval_condition(inner, ctx)

    # Leaf condition
    field = condition.get("field", "")
    comparator = condition.get("comparator", "eq")
    value = condition.get("value")

    # Resolve field from context
    actual: Any = None
    if field == "action_type":
        actual = ctx.action_type
    elif field == "agent_id":
        actual = ctx.agent_id
    elif field.startswith("payload."):
        key = field[len("payload."):]
        actual = ctx.payload.get(key)
    elif field.startswith("metadata."):
        key = field[len("metadata."):]
        actual = ctx.metadata.get(key)
    else:
        logger.debug("Unknown policy field: %s", field)
        return False

    match comparator:
        case "eq":
            return actual == value
        case "neq":
            return actual != value
        case "in":
            return actual in (value or [])
        case "not_in":
            return actual not in (value or [])
        case "contains":
            return isinstance(actual, str) and isinstance(value, str) and value in actual
        case "starts_with":
            return isinstance(actual, str) and isinstance(value, str) and actual.startswith(value)
        case "gt":
            return actual is not None and actual > value
        case "lt":
            return actual is not None and actual < value
        case _:
            logger.warning("Unknown comparator: %s", comparator)
            return False


# ---------------------------------------------------------------------------
# Policy rule & engine
# ---------------------------------------------------------------------------

@dataclass
class PolicyRule:
    name: str
    condition: dict
    action: str  # "approve" | "deny" | "escalate" | "warn" | "throttle"
    reason: str


class PolicyEngine:
    """Evaluates a list of PolicyRule objects in priority order (first match wins)."""

    def __init__(self, rules: list[PolicyRule] | None = None, default_action: str = "approve") -> None:
        self.rules: list[PolicyRule] = rules or []
        self.default_action = default_action

    def add_rule(self, rule: PolicyRule) -> None:
        self.rules.append(rule)

    def evaluate(self, ctx: PolicyContext) -> PolicyDecision:
        for rule in self.rules:
            try:
                if _eval_condition(rule.condition, ctx):
                    logger.info(
                        "Policy rule '%s' matched → %s for agent=%s action=%s",
                        rule.name, rule.action, ctx.agent_id, ctx.action_type,
                    )
                    return PolicyDecision(action=rule.action, reason=rule.reason, matched_rule=rule.name)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Error evaluating rule '%s': %s", rule.name, exc)

        return PolicyDecision(action=self.default_action, reason="no rule matched", matched_rule=None)


# ---------------------------------------------------------------------------
# Default engine — loaded from config or hardcoded baseline
# ---------------------------------------------------------------------------

def build_default_engine() -> PolicyEngine:
    """Build a sane default policy engine with basic safety rules."""
    engine = PolicyEngine(default_action="approve")

    # Deny rm -rf style commands
    engine.add_rule(PolicyRule(
        name="deny_rm_rf",
        condition={
            "op": "and",
            "conditions": [
                {"field": "action_type", "comparator": "eq", "value": "tool_call"},
                {"field": "payload.tool_name", "comparator": "eq", "value": "shell"},
                {"field": "payload.command", "comparator": "contains", "value": "rm -rf"},
            ],
        },
        action="deny",
        reason="Destructive shell command blocked by default policy",
    ))

    # Escalate when budget nears limit (> 0.90 of budget)
    engine.add_rule(PolicyRule(
        name="escalate_budget_high",
        condition={
            "op": "and",
            "conditions": [
                {"field": "action_type", "comparator": "eq", "value": "model_invoke"},
                {"field": "metadata.budget_fraction", "comparator": "gt", "value": 0.9},
            ],
        },
        action="escalate",
        reason="Agent is approaching budget limit — escalating for human review",
    ))

    return engine


_default_engine: PolicyEngine | None = None


def get_policy_engine() -> PolicyEngine:
    global _default_engine
    if _default_engine is None:
        _default_engine = build_default_engine()
    return _default_engine


# ---------------------------------------------------------------------------
# Rate limiting — calls_in_window (25.6)
# ---------------------------------------------------------------------------

async def count_calls_in_window(
    agent_id: str,
    action_type: str,
    window_seconds: int,
) -> int:
    """Count events for agent+action in the last `window_seconds` (25.6)."""
    from datetime import timedelta
    from datetime import datetime, timezone
    from sqlalchemy import select, func
    from ..db import get_session
    from ..models.events import Event

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=window_seconds)
    try:
        async with get_session() as session:
            result = await session.execute(
                select(func.count(Event.id)).where(
                    Event.agent_id == agent_id,
                    Event.lane == "tool.execution",
                    Event.payload["action_type"].astext == action_type,
                    Event.created_at >= cutoff,
                )
            )
            return result.scalar() or 0
    except Exception as exc:
        logger.warning("calls_in_window query failed: %s", exc)
        return 0


async def evaluate_with_ratelimit(engine: PolicyEngine, ctx: PolicyContext) -> PolicyDecision:
    """Evaluate policy rules, checking calls_in_window conditions asynchronously.

    Rate-limit rules use condition format:
      {"calls_in_window": {"window_seconds": 60, "max_calls": 10}}

    These are checked separately before the synchronous rule pass.
    """
    for rule in engine.rules:
        cond = rule.condition
        if "calls_in_window" in cond:
            params = cond["calls_in_window"]
            window = int(params.get("window_seconds", 60))
            max_calls = int(params.get("max_calls", 10))
            count = await count_calls_in_window(ctx.agent_id, ctx.action_type, window)
            if count >= max_calls:
                logger.info(
                    "Rate limit rule '%s' triggered: agent=%s count=%d/%d in %ds",
                    rule.name, ctx.agent_id, count, max_calls, window,
                )
                return PolicyDecision(action=rule.action, reason=rule.reason, matched_rule=rule.name)

    return engine.evaluate(ctx)


async def build_merged_engine(org_id: str, agent_id: str) -> PolicyEngine:
    """Build a PolicyEngine from three-tier merged policies (7.2).

    Loads:
    1. Global policies from shared config
    2. Org policies from DB organisations.policies JSONB
    3. Agent policies from agent config

    Returns a PolicyEngine with rules from all three tiers merged.
    """
    from .policy_merge import merge_policies
    from ...shared.config import get_cached_config
    from ..db import get_session
    from ..models.organisation import Organisation

    try:
        cfg = get_cached_config()
        global_policies = getattr(cfg, "global_policies", {}) or {}
        agent_def = cfg.agents.get(agent_id)
        agent_policies = {}
        if agent_def and hasattr(agent_def, "policies"):
            agent_policies = agent_def.policies or {}
    except Exception:
        global_policies = {}
        agent_policies = {}

    try:
        async with get_session() as session:
            org = await session.get(Organisation, org_id)
            org_policies = org.policies if org and org.policies else {}
    except Exception:
        org_policies = {}

    merged = merge_policies(global_policies, org_policies, agent_policies)

    engine = PolicyEngine(default_action=get_policy_engine().default_action)
    # Add merged forbidden-tools as deny rules
    for tool_name in merged.get("forbidden_tools", []):
        engine.add_rule(PolicyRule(
            name=f"merged_forbidden:{tool_name}",
            condition={
                "op": "and",
                "conditions": [
                    {"field": "action_type", "comparator": "eq", "value": "tool_call"},
                    {"field": "payload.tool_name", "comparator": "eq", "value": tool_name},
                ],
            },
            action="deny",
            reason=f"Tool '{tool_name}' is forbidden in merged org/agent policy",
        ))
    # Add base engine rules (global defaults)
    for rule in get_policy_engine().rules:
        engine.add_rule(rule)
    return engine
