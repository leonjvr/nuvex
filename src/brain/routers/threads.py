"""Thread management routes — list, get, create, compact, agent status."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..compaction import maybe_compact
from ..db import get_session
from ..lifecycle import get_agent_state
from ..models.thread import Message, Thread

router = APIRouter(prefix="/threads", tags=["threads"])


class ThreadOut(BaseModel):
    id: str
    agent_id: str
    channel: str
    participants: dict
    message_count: int
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: int
    thread_id: str
    role: str
    content: str
    tokens: int
    created_at: str

    model_config = {"from_attributes": True}


class ThreadCreate(BaseModel):
    id: str
    agent_id: str
    channel: str
    participants: dict = {}


@router.get("", response_model=list[ThreadOut])
async def list_threads(agent_id: str | None = None, limit: int = 50) -> list[ThreadOut]:
    """List threads, optionally filtered by agent_id."""
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 500")
    async with get_session() as session:
        q = select(Thread).order_by(Thread.updated_at.desc()).limit(limit)
        if agent_id:
            q = q.where(Thread.agent_id == agent_id)
        result = await session.execute(q)
        rows = list(result.scalars())
    return [
        ThreadOut(
            id=r.id,
            agent_id=r.agent_id,
            channel=r.channel,
            participants=r.participants,
            message_count=r.message_count,
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat(),
        )
        for r in rows
    ]


@router.post("", response_model=ThreadOut, status_code=201)
async def create_thread(body: ThreadCreate) -> ThreadOut:
    """Create a new thread (idempotent — returns existing if id already exists)."""
    async with get_session() as session:
        existing = await session.get(Thread, body.id)
        if existing:
            return ThreadOut(
                id=existing.id,
                agent_id=existing.agent_id,
                channel=existing.channel,
                participants=existing.participants,
                message_count=existing.message_count,
                created_at=existing.created_at.isoformat(),
                updated_at=existing.updated_at.isoformat(),
            )
        thread = Thread(
            id=body.id,
            agent_id=body.agent_id,
            channel=body.channel,
            participants=body.participants,
        )
        session.add(thread)
        await session.commit()
        await session.refresh(thread)
    return ThreadOut(
        id=thread.id,
        agent_id=thread.agent_id,
        channel=thread.channel,
        participants=thread.participants,
        message_count=thread.message_count,
        created_at=thread.created_at.isoformat(),
        updated_at=thread.updated_at.isoformat(),
    )


@router.get("/{thread_id}", response_model=ThreadOut)
async def get_thread(thread_id: str) -> ThreadOut:
    """Retrieve a thread by ID."""
    async with get_session() as session:
        row = await session.get(Thread, thread_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Thread '{thread_id}' not found")
    return ThreadOut(
        id=row.id,
        agent_id=row.agent_id,
        channel=row.channel,
        participants=row.participants,
        message_count=row.message_count,
        created_at=row.created_at.isoformat(),
        updated_at=row.updated_at.isoformat(),
    )


@router.get("/{thread_id}/messages", response_model=list[MessageOut])
async def list_thread_messages(thread_id: str, limit: int = 100) -> list[MessageOut]:
    """Return messages for a thread, oldest first."""
    if limit < 1 or limit > 1000:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 1000")
    async with get_session() as session:
        thread = await session.get(Thread, thread_id)
        if thread is None:
            raise HTTPException(status_code=404, detail=f"Thread '{thread_id}' not found")
        result = await session.execute(
            select(Message)
            .where(Message.thread_id == thread_id)
            .order_by(Message.id.asc())
            .limit(limit)
        )
        rows = list(result.scalars())
    return [
        MessageOut(
            id=r.id,
            thread_id=r.thread_id,
            role=r.role,
            content=r.content,
            tokens=r.tokens,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]



@router.post("/{thread_id}/compact")
async def compact_thread(thread_id: str) -> dict:
    """Manually trigger compaction for a specific thread."""
    try:
        compacted = await maybe_compact(thread_id, token_limit=1)  # force
        return {"thread_id": thread_id, "compacted": compacted}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/agents/{agent_id}/status")
async def agent_status(agent_id: str) -> dict:
    """Return the current lifecycle state of an agent."""
    state = await get_agent_state(agent_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    return {"agent_id": agent_id, "lifecycle_state": state}


# ---------------------------------------------------------------------------
# §6.4 — Org-scoped thread endpoints: /api/v1/orgs/{org_id}/threads
# ---------------------------------------------------------------------------

org_threads_router = APIRouter(prefix="/orgs", tags=["orgs-threads"])


@org_threads_router.get("/{org_id}/threads", response_model=list[ThreadOut])
async def list_org_threads(org_id: str, agent_id: str | None = None, limit: int = 50) -> list[ThreadOut]:
    """List threads scoped to an organisation with optional agent_id filter."""
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 500")
    async with get_session() as session:
        from .middleware import require_active_org
        await require_active_org(org_id, session)
        # Threads scoped by org via thread_id prefix (org_id:agent_id:...)
        q = (
            select(Thread)
            .where(Thread.id.like(f"{org_id}:%"))
            .order_by(Thread.updated_at.desc())
            .limit(limit)
        )
        if agent_id:
            q = q.where(Thread.agent_id == agent_id)
        result = await session.execute(q)
        rows = list(result.scalars())
    return [
        ThreadOut(
            id=r.id,
            agent_id=r.agent_id,
            channel=r.channel,
            participants=r.participants,
            message_count=r.message_count,
            created_at=r.created_at.isoformat(),
            updated_at=r.updated_at.isoformat(),
        )
        for r in rows
    ]
