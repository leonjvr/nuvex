"""Persistent task queue for desktop device orchestration (§2)."""
from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select

from ..db import get_session
from .models import DesktopTaskQueue, TaskStatus

log = logging.getLogger(__name__)

# Configurable expiry threshold (hours)
QUEUE_EXPIRY_HOURS = int(os.environ.get("DESKTOP_QUEUE_EXPIRY_HOURS", "24"))

# Valid status forward-transitions
_VALID_TRANSITIONS: dict[str, set[str]] = {
    TaskStatus.queued: {TaskStatus.dispatched, TaskStatus.cancelled},
    TaskStatus.dispatched: {TaskStatus.queued, TaskStatus.waiting_idle, TaskStatus.waiting_permission, TaskStatus.running, TaskStatus.failed, TaskStatus.cancelled},
    TaskStatus.waiting_idle: {TaskStatus.running, TaskStatus.cancelled},
    TaskStatus.waiting_permission: {TaskStatus.running, TaskStatus.cancelled},
    TaskStatus.running: {TaskStatus.succeeded, TaskStatus.failed, TaskStatus.cancelled},
    TaskStatus.succeeded: set(),
    TaskStatus.failed: set(),
    TaskStatus.cancelled: set(),
}


@dataclass
class QueuedTask:
    id: str
    agent_id: str
    device_id: str
    graph_thread_id: str | None
    tool_name: str
    payload: dict
    call_id: str
    status: str


class TaskQueueManager:
    """Manages the persistent desktop task queue."""

    async def enqueue(
        self,
        agent_id: str,
        device_id: str,
        graph_thread_id: str | None,
        tool_name: str,
        payload: dict[str, Any],
        call_id: str | None = None,
    ) -> str:
        if call_id is None:
            call_id = str(uuid.uuid4())
        task = DesktopTaskQueue(
            id=str(uuid.uuid4()),
            agent_id=agent_id,
            device_id=device_id,
            graph_thread_id=graph_thread_id,
            tool_name=tool_name,
            payload_json=payload,
            status=TaskStatus.queued,
            call_id=call_id,
        )
        async with get_session() as session:
            session.add(task)
            await session.commit()
        log.debug("queue: enqueued %s for device %s", call_id, device_id)
        return task.id

    async def dequeue_for_device(self, device_id: str) -> list[QueuedTask]:
        async with get_session() as session:
            rows = (await session.execute(
                select(DesktopTaskQueue).where(
                    DesktopTaskQueue.device_id == device_id,
                    DesktopTaskQueue.status == TaskStatus.queued,
                )
            )).scalars().all()
            return [
                QueuedTask(
                    id=r.id, agent_id=r.agent_id, device_id=r.device_id,
                    graph_thread_id=r.graph_thread_id, tool_name=r.tool_name,
                    payload=r.payload_json, call_id=r.call_id, status=r.status,
                )
                for r in rows
            ]

    async def update_status(
        self,
        queue_id: str,
        status: str,
        result_json: dict | None = None,
        error: str | None = None,
    ) -> bool:
        async with get_session() as session:
            row = await session.get(DesktopTaskQueue, queue_id)
            if row is None:
                return False
            allowed = _VALID_TRANSITIONS.get(row.status, set())
            if status not in allowed:
                log.warning("queue: invalid transition %s→%s for %s", row.status, status, queue_id)
                return False
            row.status = status
            row.updated_at = datetime.now(timezone.utc)
            if result_json is not None:
                row.result_json = result_json
            if error is not None:
                row.error = error
            await session.commit()
        return True

    async def update_status_by_call_id(
        self,
        call_id: str,
        status: str,
        result_json: dict | None = None,
        error: str | None = None,
    ) -> str | None:
        """Update status by call_id. Returns queue row id or None."""
        async with get_session() as session:
            row = (await session.execute(
                select(DesktopTaskQueue).where(DesktopTaskQueue.call_id == call_id)
            )).scalar_one_or_none()
            if row is None:
                return None
            allowed = _VALID_TRANSITIONS.get(row.status, set())
            if status not in allowed:
                log.warning("queue: invalid transition %s→%s for call_id %s", row.status, status, call_id)
                return None
            row.status = status
            row.updated_at = datetime.now(timezone.utc)
            if result_json is not None:
                row.result_json = result_json
            if error is not None:
                row.error = error
            await session.commit()
            return row.id

    async def get_pending_count(self, device_id: str) -> int:
        async with get_session() as session:
            rows = (await session.execute(
                select(DesktopTaskQueue).where(
                    DesktopTaskQueue.device_id == device_id,
                    DesktopTaskQueue.status.in_([TaskStatus.queued, TaskStatus.dispatched]),
                )
            )).scalars().all()
            return len(rows)

    async def expire_old_tasks(self) -> int:
        """Transition tasks older than QUEUE_EXPIRY_HOURS to cancelled. Returns count."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=QUEUE_EXPIRY_HOURS)
        async with get_session() as session:
            rows = (await session.execute(
                select(DesktopTaskQueue).where(
                    DesktopTaskQueue.status.in_([TaskStatus.queued, TaskStatus.dispatched]),
                    DesktopTaskQueue.created_at < cutoff,
                )
            )).scalars().all()
            for row in rows:
                row.status = TaskStatus.cancelled
                row.error = "expired"
                row.updated_at = datetime.now(timezone.utc)
            await session.commit()
            return len(rows)

    async def get_by_call_id(self, call_id: str) -> DesktopTaskQueue | None:
        async with get_session() as session:
            return (await session.execute(
                select(DesktopTaskQueue).where(DesktopTaskQueue.call_id == call_id)
            )).scalar_one_or_none()


# Module-level singleton
_queue_manager: TaskQueueManager | None = None


def get_queue_manager() -> TaskQueueManager:
    global _queue_manager
    if _queue_manager is None:
        _queue_manager = TaskQueueManager()
    return _queue_manager
