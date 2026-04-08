"""Unit tests — tasks: create/transition/parent-child enforcement, valid transitions."""
from __future__ import annotations

import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timezone

from src.brain.tasks import VALID_TRANSITIONS


# ---------------------------------------------------------------------------
# VALID_TRANSITIONS state machine
# ---------------------------------------------------------------------------

class TestValidTransitions:
    def test_pending_can_become_active(self):
        assert "active" in VALID_TRANSITIONS["pending"]

    def test_pending_can_be_cancelled(self):
        assert "cancelled" in VALID_TRANSITIONS["pending"]

    def test_active_can_complete(self):
        assert "done" in VALID_TRANSITIONS["active"]

    def test_active_can_fail(self):
        assert "failed" in VALID_TRANSITIONS["active"]

    def test_done_is_terminal(self):
        assert VALID_TRANSITIONS["done"] == set()

    def test_cancelled_is_terminal(self):
        assert VALID_TRANSITIONS["cancelled"] == set()

    def test_failed_can_retry(self):
        assert "pending" in VALID_TRANSITIONS["failed"]


# ---------------------------------------------------------------------------
# transition_task — DB mocked
# ---------------------------------------------------------------------------

class TestTransitionTask:
    def _mock_task(self, status="active", has_children=False):
        task = MagicMock()
        task.id = uuid.uuid4()
        task.status = status
        task.updated_at = None
        task.result = None
        task.error = None
        return task

    def _make_session(self, task, children=None):
        session = AsyncMock()
        exec_result = MagicMock()
        exec_result.scalar_one_or_none.return_value = task

        children_result = MagicMock()
        children_result.scalars.return_value.all.return_value = children or []

        session.execute = AsyncMock(side_effect=[exec_result, children_result])
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        return session

    @pytest.mark.asyncio
    async def test_valid_transition_succeeds(self):
        from src.brain.tasks import transition_task

        task = self._mock_task(status="active")
        session = self._make_session(task, children=[])

        with patch("src.brain.tasks.get_session", return_value=session):
            result = await transition_task(str(task.id), "done")

        assert task.status == "done"

    @pytest.mark.asyncio
    async def test_invalid_transition_raises(self):
        from src.brain.tasks import transition_task

        task = self._mock_task(status="done")
        exec_result = MagicMock()
        exec_result.scalar_one_or_none.return_value = task

        session = AsyncMock()
        session.execute = AsyncMock(return_value=exec_result)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.tasks.get_session", return_value=session):
            with pytest.raises(ValueError, match="Cannot transition"):
                await transition_task(str(task.id), "active")

    @pytest.mark.asyncio
    async def test_task_not_found_raises(self):
        from src.brain.tasks import transition_task

        exec_result = MagicMock()
        exec_result.scalar_one_or_none.return_value = None

        session = AsyncMock()
        session.execute = AsyncMock(return_value=exec_result)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        with patch("src.brain.tasks.get_session", return_value=session):
            with pytest.raises(ValueError, match="not found"):
                await transition_task(str(uuid.uuid4()), "done")

    @pytest.mark.asyncio
    async def test_parent_cannot_complete_with_active_children(self):
        """23.5 — completing a parent with active children must raise."""
        from src.brain.tasks import transition_task

        parent = self._mock_task(status="active")
        child = self._mock_task(status="active")

        session = self._make_session(parent, children=[child])

        with patch("src.brain.tasks.get_session", return_value=session):
            with pytest.raises(ValueError, match="active child"):
                await transition_task(str(parent.id), "done")

    @pytest.mark.asyncio
    async def test_parent_can_complete_when_all_children_done(self):
        """Parent should be completable when all children are done/cancelled."""
        from src.brain.tasks import transition_task

        parent = self._mock_task(status="active")
        session = self._make_session(parent, children=[])  # no active children

        with patch("src.brain.tasks.get_session", return_value=session):
            result = await transition_task(str(parent.id), "done")

        assert parent.status == "done"


# ---------------------------------------------------------------------------
# create_task_record — DB mocked
# ---------------------------------------------------------------------------

class TestCreateTaskRecord:
    @pytest.mark.asyncio
    async def test_creates_task_with_correct_fields(self):
        from src.brain.tasks import create_task_record

        created_task = MagicMock()
        created_task.id = uuid.uuid4()

        session = AsyncMock()
        session.add = MagicMock()
        session.commit = AsyncMock()
        session.refresh = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)

        # After refresh, task has correct attributes
        async def _refresh(obj):
            obj.id = uuid.uuid4()
            obj.status = "pending"

        session.refresh.side_effect = _refresh

        with patch("src.brain.tasks.get_session", return_value=session):
            task = await create_task_record(
                title="Test task",
                assigned_agent="maya",
                description="Some work",
                priority=3,
            )

        session.add.assert_called_once()
        assert task.status == "pending"


# ---------------------------------------------------------------------------
# 23.7 — Integration scenario: agent creates sub-task, child completes,
#         parent is subsequently unblocked and can be completed.
# ---------------------------------------------------------------------------

class TestSubtaskIntegration:
    """End-to-end flow (DB mocked): parent → child creation → child done → parent done."""

    def _make_task(self, task_id: uuid.UUID, status: str, parent_id: uuid.UUID | None = None):
        t = MagicMock()
        t.id = task_id
        t.status = status
        t.parent_task_id = parent_id
        t.updated_at = None
        t.result = None
        t.error = None
        return t

    def _make_create_session(self, refreshed_task):
        """Session mock for create_task_record calls."""
        session = AsyncMock()
        session.add = MagicMock()
        session.commit = AsyncMock()

        async def _refresh(obj):
            obj.id = refreshed_task.id
            obj.status = "pending"

        session.refresh = AsyncMock(side_effect=_refresh)
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        return session

    def _make_transition_session(self, task, active_children):
        """Session mock for transition_task calls.
        First execute → fetch task, second execute → fetch active children."""
        session = AsyncMock()

        fetch_task = MagicMock()
        fetch_task.scalar_one_or_none.return_value = task

        fetch_children = MagicMock()
        fetch_children.scalars.return_value.all.return_value = active_children

        session.execute = AsyncMock(side_effect=[fetch_task, fetch_children])
        session.commit = AsyncMock()
        session.__aenter__ = AsyncMock(return_value=session)
        session.__aexit__ = AsyncMock(return_value=False)
        return session

    @pytest.mark.asyncio
    async def test_agent_creates_parent_then_subtask(self):
        """23.7 step 1 — parent and child tasks can be created independently."""
        from src.brain.tasks import create_task_record

        parent_id = uuid.uuid4()
        child_id = uuid.uuid4()

        parent_task = self._make_task(parent_id, "pending")
        child_task = self._make_task(child_id, "pending", parent_id=parent_id)

        parent_session = self._make_create_session(parent_task)
        child_session = self._make_create_session(child_task)

        with patch("src.brain.tasks.get_session", side_effect=[parent_session, child_session]):
            created_parent = await create_task_record(
                title="Parent: deploy feature",
                assigned_agent="maya",
                priority=3,
            )
            created_child = await create_task_record(
                title="Child: write unit tests",
                assigned_agent="maya",
                priority=4,
                parent_task_id=str(parent_id),
            )

        assert created_parent.status == "pending"
        assert created_child.status == "pending"

    @pytest.mark.asyncio
    async def test_child_completes_before_parent(self):
        """23.7 step 2 — child task transitions to done successfully."""
        from src.brain.tasks import transition_task

        child_id = uuid.uuid4()
        child = self._make_task(child_id, "active")
        session = self._make_transition_session(child, active_children=[])

        with patch("src.brain.tasks.get_session", return_value=session):
            result = await transition_task(str(child_id), "done", result={"summary": "tests written"})

        assert child.status == "done"

    @pytest.mark.asyncio
    async def test_parent_blocked_while_child_active(self):
        """23.7 — parent cannot complete while child is still active."""
        from src.brain.tasks import transition_task

        parent_id = uuid.uuid4()
        child_id = uuid.uuid4()
        parent = self._make_task(parent_id, "active")
        active_child = self._make_task(child_id, "active", parent_id=parent_id)

        session = self._make_transition_session(parent, active_children=[active_child])

        with patch("src.brain.tasks.get_session", return_value=session):
            with pytest.raises(ValueError, match="active child"):
                await transition_task(str(parent_id), "done")

    @pytest.mark.asyncio
    async def test_parent_unblocked_after_child_completes(self):
        """23.7 — once child is done, parent completion succeeds (no active children)."""
        from src.brain.tasks import transition_task

        parent_id = uuid.uuid4()
        parent = self._make_task(parent_id, "active")

        # No active children remain — child has already moved to done
        session = self._make_transition_session(parent, active_children=[])

        with patch("src.brain.tasks.get_session", return_value=session):
            await transition_task(str(parent_id), "done")

        assert parent.status == "done"

    @pytest.mark.asyncio
    async def test_full_subtask_flow(self):
        """23.7 full scenario: create parent + child, complete child, complete parent."""
        from src.brain.tasks import create_task_record, transition_task

        parent_id = uuid.uuid4()
        child_id = uuid.uuid4()

        parent_task = self._make_task(parent_id, "pending")
        child_task = self._make_task(child_id, "pending", parent_id=parent_id)

        parent_create_session = self._make_create_session(parent_task)
        child_create_session = self._make_create_session(child_task)

        # Transition: activate parent
        active_parent = self._make_task(parent_id, "pending")  # starts pending
        activate_parent_session = self._make_transition_session(active_parent, active_children=[])

        # Transition: activate child
        active_child = self._make_task(child_id, "pending", parent_id=parent_id)
        activate_child_session = self._make_transition_session(active_child, active_children=[])

        # Transition: complete child
        working_child = self._make_task(child_id, "active", parent_id=parent_id)
        complete_child_session = self._make_transition_session(working_child, active_children=[])

        # Transition: complete parent (no active children left)
        working_parent = self._make_task(parent_id, "active")
        complete_parent_session = self._make_transition_session(working_parent, active_children=[])

        sessions = [
            parent_create_session,
            child_create_session,
            activate_parent_session,
            activate_child_session,
            complete_child_session,
            complete_parent_session,
        ]

        with patch("src.brain.tasks.get_session", side_effect=sessions):
            # Step 1 — create parent
            await create_task_record("Deploy feature", "maya")
            # Step 2 — create child
            await create_task_record("Write tests", "maya", parent_task_id=str(parent_id))
            # Step 3 — activate both
            await transition_task(str(parent_id), "active")
            await transition_task(str(child_id), "active")
            # Step 4 — complete child
            await transition_task(str(child_id), "done", result={"summary": "done"})
            # Step 5 — complete parent: child is now done, no blocker
            await transition_task(str(parent_id), "done")

        assert working_parent.status == "done"
        assert working_child.status == "done"
