"""route_model node — classify task and pick the correct model tier."""
from __future__ import annotations

import logging
from typing import Any

from ..routing.classifier import classify
from ..routing.router import resolve_model
from ..state import AgentState

log = logging.getLogger(__name__)


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

    task_type = classify(text)

    # Check for explicit model hint in task metadata (overrides everything)
    model_hint: str | None = None
    if state.metadata:
        model_hint = state.metadata.get("model_hint")

    if model_hint:
        log.debug("route_model: using model_hint=%s (overrides arousal)", model_hint)
        return {
            "model_tier": state.model_tier or "standard",
            "active_model": model_hint,
            "metadata": {**(state.metadata or {}), "task_type": task_type},
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

    model_name, tier = resolve_model(state.agent_id, task_type)

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

    return {
        "model_tier": tier,
        "active_model": model_name,
        "metadata": {**(state.metadata or {}), "task_type": task_type},
    }
