"""Model registry — instantiate LangChain chat models from config."""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.tools import StructuredTool

from .state import AgentState

log = logging.getLogger(__name__)


@lru_cache(maxsize=32)
def _build_model(model_name: str) -> BaseChatModel:
    """Instantiate (and cache) a LangChain chat model by provider/name string."""
    if "claude" in model_name or model_name.startswith("anthropic/"):
        from langchain_anthropic import ChatAnthropic

        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        return ChatAnthropic(
            model=model_name.split("/")[-1],
            api_key=api_key or "placeholder",  # type: ignore[arg-type]
        )
    if "llama" in model_name or "mixtral" in model_name or model_name.startswith("groq/"):
        from langchain_groq import ChatGroq

        api_key = os.environ.get("GROQ_API_KEY", "")
        return ChatGroq(
            model=model_name.split("/")[-1],
            api_key=api_key or "placeholder",  # type: ignore[arg-type]
        )
    if model_name.startswith("deepseek/"):
        from langchain_openai import ChatOpenAI

        api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        return ChatOpenAI(
            model=model_name.split("/")[-1],
            api_key=api_key or "placeholder",  # type: ignore[arg-type]
            base_url="https://api.deepseek.com",
        )
    if model_name.startswith("minimax/"):
        from langchain_openai import ChatOpenAI

        api_key = os.environ.get("MINIMAX_API_KEY", "")
        return ChatOpenAI(
            model=model_name.split("/")[-1],
            api_key=api_key or "placeholder",  # type: ignore[arg-type]
            base_url="https://api.minimax.io/v1",
        )
    # Default: OpenAI
    from langchain_openai import ChatOpenAI

    api_key = os.environ.get("OPENAI_API_KEY", "")
    return ChatOpenAI(
        model=model_name.split("/")[-1],
        api_key=api_key or "placeholder",  # type: ignore[arg-type]
    )


def _resolve_model_name(agent_id: str, model_tier: str) -> str:
    """Return the model name string for the given tier from agent config.

    Tiers: fast | primary | code  — any unknown tier falls back to primary.
    Budget mode forces everything to fast. Failover mode uses primary.
    """
    try:
        from ..shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
        if agent_def is None:
            return "gpt-4o-mini"
        m = agent_def.model
        mode = m.mode  # standard | budget | failover
        if mode == "budget":
            # Budget mode: always use the cheapest / fastest model
            return m.fast or m.primary
        # In standard or failover mode: route by tier
        if model_tier == "fast":
            return m.fast or m.primary
        if model_tier == "code":
            return m.code or m.primary
        return m.primary
    except Exception:
        return "gpt-4o-mini"


def get_failover_models(agent_id: str) -> list[str]:
    """Return ordered list of failover model names from agent config."""
    try:
        from ..shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
        if agent_def is None:
            return []
        return list(agent_def.model.failover)
    except Exception:
        return []


async def get_model_for_state(state: AgentState) -> BaseChatModel:
    """Return the LangChain model for the current agent state.

    Picks the model name from agent config based on state.model_tier,
    falling back to state.active_model if set, then to gpt-4o-mini.
    """
    if state.active_model:
        return _build_model(state.active_model)
    model_name = _resolve_model_name(state.agent_id, state.model_tier or "primary")
    return _build_model(model_name or "gpt-4o-mini")


def get_active_model_name(state: AgentState) -> str:
    """Return the model name string that will be used for this invocation."""
    if state.active_model:
        return state.active_model
    return _resolve_model_name(state.agent_id, state.model_tier or "primary") or "gpt-4o-mini"


def get_llm(model_name: str) -> BaseChatModel:
    """Public helper — return a cached LangChain model by provider/name string."""
    return _build_model(model_name)


def is_claude_model(model_name: str) -> bool:
    """Return True when model name routes to Anthropic Claude."""
    lowered = (model_name or "").lower()
    return "claude" in lowered or lowered.startswith("anthropic/")


def _build_claude_with_advisor(model_name: str) -> BaseChatModel:
    """Build Claude model for advisor flow.

    The current runtime does not require a separate constructor path,
    so we reuse the standard model builder.
    """
    return _build_model(model_name)


def get_advisor_enabled(agent_id: str) -> bool:
    """Read per-agent advisor toggle from config; default enabled."""
    try:
        from ..shared.config import get_cached_config

        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
        if agent_def is None:
            return True
        model_cfg: Any = getattr(agent_def, "model", None)
        advisor = getattr(model_cfg, "advisor", True)
        return bool(advisor)
    except Exception:
        return True


def make_advisor_tool() -> StructuredTool:
    """Create a lightweight advisor tool compatible with tool binding."""

    def _advisor(query: str) -> str:
        return f"Advisor note: focus on risk, policy, and fallback options for: {query}"

    return StructuredTool.from_function(
        func=_advisor,
        name="advisor",
        description="Provide a short advisory note for complex or risky requests.",
    )
