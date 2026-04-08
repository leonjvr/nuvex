"""Memory retriever — semantic ANN search over the memories table.

Embeds the incoming message, runs a pgvector cosine similarity search
scoped by tier and ownership, and returns a formatted [MEMORY] block
within the configured token budget.
"""
from __future__ import annotations

import logging
import os
from typing import Any

from sqlalchemy import text

from ..db import get_session

log = logging.getLogger(__name__)

_DEFAULT_K = 10
_DEFAULT_MIN_COSINE = 0.72
_DEFAULT_TOKEN_BUDGET = 600
_EMBEDDING_MODEL = "text-embedding-3-small"
_EMBEDDING_DIM = 1536


def _count_tokens(text_: str) -> int:
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text_))
    except Exception:
        return len(text_) // 4


async def _embed(text_: str) -> list[float] | None:
    """Embed text using OpenAI embeddings API. Returns None on failure."""
    try:
        import openai
        client = openai.AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        resp = await client.embeddings.create(
            model=_EMBEDDING_MODEL,
            input=text_,
        )
        return resp.data[0].embedding
    except Exception as exc:
        log.warning("memory.retriever: embedding failed: %s", exc)
        return None


class MemoryRetriever:
    """Retrieve semantically relevant memories for an agent invocation.

    Args:
        agent_id: The agent requesting retrieval.
        agent_tier: Numeric tier (1=T1, 2=T2, 3=T3, 4=T4).
        division_id: Agent's division identifier.
        k: Maximum results to return.
        min_cosine: Minimum similarity threshold (default 0.72).
        token_budget: Max tokens allowed in the [MEMORY] block (default 600).
    """

    def __init__(
        self,
        agent_id: str,
        agent_tier: int = 4,
        division_id: str = "default",
        k: int = _DEFAULT_K,
        min_cosine: float = _DEFAULT_MIN_COSINE,
        token_budget: int = _DEFAULT_TOKEN_BUDGET,
    ) -> None:
        self.agent_id = agent_id
        self.agent_tier = agent_tier
        self.division_id = division_id
        self.k = k
        self.min_cosine = min_cosine
        self.token_budget = token_budget

    async def retrieve(self, query: str) -> list[dict[str, Any]]:
        """Return top-K memory rows relevant to query, within token budget."""
        embedding = await _embed(query)
        if embedding is None:
            return []
        embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"
        # Scope filter: personal (own), division (same division), org (tier <= agent_tier)
        async with get_session() as session:
            sql = text("""
                SELECT id, content, scope, owner_id, confidence, retrieval_count,
                       1 - (embedding <=> :emb ::vector) AS cosine_score
                FROM memories
                WHERE
                    (
                        (scope = 'personal' AND owner_id = :agent_id)
                        OR (scope = 'division' AND owner_id = :division_id AND access_tier <= :tier)
                        OR (scope = 'org' AND approved_by IS NOT NULL AND access_tier <= :tier)
                    )
                    AND (expires_at IS NULL OR expires_at > now())
                    AND embedding IS NOT NULL
                ORDER BY cosine_score DESC
                LIMIT :k
            """)
            result = await session.execute(
                sql,
                {
                    "emb": embedding_str,
                    "agent_id": self.agent_id,
                    "division_id": self.division_id,
                    "tier": self.agent_tier,
                    "k": self.k,
                },
            )
            rows = result.mappings().all()

        # Filter by minimum cosine threshold
        rows = [r for r in rows if (r["cosine_score"] or 0.0) >= self.min_cosine]

        # Bump retrieval_count async (fire-and-forget; ignore failures)
        if rows:
            ids = [r["id"] for r in rows]
            try:
                async with get_session() as session:
                    await session.execute(
                        text("UPDATE memories SET retrieval_count = retrieval_count + 1 WHERE id = ANY(:ids)"),
                        {"ids": ids},
                    )
                    await session.commit()
            except Exception as exc:
                log.debug("memory.retriever: retrieval_count update failed: %s", exc)

        return [dict(r) for r in rows]

    def format_retrieved(self, rows: list[dict]) -> str:
        """Format pre-fetched retrieve() rows into a [MEMORY] block string."""
        return self._build_block_from_rows(rows)

    async def build_block(self, query: str) -> str:
        """Return a formatted [MEMORY] block string, or empty string if nothing to inject."""
        rows = await self.retrieve(query)
        return self._build_block_from_rows(rows)

    def _build_block_from_rows(self, rows: list[dict]) -> str:
        """Core formatting logic shared by build_block and format_retrieved."""
        if not rows:
            return ""

        lines: list[str] = ["[MEMORY]"]
        budget_levels = [self.k, 5, 3, 0]
        # Graceful degradation: reduce K until within budget
        for max_items in budget_levels:
            if max_items == 0:
                return ""
            candidate_lines: list[str] = []
            candidate_tokens = _count_tokens("[MEMORY]\n")
            for row in rows[:max_items]:
                scope_label = f"{row['scope']}/{row['owner_id'][:12]}"
                conf = row.get("confidence", 1.0)
                line = f"• [{scope_label}] {row['content']} (confidence {conf:.2f})"
                line_tokens = _count_tokens(line + "\n")
                if candidate_tokens + line_tokens > self.token_budget:
                    break
                candidate_lines.append(line)
                candidate_tokens += line_tokens
            if candidate_tokens <= self.token_budget and candidate_lines:
                lines.extend(candidate_lines)
                break

        if len(lines) <= 1:
            return ""

        lines.append("")  # trailing newline
        return "\n".join(lines) + "\n"
