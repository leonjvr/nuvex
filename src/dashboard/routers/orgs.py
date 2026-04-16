"""Dashboard orgs router — list, create, update, and archive organisations."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.models.organisation import Organisation
from ...shared.models.organisation import (
    Organisation as OrgSchema,
    OrganisationCreate,
    OrganisationUpdate,
    validate_status_transition,
)

router = APIRouter(prefix="/api/orgs", tags=["orgs"])


def _to_schema(org: Organisation) -> OrgSchema:
    return OrgSchema.model_validate(org)


@router.get("", response_model=list[OrgSchema])
async def list_orgs():
    async with get_session() as session:
        result = await session.execute(
            select(Organisation).order_by(Organisation.created_at)
        )
        return [_to_schema(row) for row in result.scalars().all()]


@router.post("", status_code=201, response_model=OrgSchema)
async def create_org(body: OrganisationCreate):
    async with get_session() as session:
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


@router.get("/{org_id}", response_model=OrgSchema)
async def get_org(org_id: str):
    async with get_session() as session:
        org = await session.get(Organisation, org_id)
        if org is None:
            raise HTTPException(status_code=404, detail=f"Organisation '{org_id}' not found")
        return _to_schema(org)


@router.put("/{org_id}", response_model=OrgSchema)
async def update_org(org_id: str, body: OrganisationUpdate):
    async with get_session() as session:
        org = await session.get(Organisation, org_id)
        if org is None:
            raise HTTPException(status_code=404, detail=f"Organisation '{org_id}' not found")
        if body.name is not None:
            org.name = body.name
        if body.status is not None:
            validate_status_transition(org.status, body.status)
            org.status = body.status
        if body.config is not None:
            org.config = body.config
        if body.policies is not None:
            org.policies = body.policies
        if body.communication_links is not None:
            org.communication_links = body.communication_links
        await session.commit()
        await session.refresh(org)
        return _to_schema(org)


@router.delete("/{org_id}", status_code=204, response_class=Response)
async def archive_org(org_id: str) -> Response:
    async with get_session() as session:
        org = await session.get(Organisation, org_id)
        if org is None:
            raise HTTPException(status_code=404, detail=f"Organisation '{org_id}' not found")
        validate_status_transition(org.status, "archived")
        org.status = "archived"
        await session.commit()
    return Response(status_code=204)
