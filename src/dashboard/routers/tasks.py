"""Dashboard tasks router — TaskPacket CRUD."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.models.tasks import Task

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class CreateTask(BaseModel):
    title: str
    description: str | None = None
    assigned_agent: str
    priority: int = 5
    acceptance_criteria: list[str] = []
    verification_level: str = "auto"
    parent_task_id: str | None = None


@router.get("")
async def list_tasks(
    agent_id: str | None = Query(None),
    status: str | None = Query(None),
    org_id: str | None = Query(None),
    limit: int = Query(100, le=500),
):
    async with get_session() as session:
        q = select(Task).order_by(Task.created_at.desc()).limit(limit)
        if agent_id:
            q = q.where(Task.assigned_agent == agent_id)
        if status:
            q = q.where(Task.status == status)
        if org_id:
            q = q.where(Task.org_id == org_id)
        result = await session.execute(q)
        rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "title": r.title,
            "assigned_agent": r.assigned_agent,
            "priority": r.priority,
            "status": r.status,
            "verification_level": r.verification_level,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("", status_code=201)
async def create_task(body: CreateTask):
    task = Task(
        id=uuid.uuid4(),
        title=body.title,
        description=body.description,
        assigned_agent=body.assigned_agent,
        priority=body.priority,
        acceptance_criteria=body.acceptance_criteria,
        verification_level=body.verification_level,
        parent_task_id=uuid.UUID(body.parent_task_id) if body.parent_task_id else None,
    )
    async with get_session() as session:
        session.add(task)
        await session.commit()
    return {"id": str(task.id)}


@router.put("/{task_id}/status")
async def update_task_status(task_id: str, status: str):
    valid = {"pending", "active", "done", "failed", "cancelled"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid}")
    async with get_session() as session:
        result = await session.execute(
            select(Task).where(Task.id == uuid.UUID(task_id))
        )
        task = result.scalar_one_or_none()
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        task.status = status
        await session.commit()
    return {"id": task_id, "status": status}
