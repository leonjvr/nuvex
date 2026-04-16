"""Dashboard: device token issuance and revocation."""
from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.devices.models import DesktopDevice, DesktopDeviceToken
from ...brain.devices.registry import get_registry

router = APIRouter(prefix="/api/device-tokens", tags=["device-tokens"])


class CreateTokenRequest(BaseModel):
    name: str = ""
    created_by: str | None = None


@router.post("", status_code=201)
async def create_token(req: CreateTokenRequest) -> dict:
    """Create a new device token. Returns plaintext once — not stored."""
    plaintext = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(plaintext.encode()).hexdigest()
    token_id = str(uuid.uuid4())

    async with get_session() as session:
        row = DesktopDeviceToken(
            id=token_id,
            token_hash=token_hash,
            device_id=None,
            created_by=req.created_by or req.name or None,
            created_at=datetime.now(timezone.utc),
        )
        session.add(row)
        await session.commit()

    return {
        "id": token_id,
        "token": plaintext,  # only time plaintext is returned
        "token_hash": token_hash,
        "created_by": req.created_by,
    }


@router.get("")
async def list_tokens() -> list[dict]:
    async with get_session() as session:
        rows = (await session.execute(select(DesktopDeviceToken))).scalars().all()
        result = []
        for r in rows:
            device_name: str | None = None
            if r.device_id:
                device = await session.get(DesktopDevice, r.device_id)
                if device:
                    device_name = device.name
            result.append({
                "id": r.id,
                "device_id": r.device_id,
                "device_name": device_name,
                "created_by": r.created_by,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "revoked_at": r.revoked_at.isoformat() if r.revoked_at else None,
                "status": "revoked" if r.revoked_at else "active",
            })
        return result


@router.delete("/{token_id}", status_code=204, response_class=Response)
async def revoke_token(token_id: str) -> Response:
    async with get_session() as session:
        row = await session.get(DesktopDeviceToken, token_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Token not found")
        if row.revoked_at:
            return Response(status_code=204)  # already revoked, idempotent
        row.revoked_at = datetime.now(timezone.utc)
        await session.commit()

    # Disconnect device if connected
    if row.device_id:
        registry = get_registry()
        ws = registry.get(row.device_id)
        if ws:
            try:
                await ws.close(code=4001, reason="token_revoked")
            except Exception:
                pass
            registry.unregister(row.device_id)
    return Response(status_code=204)
