"""NUVEX agent graph — main LangGraph StateGraph definition."""
from __future__ import annotations

import logging
from typing import Any, Literal

from langgraph.graph import END, START, StateGraph

from .governance.approval import approval_gate
from .governance.budget import enforce_budget
from .governance.check_policy import check_policy
from .governance.classification import check_classification
from .governance.forbidden import check_forbidden
from .compaction import maybe_compact
from .lifecycle import set_agent_state
from .nodes.call_llm import call_llm
from .nodes.execute_tools import execute_tools
from .nodes.halt_diminishing_returns import halt_diminishing_returns
from .nodes.route_model import route_model
from .state import AgentState

log = logging.getLogger(__name__)


async def _auto_compact(state: AgentState) -> dict[str, Any]:
    """Auto-compact thread if over token threshold before LLM call (18.6)."""
    try:
        await maybe_compact(state.thread_id)
    except Exception as exc:
        log.debug("auto-compact skipped (non-fatal): %s", exc)
    return {}


async def _lifecycle_start(state: AgentState) -> dict[str, Any]:
    """Mark agent as active when an invocation begins."""
    try:
        await set_agent_state(state.agent_id, "active", reason=f"invocation/{state.invocation_id}")
    except Exception as exc:
        log.warning("lifecycle_start failed: %s", exc)
    return {}


async def _lifecycle_end(state: AgentState) -> dict[str, Any]:
    """Return agent to idle (or error) when an invocation finishes."""
    import asyncio

    # Record invocation start time for duration calculation (best-effort)
    from datetime import datetime, timezone
    end_time = datetime.now(timezone.utc)

    try:
        new_state = "error" if state.error else "idle"
        reason = state.error if state.error else f"finished/{state.invocation_id}"
        await set_agent_state(state.agent_id, new_state, reason=reason)
    except Exception as exc:
        log.warning("lifecycle_end failed: %s", exc)

    # 28.15 — run memory consolidation async at end of thread
    try:
        outcome = "failed" if state.error else "finished"
        asyncio.ensure_future(_run_consolidation(state, outcome))
    except Exception as exc:
        log.debug("memory consolidation schedule failed (non-fatal): %s", exc)

    # 29.4.1 — score thread outcome and adjust memory confidence (non-blocking)
    # Pass finished=True: lifecycle_end merges this after returning, but scoring
    # fires before the merge so we inject it explicitly into the scoring state.
    try:
        scoring_state = state.model_copy(update={"finished": True})
        asyncio.ensure_future(_run_outcome_scoring(scoring_state, end_time))
    except Exception as exc:
        log.debug("outcome scoring schedule failed (non-fatal): %s", exc)

    # §35 — scratch dir cleanup (best-effort, non-blocking)
    try:
        from .tools.executor import cleanup_scratch_dir
        from ..shared.config import get_cached_config, get_agent as _get_agent
        _cfg = get_cached_config()
        _agent_def = _get_agent(_cfg, state.agent_id)
        cleanup_policy = (_agent_def.scratch.cleanup if _agent_def else "on_archive")
        if cleanup_policy == "on_archive":
            cleanup_scratch_dir(state.thread_id)
    except Exception as exc:
        log.debug("scratch cleanup failed (non-fatal): %s", exc)

    return {"finished": True}


async def _run_consolidation(state: AgentState, outcome: str) -> None:
    """Background task: extract and store facts from the completed thread."""
    try:
        from .memory.consolidator import MemoryConsolidator
        from ..shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(state.agent_id)
        fast_model = "gpt-4o-mini"
        division_id = "default"
        if agent_def:
            fast_model = (agent_def.model.fast or agent_def.model.primary or fast_model)
            division_id = agent_def.division or "default"
        consolidator = MemoryConsolidator(
            agent_id=state.agent_id,
            division_id=division_id,
            fast_model=fast_model,
        )
        facts_written = await consolidator.consolidate(
            messages=state.messages,
            thread_id=state.thread_id,
            outcome=outcome,
        )
        log.info(
            "memory consolidation: thread=%s agent=%s outcome=%s facts=%d",
            state.thread_id, state.agent_id, outcome, facts_written,
        )
    except Exception as exc:
        log.warning("memory consolidation failed (non-fatal): %s", exc)


async def _run_outcome_scoring(state: AgentState, end_time: "datetime") -> None:
    """Background task: score thread outcomes and propagate memory confidence (29.4)."""
    try:
        from datetime import datetime
        from .outcomes import score_thread, adjust_memory_confidence, record_routing_outcome

        outcome = await score_thread(state, end_time)
        await adjust_memory_confidence(state.thread_id, outcome)

        # 29.4.2 — record routing outcome
        task_type = state.metadata.get("task_type", "conversation") if state.metadata else "conversation"
        await record_routing_outcome(
            agent_id=state.agent_id,
            task_type=task_type,
            model_name=state.active_model or "unknown",
            succeeded=outcome.succeeded,
            cost_usd=state.cost_usd,
            duration_s=outcome.duration_s,
        )
    except Exception as exc:
        log.warning("outcome scoring failed (non-fatal): %s", exc)


def _should_continue(state: AgentState) -> Literal["tools", "halt_dr", "end"]:
    if state.finished or state.error or state.budget_exceeded:
        return "end"
    if state.iteration >= state.max_iterations:
        return "end"
    last = state.messages[-1] if state.messages else None
    has_tool_calls = last and getattr(last, "tool_calls", None)
    # Tool-call turns route to tools; only non-tool turns can trigger DR halt
    if has_tool_calls:
        return "tools"
    # §29 — check diminishing returns after non-tool-call turns
    if _is_diminishing_returns_halt(state):
        return "halt_dr"
    return "end"


def _is_diminishing_returns_halt(state: AgentState) -> bool:
    """Return True when consecutive low-yield turns have exceeded the threshold (§29)."""
    try:
        from ..shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(state.agent_id)
        dr_cfg = agent_def.diminishing_returns if agent_def else None
        if dr_cfg is None or not dr_cfg.enabled:
            return False
        return state.low_yield_turns >= dr_cfg.consecutive_threshold
    except Exception:
        return False


def _check_budget(state: AgentState) -> Literal["llm", "end"]:
    """Gate: prevent LLM call if budget is already exceeded."""
    if state.budget_exceeded:
        return "end"
    return "llm"


def _governance_gate(state: AgentState) -> Literal["next", "end"]:
    """Shared gate for governance pipeline nodes — short-circuit on denial."""
    if state.finished or state.error or state.budget_exceeded:
        return "end"
    return "next"


def _policy_gate(state: AgentState) -> Literal["execute_tools", "end"]:
    """After policy check — proceed to execute_tools or end if denied."""
    if state.finished or state.error:
        return "end"
    return "execute_tools"


async def _check_classification_node(state: AgentState) -> dict[str, Any]:
    """Async wrapper for classification check — converts state return to update dict."""
    updated = check_classification(state)
    if updated.error and updated.error != state.error:
        return {
            "error": updated.error,
            "finished": True,
            "governance_decisions": updated.governance_decisions,
        }
    return {}


def build_graph() -> StateGraph:
    """Build the NUVEX agent StateGraph.

    Graph flow:
      lifecycle_start → route_model → call_llm
        → [tool_calls] → check_forbidden → check_classification
                       → approval_gate → check_policy → execute_tools
                       → enforce_budget → route_model  (loop)
        → [no tools / done] → lifecycle_end
    """
    g = StateGraph(AgentState)

    g.add_node("lifecycle_start", _lifecycle_start)
    g.add_node("route_model", route_model)
    g.add_node("auto_compact", _auto_compact)
    g.add_node("call_llm", call_llm)
    # §29 — diminishing returns halt node
    g.add_node("halt_diminishing_returns", halt_diminishing_returns)
    # Governance pipeline — all 5 stages (6.6)
    g.add_node("check_forbidden", check_forbidden)
    g.add_node("check_classification", _check_classification_node)
    g.add_node("approval_gate", approval_gate)
    g.add_node("check_policy", check_policy)
    g.add_node("execute_tools", execute_tools)
    g.add_node("persist_budget", enforce_budget)
    g.add_node("lifecycle_end", _lifecycle_end)

    # Pre-LLM: budget gate prevents calling LLM when over budget
    g.add_edge(START, "lifecycle_start")
    g.add_edge("lifecycle_start", "route_model")
    g.add_conditional_edges("route_model", _check_budget, {"llm": "auto_compact", "end": "lifecycle_end"})
    g.add_edge("auto_compact", "call_llm")

    # Post-LLM: route to governance, halt_dr, or end
    g.add_conditional_edges("call_llm", _should_continue, {"tools": "check_forbidden", "halt_dr": "halt_diminishing_returns", "end": "lifecycle_end"})
    g.add_edge("halt_diminishing_returns", "lifecycle_end")

    # Governance pipeline (any denial short-circuits to lifecycle_end)
    g.add_conditional_edges("check_forbidden", _governance_gate, {"next": "check_classification", "end": "lifecycle_end"})
    g.add_conditional_edges("check_classification", _governance_gate, {"next": "approval_gate", "end": "lifecycle_end"})
    g.add_conditional_edges("approval_gate", _governance_gate, {"next": "check_policy", "end": "lifecycle_end"})
    g.add_conditional_edges("check_policy", _policy_gate, {"execute_tools": "execute_tools", "end": "lifecycle_end"})

    # Post-execution: persist budget then loop
    g.add_edge("execute_tools", "persist_budget")
    g.add_edge("persist_budget", "route_model")
    g.add_edge("lifecycle_end", END)

    return g


_compiled_graph = None


def get_compiled_graph(checkpointer=None):
    """Return (or create) the compiled LangGraph.

    Parameters
    ----------
    checkpointer:
        A LangGraph checkpointer instance (e.g. ``AsyncPostgresSaver`` or
        ``MemorySaver``).  When *None* the graph is compiled without
        persistence — suitable for tests and ephemeral environments.
    """
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_graph().compile(checkpointer=checkpointer)
    return _compiled_graph
