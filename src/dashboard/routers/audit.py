"""Dashboard audit router — paginated governance audit log."""
from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.models.governance import GovernanceAudit

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
async def list_audit(
    agent_id: str | None = Query(None),
    decision: str | None = Query(None),
    thread_id: str | None = Query(None),
    org_id: str | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0),
):
    async with get_session() as session:
        q = select(GovernanceAudit).order_by(GovernanceAudit.created_at.desc())
        if agent_id:
            q = q.where(GovernanceAudit.agent_id == agent_id)
        if decision:
            q = q.where(GovernanceAudit.decision == decision)
        if thread_id:
            q = q.where(GovernanceAudit.thread_id == thread_id)
        if org_id:
            q = q.where(GovernanceAudit.org_id == org_id)
        q = q.offset(offset).limit(limit)
        result = await session.execute(q)
        rows = result.scalars().all()

    return [
        {
            "id": r.id,
            "agent_id": r.agent_id,
            "invocation_id": r.invocation_id,
            "action": r.action,
            "tool_name": r.tool_name,
            "decision": r.decision,
            "stage": r.stage,
            "reason": r.reason,
            "cost_usd": r.cost_usd,
            "sha256_hash": r.sha256_hash,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
