"""Dashboard — approvals proxy router (§10.7)."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ...brain.db import get_session

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


@router.get("")
async def list_pending_approvals(agent_id: str | None = None) -> JSONResponse:
    """List pending approvals, optionally filtered by agent."""
    async with get_session() as session:
        if agent_id:
            rows = await session.execute(
                text(
                    "SELECT id, agent_id, thread_id, tool_name, tool_input, reason, "
                    "status, created_at FROM pending_approvals "
                    "WHERE status = 'pending' AND agent_id = :agent_id "
                    "ORDER BY created_at DESC"
                ),
                {"agent_id": agent_id},
            )
        else:
            rows = await session.execute(
                text(
                    "SELECT id, agent_id, thread_id, tool_name, tool_input, reason, "
                    "status, created_at FROM pending_approvals "
                    "WHERE status = 'pending' "
                    "ORDER BY created_at DESC"
                )
            )
        results = [
            {
                "id": str(r.id),
                "agent_id": r.agent_id,
                "thread_id": r.thread_id,
                "tool_name": r.tool_name,
                "tool_input": r.tool_input or {},
                "reason": r.reason,
                "status": r.status,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    return JSONResponse(results)


@router.post("/{approval_id}/approve")
async def approve(approval_id: str) -> JSONResponse:
    """Approve a pending approval."""
    try:
        UUID(approval_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid UUID")
    now = datetime.now(timezone.utc)
    async with get_session() as session:
        check = await session.execute(
            text("SELECT status FROM pending_approvals WHERE id = :id"),
            {"id": approval_id},
        )
        row = check.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        if row[0] != "pending":
            raise HTTPException(status_code=409, detail="Already resolved")
        await session.execute(
            text(
                "UPDATE pending_approvals SET status='approved', resolved_by='dashboard', "
                "resolved_at=:now WHERE id=:id"
            ),
            {"now": now, "id": approval_id},
        )
        await session.commit()
    return JSONResponse({"id": approval_id, "status": "approved"})


@router.post("/{approval_id}/reject")
async def reject(approval_id: str) -> JSONResponse:
    """Reject a pending approval."""
    try:
        UUID(approval_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid UUID")
    now = datetime.now(timezone.utc)
    async with get_session() as session:
        check = await session.execute(
            text("SELECT status FROM pending_approvals WHERE id = :id"),
            {"id": approval_id},
        )
        row = check.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        if row[0] != "pending":
            raise HTTPException(status_code=409, detail="Already resolved")
        await session.execute(
            text(
                "UPDATE pending_approvals SET status='rejected', resolved_by='dashboard', "
                "resolved_at=:now WHERE id=:id"
            ),
            {"now": now, "id": approval_id},
        )
        await session.commit()
    return JSONResponse({"id": approval_id, "status": "rejected"})
