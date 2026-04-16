"""Dashboard events router — event bus log viewer."""
from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.models.events import Event

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("")
async def list_events(
    lane: str | None = Query(None),
    status: str | None = Query(None),
    agent_id: str | None = Query(None),
    org_id: str | None = Query(None),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
):
    async with get_session() as session:
        q = select(Event).order_by(Event.created_at.desc()).offset(offset).limit(limit)
        if lane:
            q = q.where(Event.lane == lane)
        if status:
            q = q.where(Event.status == status)
        if agent_id:
            q = q.where(Event.agent_id == agent_id)
        if org_id:
            q = q.where(Event.org_id == org_id)
        result = await session.execute(q)
        rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "lane": r.lane,
            "status": r.status,
            "failure_class": r.failure_class,
            "agent_id": r.agent_id,
            "invocation_id": r.invocation_id,
            "retry_count": r.retry_count,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
