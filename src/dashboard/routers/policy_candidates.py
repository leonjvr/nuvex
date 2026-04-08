"""Dashboard policy candidates router — review queue for LLM-generated policies."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from ...brain.db import get_session

router = APIRouter(prefix="/api/policy-candidates", tags=["policy-candidates"])


@router.get("")
async def list_candidates(status: str = "pending_review", limit: int = 50):
    valid = {"pending_review", "approved", "rejected"}
    if status not in valid:
        raise HTTPException(status_code=422, detail=f"status must be one of {valid}")
    async with get_session() as session:
        result = await session.execute(
            text(
                "SELECT id, agent_id, division_id, condition_tree, action, rationale, "
                "source_threads, status, reviewed_by, reviewed_at, created_at "
                "FROM policy_candidates "
                "WHERE status = :status "
                "ORDER BY created_at DESC "
                "LIMIT :lim"
            ),
            {"status": status, "lim": min(limit, 200)},
        )
        rows = result.mappings().all()
    return [
        {
            "id": str(r["id"]),
            "agent_id": r["agent_id"],
            "division_id": r["division_id"],
            "condition_tree": r["condition_tree"] or {},
            "action": r["action"],
            "rationale": r["rationale"],
            "source_threads": r["source_threads"] or [],
            "status": r["status"],
            "reviewed_by": r["reviewed_by"],
            "reviewed_at": r["reviewed_at"].isoformat() if r["reviewed_at"] else None,
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


@router.post("/{candidate_id}/approve")
async def approve(candidate_id: str, reviewer_id: str = "dashboard"):
    try:
        UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid UUID")
    now = datetime.now(timezone.utc)
    async with get_session() as session:
        check = await session.execute(
            text("SELECT status FROM policy_candidates WHERE id = :id"),
            {"id": candidate_id},
        )
        row = check.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        if row[0] != "pending_review":
            raise HTTPException(status_code=409, detail="Already reviewed")
        await session.execute(
            text(
                "UPDATE policy_candidates SET status='approved', reviewed_by=:rev, reviewed_at=:now "
                "WHERE id=:id"
            ),
            {"rev": reviewer_id, "now": now, "id": candidate_id},
        )
        await session.commit()
    return {"id": candidate_id, "status": "approved"}


@router.post("/{candidate_id}/reject")
async def reject(candidate_id: str, reviewer_id: str = "dashboard"):
    try:
        UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid UUID")
    now = datetime.now(timezone.utc)
    async with get_session() as session:
        check = await session.execute(
            text("SELECT status FROM policy_candidates WHERE id = :id"),
            {"id": candidate_id},
        )
        row = check.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        if row[0] != "pending_review":
            raise HTTPException(status_code=409, detail="Already reviewed")
        await session.execute(
            text(
                "UPDATE policy_candidates SET status='rejected', reviewed_by=:rev, reviewed_at=:now "
                "WHERE id=:id"
            ),
            {"rev": reviewer_id, "now": now, "id": candidate_id},
        )
        await session.commit()
    return {"id": candidate_id, "status": "rejected"}



@router.get("")
async def list_candidates(status: str = "pending_review", limit: int = 50):
    valid = {"pending_review", "approved", "rejected"}
    if status not in valid:
        raise HTTPException(status_code=422, detail=f"status must be one of {valid}")
    async with get_session() as session:
        result = await session.execute(
            select(PolicyCandidate)
            .where(PolicyCandidate.status == status)
            .order_by(PolicyCandidate.created_at.desc())
            .limit(min(limit, 200))
        )
        rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "agent_id": r.agent_id,
            "division_id": r.division_id,
            "condition_tree": r.condition_tree or {},
            "action": r.action,
            "rationale": r.rationale,
            "source_threads": r.source_threads or [],
            "status": r.status,
            "reviewed_by": r.reviewed_by,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/{candidate_id}/approve")
async def approve(candidate_id: str, reviewer_id: str = "dashboard"):
    try:
        cid = UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid UUID")
    async with get_session() as session:
        result = await session.execute(
            select(PolicyCandidate).where(PolicyCandidate.id == cid)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        if row.status != "pending_review":
            raise HTTPException(status_code=409, detail="Already reviewed")
        row.status = "approved"
        row.reviewed_by = reviewer_id
        row.reviewed_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(row)
    return {"id": str(row.id), "status": row.status}


@router.post("/{candidate_id}/reject")
async def reject(candidate_id: str, reviewer_id: str = "dashboard"):
    try:
        cid = UUID(candidate_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid UUID")
    async with get_session() as session:
        result = await session.execute(
            select(PolicyCandidate).where(PolicyCandidate.id == cid)
        )
        row = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Not found")
        if row.status != "pending_review":
            raise HTTPException(status_code=409, detail="Already reviewed")
        row.status = "rejected"
        row.reviewed_by = reviewer_id
        row.reviewed_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(row)
    return {"id": str(row.id), "status": row.status}
