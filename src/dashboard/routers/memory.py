"""Dashboard memory management routes (Section 28.8)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select, text

from ...brain.db import get_session
from ...brain.models.memory import Memory
from ...brain.models.memory_promotion import MemoryPromotion

router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryOut(BaseModel):
    id: int
    agent_id: str
    content: str
    scope: str
    owner_id: str
    confidence: float
    source_agent: str | None
    source_thread: str | None
    access_tier: int
    promoted_from: int | None
    approved_by: str | None
    retrieval_count: int
    created_at: str
    expires_at: str | None

    model_config = {"from_attributes": True}


class PromotionOut(BaseModel):
    id: int
    source_memory_id: int
    target_scope: str
    requested_by: str
    requested_at: str
    approved_by: str | None
    approved_at: str | None
    status: str

    model_config = {"from_attributes": True}


@router.get("", response_model=list[MemoryOut])
async def list_memories(
    agent_id: str | None = None,
    scope: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[MemoryOut]:
    """List all memories with optional agent/scope filters."""
    async with get_session() as session:
        q = select(Memory).order_by(Memory.created_at.desc()).limit(limit).offset(offset)
        if agent_id:
            q = q.where(Memory.agent_id == agent_id)
        if scope:
            q = q.where(Memory.scope == scope)
        result = await session.execute(q)
        rows = result.scalars().all()
    return [
        MemoryOut(
            id=r.id,
            agent_id=r.agent_id,
            content=r.content,
            scope=r.scope,
            owner_id=r.owner_id,
            confidence=r.confidence,
            source_agent=r.source_agent,
            source_thread=r.source_thread,
            access_tier=r.access_tier,
            promoted_from=r.promoted_from,
            approved_by=r.approved_by,
            retrieval_count=r.retrieval_count,
            created_at=r.created_at.isoformat(),
            expires_at=r.expires_at.isoformat() if r.expires_at else None,
        )
        for r in rows
    ]


@router.get("/pending-approvals", response_model=list[PromotionOut])
async def list_pending_approvals() -> list[PromotionOut]:
    """List all pending org-scope promotion requests (T1 approval required)."""
    async with get_session() as session:
        result = await session.execute(
            select(MemoryPromotion)
            .where(MemoryPromotion.status == "pending")
            .order_by(MemoryPromotion.requested_at.desc())
        )
        rows = result.scalars().all()
    return [
        PromotionOut(
            id=r.id,
            source_memory_id=r.source_memory_id,
            target_scope=r.target_scope,
            requested_by=r.requested_by,
            requested_at=r.requested_at.isoformat(),
            approved_by=r.approved_by,
            approved_at=r.approved_at.isoformat() if r.approved_at else None,
            status=r.status,
        )
        for r in rows
    ]


@router.get("/stats/summary")
async def memory_stats() -> dict[str, Any]:
    """Aggregate stats: counts by scope per agent, recent consolidations, avg token estimate."""
    async with get_session() as session:
        # Counts by agent + scope
        scope_result = await session.execute(
            text("""
                SELECT agent_id, scope, COUNT(*) AS cnt
                FROM memories
                GROUP BY agent_id, scope
                ORDER BY agent_id, scope
            """)
        )
        scope_rows = scope_result.mappings().all()

        # Recent consolidations (memories that have a source_thread set — produced by consolidator)
        consol_result = await session.execute(
            text("""
                SELECT id, agent_id, content, scope, confidence, source_thread, created_at
                FROM memories
                WHERE source_thread IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 20
            """)
        )
        consol_rows = consol_result.mappings().all()

        # Avg token estimate per memory (approx content_length / 4)
        token_result = await session.execute(
            text("""
                SELECT agent_id,
                       ROUND(AVG(LENGTH(content) / 4.0), 1) AS avg_tokens_per_memory,
                       SUM(retrieval_count) AS total_retrievals
                FROM memories
                GROUP BY agent_id
            """)
        )
        token_rows = token_result.mappings().all()

    counts_by_agent: dict[str, dict[str, int]] = {}
    for r in scope_rows:
        agent = r["agent_id"]
        if agent not in counts_by_agent:
            counts_by_agent[agent] = {}
        counts_by_agent[agent][r["scope"]] = int(r["cnt"])

    token_map = {
        r["agent_id"]: {
            "avg_tokens_per_memory": float(r["avg_tokens_per_memory"] or 0),
            "total_retrievals": int(r["total_retrievals"] or 0),
        }
        for r in token_rows
    }

    return {
        "counts_by_agent": counts_by_agent,
        "token_stats": token_map,
        "recent_consolidations": [
            {
                "id": r["id"],
                "agent_id": r["agent_id"],
                "content": r["content"][:120],
                "scope": r["scope"],
                "confidence": float(r["confidence"]),
                "source_thread": r["source_thread"],
                "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
            }
            for r in consol_rows
        ],
    }


@router.get("/edges")
async def list_memory_edges(
    agent_id: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Return memory edges (relationships) with source/target memory content inline."""
    async with get_session() as session:
        agent_filter = "AND e.agent_id = :agent_id" if agent_id else ""
        result = await session.execute(
            text(f"""
                SELECT
                    e.id,
                    e.source_id,
                    e.target_id,
                    e.edge_type,
                    e.confidence,
                    e.agent_id,
                    e.created_at,
                    src.content  AS source_content,
                    src.scope    AS source_scope,
                    tgt.content  AS target_content,
                    tgt.scope    AS target_scope
                FROM memory_edges e
                JOIN memories src ON src.id = e.source_id
                JOIN memories tgt ON tgt.id = e.target_id
                WHERE 1=1 {agent_filter}
                ORDER BY e.created_at DESC
                LIMIT :limit
            """),
            {"limit": limit, **({"agent_id": agent_id} if agent_id else {})},
        )
        rows = result.mappings().all()
    return [
        {
            "id": r["id"],
            "source_id": r["source_id"],
            "target_id": r["target_id"],
            "edge_type": r["edge_type"],
            "confidence": float(r["confidence"]),
            "agent_id": r["agent_id"],
            "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
            "source_content": str(r["source_content"])[:150],
            "source_scope": r["source_scope"],
            "target_content": str(r["target_content"])[:150],
            "target_scope": r["target_scope"],
        }
        for r in rows
    ]


@router.get("/dream-log")
async def list_dream_log() -> list[dict[str, Any]]:
    """Return per-agent dream state: last dream, thread count, total dreams."""
    async with get_session() as session:
        result = await session.execute(
            text("""
                SELECT agent_id, last_dream_at, threads_since_dream, dream_count, updated_at
                FROM memory_dream_log
                ORDER BY agent_id
            """)
        )
        rows = result.mappings().all()
    return [
        {
            "agent_id": r["agent_id"],
            "last_dream_at": r["last_dream_at"].isoformat() if r["last_dream_at"] else None,
            "threads_since_dream": int(r["threads_since_dream"]),
            "dream_count": int(r["dream_count"]),
        }
        for r in rows
    ]


@router.get("/{memory_id}", response_model=MemoryOut)
async def get_memory(memory_id: int) -> MemoryOut:
    """Get a single memory entry by ID."""
    async with get_session() as session:
        result = await session.execute(
            select(Memory).where(Memory.id == memory_id)
        )
        row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Memory not found")
    return MemoryOut(
        id=row.id,
        agent_id=row.agent_id,
        content=row.content,
        scope=row.scope,
        owner_id=row.owner_id,
        confidence=row.confidence,
        source_agent=row.source_agent,
        source_thread=row.source_thread,
        access_tier=row.access_tier,
        promoted_from=row.promoted_from,
        approved_by=row.approved_by,
        retrieval_count=row.retrieval_count,
        created_at=row.created_at.isoformat(),
        expires_at=row.expires_at.isoformat() if row.expires_at else None,
    )


@router.delete("/{memory_id}")
async def delete_memory(memory_id: int) -> Response:
    """Delete a memory entry."""
    async with get_session() as session:
        result = await session.execute(
            select(Memory).where(Memory.id == memory_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Memory not found")
        await session.delete(row)
        await session.commit()
    return Response(status_code=204)


@router.post("/{memory_id}/promote", status_code=202)
async def promote_memory(memory_id: int, target_scope: str = "division") -> dict[str, Any]:
    """Request promotion of a memory to a higher scope."""
    if target_scope not in ("division", "org"):
        raise HTTPException(status_code=400, detail="target_scope must be 'division' or 'org'")

    async with get_session() as session:
        result = await session.execute(
            select(Memory).where(Memory.id == memory_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail="Memory not found")

    try:
        from ...brain.memory.promoter import MemoryPromoter
        promoter = MemoryPromoter(requesting_agent_id=row.source_agent or row.agent_id)
        if target_scope == "division":
            success = await promoter.promote_personal_to_division(memory_id, row.owner_id)
        else:
            await promoter.request_org_promotion(memory_id)
            success = True
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"memory_id": memory_id, "target_scope": target_scope, "promoted": True}
