"""Dashboard health/services router — service health table."""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.models.cron import ServiceHealth

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("/services")
async def list_services():
    async with get_session() as session:
        result = await session.execute(
            select(ServiceHealth).order_by(ServiceHealth.service)
        )
        rows = result.scalars().all()
    return [
        {
            "service": r.service,
            "status": r.status,
            "latency_ms": r.latency_ms,
            "error": r.error,
            "checked_at": r.checked_at.isoformat() if r.checked_at else None,
        }
        for r in rows
    ]
