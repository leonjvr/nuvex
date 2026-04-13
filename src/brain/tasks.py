"""Task lifecycle management — create, assign, complete, fail tasks."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from langchain_core.tools import tool
from sqlalchemy import select

from .db import get_session
from .models.tasks import Task

log = logging.getLogger(__name__)

VALID_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"active", "cancelled"},
    "active": {"done", "failed", "pending", "pending_review"},
    "pending_review": {"done", "failed"},  # operator approves or rejects (24.6)
    "done": set(),
    "failed": {"pending"},
    "cancelled": set(),
}


async def create_task_record(
    title: str,
    assigned_agent: str,
    description: str = "",
    priority: int = 5,
    acceptance_criteria: list[str] | None = None,
    parent_task_id: str | None = None,
    org_id: str = "default",
) -> Task:
    """Persist a new task in the database and return the model."""
    task = Task(
        title=title,
        assigned_agent=assigned_agent,
        description=description,
        priority=priority,
        acceptance_criteria=acceptance_criteria or [],
        parent_task_id=uuid.UUID(parent_task_id) if parent_task_id else None,
        status="pending",
        org_id=org_id,
    )
    async with get_session() as session:
        session.add(task)
        await session.commit()
        await session.refresh(task)
    log.info("task created: id=%s title=%r agent=%s org=%s", task.id, title, assigned_agent, org_id)
    return task


async def transition_task(task_id: str, new_status: str, result: dict | None = None, error: str | None = None) -> Task:
    """Move a task to a new status, validating the transition."""
    tid = uuid.UUID(task_id)
    async with get_session() as session:
        row: Task | None = (await session.execute(select(Task).where(Task.id == tid))).scalar_one_or_none()
        if row is None:
            raise ValueError(f"Task {task_id} not found")
        allowed = VALID_TRANSITIONS.get(row.status, set())
        if new_status not in allowed:
            raise ValueError(f"Cannot transition task from '{row.status}' to '{new_status}'")

        # 23.5 — parent cannot complete until all children are done/cancelled
        if new_status == "done":
            active_children = (await session.execute(
                select(Task).where(
                    Task.parent_task_id == tid,
                    Task.status.in_(("pending", "active")),
                )
            )).scalars().all()
            if active_children:
                ids = [str(c.id) for c in active_children]
                raise ValueError(
                    f"Cannot complete task {task_id}: {len(active_children)} active child task(s) remain: {ids}"
                )

        row.status = new_status
        row.updated_at = datetime.now(timezone.utc)
        if result is not None:
            row.result = result
        if error is not None:
            row.error = error
        await session.commit()
        await session.refresh(row)
    log.info("task %s → %s", task_id, new_status)
    return row


async def get_task(task_id: str) -> Task | None:
    async with get_session() as session:
        result = await session.execute(select(Task).where(Task.id == uuid.UUID(task_id)))
        return result.scalar_one_or_none()


async def list_agent_tasks(agent_id: str, status: str | None = None) -> list[Task]:
    async with get_session() as session:
        q = select(Task).where(Task.assigned_agent == agent_id)
        if status:
            q = q.where(Task.status == status)
        result = await session.execute(q.order_by(Task.priority, Task.created_at))
        return list(result.scalars().all())


# --- LangChain tools usable by agents ---

@tool
async def create_task(
    title: str,
    assigned_agent: str,
    description: str = "",
    priority: int = 5,
    acceptance_criteria: list[str] | None = None,
    parent_task_id: str | None = None,
) -> dict[str, Any]:
    """Create a new task and assign it to an agent.

    Args:
        title: Short description of the work to be done.
        assigned_agent: The agent ID responsible for this task.
        description: Detailed instructions or context.
        priority: 1 (highest) to 10 (lowest). Default 5.
        acceptance_criteria: List of verifiable conditions for completion.
        parent_task_id: Optional UUID of a parent task (for subtask nesting).

    Returns:
        dict with task_id, title, status, assigned_agent.
    """
    # §16.2-16.3 — Intra-org validation: target agent must be in same org as caller
    # We resolve org_id from the agent DB record for the assigned_agent.
    calling_org = "default"
    target_org = "default"
    try:
        from .db import get_session as _ts
        from .models.agent import Agent as _Agent
        from sqlalchemy import select as _sel
        async with _ts() as _sess:
            _row = (await _sess.execute(
                _sel(_Agent.org_id).where(_Agent.id == assigned_agent).limit(1)
            )).scalar_one_or_none()
            if _row is not None:
                target_org = _row
    except Exception:
        pass

    if target_org != calling_org and calling_org != "default":
        return {
            "error": "cross_org_delegation_blocked",
            "message": (
                f"Agent '{assigned_agent}' belongs to org '{target_org}'. "
                "Cross-org task delegation is not permitted. "
                "Use send_work_packet to delegate work to agents in other organisations."
            ),
        }

    task = await create_task_record(title, assigned_agent, description, priority, acceptance_criteria, parent_task_id)
    return {
        "task_id": str(task.id),
        "title": task.title,
        "status": task.status,
        "assigned_agent": task.assigned_agent,
        "priority": task.priority,
    }


@tool
async def complete_task(task_id: str, summary: str = "") -> dict[str, Any]:
    """Mark a task as done and record the completion summary.

    For T3/T4 agents the task is sent to peer review before final completion.

    Args:
        task_id: UUID of the task to complete.
        summary: Brief description of what was accomplished.

    Returns:
        dict with task_id and updated status.
    """
    task = await get_task(task_id)
    if task is None:
        return {"error": f"Task {task_id} not found"}

    # 24.6 — T3/T4 tasks require peer review before completion
    try:
        from ..shared.config import get_cached_config
        cfg = get_cached_config()
        agent_def = cfg.agents.get(task.assigned_agent)
        tier = getattr(agent_def, "tier", "T2") if agent_def else "T2"
    except Exception:
        tier = "T2"

    if tier in ("T3", "T4"):
        updated = await transition_task(task_id, "pending_review", result={"summary": summary})
        try:
            from .events import publish
            await publish(
                "task.review_required",
                {"task_id": task_id, "agent": task.assigned_agent, "summary": summary},
                agent_id=task.assigned_agent,
            )
        except Exception:
            pass
        return {"task_id": str(updated.id), "status": "pending_review",
                "message": "Task sent to operator for peer review"}

    updated = await transition_task(task_id, "done", result={"summary": summary})
    return {"task_id": str(updated.id), "status": updated.status, "summary": summary}


@tool
async def fail_task(task_id: str, error: str = "") -> dict[str, Any]:
    """Mark a task as failed and record the error reason.

    Args:
        task_id: UUID of the task.
        error: Description of what went wrong.

    Returns:
        dict with task_id and updated status.
    """
    task = await transition_task(task_id, "failed", error=error)
    return {"task_id": str(task.id), "status": task.status, "error": error}


@tool
async def list_tasks(agent_id: str, status: str = "") -> list[dict[str, Any]]:
    """List tasks assigned to an agent.

    Args:
        agent_id: The agent whose tasks to retrieve.
        status: Filter by status (pending/active/done/failed). Empty = all.

    Returns:
        List of task dicts sorted by priority then created_at.
    """
    tasks = await list_agent_tasks(agent_id, status or None)
    return [
        {
            "task_id": str(t.id),
            "title": t.title,
            "status": t.status,
            "priority": t.priority,
            "parent_task_id": str(t.parent_task_id) if t.parent_task_id else None,
        }
        for t in tasks
    ]


TASK_TOOLS = [create_task, complete_task, fail_task, list_tasks]
