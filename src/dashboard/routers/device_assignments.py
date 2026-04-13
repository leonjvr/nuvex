"""Dashboard: device assignment CRUD — POST/DELETE/GET /agents/{id}/desktop-device, GET /devices."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.devices.models import DesktopAgentAssignment, DesktopDevice
from ...brain.devices.registry import get_registry
from ...shared.config import get_cached_config

router = APIRouter(tags=["device-assignments"])


@router.get("/api/devices")
async def list_devices() -> list[dict]:
    """List all registered desktop devices with live connection status."""
    registry = get_registry()
    async with get_session() as session:
        rows = (await session.execute(select(DesktopDevice))).scalars().all()
        return [
            {
                "id": r.id,
                "name": r.name,
                "platform": r.platform,
                "connected": registry.is_connected(r.id),
                "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
            }
            for r in rows
        ]


class AssignDeviceRequest(BaseModel):
    device_id: str


@router.post("/api/agents/{agent_id}/desktop-device", status_code=201)
async def assign_device(agent_id: str, req: AssignDeviceRequest) -> dict:
    # Validate agent exists in config
    cfg = get_cached_config()
    if agent_id not in cfg.agents:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    async with get_session() as session:
        # Validate device exists
        device = await session.get(DesktopDevice, req.device_id)
        if device is None:
            raise HTTPException(status_code=404, detail=f"Device '{req.device_id}' not found")

        # Check for existing assignment on this device
        existing_for_device = (await session.execute(
            select(DesktopAgentAssignment).where(
                DesktopAgentAssignment.device_id == req.device_id,
                DesktopAgentAssignment.enabled.is_(True),
            )
        )).scalar_one_or_none()
        if existing_for_device and existing_for_device.agent_id != agent_id:
            raise HTTPException(
                status_code=409,
                detail=f"Device '{req.device_id}' already assigned to agent '{existing_for_device.agent_id}'",
            )

        # Upsert assignment
        row = await session.get(DesktopAgentAssignment, agent_id)
        if row is None:
            row = DesktopAgentAssignment(agent_id=agent_id, device_id=req.device_id, enabled=True)
            session.add(row)
        else:
            row.device_id = req.device_id
            row.enabled = True
        await session.commit()

    return {"agent_id": agent_id, "device_id": req.device_id, "enabled": True}


@router.delete("/api/agents/{agent_id}/desktop-device", status_code=204, response_class=Response)
async def remove_device(agent_id: str) -> Response:
    async with get_session() as session:
        row = await session.get(DesktopAgentAssignment, agent_id)
        if row is None:
            raise HTTPException(status_code=404, detail="No desktop device assigned")
        row.enabled = False
        await session.commit()
    return Response(status_code=204)


@router.get("/api/agents/{agent_id}/desktop-device")
async def get_device_assignment(agent_id: str) -> dict:
    async with get_session() as session:
        row = await session.get(DesktopAgentAssignment, agent_id)
        if row is None or not row.enabled:
            return {"agent_id": agent_id, "device_id": None, "enabled": False}
        device = await session.get(DesktopDevice, row.device_id)
        return {
            "agent_id": agent_id,
            "device_id": row.device_id,
            "enabled": row.enabled,
            "device_name": device.name if device else None,
            "device_platform": device.platform if device else None,
            "device_connected": device.is_connected if device else False,
        }
