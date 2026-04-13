"""Cron job management routes — list, register, disable/delete."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..cron import register_cron
from ..db import get_session
from ..models.cron import CronEntry

router = APIRouter(prefix="/cron", tags=["cron"])


class CronEntryOut(BaseModel):
    id: int
    name: str
    agent_id: str
    schedule: str
    task_payload: dict
    enabled: bool
    last_run_at: str | None
    next_run_at: str | None
    created_at: str

    model_config = {"from_attributes": True}


class CronCreate(BaseModel):
    name: str
    agent_id: str
    schedule: str
    task_payload: dict = {}


@router.get("", response_model=list[CronEntryOut])
async def list_cron_jobs() -> list[CronEntryOut]:
    """Return all registered cron jobs."""
    async with get_session() as session:
        result = await session.execute(select(CronEntry).order_by(CronEntry.name))
        rows = list(result.scalars())
    return [_to_out(r) for r in rows]


@router.get("/{name}", response_model=CronEntryOut)
async def get_cron_job(name: str) -> CronEntryOut:
    """Return a single cron job by name."""
    async with get_session() as session:
        result = await session.execute(select(CronEntry).where(CronEntry.name == name))
        row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Cron job '{name}' not found")
    return _to_out(row)


@router.post("", response_model=CronEntryOut, status_code=201)
async def create_or_update_cron_job(body: CronCreate) -> CronEntryOut:
    """Register a new cron job (or update schedule/payload if name already exists)."""
    try:
        await register_cron(
            name=body.name,
            agent_id=body.agent_id,
            schedule=body.schedule,
            task_payload=body.task_payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    async with get_session() as session:
        result = await session.execute(select(CronEntry).where(CronEntry.name == body.name))
        row = result.scalar_one_or_none()
    if row is None:  # pragma: no cover
        raise HTTPException(status_code=500, detail="Job was registered but not found")
    return _to_out(row)


@router.delete("/{name}", status_code=204, response_model=None)
async def delete_cron_job(name: str) -> None:
    """Disable and remove a cron job."""
    from ..cron import get_scheduler

    async with get_session() as session:
        result = await session.execute(select(CronEntry).where(CronEntry.name == name))
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Cron job '{name}' not found")
        await session.delete(row)
        await session.commit()

    sched = get_scheduler()
    job_id = f"cron:{name}"
    if sched.get_job(job_id):
        sched.remove_job(job_id)


def _to_out(r: CronEntry) -> CronEntryOut:
    return CronEntryOut(
        id=r.id,
        name=r.name,
        agent_id=r.agent_id,
        schedule=r.schedule,
        task_payload=r.task_payload,
        enabled=r.enabled,
        last_run_at=r.last_run_at.isoformat() if r.last_run_at else None,
        next_run_at=r.next_run_at.isoformat() if r.next_run_at else None,
        created_at=r.created_at.isoformat(),
    )


# ── Org-scoped cron endpoints  (task 15.3) ────────────────────────────────────

org_cron_router = APIRouter(tags=["cron"])


@org_cron_router.get("", response_model=list[CronEntryOut])
async def list_org_cron_jobs(org_id: str) -> list[CronEntryOut]:
    """Return all cron jobs for a specific organisation."""
    async with get_session() as session:
        result = await session.execute(
            select(CronEntry)
            .where(CronEntry.org_id == org_id)
            .order_by(CronEntry.name)
        )
        rows = list(result.scalars())
    return [_to_out(r) for r in rows]


@org_cron_router.post("", response_model=CronEntryOut, status_code=201)
async def create_org_cron_job(org_id: str, body: CronCreate) -> CronEntryOut:
    """Register a cron job scoped to a specific organisation."""
    try:
        await register_cron(
            name=body.name,
            agent_id=body.agent_id,
            schedule=body.schedule,
            task_payload=body.task_payload,
            org_id=org_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    async with get_session() as session:
        result = await session.execute(select(CronEntry).where(CronEntry.name == body.name))
        row = result.scalar_one_or_none()
    if row is None:  # pragma: no cover
        raise HTTPException(status_code=500, detail="Job was registered but not found")
    return _to_out(row)
