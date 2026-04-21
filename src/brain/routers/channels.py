"""Channel binding CRUD — /api/v1/orgs/{org_id}/channels."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models.agent import Agent
from ..models.channel_binding import ChannelBinding
from .middleware import require_active_org

log = logging.getLogger(__name__)
router = APIRouter(prefix="/orgs", tags=["channels"])


class ChannelBindingOut(BaseModel):
    id: int
    org_id: str
    agent_id: str | None = None
    channel_type: str
    channel_identity: str
    config: dict
    created_at: str

    model_config = {"from_attributes": True}


class ChannelBindingCreate(BaseModel):
    agent_id: str | None = None
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
            id=r.id, org_id=r.org_id, agent_id=r.agent_id, channel_type=r.channel_type,
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
    if body.agent_id:
        _agent = await session.get(Agent, body.agent_id)
        if _agent is None or _agent.org_id != org_id:
            raise HTTPException(status_code=404, detail=f"Agent '{body.agent_id}' not found in org '{org_id}'")

    if body.channel_type == "whatsapp" and not body.agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required for whatsapp channel bindings")

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

    if body.agent_id:
        existing_agent_channel = await session.execute(
            select(ChannelBinding.id).where(
                ChannelBinding.org_id == org_id,
                ChannelBinding.agent_id == body.agent_id,
                ChannelBinding.channel_type == body.channel_type,
            ).limit(1)
        )
        if existing_agent_channel.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=409,
                detail=f"Agent '{body.agent_id}' already has a {body.channel_type} binding in org '{org_id}'",
            )

    binding = ChannelBinding(
        org_id=org_id,
        agent_id=body.agent_id,
        channel_type=body.channel_type,
        channel_identity=body.channel_identity,
        config=body.config,
    )
    session.add(binding)
    await session.commit()
    await session.refresh(binding)
    return ChannelBindingOut(
        id=binding.id, org_id=binding.org_id, agent_id=binding.agent_id, channel_type=binding.channel_type,
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
