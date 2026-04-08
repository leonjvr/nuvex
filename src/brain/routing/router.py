"""Model router — map task type to specific model name using agent routing config."""
from __future__ import annotations

import logging

from ...shared.config import get_cached_config

log = logging.getLogger(__name__)


def resolve_model(agent_id: str, task_type: str) -> tuple[str, str]:
    """
    Returns (model_name, tier) for the given agent and task type.
    Tier is one of: fast | standard | power

    If the primary model is unhealthy, falls back to the next healthiest candidate.
    """
    try:
        cfg = get_cached_config()
        agent = cfg.agents.get(agent_id)
        if agent is None:
            return "gpt-4o-mini", "standard"

        routing = agent.routing  # RoutingConfig: simple_reply, conversation, code_generation, voice_response
        model_cfg = agent.model  # ModelConfig: primary, fast, code

        tier_key = getattr(routing, task_type.replace("-", "_"), None) if routing else None

        if tier_key == "fast":
            candidates = [model_cfg.fast, model_cfg.primary, "gpt-4o-mini"]
            tier = "fast"
        elif tier_key == "code":
            candidates = [model_cfg.code, model_cfg.primary, "gpt-4o"]
            tier = "standard"
        else:
            candidates = [model_cfg.primary, "gpt-4o-mini"]
            tier = "standard"

        # Filter out None entries
        candidates = [c for c in candidates if c]

        # Health-aware selection: prefer the healthiest model in the candidate list
        try:
            from ..health import get_health_monitor
            monitor = get_health_monitor()
            best = monitor.prefer_alternative(candidates)
            if best != candidates[0]:
                log.info("health-routing: preferred %s over %s for agent=%s", best, candidates[0], agent_id)
            return best, tier
        except Exception as exc:
            log.debug("health-aware routing unavailable: %s", exc)

        return candidates[0], tier
    except Exception:
        return "gpt-4o-mini", "standard"
