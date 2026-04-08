"""Dashboard cron router — manage scheduled jobs."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select

from ...brain.db import get_session
from ...brain.models.cron import CronEntry

router = APIRouter(prefix="/api/cron", tags=["cron"])


class CronCreate(BaseModel):
    name: str
    agent_id: str
    schedule: str
    task_payload: dict = {}
    enabled: bool = True


class CronUpdate(BaseModel):
    schedule: str | None = None
    enabled: bool | None = None
    task_payload: dict | None = None


@router.get("")
async def list_cron_jobs():
    async with get_session() as session:
        result = await session.execute(select(CronEntry).order_by(CronEntry.name))
        rows = result.scalars().all()
    return [_serialize(r) for r in rows]


@router.post("", status_code=201)
async def create_cron_job(body: CronCreate):
    async with get_session() as session:
        entry = CronEntry(
            name=body.name,
            agent_id=body.agent_id,
            schedule=body.schedule,
            task_payload=body.task_payload,
            enabled=body.enabled,
        )
        session.add(entry)
        await session.commit()
        await session.refresh(entry)
    return _serialize(entry)


@router.put("/{name}")
async def update_cron_job(name: str, body: CronUpdate):
    async with get_session() as session:
        result = await session.execute(select(CronEntry).where(CronEntry.name == name))
        entry = result.scalar_one_or_none()
        if not entry:
            raise HTTPException(status_code=404, detail="Cron job not found")
        if body.schedule is not None:
            entry.schedule = body.schedule
        if body.enabled is not None:
            entry.enabled = body.enabled
        if body.task_payload is not None:
            entry.task_payload = body.task_payload
        await session.commit()
        await session.refresh(entry)
    return _serialize(entry)


@router.delete("/{name}", status_code=204)
async def delete_cron_job(name: str):
    async with get_session() as session:
        await session.execute(delete(CronEntry).where(CronEntry.name == name))
        await session.commit()


def _serialize(r: CronEntry) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "agent_id": r.agent_id,
        "schedule": r.schedule,
        "task_payload": r.task_payload,
        "enabled": r.enabled,
        "last_run_at": r.last_run_at.isoformat() if r.last_run_at else None,
        "next_run_at": r.next_run_at.isoformat() if r.next_run_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
