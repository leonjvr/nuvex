"""Unit tests: Scheduler — 16.6"""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.desktop_agent.scheduler import LocalTask


class TestScheduler:
    """16.6 — ask mode, auto mode, cooperative pause."""

    def _make_scheduler(self, mode: str = "ask") -> "Scheduler":
        from src.desktop_agent.scheduler import Scheduler
        cfg = MagicMock()
        cfg.desktop_mode = mode
        # Prevent loading from disk
        with patch("src.desktop_agent.scheduler.Scheduler._load_persisted"):
            s = Scheduler(cfg)
        return s

    def _make_task(self) -> LocalTask:
        conn = MagicMock()
        conn.send = AsyncMock()
        return LocalTask(call_id="c1", tool="desktop_screenshot", args={}, conn=conn)

    def test_enqueue_adds_task(self):
        s = self._make_scheduler()
        task = self._make_task()
        with patch.object(s, "_persist"):
            s.enqueue(task)
        assert len(s._queue) == 1

    def test_on_idle_end_pauses(self):
        s = self._make_scheduler()
        s._executing = True
        s.on_idle_end()
        assert s._paused is True

    @pytest.mark.asyncio
    async def test_auto_mode_executes_directly(self):
        s = self._make_scheduler(mode="auto")
        task = self._make_task()
        with patch.object(s, "_persist"):
            s.enqueue(task)

        executed: list = []

        async def _mock_execute_one(t):
            executed.append(t)

        with patch.object(s, "_execute_one", _mock_execute_one):
            with patch.object(s, "_persist"):
                await s._execute_all()
        assert len(executed) == 1

    @pytest.mark.asyncio
    async def test_ask_mode_shows_popup(self):
        s = self._make_scheduler(mode="ask")
        task = self._make_task()
        with patch.object(s, "_persist"):
            s.enqueue(task)

        popup_shown = []

        async def _mock_ask():
            popup_shown.append(True)

        with patch.object(s, "_ask_permission", _mock_ask):
            await s._run_queued()

        assert popup_shown

    @pytest.mark.asyncio
    async def test_cooperative_pause_stops_on_active(self):
        s = self._make_scheduler(mode="auto")
        task1 = self._make_task()
        task2 = self._make_task()
        with patch.object(s, "_persist"):
            s.enqueue(task1)
            s.enqueue(task2)

        executed: list = []
        call_count = 0

        async def _mock_execute_one(t):
            nonlocal call_count
            call_count += 1
            executed.append(t)
            # Simulate user becoming active after first task
            s._paused = True

        with patch.object(s, "_execute_one", _mock_execute_one):
            with patch.object(s, "_persist"):
                await s._execute_all()

        # Should have paused after first task
        assert call_count == 1
        assert len(s._queue) == 1  # second task still in queue
