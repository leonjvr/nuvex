"""Dashboard costs router — proxies to brain /api/v1/costs/* (§41.1) and alert CRUD (§40.5)."""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, text

from ...brain.db import get_session
from ...brain.models.budget_alert import BudgetAlert
from ...brain.routers.costs import (
    cost_breakdown,
    cost_ledger,
    routing_performance,
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
    org_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> dict[str, Any]:
    from datetime import datetime
    from_dt = datetime.fromisoformat(from_) if from_ else None
    to_dt = datetime.fromisoformat(to) if to else None
    return await cost_ledger(
        agent_id=agent_id, from_=from_dt, to=to_dt, model=model, org_id=org_id, page=page, page_size=page_size
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


@router.get("/routing-performance")
async def routing_analytics(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    agent_id: str | None = Query(None),
    task_type: str | None = Query(None),
    model_name: str | None = Query(None),
    limit: int = Query(200, ge=1, le=2000),
) -> list[dict[str, Any]]:
    from datetime import datetime

    from_dt = datetime.fromisoformat(from_) if from_ else None
    to_dt = datetime.fromisoformat(to) if to else None
    return await routing_performance(
        from_=from_dt,
        to=to_dt,
        agent_id=agent_id,
        task_type=task_type,
        model_name=model_name,
        limit=limit,
    )


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


@router.delete("/alerts/{alert_id}", status_code=204, response_model=None)
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


# Legacy endpoint — kept for backward compat; queries budgets table directly
@router.get("")
async def costs_summary() -> list[dict[str, Any]]:
    from ...brain.models.budget import Budget
    async with get_session() as session:
        result = await session.execute(select(Budget).order_by(Budget.agent_id))
        rows = result.scalars().all()
        return [
            {
                "agent_id": r.agent_id,
                "division": r.division,
                "daily_usd_used": r.daily_usd_used,
                "daily_usd_limit": r.daily_usd_limit,
                "monthly_usd_used": getattr(r, "monthly_usd_used", None),
                "monthly_usd_limit": getattr(r, "monthly_usd_limit", None),
                "total_usd_used": r.total_usd_used,
                "last_updated_at": str(r.last_updated_at) if r.last_updated_at else None,
            }
            for r in rows
        ]

