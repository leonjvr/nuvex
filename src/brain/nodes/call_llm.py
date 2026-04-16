"""call_llm node — select model tier, call LLM, track token cost."""
from __future__ import annotations

import logging
from typing import Any

from langchain_core.messages import AIMessage
from langchain_core.language_models import BaseChatModel

from ..state import AgentState
from ..models_registry import (
    get_model_for_state, get_active_model_name, get_failover_models,
    _build_model, _build_claude_with_advisor, is_claude_model,
    get_advisor_enabled, make_advisor_tool,
)
from ..tools_registry import get_tools_for_agent

# Sub-module imports — extracted for single-responsibility
from .schema_cache import compute_schema_hash
from .memory_injection import retrieve_memory_block
from .message_repair import build_messages_for_llm
from .diminishing_returns import compute_low_yield

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Backward-compat aliases — unit-tests import these private names directly
# ---------------------------------------------------------------------------
_compute_schema_hash = compute_schema_hash
_retrieve_memory_block = retrieve_memory_block
from .message_repair import repair_orphaned_tool_calls as _repair_orphaned_tool_calls
_build_messages_for_llm = build_messages_for_llm
_compute_low_yield = compute_low_yield

# Retriable error phrases
_RETRIABLE_PHRASES = (
    "overloaded", "rate_limit", "rate limit",
    "529", "503", "502", "timeout",
    "credit balance", "credit_balance", "insufficient_quota",
    "billing", "quota", "payment",
    "tool_calls must be followed", "did not have response messages",
    "connection error", "connection refused", "connect timeout",
    "name or service not known", "failed to establish", "remotedisconnected",
    "network is unreachable",
)


def _estimate_cost(model_name: str, input_tokens: int, output_tokens: int) -> float:
    from ..costs import estimate_cost
    return estimate_cost(model_name, input_tokens, output_tokens)


def _is_retriable(err: Exception) -> bool:
    msg = str(err).lower()
    return any(p in msg for p in _RETRIABLE_PHRASES)


async def _invoke_model(model: BaseChatModel, messages: list, model_name: str) -> AIMessage:
    return await model.ainvoke(messages)


def _is_budget_exceeded(agent_id: str, cumulative_cost: float) -> bool:
    try:
        from ...shared.config import get_cached_config, get_agent
        cfg = get_cached_config()
        agent_def = get_agent(cfg, agent_id)
        if agent_def is not None:
            limit = agent_def.budget.per_task_usd
            if cumulative_cost >= limit:
                log.warning(
                    "Budget exceeded for agent=%s: cost=%.4f >= limit=%.4f",
                    agent_id, cumulative_cost, limit,
                )
                return True
    except Exception:
        pass
    return False


def get_auxiliary_model(agent_id: str) -> BaseChatModel:
    """Return the fast/auxiliary model for *agent_id*.

    Used by background tasks (compaction, consolidator, language gradient, snip
    selector) to avoid billing primary-model tokens for side work.
    """
    try:
        from ...shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
        if agent_def and agent_def.model.fast:
            return _build_model(agent_def.model.fast)
        if agent_def and agent_def.model.primary:
            return _build_model(agent_def.model.primary)
    except Exception as exc:
        log.debug("get_auxiliary_model: config lookup failed (%s), using default", exc)
    return _build_model("openai/gpt-4o-mini")


def get_auxiliary_model_name(agent_id: str) -> str:
    """Return the fast/auxiliary model name string for *agent_id*."""
    try:
        from ...shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
        if agent_def and agent_def.model.fast:
            return agent_def.model.fast
        if agent_def and agent_def.model.primary:
            return agent_def.model.primary
    except Exception as exc:
        log.debug("get_auxiliary_model_name: config lookup failed (%s), using default", exc)
    return "openai/gpt-4o-mini"


async def call_llm(state: AgentState) -> dict[str, Any]:
    """Invoke the LLM for the current state and return message + cost deltas."""
    base_model: BaseChatModel = await get_model_for_state(state)
    resolved_model_name = get_active_model_name(state)

    is_groq = "groq" in resolved_model_name.lower() or state.model_tier == "fast"
    tools = (await get_tools_for_agent(state.agent_id)) if not is_groq else []

    # Advisor tool (advisor-tool-2026-03-01 beta)
    _base_advisor_eligible = not is_groq and is_claude_model(resolved_model_name) and get_advisor_enabled(state.agent_id)
    _routing_signals: dict[str, Any] | None = (state.metadata or {}).get("routing_decision", {}).get("signals")
    from ..routing.escalation import EscalationPolicy, should_escalate_advisor, increment_advisor_count
    _escalation_policy = EscalationPolicy()
    _use_advisor, _advisor_reason = should_escalate_advisor(
        base_advisor_enabled=_base_advisor_eligible,
        signals=_routing_signals,
        metadata=state.metadata or {},
        policy=_escalation_policy,
    )
    _advisor_metadata_update: dict[str, Any] = {}
    if _use_advisor:
        log.debug("call_llm: advisor active reason=%s agent=%s model=%s", _advisor_reason, state.agent_id, resolved_model_name)
        base_model = _build_claude_with_advisor(resolved_model_name)
        tools = [make_advisor_tool()] + tools
        _advisor_metadata_update = increment_advisor_count(state.metadata or {})

    # Tool schema locking (§33)
    new_hash, schema_dicts = compute_schema_hash(tools)
    if new_hash == state.tool_schema_hash and state.tool_schema_cache is not None:
        log.debug("call_llm: schema cache hit (hash=%.12s)", new_hash)
        schema_state_update: dict[str, Any] = {}
    else:
        log.debug("call_llm: schema cache miss (hash=%.12s)", new_hash)
        schema_state_update = {"tool_schema_hash": new_hash, "tool_schema_cache": schema_dicts}

    model = base_model.bind_tools(tools) if tools else base_model

    # Memory + contact context
    memory_block = await retrieve_memory_block(state)
    contact_block = ""
    if state.contact_id:
        try:
            from ..identity.context_block import build_contact_context_block
            contact_block = await build_contact_context_block(state.agent_id, state.contact_id)
        except Exception as _ce:
            log.debug("call_llm: contact context block failed (non-fatal): %s", _ce)
    messages_for_llm, _ = build_messages_for_llm(state, memory_block=memory_block, contact_block=contact_block)

    # Model invocation with failover
    failover_models = get_failover_models(state.agent_id)
    candidates = [resolved_model_name] + failover_models
    last_exc: Exception | None = None
    _primary_model_name = resolved_model_name

    for attempt, model_name in enumerate(candidates):
        if attempt > 0:
            log.warning("call_llm: primary failed, trying failover model=%s", model_name)
            is_groq_failover = "groq" in model_name.lower()
            if not is_groq_failover and _use_advisor and is_claude_model(model_name):
                fb = _build_claude_with_advisor(model_name)
            else:
                fb = _build_model(model_name)
            fb_tools = tools if not is_groq_failover else []
            model = fb.bind_tools(fb_tools) if fb_tools else fb
            resolved_model_name = model_name

        try:
            response: AIMessage = await model.ainvoke(messages_for_llm)
            last_exc = None
            break
        except Exception as exc:
            _ADVISOR_FAILURE_PHRASES = ("advisor", "invalid beta", "unsupported beta", "unknown beta")
            if _use_advisor and any(p in str(exc).lower() for p in _ADVISOR_FAILURE_PHRASES):
                log.warning("call_llm: advisor failed (%s) — retrying %s without advisor", exc, model_name)
                _use_advisor = False
                tools = [t for t in tools if getattr(t, "name", "") != "advisor"]
                no_adv_model = _build_model(model_name)
                no_adv_bound = no_adv_model.bind_tools(tools) if tools else no_adv_model
                try:
                    response = await no_adv_bound.ainvoke(messages_for_llm)
                    model = no_adv_bound
                    last_exc = None
                    break
                except Exception as exc2:
                    exc = exc2
            log.error("LLM call failed agent=%s model=%s: %s", state.agent_id, model_name, exc)
            last_exc = exc
            if not _is_retriable(exc) or attempt == len(candidates) - 1:
                break

    if last_exc is not None:
        try:
            from ..health import record_llm_call
            await record_llm_call(resolved_model_name, success=False, error=str(last_exc))
        except Exception:
            pass
        try:
            from .. import events
            import re
            status_match = re.search(r"(\d{3})", str(last_exc))
            http_status = int(status_match.group(1)) if status_match else None
            await events.publish(
                "llm.invocation",
                {"status": "error", "error": str(last_exc), "http_status": http_status, "model": resolved_model_name},
                agent_id=state.agent_id,
                invocation_id=state.invocation_id,
            )
        except Exception:
            pass
        return {"error": str(last_exc), "finished": True}

    if resolved_model_name != _primary_model_name:
        try:
            from ..lifecycle import record_agent_note
            await record_agent_note(
                state.agent_id,
                f"fallback: used {resolved_model_name} (primary {_primary_model_name} unavailable)",
            )
        except Exception:
            pass

    usage = getattr(response, "usage_metadata", None) or {}
    input_tok = usage.get("input_tokens", 0)
    output_tok = usage.get("output_tokens", 0)
    cost = _estimate_cost(resolved_model_name, input_tok, output_tok)

    try:
        from ..health import record_llm_call
        await record_llm_call(resolved_model_name, success=True)
    except Exception:
        pass

    new_cost = state.cost_usd + cost

    primary_model_name = candidates[0]
    routed_from: str | None = None
    primary_cost_usd: float | None = None
    if resolved_model_name != primary_model_name:
        routed_from = primary_model_name
        primary_cost_usd = _estimate_cost(primary_model_name, input_tok, output_tok)

    _division = ""
    try:
        from ...shared.config import get_cached_config
        _cfg = get_cached_config()
        _adef = _cfg.agents.get(state.agent_id)
        _division = _adef.division if _adef else ""
    except Exception:
        pass

    try:
        from ..costs import record_llm_cost
        _provider = resolved_model_name.split("/")[0] if "/" in resolved_model_name else ""
        await record_llm_cost(
            agent_id=state.agent_id,
            model=resolved_model_name,
            provider=_provider,
            input_tokens=input_tok,
            output_tokens=output_tok,
            cost_usd=cost,
            thread_id=state.thread_id or "",
            routed_from=routed_from,
            primary_cost_usd=primary_cost_usd,
            division=_division,
            org_id=getattr(state, "org_id", "") or "",
        )
    except Exception as _le:
        log.debug("call_llm: record_llm_cost skipped: %s", _le)

    budget_exceeded = _is_budget_exceeded(state.agent_id, new_cost)

    has_tool_calls = bool(getattr(response, "tool_calls", None))
    new_low_yield = compute_low_yield(state, output_tok, has_tool_calls)

    if _use_advisor and _advisor_reason == "signals_escalated":
        try:
            from .. import events as _ev
            await _ev.publish(
                "advisor.escalated",
                {
                    "agent_id": state.agent_id,
                    "invocation_id": state.invocation_id,
                    "model": resolved_model_name,
                    "signals": _routing_signals or {},
                    "advisor_count": _advisor_metadata_update.get("advisor_escalation_count", 1),
                },
                agent_id=state.agent_id,
                invocation_id=state.invocation_id,
            )
        except Exception as _ae:
            log.debug("call_llm: advisor.escalated event skipped: %s", _ae)

    _meta_update = _advisor_metadata_update if _advisor_metadata_update else {}

    return {
        "messages": [response],
        "error": None,
        "tokens_used": state.tokens_used + input_tok + output_tok,
        "cost_usd": new_cost,
        "budget_exceeded": budget_exceeded,
        "active_model": resolved_model_name,
        "iteration": state.iteration + 1,
        "low_yield_turns": new_low_yield,
        **schema_state_update,
        **({"metadata": {**(state.metadata or {}), **_meta_update}} if _meta_update else {}),
    }
