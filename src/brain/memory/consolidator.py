"""Memory consolidator — extract facts from a completed thread and write to memories table.

Run at the end of every agent thread (Finished or Failed lifecycle event).
Uses fast_model to extract up to 5 key facts, then embeds and stores them.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any

from sqlalchemy import text

from ..db import get_session

log = logging.getLogger(__name__)

_MIN_MESSAGES = 3
_MAX_FACTS = 5
_DISCARD_BELOW = 0.5
_PROMOTE_ABOVE = 0.85

_EXTRACTION_PROMPT = """You are a memory consolidation assistant. Extract up to {max_facts} key facts from the following conversation thread.

For each fact, output a JSON object on its own line with these fields:
- "content": string — the fact in one concise sentence (max 150 chars)
- "confidence": float 0.0–1.0 — how confident you are this is a reliable, reusable fact
- "scope": "personal" | "division" | "org" — suggested scope
  - personal: only relevant to this agent
  - division: useful to all agents in the same team/division
  - org: universally applicable across the organisation

Focus on: decisions made, errors encountered with resolutions, constraints discovered, environment facts.
Exclude: greetings, acknowledgements, filler, questions without answers.
Output ONLY valid JSON objects, one per line. No markdown, no extra text.

Thread source outcome: {outcome}

Conversation:
{conversation}
"""


def _greeting_only(messages: list[Any]) -> bool:
    """Return True if the thread is just a greeting exchange with no substance."""
    combined = " ".join(
        (m.content if isinstance(m.content, str) else str(m.content))
        for m in messages
    ).lower()
    if len(combined) < 50:
        return True
    greetings = {"hello", "hi", "hey", "thanks", "thank you", "ok", "okay", "bye", "goodbye"}
    words = set(combined.split())
    meaningful = words - greetings
    return len(meaningful) < 5


async def _embed(text_: str) -> list[float] | None:
    try:
        import openai
        client = openai.AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        resp = await client.embeddings.create(model="text-embedding-3-small", input=text_)
        return resp.data[0].embedding
    except Exception as exc:
        log.warning("memory.consolidator: embed failed: %s", exc)
        return None


async def _fast_extract(conversation_text: str, fast_model: str, outcome: str) -> list[dict[str, object]]:
    """Call the fast LLM model to extract structured facts."""
    try:
        from langchain_anthropic import ChatAnthropic
        from langchain_openai import ChatOpenAI

        prompt = _EXTRACTION_PROMPT.format(
            max_facts=_MAX_FACTS,
            outcome=outcome,
            conversation=conversation_text[:8000],
        )
        if "claude" in fast_model.lower() or "anthropic" in fast_model.lower():
            model_name = fast_model.split("/")[-1] if "/" in fast_model else fast_model
            llm = ChatAnthropic(model=model_name)  # type: ignore[call-arg]
        else:
            model_name = fast_model.split("/")[-1] if "/" in fast_model else fast_model
            llm = ChatOpenAI(model=model_name)  # type: ignore[call-arg]

        response = await llm.ainvoke(prompt)
        content = response.content if hasattr(response, "content") else str(response)
        facts = []
        for line in str(content).splitlines():
            line = line.strip()
            if not line or not line.startswith("{"):
                continue
            try:
                obj = json.loads(line)
                if "content" in obj and "confidence" in obj:
                    facts.append(obj)
            except json.JSONDecodeError:
                continue
        return facts
    except Exception as exc:
        log.warning("memory.consolidator: fast extract failed: %s", exc)
        return []


class MemoryConsolidator:
    """Extract facts from a thread and write them to the memories table."""

    def __init__(self, agent_id: str, division_id: str = "default", fast_model: str = "gpt-4o-mini") -> None:
        self.agent_id = agent_id
        self.division_id = division_id
        self.fast_model = fast_model

    async def consolidate(self, messages: list[Any], thread_id: str, outcome: str = "finished") -> int:
        """Run fact extraction and persist results. Returns count of facts written."""
        # Skip trivial threads
        if len(messages) < _MIN_MESSAGES:
            log.debug("memory.consolidator: skipping thread %s — too few messages (%d)", thread_id, len(messages))
            return 0
        if _greeting_only(messages):
            log.debug("memory.consolidator: skipping thread %s — greeting only", thread_id)
            return 0

        # Build conversation text
        parts = []
        for m in messages:
            role = getattr(m, "type", getattr(m, "role", "unknown"))
            content = m.content if isinstance(m.content, str) else str(m.content)
            parts.append(f"[{role.upper()}]: {content[:500]}")
        conversation_text = "\n".join(parts)

        facts = await _fast_extract(conversation_text, self.fast_model, outcome)
        if not facts:
            return 0

        written = 0
        for fact in facts[:_MAX_FACTS]:
            confidence = float(fact.get("confidence", 0.5))
            if confidence < _DISCARD_BELOW:
                log.debug("memory.consolidator: discarding fact (confidence %.2f): %s", confidence, fact.get("content", "")[:60])
                continue

            scope = fact.get("scope", "personal")
            if scope not in ("personal", "division", "org"):
                scope = "personal"
            owner_id = self.agent_id if scope == "personal" else self.division_id

            content = str(fact.get("content", "")).strip()[:500]
            if not content:
                continue

            metadata: dict[str, Any] = {"source_outcome": outcome}
            embedding = await _embed(content)
            embedding_str = ("[" + ",".join(str(v) for v in embedding) + "]") if embedding else None

            try:
                async with get_session() as session:
                    await session.execute(
                        text("""
                            INSERT INTO memories
                                (agent_id, content, embedding, scope, owner_id, confidence,
                                 source_agent, source_thread, access_tier, metadata_)
                            VALUES
                                (:agent_id, :content, :embedding ::vector, :scope, :owner_id,
                                 :confidence, :source_agent, :source_thread, :access_tier, :metadata_::jsonb)
                        """),
                        {
                            "agent_id": self.agent_id,
                            "content": content,
                            "embedding": embedding_str,
                            "scope": scope,
                            "owner_id": owner_id,
                            "confidence": confidence,
                            "source_agent": self.agent_id,
                            "source_thread": thread_id,
                            "access_tier": 4,
                            "metadata_": json.dumps(metadata),
                        },
                    )
                    await session.commit()
                written += 1
                log.info(
                    "memory.consolidator: wrote fact scope=%s confidence=%.2f thread=%s",
                    scope, confidence, thread_id,
                )

                # Flag for division promotion if confidence >= threshold
                if confidence >= _PROMOTE_ABOVE and scope in ("personal", "division"):
                    try:
                        from .promoter import MemoryPromoter
                        # Fetch the new memory id
                        result = await session.execute(
                            text("SELECT id FROM memories WHERE source_thread = :tid AND content = :content LIMIT 1"),
                            {"tid": thread_id, "content": content},
                        )
                        row = result.mappings().first()
                        if row:
                            promoter = MemoryPromoter(requesting_agent_id=self.agent_id)
                            await promoter.promote_personal_to_division(int(row["id"]), self.division_id)
                    except Exception as exc:
                        log.debug("memory.consolidator: promotion check failed: %s", exc)

            except Exception as exc:
                log.warning("memory.consolidator: failed to write fact: %s", exc)

        return written
