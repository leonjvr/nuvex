"""Audit trail routes — list entries and verify SHA-256 chain integrity."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..db import get_session
from ..governance.audit import verify_chain
from ..models.governance import GovernanceAudit

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditEntryOut(BaseModel):
    id: int
    agent_id: str
    org_id: str
    invocation_id: str
    thread_id: str
    action: str
    tool_name: str | None
    decision: str
    stage: str
    reason: str | None
    sha256_hash: str
    prev_hash: str | None
    cost_usd: float
    created_at: str  # ISO-8601

    model_config = {"from_attributes": True}


@router.get("/{agent_id}", response_model=list[AuditEntryOut])
async def list_audit_entries(agent_id: str, org_id: str = "default", limit: int = 50) -> list[AuditEntryOut]:
    """Return the most recent audit entries for an agent (newest first), scoped by org."""
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 1000")
    async with get_session() as session:
        q = (
            select(GovernanceAudit)
            .where(GovernanceAudit.agent_id == agent_id)
            .where(GovernanceAudit.org_id == org_id)
            .order_by(GovernanceAudit.id.desc())
            .limit(limit)
        )
        result = await session.execute(q)
        rows = list(result.scalars())
    return [
        AuditEntryOut(
            id=r.id,
            agent_id=r.agent_id,
            org_id=getattr(r, "org_id", "default"),
            invocation_id=r.invocation_id,
            thread_id=r.thread_id,
            action=r.action,
            tool_name=r.tool_name,
            decision=r.decision,
            stage=r.stage,
            reason=r.reason,
            sha256_hash=r.sha256_hash,
            prev_hash=r.prev_hash,
            cost_usd=r.cost_usd,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


@router.get("/{agent_id}/verify")
async def verify_audit_chain(agent_id: str) -> dict:
    """Verify the SHA-256 chain integrity for all audit entries of an agent."""
    try:
        valid, message = await verify_chain(agent_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"agent_id": agent_id, "valid": valid, "message": message}
