"""CRUD endpoints for organisations — /api/v1/orgs."""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...brain.db import get_db
from ...brain.models.organisation import Organisation
from ...shared.models.organisation import (
    Organisation as OrgSchema,
    OrganisationCreate,
    OrganisationUpdate,
    validate_status_transition,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/orgs", tags=["orgs"])


async def _get_org_or_404(org_id: str, session: AsyncSession) -> Organisation:
    org = await session.get(Organisation, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail=f"Organisation '{org_id}' not found")
    return org


def _to_schema(org: Organisation) -> OrgSchema:
    return OrgSchema.model_validate(org)


@router.post("", status_code=201, response_model=OrgSchema)
async def create_org(body: OrganisationCreate, session: AsyncSession = Depends(get_db)) -> OrgSchema:
    existing = await session.get(Organisation, body.org_id)
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Organisation '{body.org_id}' already exists")
    org = Organisation(
        org_id=body.org_id,
        name=body.name,
        status="active",
        config=body.config,
        policies=body.policies,
        communication_links=body.communication_links,
    )
    session.add(org)
    await session.commit()
    await session.refresh(org)
    return _to_schema(org)


@router.get("", response_model=list[OrgSchema])
async def list_orgs(session: AsyncSession = Depends(get_db)) -> list[OrgSchema]:
    result = await session.execute(select(Organisation).order_by(Organisation.created_at))
    return [_to_schema(row) for row in result.scalars().all()]


@router.get("/{org_id}", response_model=OrgSchema)
async def get_org(org_id: str, session: AsyncSession = Depends(get_db)) -> OrgSchema:
    org = await _get_org_or_404(org_id, session)
    return _to_schema(org)


@router.put("/{org_id}", response_model=OrgSchema)
async def update_org(
    org_id: str, body: OrganisationUpdate, session: AsyncSession = Depends(get_db)
) -> OrgSchema:
    org = await _get_org_or_404(org_id, session)
    if body.name is not None:
        org.name = body.name
    if body.config is not None:
        org.config = body.config
    if body.policies is not None:
        org.policies = body.policies
    if body.communication_links is not None:
        org.communication_links = body.communication_links
    if body.status is not None:
        if not validate_status_transition(org.status, body.status):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status transition: {org.status!r} → {body.status!r}",
            )
        org.status = body.status
    org.updated_at = datetime.utcnow()
    await session.commit()
    await session.refresh(org)
    return _to_schema(org)


@router.delete("/{org_id}", status_code=204, response_model=None)
async def archive_org(org_id: str, session: AsyncSession = Depends(get_db)) -> None:
    org = await _get_org_or_404(org_id, session)
    if org.status == "archived":
        return None
    if not validate_status_transition(org.status, "archived"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot archive org with status {org.status!r}; suspend first",
        )
    org.status = "archived"
    org.updated_at = datetime.utcnow()
    await session.commit()
    return None


@router.get("/{org_id}/policies")
async def get_org_policies(org_id: str, session: AsyncSession = Depends(get_db)) -> dict:
    org = await _get_org_or_404(org_id, session)
    return org.policies or {}


@router.put("/{org_id}/policies")
async def update_org_policies(
    org_id: str, policies: dict, session: AsyncSession = Depends(get_db)
) -> dict:
    org = await _get_org_or_404(org_id, session)
    org.policies = policies
    org.updated_at = datetime.utcnow()
    await session.commit()
    return org.policies or {}
