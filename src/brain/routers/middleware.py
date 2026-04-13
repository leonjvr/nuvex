"""Org validation FastAPI dependency — ensures org exists and is active (§6.5)."""
from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..models.organisation import Organisation


async def require_active_org(
    org_id: str,
    session: AsyncSession = Depends(get_db),
) -> Organisation:
    """FastAPI dependency — raise 404/403 if org doesn't exist or is not active."""
    org = await session.get(Organisation, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail=f"Organisation '{org_id}' not found")
    if org.status == "suspended":
        raise HTTPException(status_code=403, detail=f"Organisation '{org_id}' is suspended")
    if org.status == "archived":
        raise HTTPException(status_code=403, detail=f"Organisation '{org_id}' is archived")
    return org
