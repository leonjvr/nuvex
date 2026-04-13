"""Model registry — instantiate LangChain chat models from config."""
from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.tools import BaseTool

from .state import AgentState

log = logging.getLogger(__name__)

# Advisor tool constants (Anthropic beta — advisor-tool-2026-03-01)
_ADVISOR_BETA = "advisor-tool-2026-03-01"
_ADVISOR_MODEL = "claude-opus-4-6"


def is_claude_model(model_name: str) -> bool:
    """Return True when *model_name* resolves to an Anthropic Claude model."""
    return "claude" in model_name.lower() or model_name.startswith("anthropic/")


def get_advisor_enabled(agent_id: str) -> bool:
    """Return True when the advisor tool is enabled for *agent_id*.

    Defaults to True for all agents; set ``model.advisor: false`` in
    divisions.yaml to disable per agent.
    """
    try:
        from ..shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
        if agent_def is not None:
            return agent_def.model.advisor
    except Exception:
        pass
    return True


def make_advisor_tool() -> BaseTool:
    """Return a LangChain BaseTool that passes the Anthropic advisor server-tool
    definition through to the API unchanged (via the provider_tool_definition
    pass-through in langchain_anthropic 1.4+).
    """

    class _AdvisorServerTool(BaseTool):
        name: str = "advisor"
        description: str = "Anthropic advisor server tool"
        extras: dict[str, Any] = {
            "provider_tool_definition": {
                "type": "advisor_20260301",
                "name": "advisor",
                "model": _ADVISOR_MODEL,
            }
        }

        def _run(self, *args: Any, **kwargs: Any) -> str:  # pragma: no cover
            return ""  # server-side tool; never called locally

    return _AdvisorServerTool()


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


@lru_cache(maxsize=32)
def _build_claude_with_advisor(model_name: str) -> BaseChatModel:
    """Build a ChatAnthropic client that carries the advisor-tool beta header.

    The beta activates Anthropic's server-side advisor sub-inference.  The
    caller is responsible for adding the advisor tool definition to the
    ``tools`` list before invoking the model.
    """
    from langchain_anthropic import ChatAnthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    return ChatAnthropic(
        model=model_name.split("/")[-1],
        api_key=api_key or "placeholder",  # type: ignore[arg-type]
        betas=[_ADVISOR_BETA],
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
