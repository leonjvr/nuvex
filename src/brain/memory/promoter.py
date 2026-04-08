"""Memory promoter — cross-scope promotion: personal → division → org.

Personal → Division: auto-promoted on confidence >= 0.85 with duplicate check.
Division → Org: creates pending entry, emits memory.promotion_pending event.
T1 agents approve org entries via approve_org_memory tool.
"""
from __future__ import annotations

import logging

from sqlalchemy import text

from ..db import get_session

log = logging.getLogger(__name__)

_COSINE_DUPLICATE_THRESHOLD = 0.95


class MemoryPromoter:
    """Promote memory entries across scopes."""

    def __init__(self, requesting_agent_id: str) -> None:
        self.requesting_agent_id = requesting_agent_id

    async def promote_personal_to_division(self, memory_id: int, division_id: str) -> bool:
        """Auto-promote personal memory to division scope if not a duplicate.

        Returns True if a new division-scope entry was created.
        """
        async with get_session() as session:
            # Fetch source memory
            result = await session.execute(
                text("SELECT content, confidence, embedding, source_agent FROM memories WHERE id = :id"),
                {"id": memory_id},
            )
            row = result.mappings().first()
            if not row:
                log.warning("memory.promoter: source memory %d not found", memory_id)
                return False

            embedding = row["embedding"]

            # Duplicate check: cosine similarity > threshold in division scope
            if embedding:
                dup_result = await session.execute(
                    text("""
                        SELECT id FROM memories
                        WHERE scope = 'division'
                          AND owner_id = :division_id
                          AND embedding IS NOT NULL
                          AND 1 - (embedding <=> :emb ::vector) > :threshold
                        LIMIT 1
                    """),
                    {
                        "division_id": division_id,
                        "emb": embedding,
                        "threshold": _COSINE_DUPLICATE_THRESHOLD,
                    },
                )
                if dup_result.mappings().first():
                    log.debug("memory.promoter: skipping duplicate for division %s", division_id)
                    return False

            # Create division-scope entry
            await session.execute(
                text("""
                    INSERT INTO memories
                        (agent_id, content, embedding, scope, owner_id, confidence,
                         source_agent, promoted_from, access_tier)
                    SELECT
                        :agent_id, content, embedding, 'division', :division_id, confidence,
                        :source_agent, :promoted_from, access_tier
                    FROM memories WHERE id = :src_id
                """),
                {
                    "agent_id": self.requesting_agent_id,
                    "division_id": division_id,
                    "source_agent": row.get("source_agent", self.requesting_agent_id),
                    "promoted_from": memory_id,
                    "src_id": memory_id,
                },
            )
            await session.commit()

        log.info("memory.promoter: promoted memory %d → division scope %s", memory_id, division_id)
        # Record promotion in memory_promotions table
        try:
            async with get_session() as session:
                await session.execute(
                    text("""
                        INSERT INTO memory_promotions (source_memory_id, target_scope, requested_by, status)
                        VALUES (:src, 'division', :req, 'completed')
                    """),
                    {"src": memory_id, "req": self.requesting_agent_id},
                )
                await session.commit()
        except Exception as exc:
            log.debug("memory.promoter: promotion log failed: %s", exc)

        return True

    async def request_org_promotion(self, memory_id: int) -> None:
        """Create a pending org-scope entry and notify T1 agents.

        The entry is NOT visible in retrieval until approved_by is set.
        """
        async with get_session() as session:
            await session.execute(
                text("""
                    INSERT INTO memories
                        (agent_id, content, embedding, scope, owner_id, confidence,
                         source_agent, promoted_from, access_tier, approved_by)
                    SELECT
                        :agent_id, content, embedding, 'org', 'org', confidence,
                        source_agent, :promoted_from, 1, NULL
                    FROM memories WHERE id = :src_id
                """),
                {
                    "agent_id": self.requesting_agent_id,
                    "promoted_from": memory_id,
                    "src_id": memory_id,
                },
            )
            await session.commit()

        # Record promotion request
        try:
            async with get_session() as session:
                await session.execute(
                    text("""
                        INSERT INTO memory_promotions (source_memory_id, target_scope, requested_by, status)
                        VALUES (:src, 'org', :req, 'pending')
                    """),
                    {"src": memory_id, "req": self.requesting_agent_id},
                )
                await session.commit()
        except Exception as exc:
            log.debug("memory.promoter: promotion log failed: %s", exc)

        # Emit event to notify T1 agents
        try:
            from ..events import publish
            import asyncio
            asyncio.ensure_future(
                publish(
                    lane="memory.promotion_pending",
                    payload={"memory_id": memory_id, "requested_by": self.requesting_agent_id},
                    agent_id=self.requesting_agent_id,
                )
            )
        except Exception as exc:
            log.warning("memory.promoter: event publish failed: %s", exc)

        log.info("memory.promoter: requested org promotion for memory %d", memory_id)

    async def approve_org_memory(self, memory_id: int, approver_agent_id: str) -> bool:
        """T1-only: approve a pending org-scope memory entry.

        Sets approved_by on the pending org entry, making it live in retrieval.
        """
        async with get_session() as session:
            result = await session.execute(
                text("""
                    UPDATE memories
                    SET approved_by = :approver
                    WHERE id = :id AND scope = 'org' AND approved_by IS NULL
                    RETURNING id
                """),
                {"approver": approver_agent_id, "id": memory_id},
            )
            rows = result.fetchall()
            updated: int = len(rows)
            await session.commit()

        if updated:
            log.info("memory.promoter: org memory %d approved by %s", memory_id, approver_agent_id)
            # Update promotion record
            try:
                async with get_session() as session:
                    await session.execute(
                        text("""
                            UPDATE memory_promotions
                            SET approved_by = :approver, approved_at = now(), status = 'completed'
                            WHERE source_memory_id = :mid AND target_scope = 'org' AND status = 'pending'
                        """),
                        {"approver": approver_agent_id, "mid": memory_id},
                    )
                    await session.commit()
            except Exception as exc:
                log.debug("memory.promoter: promotion log update failed: %s", exc)
            return True

        log.warning("memory.promoter: org memory %d not found or already approved", memory_id)
        return False
