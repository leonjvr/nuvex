"""Dashboard threads + messages router."""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.models.thread import Message, Thread

_BRAIN_URL = os.environ.get("BRAIN_URL", "http://brain:8100")

router = APIRouter(prefix="/api/threads", tags=["threads"])


@router.get("")
async def list_threads(
    agent_id: str | None = Query(None),
    channel: str | None = Query(None),
    limit: int = Query(50, le=500),
    offset: int = Query(0),
):
    async with get_session() as session:
        q = select(Thread).order_by(Thread.created_at.desc())
        if agent_id:
            q = q.where(Thread.agent_id == agent_id)
        if channel:
            q = q.where(Thread.channel == channel)
        q = q.offset(offset).limit(limit)
        result = await session.execute(q)
        rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "agent_id": r.agent_id,
            "channel": r.channel,
            "message_count": r.message_count,
            "participants": r.participants or {},
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
            "last_compacted_at": r.last_compacted_at.isoformat() if r.last_compacted_at else None,
        }
        for r in rows
    ]


@router.get("/{thread_id}/messages")
async def thread_messages(thread_id: str, limit: int = Query(100, le=1000)):
    async with get_session() as session:
        t_res = await session.execute(select(Thread).where(Thread.id == thread_id))
        thread = t_res.scalar_one_or_none()
        if thread is None:
            return []  # Thread may not be persisted yet — return empty, not 404

        m_res = await session.execute(
            select(Message)
            .where(Message.thread_id == thread_id)
            .order_by(Message.created_at)
            .limit(limit)
        )
        messages = m_res.scalars().all()

    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "tokens": m.tokens,
            "metadata": m.metadata_ or {},
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ]


@router.get("/{thread_id}/trace")
async def thread_trace(thread_id: str):
    """Proxy the LangGraph checkpoint trace from brain."""
    url = f"{_BRAIN_URL}/threads/{thread_id}/trace"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
    except httpx.RequestError as exc:
        raise HTTPException(status_code=503, detail=f"Brain unreachable: {exc}") from exc
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Thread not found in checkpoint")
    if not resp.is_success:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    return resp.json()


# ── Bulk-sync: gateway sends known chats on connect ───────────────────────────

class ChatSyncItem(BaseModel):
    thread_id: str
    agent_id: str
    channel: str
    contact: str
    display_name: str | None = None
    is_group: bool = False


class BulkSyncPayload(BaseModel):
    chats: list[ChatSyncItem]


@router.post("/bulk-sync")
async def bulk_sync_chats(payload: BulkSyncPayload):
    """Create Thread stubs for chats the gateway already knows about.

    Called by WA/TG gateways on connect.  Idempotent — existing threads are
    left untouched; only missing ones are inserted.
    """
    inserted = 0
    from ...brain.models.agent import Agent
    from ...brain.routers.invoke import _ensure_agent_row  # type: ignore[attr-defined]

    async with get_session() as session:
        for item in payload.chats:
            # skip if thread already exists
            existing = await session.get(Thread, item.thread_id)
            if existing:
                continue
            # ensure agent row
            await _ensure_agent_row(session, item.agent_id)
            participants: dict = {item.contact: {"role": "user"}}
            if item.display_name:
                participants[item.contact]["display_name"] = item.display_name
            session.add(Thread(
                id=item.thread_id,
                agent_id=item.agent_id,
                channel=item.channel,
                participants=participants,
                message_count=0,
            ))
            inserted += 1
        await session.commit()
    return {"inserted": inserted, "total": len(payload.chats)}
