"""Dashboard costs router — proxies to brain /api/v1/costs/* (§41.1) and alert CRUD (§40.5)."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.models.budget_alert import BudgetAlert
from ...brain.routers.costs import (
    cost_breakdown,
    cost_ledger,
    cost_savings,
    cost_summary,
    list_alerts,
)

router = APIRouter(prefix="/api/costs", tags=["costs"])


@router.get("/summary")
async def summary() -> list[dict[str, Any]]:
    return await cost_summary()


@router.get("/ledger")
async def ledger(
    agent_id: str | None = Query(None),
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    model: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> dict[str, Any]:
    from datetime import datetime
    from_dt = datetime.fromisoformat(from_) if from_ else None
    to_dt = datetime.fromisoformat(to) if to else None
    return await cost_ledger(
        agent_id=agent_id, from_=from_dt, to=to_dt, model=model, page=page, page_size=page_size
    )


@router.get("/breakdown")
async def breakdown(
    group_by: str = Query("model"),
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
) -> list[dict[str, Any]]:
    from datetime import datetime
    from_dt = datetime.fromisoformat(from_) if from_ else None
    to_dt = datetime.fromisoformat(to) if to else None
    return await cost_breakdown(group_by=group_by, from_=from_dt, to=to_dt)


@router.get("/savings")
async def savings(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
) -> list[dict[str, Any]]:
    from datetime import datetime
    from_dt = datetime.fromisoformat(from_) if from_ else None
    to_dt = datetime.fromisoformat(to) if to else None
    return await cost_savings(from_=from_dt, to=to_dt)


@router.get("/alerts")
async def get_alerts() -> list[dict[str, Any]]:
    return await list_alerts()


@router.post("/alerts", status_code=201)
async def create_alert(body: dict[str, Any]) -> dict[str, Any]:
    async with get_session() as session:
        alert = BudgetAlert(
            id=uuid.uuid4(),
            agent_id=body.get("agent_id"),
            division=body.get("division"),
            threshold_pct=body.get("threshold_pct", 80.0),
            window=body.get("window", "month"),
            channels=body.get("channels"),
        )
        session.add(alert)
        await session.commit()
        return {"id": str(alert.id)}


@router.delete("/alerts/{alert_id}", status_code=204)
async def delete_alert(alert_id: str) -> None:
    async with get_session() as session:
        try:
            aid = uuid.UUID(alert_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid alert id")
        row = await session.get(BudgetAlert, aid)
        if row is None:
            raise HTTPException(status_code=404, detail="alert not found")
        await session.delete(row)
        await session.commit()


# Legacy endpoint — kept for backward compat
@router.get("")
async def costs_summary() -> list[dict[str, Any]]:
    return await cost_summary()

