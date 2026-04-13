"""Dashboard principals router — proxies to brain principals endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any

from ...brain.routers.principals import (
    list_principals as brain_list_principals,
    create_principal as brain_create_principal,
    update_principal as brain_update_principal,
    delete_principal as brain_delete_principal,
    PrincipalCreate,
    PrincipalUpdate,
)

router = APIRouter(prefix="/api/principals", tags=["principals"])


@router.get("")
async def list_principals(org_id: str = "default") -> list[dict]:
    return await brain_list_principals(org_id=org_id)


@router.post("", status_code=201)
async def create_principal(body: PrincipalCreate) -> dict:
    return await brain_create_principal(body)


@router.patch("/{principal_id}")
async def update_principal(principal_id: str, body: PrincipalUpdate) -> dict:
    return await brain_update_principal(principal_id, body)


@router.delete("/{principal_id}", status_code=204, response_model=None)
async def delete_principal(principal_id: str) -> None:
    return await brain_delete_principal(principal_id)
