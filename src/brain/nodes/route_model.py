"""route_model node — classify task and pick the correct model tier."""
from __future__ import annotations

import logging
from typing import Any

from ..events import publish
from ..routing.classifier import classify_detailed
from ..routing.router import resolve_model_decision
from ..state import AgentState

log = logging.getLogger(__name__)


def _provider_from_model_name(model_name: str) -> str:
    lowered = (model_name or "").lower()
    if "/" in lowered:
        return lowered.split("/", 1)[0]
    if "claude" in lowered:
        return "anthropic"
    if lowered.startswith("gpt") or lowered.startswith("o1") or lowered.startswith("o3"):
        return "openai"
    if "gemini" in lowered:
        return "google"
    if "llama" in lowered or "mixtral" in lowered:
        return "groq"
    return "unknown"


async def _emit_model_routed_event(
    state: AgentState,
    task_type: str,
    model_name: str,
    tier: str,
    provider: str,
    fallback_used: bool,
    decision_reason: str,
    requested_tier: str,
) -> None:
    payload = {
        "thread_id": state.thread_id,
        "task_type": task_type,
        "requested_tier": requested_tier,
        "resolved_tier": tier,
        "resolved_model": model_name,
        "provider": provider,
        "fallback_used": fallback_used,
        "decision_reason": decision_reason,
    }
    try:
        await publish(
            "model.routed",
            payload,
            agent_id=state.agent_id,
            invocation_id=state.invocation_id,
        )
    except Exception as exc:
        log.debug("route_model: model.routed emission skipped: %s", exc)


async def route_model(state: AgentState) -> dict[str, Any]:
    """Classify the last user message and resolve the correct model.

    Applies arousal-based tier modulation (30.4) before final model selection.
    Explicit task packet model_hint takes precedence over arousal override.
    """
    last_human = next(
        (m for m in reversed(state.messages) if m.type == "human"), None
    )
    text = last_human.content if last_human else ""
    if isinstance(text, list):  # multi-part content
        text = " ".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in text)

    budget_pressure = 1.0 if state.budget_exceeded else 0.0
    classification = classify_detailed(text, budget_pressure=budget_pressure)
    task_type = classification.task_type

    # Check for explicit model hint in task metadata (overrides everything)
    model_hint: str | None = None
    if state.metadata:
        model_hint = state.metadata.get("model_hint")

    requested_tier = state.model_tier or "standard"

    if model_hint:
        log.debug("route_model: using model_hint=%s (overrides arousal)", model_hint)
        provider = _provider_from_model_name(model_hint)
        decision = {
            "task_type": task_type,
            "requested_tier": requested_tier,
            "resolved_tier": requested_tier,
            "resolved_model": model_hint,
            "provider": provider,
            "fallback_used": False,
            "decision_reason": "model_hint",
            "signals": {
                "complexity_score": classification.complexity_score,
                "output_type": classification.output_type,
                "tool_likelihood": classification.tool_likelihood,
                "risk_class": classification.risk_class,
                "budget_pressure": classification.budget_pressure,
            },
        }
        await _emit_model_routed_event(
            state=state,
            task_type=task_type,
            model_name=model_hint,
            tier=requested_tier,
            provider=provider,
            fallback_used=False,
            decision_reason="model_hint",
            requested_tier=requested_tier,
        )
        return {
            "model_tier": requested_tier,
            "active_model": model_hint,
            "metadata": {
                **(state.metadata or {}),
                "task_type": task_type,
                "routing_decision": decision,
            },
        }

    # Arousal-based tier modulation (30.4.1) — best-effort, never blocks
    arousal_tier_override: str | None = None
    try:
        from ..arousal import get_model_tier_override, read_arousal
        arousal_score = await read_arousal(state.agent_id)
        arousal_tier_override = get_model_tier_override(arousal_score, task_type)
        if arousal_tier_override:
            log.debug(
                "route_model: arousal=%.2f override tier=%s for agent=%s",
                arousal_score, arousal_tier_override, state.agent_id,
            )
    except Exception as exc:
        log.debug("route_model: arousal modulation skipped: %s", exc)

    decision = resolve_model_decision(state.agent_id, task_type)
    model_name = decision["model_name"]
    tier = decision["tier"]

    # Apply arousal tier override (30.4.1) — never bypasses governance pipeline
    if arousal_tier_override == "fast":
        try:
            from ...shared.config import get_cached_config
            cfg = get_cached_config()
            agent = cfg.agents.get(state.agent_id)
            if agent and agent.model and agent.model.fast:
                model_name = agent.model.fast
                tier = "fast"
        except Exception:
            pass
    elif arousal_tier_override == "performance":
        try:
            from ...shared.config import get_cached_config
            cfg = get_cached_config()
            agent = cfg.agents.get(state.agent_id)
            if agent and agent.model and (agent.model.code or agent.model.primary):
                model_name = agent.model.code or agent.model.primary or model_name
                tier = "standard"
        except Exception:
            pass

    final_provider = _provider_from_model_name(model_name)
    final_reason = decision["decision_reason"]
    if arousal_tier_override in {"fast", "performance"}:
        final_reason = f"arousal_{arousal_tier_override}"

    routing_decision = {
        "task_type": task_type,
        "requested_tier": requested_tier,
        "resolved_tier": tier,
        "resolved_model": model_name,
        "provider": final_provider,
        "fallback_used": bool(decision["fallback_used"]),
        "decision_reason": final_reason,
        "signals": {
            "complexity_score": classification.complexity_score,
            "output_type": classification.output_type,
            "tool_likelihood": classification.tool_likelihood,
            "risk_class": classification.risk_class,
            "budget_pressure": classification.budget_pressure,
        },
    }

    await _emit_model_routed_event(
        state=state,
        task_type=task_type,
        model_name=model_name,
        tier=tier,
        provider=final_provider,
        fallback_used=bool(decision["fallback_used"]),
        decision_reason=final_reason,
        requested_tier=requested_tier,
    )

    return {
        "model_tier": tier,
        "active_model": model_name,
        "metadata": {
            **(state.metadata or {}),
            "task_type": task_type,
            "routing_decision": routing_decision,
        },
    }
