"""Work packet GET endpoints — /api/v1/orgs/{org_id}/packets (§11.10)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models.work_packet import WorkPacket
from .middleware import require_active_org

log = logging.getLogger(__name__)
router = APIRouter(prefix="/orgs", tags=["work-packets"])


class WorkPacketOut(BaseModel):
    id: str
    source_org_id: str
    target_org_id: str
    packet_type: str
    status: str
    mode: str
    result: dict | None
    error: str | None
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


def _to_out(p: WorkPacket) -> WorkPacketOut:
    return WorkPacketOut(
        id=p.id,
        source_org_id=p.source_org_id,
        target_org_id=p.target_org_id,
        packet_type=p.packet_type,
        status=p.status,
        mode=p.mode,
        result=p.result,
        error=p.error,
        created_at=p.created_at.isoformat(),
        updated_at=p.updated_at.isoformat(),
    )


@router.get("/{org_id}/packets", response_model=list[WorkPacketOut])
async def list_packets(
    org_id: str,
    status: str | None = None,
    limit: int = 50,
    session: AsyncSession = Depends(get_db),
) -> list[WorkPacketOut]:
    """List outbound or inbound work packets for this org."""
    await require_active_org(org_id, session)
    if limit < 1 or limit > 500:
        raise HTTPException(status_code=422, detail="limit must be 1-500")
    from sqlalchemy import or_
    q = select(WorkPacket).where(
        or_(WorkPacket.source_org_id == org_id, WorkPacket.target_org_id == org_id)
    ).order_by(WorkPacket.created_at.desc()).limit(limit)
    if status:
        q = q.where(WorkPacket.status == status)
    result = await session.execute(q)
    return [_to_out(p) for p in result.scalars()]


@router.get("/{org_id}/packets/{packet_id}", response_model=WorkPacketOut)
async def get_packet(
    org_id: str, packet_id: str, session: AsyncSession = Depends(get_db)
) -> WorkPacketOut:
    """Get a single work packet status."""
    await require_active_org(org_id, session)
    packet = await session.get(WorkPacket, packet_id)
    if packet is None or (packet.source_org_id != org_id and packet.target_org_id != org_id):
        raise HTTPException(status_code=404, detail=f"Packet '{packet_id}' not found for org '{org_id}'")
    return _to_out(packet)
