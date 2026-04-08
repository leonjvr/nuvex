"""Policy candidate routes — review and act on LLM-generated policy suggestions (29.7)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..db import get_session
from ..models.outcomes import PolicyCandidate

router = APIRouter(prefix="/policy-candidates", tags=["policy-candidates"])


class PolicyCandidateOut(BaseModel):
    id: str
    agent_id: str | None
    division_id: str | None
    condition_tree: dict
    action: str
    rationale: str
    source_threads: list
    status: str
    reviewed_by: str | None
    reviewed_at: str | None
    created_at: str

    model_config = {"from_attributes": True}


def _serialize(candidate: PolicyCandidate) -> PolicyCandidateOut:
    return PolicyCandidateOut(
        id=str(candidate.id),
        agent_id=candidate.agent_id,
        division_id=candidate.division_id,
        condition_tree=candidate.condition_tree or {},
        action=candidate.action,
        rationale=candidate.rationale,
        source_threads=candidate.source_threads or [],
        status=candidate.status,
        reviewed_by=candidate.reviewed_by,
        reviewed_at=candidate.reviewed_at.isoformat() if candidate.reviewed_at else None,
        created_at=candidate.created_at.isoformat(),
    )


@router.get("", response_model=list[PolicyCandidateOut])
async def list_candidates(
    status: str = "pending_review",
    limit: int = 50,
) -> list[PolicyCandidateOut]:
    """List policy candidates filtered by status (T1 only in production)."""
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 500")
    valid_statuses = {"pending_review", "approved", "rejected"}
    if status not in valid_statuses:
        raise HTTPException(status_code=422, detail=f"status must be one of {valid_statuses}")

    async with get_session() as session:
        result = await session.execute(
            select(PolicyCandidate)
            .where(PolicyCandidate.status == status)
            .order_by(PolicyCandidate.created_at.desc())
            .limit(limit)
        )
        rows = list(result.scalars())

    return [_serialize(r) for r in rows]


@router.post("/{candidate_id}/approve", response_model=PolicyCandidateOut)
async def approve_candidate(candidate_id: str, reviewer_id: str) -> PolicyCandidateOut:
    """Approve a policy candidate (marks for policy engine reload)."""
    try:
        cand_uuid = uuid.UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid candidate_id UUID")

    async with get_session() as session:
        result = await session.execute(
            select(PolicyCandidate).where(PolicyCandidate.id == cand_uuid)
        )
        candidate = result.scalar_one_or_none()
        if candidate is None:
            raise HTTPException(status_code=404, detail="Policy candidate not found")
        if candidate.status != "pending_review":
            raise HTTPException(
                status_code=409,
                detail=f"Candidate is already {candidate.status}",
            )

        candidate.status = "approved"
        candidate.reviewed_by = reviewer_id
        candidate.reviewed_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(candidate)

    # Publish event so policy engine can reload (non-blocking)
    try:
        from ..events import publish
        await publish(
            "policy.candidate_approved",
            {"candidate_id": candidate_id, "reviewer_id": reviewer_id},
        )
    except Exception:
        pass  # non-fatal — candidate is already persisted

    return _serialize(candidate)


@router.post("/{candidate_id}/reject", response_model=PolicyCandidateOut)
async def reject_candidate(candidate_id: str, reviewer_id: str) -> PolicyCandidateOut:
    """Reject a policy candidate."""
    try:
        cand_uuid = uuid.UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid candidate_id UUID")

    async with get_session() as session:
        result = await session.execute(
            select(PolicyCandidate).where(PolicyCandidate.id == cand_uuid)
        )
        candidate = result.scalar_one_or_none()
        if candidate is None:
            raise HTTPException(status_code=404, detail="Policy candidate not found")
        if candidate.status != "pending_review":
            raise HTTPException(
                status_code=409,
                detail=f"Candidate is already {candidate.status}",
            )

        candidate.status = "rejected"
        candidate.reviewed_by = reviewer_id
        candidate.reviewed_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(candidate)

    return _serialize(candidate)
