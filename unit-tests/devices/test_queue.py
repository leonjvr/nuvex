"""Unit tests: TaskQueueManager — 16.2"""
from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.brain.devices.queue import TaskQueueManager, _VALID_TRANSITIONS
from src.brain.devices.models import TaskStatus


class TestTaskQueueManagerEnqueue:
    """16.2a — enqueue creates a queued task."""

    @pytest.mark.asyncio
    async def test_enqueue_returns_id(self):
        manager = TaskQueueManager()
        mock_task = MagicMock()
        mock_task.id = "task-001"
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        with patch("src.brain.devices.queue.get_session", return_value=mock_session), \
             patch("src.brain.devices.queue.DesktopTaskQueue", return_value=mock_task):
            result = await manager.enqueue(
                agent_id="maya",
                device_id="dev-1",
                graph_thread_id="thread-abc",
                tool_name="desktop_screenshot",
                payload={"args": {}},
                call_id="call-123",
            )
        assert result == "task-001"


class TestTaskStatusTransitions:
    """16.2b — status lifecycle transitions."""

    def test_queued_can_transition_to_dispatched(self):
        assert "dispatched" in _VALID_TRANSITIONS[TaskStatus.queued]

    def test_queued_cannot_transition_to_running(self):
        assert "running" not in _VALID_TRANSITIONS[TaskStatus.queued]

    def test_dispatched_can_go_back_to_queued(self):
        # On disconnect, dispatched → queued is valid
        assert "queued" in _VALID_TRANSITIONS[TaskStatus.dispatched]

    def test_succeeded_has_no_valid_transitions(self):
        assert len(_VALID_TRANSITIONS[TaskStatus.succeeded]) == 0

    def test_failed_has_no_valid_transitions(self):
        assert len(_VALID_TRANSITIONS[TaskStatus.failed]) == 0

    def test_cancelled_has_no_valid_transitions(self):
        assert len(_VALID_TRANSITIONS[TaskStatus.cancelled]) == 0

    def test_running_can_succeed(self):
        assert "succeeded" in _VALID_TRANSITIONS[TaskStatus.running]

    def test_running_can_fail(self):
        assert "failed" in _VALID_TRANSITIONS[TaskStatus.running]

    def test_running_can_cancel(self):
        assert "cancelled" in _VALID_TRANSITIONS[TaskStatus.running]

    def test_waiting_idle_can_run(self):
        assert "running" in _VALID_TRANSITIONS[TaskStatus.waiting_idle]

    def test_waiting_permission_can_run(self):
        assert "running" in _VALID_TRANSITIONS[TaskStatus.waiting_permission]

    @pytest.mark.asyncio
    async def test_invalid_transition_returns_false(self):
        manager = TaskQueueManager()
        mock_row = MagicMock()
        mock_row.status = "succeeded"
        mock_row.id = "q-1"
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_session.get = AsyncMock(return_value=mock_row)
        mock_session.commit = AsyncMock()

        with patch("src.brain.devices.queue.get_session", return_value=mock_session):
            result = await manager.update_status("q-1", "running")
        assert result is False


class TestQueueExpiry:
    """16.2c — tasks older than threshold auto-cancel."""

    @pytest.mark.asyncio
    async def test_expire_returns_count(self):
        manager = TaskQueueManager()
        mock_row = MagicMock()
        mock_row.status = TaskStatus.queued
        mock_rows = [mock_row, mock_row]
        mock_session = AsyncMock()
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)
        mock_execute_result = MagicMock()
        mock_execute_result.scalars.return_value.all.return_value = mock_rows
        mock_session.execute = AsyncMock(return_value=mock_execute_result)
        mock_session.commit = AsyncMock()

        with patch("src.brain.devices.queue.get_session", return_value=mock_session):
            count = await manager.expire_old_tasks()
        assert count == 2
        for row in mock_rows:
            assert row.status == TaskStatus.cancelled
            assert row.error == "expired"
