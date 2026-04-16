"""Model router — map task type to specific model name using agent routing config."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ...shared.config import get_cached_config

if TYPE_CHECKING:
    from .classifier import ClassificationResult

log = logging.getLogger(__name__)


def _provider_for_model(model_name: str) -> str:
    """Infer provider slug from a model identifier."""
    if not model_name:
        return "unknown"

    lowered = model_name.lower()
    if "/" in lowered:
        prefix = lowered.split("/", 1)[0]
        if prefix:
            return prefix

    if "claude" in lowered:
        return "anthropic"
    if lowered.startswith("gpt") or lowered.startswith("o1") or lowered.startswith("o3"):
        return "openai"
    if "gemini" in lowered:
        return "google"
    if "llama" in lowered or "mixtral" in lowered:
        return "groq"
    return "unknown"


def resolve_model_decision(agent_id: str, task_type: str) -> dict[str, Any]:
    """Return a structured routing decision for model telemetry."""
    default_model = "gpt-4o-mini"
    decision: dict[str, Any] = {
        "model_name": default_model,
        "tier": "standard",
        "provider": "openai",
        "fallback_used": False,
        "decision_reason": "default",
        "task_type": task_type,
    }

    try:
        cfg = get_cached_config()
        agent = cfg.agents.get(agent_id)
        if agent is None:
            return decision

        routing = agent.routing
        model_cfg = agent.model
        tier_key = getattr(routing, task_type.replace("-", "_"), None) if routing else None

        if tier_key == "fast":
            candidates = [model_cfg.fast, model_cfg.primary, default_model]
            tier = "fast"
        elif tier_key == "code":
            candidates = [model_cfg.code, model_cfg.primary, "gpt-4o"]
            tier = "standard"
        else:
            candidates = [model_cfg.primary, default_model]
            tier = "standard"

        # trivial_reply always forces the fast model (hermes-inspired-runtime §5.9)
        if task_type == "trivial_reply":
            candidates = [model_cfg.fast, model_cfg.primary, default_model]
            tier = "fast"

        candidates = [c for c in candidates if c]
        selected = candidates[0]
        fallback_used = False
        reason = "routing_config"

        try:
            from ..health import get_health_monitor

            monitor = get_health_monitor()
            best = monitor.prefer_alternative(candidates)
            if best != selected:
                fallback_used = True
                reason = "health_fallback"
                log.info(
                    "health-routing: preferred %s over %s for agent=%s",
                    best,
                    selected,
                    agent_id,
                )
            selected = best
        except Exception as exc:
            log.debug("health-aware routing unavailable: %s", exc)

        return {
            "model_name": selected,
            "tier": tier,
            "provider": _provider_for_model(selected),
            "fallback_used": fallback_used,
            "decision_reason": reason,
            "task_type": task_type,
        }
    except Exception:
        return decision


def resolve_model(agent_id: str, task_type: str) -> tuple[str, str]:
    """
    Returns (model_name, tier) for the given agent and task type.
    Tier is one of: fast | standard | power

    If the primary model is unhealthy, falls back to the next healthiest candidate.
    """
    decision = resolve_model_decision(agent_id, task_type)
    return decision["model_name"], decision["tier"]


def _signals_dict(signals: "ClassificationResult", theta: float) -> dict[str, Any]:
    return {
        "complexity_score": signals.complexity_score,
        "tool_likelihood": signals.tool_likelihood,
        "risk_class": signals.risk_class,
        "budget_pressure": signals.budget_pressure,
        "theta": theta,
    }


def resolve_model_with_signals(
    agent_id: str,
    task_type: str,
    signals: "ClassificationResult | None" = None,
    theta: float = 0.5,
) -> dict[str, Any]:
    """Resolve model incorporating capability signals for quality-cost optimization.

    theta: quality-cost threshold in [0.0, 1.0].
        Higher theta = prefer quality (promote complex/risky tasks to heavier model).
        Lower theta = prefer cost (demote simple tasks to fast model under budget pressure).
    """
    base = resolve_model_decision(agent_id, task_type)
    if signals is None:
        return base

    # Promote from fast → code tier when high complexity + high risk
    if (
        signals.complexity_score > theta
        and signals.risk_class == "high"
        and base["tier"] == "fast"
    ):
        upgraded = resolve_model_decision(agent_id, "code_generation")
        return {**upgraded, "decision_reason": "signals_promoted", "signals": _signals_dict(signals, theta)}

    # Demote to fast when simple + low risk + budget pressure exceeds threshold
    if (
        signals.complexity_score < (1.0 - theta)
        and signals.tool_likelihood < 0.3
        and signals.risk_class == "low"
        and signals.budget_pressure > 0.6
        and base["tier"] != "fast"
    ):
        downgraded = resolve_model_decision(agent_id, "simple_reply")
        return {**downgraded, "decision_reason": "signals_demoted_budget", "signals": _signals_dict(signals, theta)}

    return {**base, "signals": _signals_dict(signals, theta)}
