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
        org_id: Organisation scope — memories from other orgs are excluded.
    """

    def __init__(
        self,
        agent_id: str,
        agent_tier: int = 4,
        division_id: str = "default",
        k: int = _DEFAULT_K,
        min_cosine: float = _DEFAULT_MIN_COSINE,
        token_budget: int = _DEFAULT_TOKEN_BUDGET,
        org_id: str = "",
    ) -> None:
        self.agent_id = agent_id
        self.agent_tier = agent_tier
        self.division_id = division_id
        self.k = k
        self.min_cosine = min_cosine
        self.token_budget = token_budget
        self.org_id = org_id

    async def retrieve(self, query: str) -> list[dict[str, Any]]:
        """Return top-K memory rows relevant to query, within token budget."""
        embedding = await _embed(query)
        if embedding is None:
            return []
        embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"
        # Scope filter: personal (own), division (same division), org (tier <= agent_tier)
        async with get_session() as session:
            # When org_id is set, restrict to that org (cross-org isolation).
            # Empty org_id is treated as the legacy default — no filter applied.
            org_filter = "AND (org_id = :org_id OR :org_id = '')" if True else ""
            sql = text(f"""
                SELECT id, content, scope, owner_id, confidence, retrieval_count,
                       1 - (embedding <=> CAST(:emb AS vector)) AS cosine_score
                FROM memories
                WHERE
                    (
                        (scope = 'personal' AND owner_id = :agent_id)
                        OR (scope = 'division' AND owner_id = :division_id AND access_tier <= :tier)
                        OR (scope = 'org' AND approved_by IS NOT NULL AND access_tier <= :tier)
                    )
                    AND (expires_at IS NULL OR expires_at > now())
                    AND embedding IS NOT NULL
                    AND (org_id = :org_id OR :org_id = '')
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
                    "org_id": self.org_id,
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

    # ------------------------------------------------------------------ §38
    async def retrieve_with_graph(
        self,
        query: str,
        use_graph: bool = True,
        max_hops: int = 2,
        max_neighbours_per_hop: int = 8,
        max_expanded: int = 16,
    ) -> list[dict[str, Any]]:
        """ANN retrieval + BFS graph expansion (§38).

        Returns merged, re-ranked results (max 20) annotated with
        ``retrieval_source``, ``edge_path``, and ``weighted_score``.
        """
        ann_rows = await self.retrieve(query)
        if not ann_rows:
            return []

        # Annotate ANN seeds
        for row in ann_rows:
            row.setdefault("retrieval_source", "ann")
            row.setdefault("edge_path", [])
            row.setdefault("weighted_score", float(row.get("cosine_score") or 0.0))

        if not use_graph:
            return ann_rows[:20]

        seed_ids = {r["id"] for r in ann_rows}
        expanded: dict[int, dict[str, Any]] = {r["id"]: r for r in ann_rows}
        traversed_edge_ids: list[int] = []

        frontier = list(seed_ids)
        for hop in range(1, max_hops + 1):
            if not frontier:
                break
            weight = 1.0 - 0.2 * hop  # hop-1→0.8, hop-2→0.6

            next_frontier: list[int] = []
            for seed in frontier:
                neighbours = await self._get_edge_neighbours(seed, limit=max_neighbours_per_hop)
                for edge_id, neighbour_id, _etype in neighbours:
                    if len(expanded) >= len(seed_ids) + max_expanded:
                        break
                    traversed_edge_ids.append(edge_id)
                    if neighbour_id in expanded:
                        # Already present; boost score if new hop weight is higher
                        existing = expanded[neighbour_id]
                        if weight > existing.get("weighted_score", 0):
                            existing["weighted_score"] = weight
                        continue
                    # Fetch memory row
                    mem_row = await self._fetch_memory_row(neighbour_id)
                    if mem_row is None:
                        continue
                    mem_row["retrieval_source"] = f"hop{hop}"
                    mem_row["edge_path"] = [seed, neighbour_id]
                    mem_row["weighted_score"] = weight
                    expanded[neighbour_id] = mem_row
                    next_frontier.append(neighbour_id)
            frontier = next_frontier

        # Bulk-update traversed_at for traversed edges (§38.5)
        if traversed_edge_ids:
            await self._mark_edges_traversed(traversed_edge_ids)

        # Merge and re-rank (§38.3)
        merged = sorted(expanded.values(), key=lambda r: r.get("weighted_score", 0), reverse=True)
        return merged[:20]

    async def _get_edge_neighbours(
        self, memory_id: int, limit: int = 8
    ) -> list[tuple[int, int, str]]:
        """Return (edge_id, neighbour_memory_id, edge_type) for edges from/to memory_id."""
        try:
            async with get_session() as session:
                result = await session.execute(
                    text("""
                        SELECT id, target_id AS neighbour, edge_type FROM memory_edges
                        WHERE source_id = :mid
                        UNION ALL
                        SELECT id, source_id AS neighbour, edge_type FROM memory_edges
                        WHERE target_id = :mid
                        LIMIT :lim
                    """),
                    {"mid": memory_id, "lim": limit},
                )
                rows = result.fetchall()
            return [(r[0], r[1], r[2]) for r in rows]
        except Exception as exc:
            log.debug("memory.retriever: edge neighbour query failed: %s", exc)
            return []

    async def _fetch_memory_row(self, memory_id: int) -> dict[str, Any] | None:
        """Fetch a single memory row by id."""
        try:
            async with get_session() as session:
                result = await session.execute(
                    text("SELECT id, content, scope, owner_id, confidence FROM memories WHERE id = :mid"),
                    {"mid": memory_id},
                )
                row = result.mappings().first()
            if row is None:
                return None
            return dict(row)
        except Exception as exc:
            log.debug("memory.retriever: fetch memory row failed: %s", exc)
            return None

    async def _mark_edges_traversed(self, edge_ids: list[int]) -> None:
        """Bulk-set traversed_at = now() for the given edge ids (§38.5)."""
        try:
            async with get_session() as session:
                await session.execute(
                    text("UPDATE memory_edges SET traversed_at = now() WHERE id = ANY(:ids)"),
                    {"ids": edge_ids},
                )
                await session.commit()
        except Exception as exc:
            log.debug("memory.retriever: mark_edges_traversed failed: %s", exc)
