"""Memory retrieval injection — builds the [MEMORY] block for each LLM call.

Respects forbidden_tools, tier, org scope, and outcome logging (§28, §29).
"""
from __future__ import annotations

import logging

from langchain_core.messages import HumanMessage

log = logging.getLogger(__name__)


async def retrieve_memory_block(state: "AgentState") -> str:  # type: ignore[name-defined]
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


# Legacy alias for unit-tests that imported the private name
_retrieve_memory_block = retrieve_memory_block
