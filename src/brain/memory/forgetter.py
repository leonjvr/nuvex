"""Memory forgetter — daily archival of personal-scope memories.

Runs as a daily cron job. Archives old/low-confidence personal memories
(sets scope = 'archived') instead of deleting them — like human long-term
storage: hard to retrieve but not permanently lost.
Division and org scope entries are never auto-archived.
Frequently-accessed entries (retrieval_count >= 5) are immune."""
from __future__ import annotations

import logging

from sqlalchemy import text

from ..db import get_session

log = logging.getLogger(__name__)

_DEFAULT_MAX_PERSONAL = 500
_PRUNE_CONFIDENCE_LIMIT = 0.6
_BUDGET_PRUNE_DAYS = 30
_BUDGET_PRUNE_CONFIDENCE = 0.7
_RETRIEVAL_IMMUNE_COUNT = 5


class MemoryForgetter:
    """Prune personal-scope memories according to forgetting policy (28.20-28.22)."""

    def __init__(
        self,
        agent_id: str,
        max_personal_memories: int = _DEFAULT_MAX_PERSONAL,
    ) -> None:
        self.agent_id = agent_id
        self.max_personal_memories = max_personal_memories

    async def prune_over_limit(self) -> int:
        """Prune oldest low-confidence personal memories when count > max.

        Returns count of pruned entries.
        """
        async with get_session() as session:
            count_result = await session.execute(
                text(
                    "SELECT COUNT(*) FROM memories WHERE agent_id = :agent_id AND scope = 'personal'"
                ),
                {"agent_id": self.agent_id},
            )
            total = count_result.scalar() or 0

        if total <= self.max_personal_memories:
            return 0

        to_prune = int(total) - self.max_personal_memories

        async with get_session() as session:
            result = await session.execute(
                text("""
                    UPDATE memories
                    SET scope = 'archived'
                    WHERE id IN (
                        SELECT id FROM memories
                        WHERE agent_id = :agent_id
                          AND scope = 'personal'
                          AND confidence < :conf_limit
                          AND retrieval_count < :immune
                          AND (source IS NULL OR source != 'wiki')
                        ORDER BY created_at ASC
                        LIMIT :limit
                    )
                    RETURNING id
                """),
                {
                    "agent_id": self.agent_id,
                    "conf_limit": _PRUNE_CONFIDENCE_LIMIT,
                    "immune": _RETRIEVAL_IMMUNE_COUNT,
                    "limit": to_prune,
                },
            )
            rows = result.fetchall()
            pruned: int = len(rows)
            await session.commit()

        log.info(
            "memory.forgetter: archived %d/%d over-limit personal memories for agent %s",
            pruned, to_prune, self.agent_id,
        )
        return pruned

    async def prune_budget_pressure(self) -> int:
        """Prune personal memories older than 30 days when agent is at >= 95% budget capacity.

        Returns count of pruned entries. Caller is responsible for detecting 3-day budget pressure.
        """
        async with get_session() as session:
            result = await session.execute(
                text("""
                    UPDATE memories
                    SET scope = 'archived'
                    WHERE id IN (
                        SELECT id FROM memories
                        WHERE agent_id = :agent_id
                          AND scope = 'personal'
                          AND confidence < :conf_limit
                          AND retrieval_count < :immune
                          AND (source IS NULL OR source != 'wiki')
                          AND created_at < now() - INTERVAL '30 days'
                        ORDER BY created_at ASC
                    )
                    RETURNING id
                """),
                {
                    "agent_id": self.agent_id,
                    "conf_limit": _BUDGET_PRUNE_CONFIDENCE,
                    "immune": _RETRIEVAL_IMMUNE_COUNT,
                },
            )
            rows = result.fetchall()
            pruned: int = len(rows)
            await session.commit()

        log.info(
            "memory.forgetter: budget-pressure archived %d personal memories for agent %s",
            pruned, self.agent_id,
        )
        return pruned

    async def run_daily(self, budget_pressure: bool = False) -> dict[str, int]:
        """Run the full daily forgetting cycle.

        Args:
            budget_pressure: True when agent has been at >= 95% budget for 3 consecutive days.

        Returns a dict with {'over_limit': N, 'budget_pressure': N}.
        """
        results = {"over_limit": 0, "budget_pressure": 0}

        results["over_limit"] = await self.prune_over_limit()

        if budget_pressure:
            results["budget_pressure"] = await self.prune_budget_pressure()

        return results
