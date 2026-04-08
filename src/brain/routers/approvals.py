"""Brain API — approval management endpoints (§10)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..db import get_session
from ..models.approval import PendingApproval

router = APIRouter(prefix="/approvals", tags=["approvals"])


class ApprovalDecision(BaseModel):
    resolved_by: str = "operator"


@router.get("", response_model=list[dict])
async def list_pending_approvals(agent_id: str | None = None) -> list[dict]:
    """List pending approvals, optionally filtered by agent."""
    async with get_session() as session:
        q = select(PendingApproval).where(PendingApproval.status == "pending")
        if agent_id:
            q = q.where(PendingApproval.agent_id == agent_id)
        rows = await session.scalars(q)
        return [
            {
                "id": str(r.id),
                "agent_id": r.agent_id,
                "thread_id": r.thread_id,
                "tool_name": r.tool_name,
                "tool_input": r.tool_input,
                "reason": r.reason,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]


@router.post("/{approval_id}/approve")
async def approve(approval_id: str, body: ApprovalDecision) -> dict:
    """Approve a pending approval."""
    async with get_session() as session:
        row = await session.scalar(
            select(PendingApproval).where(PendingApproval.id == approval_id)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Approval not found")
        if row.status != "pending":
            raise HTTPException(status_code=409, detail=f"Approval already {row.status}")
        row.status = "approved"
        row.resolved_at = datetime.now(timezone.utc)
        row.resolved_by = body.resolved_by
        await session.commit()
    return {"status": "approved"}


@router.post("/{approval_id}/reject")
async def reject(approval_id: str, body: ApprovalDecision) -> dict:
    """Reject a pending approval."""
    async with get_session() as session:
        row = await session.scalar(
            select(PendingApproval).where(PendingApproval.id == approval_id)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Approval not found")
        if row.status != "pending":
            raise HTTPException(status_code=409, detail=f"Approval already {row.status}")
        row.status = "rejected"
        row.resolved_at = datetime.now(timezone.utc)
        row.resolved_by = body.resolved_by
        await session.commit()
    return {"status": "rejected"}
