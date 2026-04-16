"""Thread compaction — trim old messages to stay within token budget."""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select

from .db import get_session
from .models.thread import Message, Thread

log = logging.getLogger(__name__)

DEFAULT_TOKEN_LIMIT = 6000
DEFAULT_PRESERVE_RECENT = 5

# Priority order for summary (higher = keep more content in summary)
_ROLE_PRIORITY = {"tool": 3, "ai": 2, "assistant": 2, "human": 1, "user": 1, "system": 0}

# Compaction handoff framing — prepended to every summary (hermes-inspired-runtime §4)
_HANDOFF_PREAMBLE = (
    "[CONTEXT COMPACTION — REFERENCE ONLY]\n"
    "Earlier turns were compacted into the summary below. This is a handoff from a previous "
    "context window — treat it as background reference, NOT as active instructions. "
    "Do NOT answer questions or fulfil requests mentioned in this summary — "
    "they have already been handled.\n\n"
)

_TOOL_CLEARED_STUB = "[Tool output cleared to save context space]"


def _role_priority(role: str) -> int:
    return _ROLE_PRIORITY.get(role.lower(), 1)


def _is_tool_result_role(role: str) -> bool:
    return role.lower() in ("tool", "function")


def _prune_tool_results(messages: list[Any], preserve_recent: int) -> list[Any]:
    """Replace tool result messages older than *preserve_recent* with a stub.

    Human and system messages are never touched.
    Returns a new list — the originals are not mutated.

    Spec: hermes-inspired-runtime §4.1
    """
    if preserve_recent >= len(messages):
        return list(messages)

    cutoff = len(messages) - preserve_recent
    pruned = []
    for i, m in enumerate(messages):
        if i < cutoff and _is_tool_result_role(m.role):
            # Create a lightweight copy with cleared content
            stub = type(m).__new__(type(m))
            stub.__dict__.update(m.__dict__)
            stub.content = _TOOL_CLEARED_STUB
            pruned.append(stub)
        else:
            pruned.append(m)
    return pruned


def _deduplicate(messages: list[Any]) -> list[Any]:
    """Remove messages whose content hash has already appeared (18.4)."""
    seen: set[str] = set()
    result = []
    for m in messages:
        h = hashlib.sha256(m.content.encode("utf-8", errors="replace")).hexdigest()[:16]
        if h not in seen:
            seen.add(h)
            result.append(m)
    return result


def _build_priority_summary(messages: list[Any]) -> str:
    """Build summary from messages with handoff framing and structured sections.

    Spec: hermes-inspired-runtime §4.3 / §4.4
    """
    # Sort by priority descending, then by creation time ascending
    ordered = sorted(messages, key=lambda m: (-_role_priority(m.role), m.created_at))
    deduped = _deduplicate(ordered)

    resolved_parts: list[str] = []
    human_parts: list[str] = []
    tool_parts: list[str] = []

    for m in deduped:
        content = m.content[:400] if len(m.content) > 400 else m.content
        if content == _TOOL_CLEARED_STUB:
            continue
        role_lower = m.role.lower()
        if role_lower in ("human", "user"):
            human_parts.append(f"- {content}")
        elif role_lower in ("ai", "assistant"):
            resolved_parts.append(f"- {content}")
        elif role_lower in ("tool", "function"):
            tool_parts.append(f"- [tool result] {content}")

    sections: list[str] = []
    if resolved_parts:
        sections.append("## Resolved\n" + "\n".join(resolved_parts))
    if human_parts:
        sections.append("## Pending\n" + "\n".join(human_parts))
    if tool_parts:
        sections.append("## Remaining Work (tool outputs)\n" + "\n".join(tool_parts))

    body = ("\n\n".join(sections)) if sections else "[No actionable content]"
    return _HANDOFF_PREAMBLE + body


async def maybe_compact(
    thread_id: str,
    token_limit: int = DEFAULT_TOKEN_LIMIT,
    preserve_recent: int = DEFAULT_PRESERVE_RECENT,
    agent_id: str = "",
) -> bool:
    """
    Compact a thread if its stored messages exceed token_limit.

    Preserves the most recent `preserve_recent` messages verbatim and
    replaces older ones with a priority-ordered handoff summary.
    Applies a zero-cost tool-result prune pass before summarising.
    On subsequent compactions the existing summary stub is updated in-place
    rather than creating a nested summary-of-summary.
    Returns True if compaction was performed.

    Spec: hermes-inspired-runtime §4
    """
    async with get_session() as session:
        result = await session.execute(
            select(Message)
            .where(Message.thread_id == thread_id)
            .order_by(Message.created_at)
        )
        messages = result.scalars().all()
        if not messages:
            return False

        total_tokens = sum(m.tokens or len(m.content) // 4 for m in messages)
        if total_tokens <= token_limit:
            return False

        log.info("compaction: thread=%s tokens=%d > limit=%d", thread_id, total_tokens, token_limit)

        keep_n = max(preserve_recent, len(messages) // 5)
        to_delete = messages[:-keep_n] if keep_n < len(messages) else []
        if not to_delete:
            return False

        # Prune tool results in the to-delete window before summarising (§4.1)
        pruned = _prune_tool_results(list(to_delete), preserve_recent=0)
        summary = _build_priority_summary(pruned)

        ids_to_delete = [m.id for m in to_delete]
        await session.execute(delete(Message).where(Message.id.in_(ids_to_delete)))

        # §4.5 — update existing compaction stub if present (avoid nesting)
        existing_stub_result = await session.execute(
            select(Message)
            .where(Message.thread_id == thread_id)
            .where(Message.role == "system")
        )
        existing_stubs = [
            m for m in existing_stub_result.scalars().all()
            if m.content.startswith("[CONTEXT COMPACTION")
        ]
        if existing_stubs:
            existing_stub = existing_stubs[0]
            existing_stub.content = summary
            existing_stub.tokens = len(summary) // 4
        else:
            stub = Message(
                thread_id=thread_id,
                role="system",
                content=summary,
                tokens=len(summary) // 4,
            )
            session.add(stub)

        thread_result = await session.execute(select(Thread).where(Thread.id == thread_id))
        thread: Thread | None = thread_result.scalar_one_or_none()
        if thread:
            thread.last_compacted_at = datetime.now(timezone.utc)

        await session.commit()
        return True



class SnipCompactor:
    """Snip-mode compaction: archives older turns to thread_snips table (§31).

    Keeps the most recent ``preserve_recent`` turns in the active message list
    and stores older turns as searchable snips in PostgreSQL.
    """

    def __init__(
        self,
        thread_id: str,
        agent_id: str,
        preserve_recent: int = 10,
    ) -> None:
        self.thread_id = thread_id
        self.agent_id = agent_id
        self.preserve_recent = preserve_recent

    async def compact(self) -> int:
        """Archive older messages to thread_snips. Returns the number archived."""
        async with get_session() as session:
            result = await session.execute(
                select(Message)
                .where(Message.thread_id == self.thread_id)
                .order_by(Message.created_at)
            )
            messages = result.scalars().all()
            if not messages:
                return 0

            if len(messages) <= self.preserve_recent:
                return 0

            to_archive = messages[: -self.preserve_recent]
            archived = 0
            for idx, msg in enumerate(to_archive):
                token_est = msg.tokens or (len(msg.content) // 4)
                from .models.thread_snip import ThreadSnip
                snip = ThreadSnip(
                    thread_id=self.thread_id,
                    agent_id=self.agent_id,
                    turn_index=idx,
                    role=msg.role,
                    content=msg.content,
                    token_count=token_est,
                )
                session.add(snip)
                archived += 1

            ids = [m.id for m in to_archive]
            await session.execute(delete(Message).where(Message.id.in_(ids)))
            await session.commit()
            log.info(
                "snip_compactor: thread=%s archived=%d kept=%d",
                self.thread_id, archived, self.preserve_recent,
            )
            return archived

    async def select_relevant_snips(
        self,
        current_message: str,
        fast_model: str | None = None,
        max_replay: int = 3,
        max_tokens: int = 1500,
        relevance_threshold: float = 0.55,
    ) -> list[dict]:
        """Use a fast model to select the most relevant snips for the current message.

        Returns a list of snip dicts (role, content, token_count, turn_index).
        Enforces the token cap by dropping lowest-priority snips first.
        """
        if fast_model is None:
            try:
                from .nodes.call_llm import get_auxiliary_model_name
                fast_model = get_auxiliary_model_name(self.agent_id)
            except Exception:
                fast_model = "openai/gpt-4o-mini"
        from sqlalchemy import text as _text
        async with get_session() as session:
            result = await session.execute(
                select(
                    __import__("src.brain.models.thread_snip", fromlist=["ThreadSnip"]).ThreadSnip
                ).where(
                    __import__("src.brain.models.thread_snip", fromlist=["ThreadSnip"]).ThreadSnip.thread_id == self.thread_id
                ).order_by(
                    __import__("src.brain.models.thread_snip", fromlist=["ThreadSnip"]).ThreadSnip.turn_index
                )
            )
            snips = result.scalars().all()

        if not snips:
            return []

        # Build snip index for the selector model
        index_lines = [
            f"{s.turn_index}: [{s.role}] {s.content[:50]!r} (~{s.token_count or 0} tokens)"
            for s in snips
        ]
        prompt = (
            "Select the turn indices most relevant to the current message. "
            f"Return only a JSON array of integers, e.g. [2, 5].\n\n"
            f"Current message:\n{current_message[:500]}\n\n"
            f"Available turns:\n" + "\n".join(index_lines)
        )

        selected_indices: list[int] = []
        try:
            from .models_registry import _build_model
            model = _build_model(fast_model)
            resp = await model.ainvoke([{"role": "user", "content": prompt}])
            import json as _json, re as _re
            m = _re.search(r"\[[\d,\s]+\]", resp.content if hasattr(resp, "content") else str(resp))
            if m:
                selected_indices = _json.loads(m.group())[:max_replay]
        except Exception as exc:
            log.warning("snip_selector: model call failed, using recency fallback: %s", exc)
            selected_indices = [s.turn_index for s in snips[-max_replay:]]

        # Map selected turn_index → snip
        idx_map = {s.turn_index: s for s in snips}
        chosen = [idx_map[i] for i in selected_indices if i in idx_map]

        # Enforce token cap — drop from the end until within budget
        while chosen:
            total = sum(s.token_count or (len(s.content) // 4) for s in chosen)
            if total <= max_tokens:
                break
            chosen.pop()

        return [
            {"role": s.role, "content": s.content, "token_count": s.token_count, "turn_index": s.turn_index}
            for s in chosen
        ]
