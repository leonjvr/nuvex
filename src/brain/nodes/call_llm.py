"""call_llm node — select model tier, call LLM, track token cost."""
from __future__ import annotations

import hashlib
import json
import logging
import re
from typing import Any

from langchain_core.messages import AIMessage, SystemMessage, HumanMessage
from langchain_core.language_models import BaseChatModel

from ..state import AgentState
from ..models_registry import get_model_for_state, get_active_model_name, get_failover_models, _build_model, _build_claude_with_advisor, is_claude_model, get_advisor_enabled, make_advisor_tool
from ..tools_registry import get_tools_for_agent
from ..workspace import assemble_system_prompt, GOVERNANCE_PREAMBLE

log = logging.getLogger(__name__)


def _compute_schema_hash(tools: list) -> tuple[str, list[dict]]:
    """Serialize tool schemas deterministically and return (sha256_hex, schema_dicts).

    Schema dicts are sorted by tool name; every level of the JSON is serialised
    with sort_keys=True so that two invocations with identical tools — regardless
    of dict insertion order — always produce the same hash (§33).
    """
    schema_dicts: list[dict] = []
    for tool in tools:
        if tool.args_schema is not None:
            if isinstance(tool.args_schema, dict):
                params = tool.args_schema  # already a JSON schema dict (e.g. MCP tools)
            else:
                try:
                    params = tool.args_schema.model_json_schema()  # Pydantic v2
                except AttributeError:
                    try:
                        params = tool.args_schema.schema()  # Pydantic v1
                    except AttributeError:
                        params = {}
        else:
            params = {}
        schema_dicts.append({
            "name": tool.name,
            "description": tool.description or "",
            "parameters": params,
        })
    schema_dicts.sort(key=lambda s: s["name"])
    serialized = json.dumps(schema_dicts, sort_keys=True)
    digest = hashlib.sha256(serialized.encode()).hexdigest()
    return digest, schema_dicts


async def _retrieve_memory_block(state: AgentState) -> str:
    """Build the [MEMORY] block for the current invocation.

    Respects forbidden_tools: [memory_retrieve] (28.10, 28.23). Silent on failure.
    """
    try:
        from ...shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(state.agent_id)
        if agent_def and "memory_retrieve" in (agent_def.forbidden_tools or []):
            log.debug("memory: skipping retrieval — memory_retrieve in forbidden_tools")
            return ""
        tier_str = (agent_def.tier if agent_def else "T4").lstrip("T")
        try:
            agent_tier = int(tier_str)
        except ValueError:
            agent_tier = 4
        division_id = agent_def.division if agent_def else "default"
        memory_k = getattr(agent_def, "memory_k", 10) if agent_def else 10
        token_budget = getattr(agent_def, "memory_token_budget", 600) if agent_def else 600
    except Exception:
        agent_tier = 4
        division_id = "default"
        memory_k = 10
        token_budget = 600

    query = ""
    for m in reversed(state.messages):
        if isinstance(m, HumanMessage):
            content = m.content
            if isinstance(content, list):
                content = " ".join(
                    p.get("text", "") if isinstance(p, dict) else str(p) for p in content
                )
            query = str(content)[:2000]
            break

    if not query:
        return ""

    try:
        from ..memory.retriever import MemoryRetriever
        retriever = MemoryRetriever(
            agent_id=state.agent_id,
            agent_tier=agent_tier,
            division_id=division_id,
            k=memory_k,
            token_budget=token_budget,
            org_id=getattr(state, "org_id", "") or "",
        )
        # Retrieve entries and log retrievals for outcome feedback loop (29.3)
        entries = await retriever.retrieve(query)
        if entries:
            await _log_memory_retrievals(state.thread_id, entries)
        return retriever.format_retrieved(entries)
    except Exception as exc:
        log.warning("memory: retrieval failed — skipping: %s", exc)
        return ""


async def _log_memory_retrievals(thread_id: str, entries: list[dict]) -> None:
    """Insert memory_retrievals rows for outcome confidence propagation (29.3.1)."""
    if not entries:
        return
    try:
        from ..db import get_session
        from ..models.outcomes import MemoryRetrieval
        rows = [
            MemoryRetrieval(
                thread_id=thread_id,
                memory_id=entry["id"],
                cosine_score=entry.get("cosine_score"),
            )
            for entry in entries
            if entry.get("id") is not None
        ]
        if rows:
            async with get_session() as session:
                for row in rows:
                    session.add(row)
                await session.commit()
    except Exception as exc:
        log.debug("memory_retrievals: logging failed (non-fatal): %s", exc)


# Errors that are worth retrying with a failover model
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
    """Delegate to canonical cost estimator in costs.py (per-1M pricing)."""
    from ..costs import estimate_cost
    return estimate_cost(model_name, input_tokens, output_tokens)


def _repair_orphaned_tool_calls(messages: list) -> tuple[list, list]:
    """Remove AI messages whose tool_calls were never answered in sequence.

    An AI message is "orphaned" when its tool_calls are NOT answered by
    consecutive ToolMessages immediately following it (e.g. the process crashed
    before tool results were stored).  Anthropic (and OpenAI) reject such
    histories with a 400 error.

    Strategy: remove the orphaned AI message AND any displaced ToolMessages
    that refer to the same tool_call_ids (stubs previously appended to the end
    of state by earlier recovery attempts).  The result is a clean conversation
    where every AI tool_use block has a consecutive tool_result.

    Returns (repaired_messages, []) — empty second element kept for API
    compatibility; no stubs need to be persisted to state.
    """
    # Pass 1: find which tool_call_ids are properly answered consecutively
    properly_answered: set[str] = set()
    orphaned_tc_ids: set[str] = set()
    orphaned_ai_indices: set[int] = set()

    for i, m in enumerate(messages):
        if getattr(m, "type", None) != "ai":
            continue
        tool_calls = getattr(m, "tool_calls", None) or []
        if not tool_calls:
            continue

        tc_ids: set[str] = set()
        for tc in tool_calls:
            tid = tc.get("id") if isinstance(tc, dict) else getattr(tc, "id", None)
            if tid:
                tc_ids.add(tid)

        # Scan consecutive following tool messages
        j = i + 1
        answered_here: set[str] = set()
        while j < len(messages) and getattr(messages[j], "type", None) == "tool":
            tid = getattr(messages[j], "tool_call_id", None)
            if tid:
                answered_here.add(tid)
            j += 1

        unanswered = tc_ids - answered_here
        if unanswered:
            log.warning(
                "call_llm: removing orphaned AI message with unanswered tool_call_ids=%s",
                sorted(unanswered),
            )
            orphaned_ai_indices.add(i)
            orphaned_tc_ids.update(unanswered)
        else:
            properly_answered.update(answered_here)

    if not orphaned_ai_indices:
        return messages, []

    # Pass 2: rebuild without orphaned AI messages and their displaced ToolMessages
    repaired: list = []
    for i, m in enumerate(messages):
        if i in orphaned_ai_indices:
            continue
        if getattr(m, "type", None) == "tool":
            tid = getattr(m, "tool_call_id", None)
            if tid and tid in orphaned_tc_ids:
                continue  # skip displaced/stub ToolMessages for orphaned calls
        repaired.append(m)
    return repaired, []


_ERROR_PASTE_PATTERNS = [
    r"sync failed",
    r"cannot insert duplicate key",
    r"unique index",
    r"traceback \(most recent call last\)",
    r"exception:",
    r"unhandled exception",
    r"error:.*at line",
    r"duplicate key",
    r"constraint violation",
    r"violates.*constraint",
    r"sqlexception",
    r"keyerror",
    r"typeerror",
    r"attributeerror",
    r"runtimeerror",
]

_ERROR_PASTE_ENFORCEMENT = """
---
CRITICAL ENFORCEMENT — ACTIVE NOW:

The user's most recent message is an error paste. Any prior conversation summaries claiming "I fixed this" or "the error has been resolved" were INCORRECT — ignore them.

You MUST respond with ONLY these 3 questions. No summaries, no explanations, no tool calls:

1. What were you doing when this happened, and which part of the system triggered it?
2. Is this a new error or has it appeared before? If before, was it after a recent code change or deployment?
3. Any other context that might help — specific account, time of day, data being processed?

Do NOT call copilot.sh. Do NOT explain the error. Do NOT claim you have fixed anything. Ask ONLY the 3 questions above, then wait for the answers.
---
"""

_ERROR_PASTE_FOLLOWUP_ENFORCEMENT = """
---
CRITICAL ENFORCEMENT — ACTIVE NOW:

There is an unresolved error in this conversation. You have NOT yet called any tools. You have NOT run copilot.sh. The user is waiting for you to actually do the work.

YOUR RESPONSE MUST START WITH A TOOL CALL. Do not write any text before the tool call. Do not acknowledge. Do not say "I'll begin" or "I'll investigate" or "Thank you". 

The ONLY acceptable response is to immediately invoke shell_tool with copilot.sh. If you write any text instead of calling a tool, you are failing the user.

Call shell_tool now. First action. No preamble.
---
"""


def _last_user_text(conversation: list) -> str:
    for m in reversed(conversation):
        if isinstance(m, HumanMessage):
            content = m.content
            if isinstance(content, list):
                parts = [p.get("text", "") if isinstance(p, dict) else str(p) for p in content]
                return " ".join(parts)
            return str(content)
    return ""


def _is_error_paste(text: str) -> bool:
    lower = text.lower()
    return any(re.search(p, lower) for p in _ERROR_PASTE_PATTERNS)


def _recent_conversation_has_unanswered_error_paste(conversation: list) -> bool:
    """Return True when there is an unresolved error paste in the conversation —
    i.e. a user message with an error paste exists and no tool message has been
    recorded since then (meaning Maya never actually ran copilot.sh to fix it).
    """
    # Find all human messages with error pastes, track if any tool call followed
    last_error_paste_idx = None
    for i, m in enumerate(conversation):
        if isinstance(m, HumanMessage):
            content = m.content
            if isinstance(content, list):
                parts = [p.get("text", "") if isinstance(p, dict) else str(p) for p in content]
                content = " ".join(parts)
            if _is_error_paste(str(content)):
                last_error_paste_idx = i

    if last_error_paste_idx is None:
        return False

    # Check if any tool message exists after the last error paste
    for m in conversation[last_error_paste_idx + 1:]:
        if getattr(m, "type", None) == "tool":
            return False  # A real tool call happened — error was addressed

    return True


def _build_messages_for_llm(state: AgentState, memory_block: str = "", contact_block: str = "") -> tuple[list, list]:
    """Return (messages_for_llm, injected_stubs).

    messages_for_llm: full list with fresh system prompt prepended, ready to
    send to the LLM.  injected_stubs: any ToolMessages added to repair
    orphaned tool_calls — the caller must include these in the state update so
    the LangGraph checkpoint is permanently healed on the first successful call.

    Pass memory_block (from MemoryRetriever.build_block()) to inject semantic memories.
    Pass contact_block (from build_contact_context_block()) to inject contact identity.
    """
    conversation = [m for m in state.messages if not isinstance(m, SystemMessage)]
    conversation, injected_stubs = _repair_orphaned_tool_calls(conversation)
    if state.workspace_path:
        try:
            # Resolve response_style from agent config (§30)
            _response_style: str | None = None
            try:
                from ...shared.config import get_cached_config, get_agent as _get_agent
                _cfg = get_cached_config()
                _agent_def = _get_agent(_cfg, state.agent_id)
                _response_style = _agent_def.response_style if _agent_def else None
            except Exception:
                pass
            system_prompt = assemble_system_prompt(
                state.workspace_path,
                memory_block=memory_block,
                contact_block=contact_block,
                denied_actions=state.denied_actions or None,
                response_style=_response_style,
                agent_id=state.agent_id,
                org_id=getattr(state, "org_id", "default"),
            )
        except Exception as exc:
            log.warning("call_llm: failed to assemble system prompt: %s", exc)
            system_prompt = GOVERNANCE_PREAMBLE
    else:
        system_prompt = GOVERNANCE_PREAMBLE

    if state.project_context:
        system_prompt = f"{system_prompt}\n\n---\n\n{state.project_context}"

    last_user_text = _last_user_text(conversation)
    if _is_error_paste(last_user_text):
        log.info("call_llm: error paste detected — appending enforcement block to system prompt")
        system_prompt = f"{system_prompt}{_ERROR_PASTE_ENFORCEMENT}"
    elif _recent_conversation_has_unanswered_error_paste(conversation):
        log.info("call_llm: error paste follow-up detected — appending workflow enforcement block")
        system_prompt = f"{system_prompt}{_ERROR_PASTE_FOLLOWUP_ENFORCEMENT}"

    return [SystemMessage(content=system_prompt)] + conversation, injected_stubs


def _is_retriable(err: Exception) -> bool:
    msg = str(err).lower()
    return any(p in msg for p in _RETRIABLE_PHRASES)


async def _invoke_model(model: BaseChatModel, messages: list, model_name: str) -> AIMessage:
    """Call the model and return the AIMessage."""
    response: AIMessage = await model.ainvoke(messages)
    return response


async def call_llm(state: AgentState) -> dict[str, Any]:
    """Invoke the LLM for the current state and return message + cost deltas."""
    base_model: BaseChatModel = await get_model_for_state(state)
    resolved_model_name = get_active_model_name(state)

    # Don't bind tools to groq/fast models — known incompatibility with tool call generation
    is_groq = "groq" in resolved_model_name.lower() or state.model_tier == "fast"
    tools = (await get_tools_for_agent(state.agent_id)) if not is_groq else []

    # Anthropic advisor tool (advisor-tool-2026-03-01 beta):
    # Enabled by default for all Claude agents; disable per agent via model.advisor: false.
    # Escalation policy (Phase-2 signals) may force advisor on for complex/risky tasks,
    # or suppress it when the per-thread cap is exceeded.
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
        log.debug(
            "call_llm: advisor tool active reason=%s agent=%s model=%s",
            _advisor_reason, state.agent_id, resolved_model_name,
        )
        base_model = _build_claude_with_advisor(resolved_model_name)
        tools = [make_advisor_tool()] + tools
        _advisor_metadata_update = increment_advisor_count(state.metadata or {})

    # Tool schema locking (§33) — hash the tool set; serve serialised schema from
    # session-level state cache when unchanged so Anthropic's prompt cache stays warm.
    new_hash, schema_dicts = _compute_schema_hash(tools)
    if new_hash == state.tool_schema_hash and state.tool_schema_cache is not None:
        log.debug("call_llm: tool schema cache hit (hash=%.12s)", new_hash)
        schema_state_update: dict[str, Any] = {}
    else:
        log.debug("call_llm: tool schema cache miss — updating (hash=%.12s)", new_hash)
        schema_state_update = {"tool_schema_hash": new_hash, "tool_schema_cache": schema_dicts}

    model = base_model.bind_tools(tools) if tools else base_model

    # Build the message list with a fresh, deduplicated system prompt.
    # Orphaned tool_calls are removed by _repair_orphaned_tool_calls.
    # Retrieve semantically relevant memories first (28.8)
    memory_block = await _retrieve_memory_block(state)
    contact_block = ""
    if state.contact_id:
        try:
            from ..identity.context_block import build_contact_context_block
            contact_block = await build_contact_context_block(state.agent_id, state.contact_id)
        except Exception as _ce:
            log.debug("call_llm: contact context block failed (non-fatal): %s", _ce)
    messages_for_llm, _ = _build_messages_for_llm(state, memory_block=memory_block, contact_block=contact_block)

    # Attempt primary model, then failover list on retriable errors
    failover_models = get_failover_models(state.agent_id)
    candidates = [resolved_model_name] + failover_models
    last_exc: Exception | None = None
    _primary_model_name = resolved_model_name  # remember original primary

    for attempt, model_name in enumerate(candidates):
        if attempt > 0:
            # Switch to failover model
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
            break  # success
        except Exception as exc:
            # If advisor is active and this looks like an advisor-specific failure,
            # retry the SAME model without advisor before moving to the next candidate.
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
            log.error("LLM call failed for agent=%s model=%s: %s", state.agent_id, model_name, exc)
            last_exc = exc
            # Only continue to failover on retriable errors
            if not _is_retriable(exc) or attempt == len(candidates) - 1:
                break

    if last_exc is not None:
        # All attempts failed — emit events and return error state
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

    # Record a note when fallback was used so the diagnostics timeline shows it
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

    # Compute primary model cost for routing savings tracking (§37.3, §37.4)
    primary_model_name = candidates[0]  # first candidate is always the primary/configured model
    routed_from: str | None = None
    primary_cost_usd: float | None = None
    if resolved_model_name != primary_model_name:
        routed_from = primary_model_name
        primary_cost_usd = _estimate_cost(primary_model_name, input_tok, output_tok)

    # Resolve division for ledger row
    _division = ""
    try:
        from ...shared.config import get_cached_config
        _cfg = get_cached_config()
        _adef = _cfg.agents.get(state.agent_id)
        _division = _adef.division if _adef else ""
    except Exception:
        pass

    # Record cost to budget ledger (§37.3) — non-fatal
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

    # §29 — low-yield turn tracking
    has_tool_calls = bool(getattr(response, "tool_calls", None))
    new_low_yield = _compute_low_yield(state, output_tok, has_tool_calls)

    # Emit advisor.escalated telemetry when signals triggered escalation
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


def _is_budget_exceeded(agent_id: str, cumulative_cost: float) -> bool:
    """Check whether the agent's cumulative cost has exceeded its configured budget."""
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



def _compute_low_yield(state: "AgentState", output_tok: int, has_tool_calls: bool) -> int:
    """Compute updated low_yield_turns counter (§29).

    Tool-call turns carry the counter forward unchanged.
    Non-tool turns below the threshold increment; above it resets to 0.
    Returns 0 when diminishing_returns is disabled.
    """
    try:
        from ...shared.config import get_cached_config, get_agent
        cfg = get_cached_config()
        agent_def = get_agent(cfg, state.agent_id)
        dr_cfg = agent_def.diminishing_returns if agent_def else None
    except Exception:
        dr_cfg = None

    if dr_cfg is None or not dr_cfg.enabled:
        return 0

    if has_tool_calls:
        return state.low_yield_turns  # carry forward unchanged per spec

    if output_tok < dr_cfg.min_tokens_per_turn:
        return state.low_yield_turns + 1

    return 0  # reset when above threshold
