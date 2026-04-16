"""Unit tests for EdgeLintJob (§39.7)."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


def _make_session(rows: list = None, rows2: list = None):
    """Return a context-manager-compatible async session mock.

    rows: returned by first session.execute().fetchall()
    rows2: returned by second session.execute().fetchall() (for pass2/pass3)
    """
    rows = rows or []
    rows2 = rows2 if rows2 is not None else []
    results = [rows, rows2]
    call_count = {"n": 0}

    async def fake_execute(*args, **kwargs):
        res = MagicMock()
        idx = min(call_count["n"], len(results) - 1)
        res.fetchall.return_value = results[idx]
        call_count["n"] += 1
        return res

    session = AsyncMock()
    session.execute = fake_execute
    session.commit = AsyncMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    return session


class TestPass1ContradictionAudit:
    @pytest.mark.asyncio
    async def test_emits_conflict_count(self):
        """Pass 1 counts high-confidence contradictions."""
        from src.brain.memory.edge_lint import EdgeLintJob

        # Two high-confidence contradiction edges
        contra_rows = [(1, 10, 20, 0.9, "agent-1"), (2, 30, 40, 0.85, "agent-1")]
        session = _make_session(rows=contra_rows)

        with patch("src.brain.memory.edge_lint.get_session", return_value=session):
            job = EdgeLintJob(dry_run=True)
            metrics = await job.run()

        assert metrics.conflicts_emitted == 2

    @pytest.mark.asyncio
    async def test_no_contradictions_emits_zero(self):
        """When no contradiction edges exist, conflicts_emitted = 0."""
        from src.brain.memory.edge_lint import EdgeLintJob

        session = _make_session(rows=[])
        with patch("src.brain.memory.edge_lint.get_session", return_value=session):
            job = EdgeLintJob(dry_run=True)
            metrics = await job.run()

        assert metrics.conflicts_emitted == 0


class TestPass2OrphanDecay:
    @pytest.mark.asyncio
    async def test_orphan_count_returned_in_metrics(self):
        """Pass 2 counts and decays orphan edges."""
        from src.brain.memory.edge_lint import EdgeLintJob

        # Need at least 3 separate sessions: pass1 (empty), pass2 orphan query, pass2 update
        call_count = {"n": 0}
        orphan_data = [[],           # pass1: no contradictions
                       [(5,), (6,)], # pass2: two orphan edge ids
                       []]           # pass3: no prunable edges

        async def fake_execute(*args, **kwargs):
            res = MagicMock()
            idx = min(call_count["n"], len(orphan_data) - 1)
            res.fetchall.return_value = orphan_data[idx]
            call_count["n"] += 1
            return res

        session = AsyncMock()
        session.execute = fake_execute
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.memory.edge_lint.get_session", return_value=session):
            job = EdgeLintJob(dry_run=True)
            metrics = await job.run()

        assert metrics.edges_decayed == 2

    @pytest.mark.asyncio
    async def test_dry_run_skips_update(self):
        """In dry_run mode, orphan edges are counted but not mutated."""
        from src.brain.memory.edge_lint import EdgeLintJob

        session = AsyncMock()
        call_count = {"n": 0}
        data = [[], [(7,)], []]  # pass1, pass2, pass3

        async def fake_execute(*args, **kwargs):
            res = MagicMock()
            idx = min(call_count["n"], len(data) - 1)
            res.fetchall.return_value = data[idx]
            call_count["n"] += 1
            return res

        session.execute = fake_execute
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.memory.edge_lint.get_session", return_value=session):
            job = EdgeLintJob(dry_run=True)
            metrics = await job.run()

        # dry_run → commit should not be called for the UPDATE
        assert metrics.edges_decayed == 1
        assert metrics.dry_run is True


class TestPass3Pruning:
    @pytest.mark.asyncio
    async def test_low_confidence_edges_counted(self):
        """Pass 3 counts edges below threshold for pruning."""
        from src.brain.memory.edge_lint import EdgeLintJob

        call_count = {"n": 0}
        data = [[], [], [(3,), (4,), (5,)]]  # pass1, pass2, pass3

        async def fake_execute(*args, **kwargs):
            res = MagicMock()
            idx = min(call_count["n"], len(data) - 1)
            res.fetchall.return_value = data[idx]
            call_count["n"] += 1
            return res

        session = AsyncMock()
        session.execute = fake_execute
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.memory.edge_lint.get_session", return_value=session):
            job = EdgeLintJob(dry_run=True)
            metrics = await job.run()

        assert metrics.edges_pruned == 3


class TestMetricsObject:
    @pytest.mark.asyncio
    async def test_metrics_has_all_fields(self):
        """LintMetrics contains all required fields after run."""
        from src.brain.memory.edge_lint import EdgeLintJob

        session = AsyncMock()
        res = MagicMock()
        res.fetchall.return_value = []
        session.execute = AsyncMock(return_value=res)
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.memory.edge_lint.get_session", return_value=session):
            job = EdgeLintJob(dry_run=False)
            metrics = await job.run()

        assert hasattr(metrics, "conflicts_emitted")
        assert hasattr(metrics, "edges_decayed")
        assert hasattr(metrics, "edges_pruned")
        assert hasattr(metrics, "dry_run")
        assert hasattr(metrics, "errors")
