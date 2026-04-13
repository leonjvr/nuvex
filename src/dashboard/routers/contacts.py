"""Dashboard contacts router — proxies to brain contact directory endpoints."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from ...brain.routers.contacts import (
    list_contacts as brain_list_contacts,
    get_contact as brain_get_contact,
    get_contact_history as brain_get_contact_history,
)

router = APIRouter(prefix="/api/contacts", tags=["contacts"])


@router.get("")
async def list_contacts(
    org_id: str = "default",
    tier: int | None = Query(None),
    sanction: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    return await brain_list_contacts(
        org_id=org_id, tier=tier, sanction=sanction, limit=limit, offset=offset
    )


@router.get("/{contact_id}")
async def get_contact(contact_id: str) -> dict[str, Any]:
    return await brain_get_contact(contact_id)


@router.get("/{contact_id}/history")
async def get_contact_history(
    contact_id: str,
    limit: int = Query(50, ge=1, le=200),
) -> list[dict[str, Any]]:
    return await brain_get_contact_history(contact_id, limit=limit)
