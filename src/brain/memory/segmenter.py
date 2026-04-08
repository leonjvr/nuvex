"""Message segmenter — topic boundary detection for threads (Section 28.10).

Embeds each message, detects topic boundaries via cosine similarity drops,
manages segment lifecycle (open → closing → closed), and supplies the
segment-based prompt assembly logic.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import text

from ..db import get_session

log = logging.getLogger(__name__)

_DEFAULT_BOUNDARY_THRESHOLD = 0.58  # cosine drop below this = new segment
_DEFAULT_TIME_GAP_MINUTES = 60
_DEFAULT_MIN_MESSAGES = 10
_DEFAULT_MAX_PRIOR_SUMMARIES = 5

# Group-chat relevance thresholds
_MENTION_SCORE = 1.0
_TOPIC_SCORE = 0.6
_BASELINE_SCORE = 0.2
_GROUP_RELEVANCE_THRESHOLD = 0.25


async def _embed(text_: str) -> list[float] | None:
    try:
        import openai
        client = openai.AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY", ""))
        resp = await client.embeddings.create(model="text-embedding-3-small", input=text_)
        return resp.data[0].embedding
    except Exception as exc:
        log.warning("memory.segmenter: embed failed: %s", exc)
        return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


class MessageSegmenter:
    """Detect topic boundaries and manage segment lifecycle.

    Args:
        thread_id: The thread being processed.
        agent_id: Agent that owns the thread.
        boundary_threshold: Cosine similarity drop below which = new segment.
        time_gap_minutes: Silence gap that also triggers a boundary.
        min_messages: Skip segmentation for threads with fewer messages.
        max_prior_summaries: Max closed-segment summaries in prompt.
    """

    def __init__(
        self,
        thread_id: str,
        agent_id: str,
        boundary_threshold: float = _DEFAULT_BOUNDARY_THRESHOLD,
        time_gap_minutes: int = _DEFAULT_TIME_GAP_MINUTES,
        min_messages: int = _DEFAULT_MIN_MESSAGES,
        max_prior_summaries: int = _DEFAULT_MAX_PRIOR_SUMMARIES,
    ) -> None:
        self.thread_id = thread_id
        self.agent_id = agent_id
        self.boundary_threshold = boundary_threshold
        self.time_gap_minutes = time_gap_minutes
        self.min_messages = min_messages
        self.max_prior_summaries = max_prior_summaries

    async def process_messages(self, messages: list[Any]) -> None:
        """Embed messages and annotate boundaries. Skips if too few messages.

        Updates msg_embedding and segment_boundary on each message row.
        """
        if len(messages) < self.min_messages:
            log.debug("segmenter: skipping thread %s — only %d messages", self.thread_id, len(messages))
            return

        prev_embedding: list[float] | None = None
        prev_created_at: datetime | None = None

        for msg in messages:
            msg_id = getattr(msg, "id", None)
            if msg_id is None:
                continue
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            embedding = await _embed(content[:1000])
            if embedding is None:
                continue

            embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"
            is_boundary = False

            if prev_embedding is not None:
                cosine = _cosine_similarity(embedding, prev_embedding)
                if cosine < self.boundary_threshold:
                    is_boundary = True
                    log.debug(
                        "segmenter: boundary detected at msg %d (cosine=%.3f < %.3f)",
                        msg_id, cosine, self.boundary_threshold,
                    )

            # Time gap check
            created_at = getattr(msg, "created_at", None)
            if (
                prev_created_at is not None
                and created_at is not None
                and not is_boundary
            ):
                gap_seconds = (created_at - prev_created_at).total_seconds()
                if gap_seconds > self.time_gap_minutes * 60:
                    is_boundary = True
                    log.debug(
                        "segmenter: time-gap boundary at msg %d (gap=%.0fs)",
                        msg_id, gap_seconds,
                    )

            # Persist embedding and boundary flag
            try:
                async with get_session() as session:
                    await session.execute(
                        text("""
                            UPDATE messages
                            SET msg_embedding = :emb ::vector, segment_boundary = :boundary
                            WHERE id = :id
                        """),
                        {"emb": embedding_str, "boundary": is_boundary, "id": msg_id},
                    )
                    await session.commit()
            except Exception as exc:
                log.warning("segmenter: failed to update message %d: %s", msg_id, exc)

            prev_embedding = embedding
            prev_created_at = created_at

    async def get_prompt_segments(self) -> tuple[list[str], dict[str, object] | None]:
        """Return (prior_summaries, open_segment_row) for prompt assembly.

        Closed segments → their 1-line summary (capped at max_prior_summaries).
        Active open segment → dict with segment info, or None if no open segment.
        """
        async with get_session() as session:
            # Closed segments
            closed_result = await session.execute(
                text("""
                    SELECT summary FROM message_segments
                    WHERE thread_id = :tid AND state = 'closed'
                    ORDER BY created_at DESC
                    LIMIT :max_sum
                """),
                {"tid": self.thread_id, "max_sum": self.max_prior_summaries},
            )
            closed_rows = closed_result.mappings().all()
            prior_summaries = [r["summary"] for r in closed_rows if r["summary"]]

            # Active segment — get start_message_id
            open_result = await session.execute(
                text("""
                    SELECT id, start_message_id FROM message_segments
                    WHERE thread_id = :tid AND state = 'open'
                    ORDER BY created_at DESC
                    LIMIT 1
                """),
                {"tid": self.thread_id},
            )
            open_seg = open_result.mappings().first()

        return prior_summaries, dict(open_seg) if open_seg else None

    async def close_segment(self, segment_id: uuid.UUID, summary: str) -> None:
        """Mark segment as closed and persist its summary."""
        async with get_session() as session:
            await session.execute(
                text("""
                    UPDATE message_segments
                    SET state = 'closed', summary = :summary, closed_at = now()
                    WHERE id = :sid
                """),
                {"summary": summary, "sid": str(segment_id)},
            )
            await session.commit()

        # Trigger consolidation async within 30s (28.40)
        asyncio.ensure_future(self._delayed_consolidation(segment_id))

    async def _delayed_consolidation(self, segment_id: uuid.UUID) -> None:
        """Fire memory consolidation on the closed segment after a brief delay."""
        await asyncio.sleep(5)  # brief delay to ensure DB is committed
        try:
            from .consolidator import MemoryConsolidator
            async with get_session() as session:
                result = await session.execute(
                    text("""
                        SELECT m.id, m.role, m.content, m.created_at
                        FROM messages m
                        JOIN message_segments s ON m.segment_id = s.id
                        WHERE s.id = :sid
                        ORDER BY m.created_at ASC
                    """),
                    {"sid": str(segment_id)},
                )
                rows = result.mappings().all()

            if rows:
                consolidator = MemoryConsolidator(agent_id=self.agent_id)

                class _Msg:
                    def __init__(self, row: Any) -> None:
                        self.type = row["role"]
                        self.content = row["content"]
                        self.created_at = row["created_at"]

                msgs = [_Msg(r) for r in rows]
                await consolidator.consolidate(msgs, self.thread_id, outcome="segment_close")
        except Exception as exc:
            log.warning("segmenter: consolidation after segment close failed: %s", exc)

    def score_group_message_relevance(
        self, content: str, agent_name: str, topic_keywords: list[str]
    ) -> float:
        """Score relevance of a group message for agent-relevance compression (28.39)."""
        content_lower = content.lower()
        if f"@{agent_name.lower()}" in content_lower:
            return _MENTION_SCORE
        if any(kw.lower() in content_lower for kw in topic_keywords):
            return _TOPIC_SCORE
        return _BASELINE_SCORE

    async def build_centroid_query_vector(self, messages: list[Any], last_n: int = 3) -> list[float] | None:
        """Compute centroid of last N active-segment messages for ANN query (28.42).

        Returns averaged embedding vector, or None if no embeddings available.
        """
        recent = messages[-last_n:] if len(messages) >= last_n else messages
        embeddings: list[list[float]] = []
        for msg in recent:
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            emb = await _embed(content[:1000])
            if emb:
                embeddings.append(emb)

        if not embeddings:
            return None

        dim = len(embeddings[0])
        centroid = [0.0] * dim
        for emb in embeddings:
            for i, v in enumerate(emb):
                centroid[i] += v
        n = len(embeddings)
        return [x / n for x in centroid]
