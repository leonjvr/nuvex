"""Channel binding CRUD — /api/v1/orgs/{org_id}/channels."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models.channel_binding import ChannelBinding
from .middleware import require_active_org

log = logging.getLogger(__name__)
router = APIRouter(prefix="/orgs", tags=["channels"])


class ChannelBindingOut(BaseModel):
    id: int
    org_id: str
    channel_type: str
    channel_identity: str
    config: dict
    created_at: str

    model_config = {"from_attributes": True}


class ChannelBindingCreate(BaseModel):
    channel_type: str
    channel_identity: str
    config: dict = {}


@router.get("/{org_id}/channels", response_model=list[ChannelBindingOut])
async def list_channels(org_id: str, session: AsyncSession = Depends(get_db)) -> list[ChannelBindingOut]:
    await require_active_org(org_id, session)
    result = await session.execute(
        select(ChannelBinding).where(ChannelBinding.org_id == org_id).order_by(ChannelBinding.id)
    )
    rows = list(result.scalars())
    return [
        ChannelBindingOut(
            id=r.id, org_id=r.org_id, channel_type=r.channel_type,
            channel_identity=r.channel_identity, config=r.config or {},
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


@router.post("/{org_id}/channels", response_model=ChannelBindingOut, status_code=201)
async def create_channel(
    org_id: str, body: ChannelBindingCreate, session: AsyncSession = Depends(get_db)
) -> ChannelBindingOut:
    await require_active_org(org_id, session)
    # Check uniqueness across orgs (channel_type + channel_identity must be globally unique)
    existing = await session.execute(
        select(ChannelBinding).where(
            ChannelBinding.channel_type == body.channel_type,
            ChannelBinding.channel_identity == body.channel_identity,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Channel {body.channel_type}/{body.channel_identity} is already bound to another org",
        )
    binding = ChannelBinding(
        org_id=org_id,
        channel_type=body.channel_type,
        channel_identity=body.channel_identity,
        config=body.config,
    )
    session.add(binding)
    await session.commit()
    await session.refresh(binding)
    return ChannelBindingOut(
        id=binding.id, org_id=binding.org_id, channel_type=binding.channel_type,
        channel_identity=binding.channel_identity, config=binding.config or {},
        created_at=binding.created_at.isoformat(),
    )


@router.delete("/{org_id}/channels/{binding_id}", status_code=204, response_model=None)
async def delete_channel(
    org_id: str, binding_id: int, session: AsyncSession = Depends(get_db)
) -> None:
    await require_active_org(org_id, session)
    binding = await session.get(ChannelBinding, binding_id)
    if binding is None or binding.org_id != org_id:
        raise HTTPException(status_code=404, detail=f"Channel binding {binding_id} not found in org '{org_id}'")
    await session.delete(binding)
    await session.commit()
    return None
