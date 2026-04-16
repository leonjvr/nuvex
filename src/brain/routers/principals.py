"""GET/POST/PATCH/DELETE /api/principals — manage org principals (owner/admin/operator)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..db import get_session
from ..models.principal import Principal

router = APIRouter(prefix="/principals", tags=["principals"])

VALID_ROLES = {"owner", "admin", "operator"}


class PrincipalCreate(BaseModel):
    org_id: str
    contact_id: str | None = None
    role: str


class PrincipalUpdate(BaseModel):
    role: str | None = None
    contact_id: str | None = None


@router.get("")
async def list_principals(org_id: str = "default") -> list[dict]:
    async with get_session() as session:
        result = await session.execute(
            select(Principal).where(Principal.org_id == org_id)
        )
        rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "org_id": r.org_id,
            "contact_id": r.contact_id,
            "role": r.role,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("", status_code=201)
async def create_principal(body: PrincipalCreate) -> dict:
    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    async with get_session() as session:
        # Enforce one-owner-per-org constraint
        if body.role == "owner":
            result = await session.execute(
                select(Principal).where(
                    Principal.org_id == body.org_id,
                    Principal.role == "owner",
                )
            )
            if result.scalar_one_or_none() is not None:
                raise HTTPException(409, "An owner already exists for this org")

        now = datetime.now(timezone.utc)
        principal = Principal(
            id=str(uuid.uuid4()),
            org_id=body.org_id,
            contact_id=body.contact_id,
            role=body.role,
            created_at=now,
            updated_at=now,
        )
        session.add(principal)
        await session.commit()
        return {"id": principal.id, "org_id": principal.org_id, "role": principal.role}


@router.patch("/{principal_id}")
async def update_principal(principal_id: str, body: PrincipalUpdate) -> dict:
    async with get_session() as session:
        principal = await session.get(Principal, principal_id)
        if principal is None:
            raise HTTPException(404, "Principal not found")

        if body.role is not None:
            if body.role not in VALID_ROLES:
                raise HTTPException(400, f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")
            # Owner uniqueness check when promoting to owner
            if body.role == "owner" and principal.role != "owner":
                result = await session.execute(
                    select(Principal).where(
                        Principal.org_id == principal.org_id,
                        Principal.role == "owner",
                    )
                )
                if result.scalar_one_or_none() is not None:
                    raise HTTPException(409, "An owner already exists for this org")
            principal.role = body.role

        if body.contact_id is not None:
            principal.contact_id = body.contact_id

        principal.updated_at = datetime.now(timezone.utc)
        await session.commit()
        return {"id": principal.id, "role": principal.role}


@router.delete("/{principal_id}", status_code=204, response_model=None)
async def delete_principal(principal_id: str) -> None:
    async with get_session() as session:
        principal = await session.get(Principal, principal_id)
        if principal is None:
            raise HTTPException(404, "Principal not found")
        await session.delete(principal)
        await session.commit()
