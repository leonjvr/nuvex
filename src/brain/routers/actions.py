"""Actions queue router — cross-channel action polling and acknowledgement."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select, update

from ..db import get_session
from ..models.actions import ActionQueue

log = logging.getLogger(__name__)
router = APIRouter(prefix="/actions", tags=["actions"])

# Maximum actions returned per poll call
_MAX_POLL = 50


@router.get("/pending")
async def get_pending_actions(
    channel: str = Query(..., description="Target channel to filter actions for"),
    limit: int = Query(20, ge=1, le=_MAX_POLL),
) -> list[dict[str, Any]]:
    """Return pending outbound actions for the given channel.

    Used by gateway pollers (WhatsApp, Telegram) to pull queued outbound messages.
    """
    async with get_session() as session:
        result = await session.execute(
            select(ActionQueue)
            .where(ActionQueue.target_channel == channel)
            .where(ActionQueue.status == "pending")
            .order_by(ActionQueue.created_at)
            .limit(limit)
        )
        rows = result.scalars().all()

    return [
        {
            "id": str(row.id),
            "agent_id": row.agent_id,
            "action_type": row.action_type,
            "target_channel": row.target_channel,
            "payload": row.payload,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]


@router.post("/{action_id}/ack")
async def ack_action(
    action_id: str,
    status: str = Query("sent", description="'sent' or 'failed'"),
    error: str | None = Query(None, description="Error message for failed deliveries"),
) -> dict[str, str]:
    """Mark an action as delivered or failed.

    Called by the gateway after attempting to send the action.
    """
    if status not in ("sent", "failed"):
        raise HTTPException(status_code=400, detail="status must be 'sent' or 'failed'")

    try:
        action_uuid = uuid.UUID(action_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid action_id UUID") from exc

    async with get_session() as session:
        result = await session.execute(
            select(ActionQueue).where(ActionQueue.id == action_uuid)
        )
        row: ActionQueue | None = result.scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=404, detail="Action not found")

        row.status = status
        row.error = error
        row.processed_at = datetime.now(timezone.utc)
        await session.commit()

    log.info("action ack: id=%s status=%s", action_id, status)
    return {"id": action_id, "status": status}
