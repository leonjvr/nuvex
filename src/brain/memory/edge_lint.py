"""Edge lint job — weekly cron maintenance of memory_edges (§39).

Three passes:
  1. Contradiction audit: emit memory.edge_conflict events for high-confidence contradictions
  2. Orphan decay: reduce confidence of edges whose nodes no longer exist (skip contradicts)
  3. Pruning: hard-delete edges with confidence < 0.3
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from sqlalchemy import text

from ..db import get_session

log = logging.getLogger(__name__)

_CONTRADICTION_THRESHOLD = 0.8
_ORPHAN_DECAY = 0.05
_PRUNE_THRESHOLD = 0.3
_DEFAULT_SCHEDULE = "0 3 * * 1"  # Every Monday at 03:00


@dataclass
class LintMetrics:
    conflicts_emitted: int = 0
    edges_decayed: int = 0
    edges_pruned: int = 0
    dry_run: bool = False
    errors: list[str] = field(default_factory=list)


class EdgeLintJob:
    """Weekly maintenance job for the memory_edges graph (§39)."""

    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run = dry_run

    async def run(self) -> LintMetrics:
        """Execute all three lint passes and return metrics."""
        metrics = LintMetrics(dry_run=self.dry_run)
        await self._pass1_contradiction_audit(metrics)
        await self._pass2_orphan_decay(metrics)
        await self._pass3_prune(metrics)
        log.info(
            "edge_lint: conflicts=%d decayed=%d pruned=%d dry_run=%s",
            metrics.conflicts_emitted,
            metrics.edges_decayed,
            metrics.edges_pruned,
            self.dry_run,
        )
        return metrics

    async def _pass1_contradiction_audit(self, metrics: LintMetrics) -> None:
        """Emit memory.edge_conflict events for high-confidence contradictions (§39.2)."""
        try:
            async with get_session() as session:
                result = await session.execute(
                    text("""
                        SELECT id, source_id, target_id, confidence, agent_id
                        FROM memory_edges
                        WHERE edge_type = 'contradicts'
                          AND confidence >= :threshold
                    """),
                    {"threshold": _CONTRADICTION_THRESHOLD},
                )
                rows = result.fetchall()

            for row in rows:
                payload = {
                    "edge_id": row[0],
                    "source_id": row[1],
                    "target_id": row[2],
                    "confidence": row[3],
                    "agent_id": row[4],
                }
                log.warning("memory.edge_conflict: %s", payload)
                metrics.conflicts_emitted += 1

                if not self.dry_run:
                    try:
                        async with get_session() as session:
                            await session.execute(
                                text("""
                                    INSERT INTO events (event_type, payload, created_at)
                                    VALUES ('memory.edge_conflict', :payload::jsonb, now())
                                """),
                                {"payload": str(payload).replace("'", '"')},
                            )
                            await session.commit()
                    except Exception as exc:
                        log.debug("edge_lint: event insert failed: %s", exc)
        except Exception as exc:
            log.warning("edge_lint: pass1 failed: %s", exc)
            metrics.errors.append(f"pass1: {exc}")

    async def _pass2_orphan_decay(self, metrics: LintMetrics) -> None:
        """Decay confidence of orphaned edges by 0.05 (skip contradicts) (§39.3)."""
        try:
            async with get_session() as session:
                # Find edges where either endpoint no longer exists in memories
                result = await session.execute(
                    text("""
                        SELECT e.id FROM memory_edges e
                        WHERE e.edge_type != 'contradicts'
                          AND (
                            NOT EXISTS (SELECT 1 FROM memories m WHERE m.id = e.source_id)
                            OR NOT EXISTS (SELECT 1 FROM memories m WHERE m.id = e.target_id)
                          )
                    """)
                )
                orphan_ids = [r[0] for r in result.fetchall()]

            if orphan_ids and not self.dry_run:
                async with get_session() as session:
                    await session.execute(
                        text("""
                            UPDATE memory_edges
                            SET confidence = GREATEST(0, confidence - :decay)
                            WHERE id = ANY(:ids)
                        """),
                        {"decay": _ORPHAN_DECAY, "ids": orphan_ids},
                    )
                    await session.commit()

            metrics.edges_decayed = len(orphan_ids)
        except Exception as exc:
            log.warning("edge_lint: pass2 failed: %s", exc)
            metrics.errors.append(f"pass2: {exc}")

    async def _pass3_prune(self, metrics: LintMetrics) -> None:
        """Hard-delete edges with confidence < 0.3 (§39.4)."""
        try:
            async with get_session() as session:
                result = await session.execute(
                    text("SELECT id FROM memory_edges WHERE confidence < :threshold"),
                    {"threshold": _PRUNE_THRESHOLD},
                )
                prune_ids = [r[0] for r in result.fetchall()]

            if prune_ids and not self.dry_run:
                async with get_session() as session:
                    await session.execute(
                        text("DELETE FROM memory_edges WHERE id = ANY(:ids)"),
                        {"ids": prune_ids},
                    )
                    await session.commit()

            metrics.edges_pruned = len(prune_ids)
        except Exception as exc:
            log.warning("edge_lint: pass3 failed: %s", exc)
            metrics.errors.append(f"pass3: {exc}")
