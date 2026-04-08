"""Cost aggregation & projection API — /api/v1/costs/* (§40)."""
from __future__ import annotations

import logging
import uuid
from calendar import monthrange
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import func, select

from ..db import get_session
from ..models.budget import Budget
from ..models.budget_alert import BudgetAlert
from ..models.budget_ledger import BudgetLedger

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/costs", tags=["costs"])


def _days_remaining_in_month(now: datetime) -> int:
    _, total_days = monthrange(now.year, now.month)
    return max(0, total_days - now.day)


def _project_eom(monthly_cost: float, daily_cost: float, now: datetime) -> float:
    """projected_eom = monthly_cost + (daily_burn * days_remaining) (§40.6)."""
    remaining = _days_remaining_in_month(now)
    return monthly_cost + daily_cost * remaining


@router.get("/summary")
async def cost_summary() -> list[dict[str, Any]]:
    """Per-agent: daily_cost, monthly_cost, budget_limit, budget_remaining, projected_eom, savings_mtd."""
    async with get_session() as session:
        now = datetime.now(timezone.utc)
        month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        today_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)

        budgets_result = await session.execute(select(Budget))
        budgets = {b.agent_id: b for b in budgets_result.scalars().all()}

        # Monthly spend per agent
        monthly_result = await session.execute(
            select(
                BudgetLedger.agent_id,
                func.coalesce(func.sum(BudgetLedger.cost_usd), 0.0),
                func.coalesce(
                    func.sum(func.coalesce(BudgetLedger.primary_cost_usd, 0.0)), 0.0
                ),
            )
            .where(BudgetLedger.timestamp >= month_start)
            .group_by(BudgetLedger.agent_id)
        )
        monthly_map: dict[str, tuple[float, float]] = {
            row[0]: (float(row[1]), float(row[2])) for row in monthly_result
        }

        # Daily spend per agent
        daily_result = await session.execute(
            select(
                BudgetLedger.agent_id,
                func.coalesce(func.sum(BudgetLedger.cost_usd), 0.0),
            )
            .where(BudgetLedger.timestamp >= today_start)
            .group_by(BudgetLedger.agent_id)
        )
        daily_map: dict[str, float] = {row[0]: float(row[1]) for row in daily_result}

        all_agents = set(budgets.keys()) | set(monthly_map.keys())
        rows = []
        for agent_id in sorted(all_agents):
            monthly_cost, primary_cost_mtd = monthly_map.get(agent_id, (0.0, 0.0))
            daily_cost = daily_map.get(agent_id, 0.0)
            budget_row = budgets.get(agent_id)
            budget_limit: float | None = float(budget_row.monthly_usd_limit) if (budget_row and budget_row.monthly_usd_limit) else None
            budget_remaining = (budget_limit - monthly_cost) if budget_limit is not None else None
            projected = _project_eom(monthly_cost, daily_cost, now)
            routing_savings = max(0.0, primary_cost_mtd - monthly_cost)

            rows.append({
                "agent_id": agent_id,
                "daily_cost": daily_cost,
                "monthly_cost": monthly_cost,
                "budget_limit": budget_limit,
                "budget_remaining": budget_remaining,
                "projected_eom": projected,
                "routing_savings_mtd": routing_savings,
            })

    return rows


@router.get("/ledger")
async def cost_ledger(
    agent_id: str | None = Query(None),
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = Query(None),
    model: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> dict[str, Any]:
    """Paginated raw ledger entries with filters (§40.2)."""
    async with get_session() as session:
        q = select(BudgetLedger)
        if agent_id:
            q = q.where(BudgetLedger.agent_id == agent_id)
        if from_:
            q = q.where(BudgetLedger.timestamp >= from_)
        if to:
            q = q.where(BudgetLedger.timestamp <= to)
        if model:
            q = q.where(BudgetLedger.model == model)

        count_result = await session.execute(select(func.count()).select_from(q.subquery()))
        total = count_result.scalar() or 0

        q = q.order_by(BudgetLedger.timestamp.desc())
        q = q.offset((page - 1) * page_size).limit(page_size)
        rows_result = await session.execute(q)
        rows = rows_result.scalars().all()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": str(r.id),
                "agent_id": r.agent_id,
                "division": r.division,
                "model": r.model,
                "provider": r.provider,
                "thread_id": r.thread_id,
                "input_tokens": r.input_tokens,
                "output_tokens": r.output_tokens,
                "cost_usd": float(r.cost_usd),
                "routed_from": r.routed_from,
                "primary_cost_usd": float(r.primary_cost_usd) if r.primary_cost_usd is not None else None,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            }
            for r in rows
        ],
    }


@router.get("/breakdown")
async def cost_breakdown(
    group_by: str = Query("model", regex="^(model|division)$"),
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = Query(None),
) -> list[dict[str, Any]]:
    """Aggregated cost by model or division (§40.3)."""
    async with get_session() as session:
        if group_by == "model":
            dim = BudgetLedger.model
        else:
            dim = BudgetLedger.division

        q = (
            select(
                dim,
                func.count().label("call_count"),
                func.coalesce(func.sum(BudgetLedger.input_tokens), 0).label("input_tokens"),
                func.coalesce(func.sum(BudgetLedger.output_tokens), 0).label("output_tokens"),
                func.coalesce(func.sum(BudgetLedger.cost_usd), 0.0).label("cost_usd"),
            )
            .group_by(dim)
            .order_by(func.sum(BudgetLedger.cost_usd).desc())
        )
        if from_:
            q = q.where(BudgetLedger.timestamp >= from_)
        if to:
            q = q.where(BudgetLedger.timestamp <= to)

        result = await session.execute(q)
        rows = result.all()
        total_cost = sum(float(r.cost_usd) for r in rows) or 1.0

    return [
        {
            group_by: r[0],
            "call_count": r.call_count,
            "input_tokens": r.input_tokens,
            "output_tokens": r.output_tokens,
            "cost_usd": float(r.cost_usd),
            "pct_of_spend": round(float(r.cost_usd) / total_cost * 100, 2),
        }
        for r in rows
    ]


@router.get("/savings")
async def cost_savings(
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = Query(None),
) -> list[dict[str, Any]]:
    """Routing savings per agent (§40.4)."""
    async with get_session() as session:
        q = (
            select(
                BudgetLedger.agent_id,
                func.coalesce(func.sum(BudgetLedger.cost_usd), 0.0).label("actual"),
                func.coalesce(
                    func.sum(func.coalesce(BudgetLedger.primary_cost_usd, BudgetLedger.cost_usd)),
                    0.0,
                ).label("primary"),
            )
            .group_by(BudgetLedger.agent_id)
        )
        if from_:
            q = q.where(BudgetLedger.timestamp >= from_)
        if to:
            q = q.where(BudgetLedger.timestamp <= to)

        result = await session.execute(q)
        rows = result.all()

    out = []
    for r in rows:
        actual = float(r.actual)
        primary = float(r.primary)
        savings = max(0.0, primary - actual)
        savings_pct = (savings / primary * 100.0) if primary > 0 else 0.0
        out.append({
            "agent_id": r.agent_id,
            "primary_cost_sum": primary,
            "actual_cost_sum": actual,
            "savings_usd": savings,
            "savings_pct": round(savings_pct, 2),
        })

    return out


# Alert CRUD — brain-side endpoints (§40)

@router.get("/alerts")
async def list_alerts() -> list[dict[str, Any]]:
    async with get_session() as session:
        result = await session.execute(select(BudgetAlert))
        rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "agent_id": r.agent_id,
            "division": r.division,
            "threshold_pct": float(r.threshold_pct),
            "window": r.window,
            "channels": r.channels,
            "last_fired_at": r.last_fired_at.isoformat() if r.last_fired_at else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


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
