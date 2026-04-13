"""POST /devices/register, WS /devices/{device_id}/ws, GET /devices."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from sqlalchemy import select

from ..db import get_session
from ..devices.models import DesktopDevice, DesktopDeviceToken
from ..devices.registry import get_registry
from ..devices.queue import get_queue_manager

log = logging.getLogger(__name__)
router = APIRouter(prefix="/devices", tags=["devices"])

HEARTBEAT_INTERVAL = 30  # seconds
HEARTBEAT_TIMEOUT = 90   # seconds


class RegisterRequest(BaseModel):
    token: str
    device_name: str = ""
    platform: str = "windows"


class RegisterResponse(BaseModel):
    device_id: str
    session_key: str


@router.post("/register", response_model=RegisterResponse)
async def register_device(req: RegisterRequest) -> RegisterResponse:
    token_hash = hashlib.sha256(req.token.encode()).hexdigest()
    async with get_session() as session:
        row = (await session.execute(
            select(DesktopDeviceToken).where(
                DesktopDeviceToken.token_hash == token_hash,
                DesktopDeviceToken.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=401, detail="Invalid or revoked token")

        device_id = row.device_id or str(uuid.uuid4())
        if row.device_id is None:
            row.device_id = device_id

        existing = await session.get(DesktopDevice, device_id)
        if existing is None:
            session.add(DesktopDevice(
                id=device_id,
                name=req.device_name or f"device-{device_id[:8]}",
                platform=req.platform,
                owner=row.created_by,
                last_seen_at=datetime.now(timezone.utc),
                is_connected=False,
            ))
        else:
            existing.last_seen_at = datetime.now(timezone.utc)
            if req.device_name:
                existing.name = req.device_name
        await session.commit()

    session_key = str(uuid.uuid4())
    return RegisterResponse(device_id=device_id, session_key=session_key)


@router.websocket("/{device_id}/ws")
async def device_ws(device_id: str, websocket: WebSocket) -> None:
    """WebSocket endpoint for persistent device connection."""
    await websocket.accept()
    registry = get_registry()
    queue = get_queue_manager()

    async with get_session() as session:
        device = await session.get(DesktopDevice, device_id)
        if device is None:
            await websocket.close(code=4004, reason="Device not registered")
            return
        device.is_connected = True
        device.last_seen_at = datetime.now(timezone.utc)
        await session.commit()

    registry.register(device_id, websocket)
    _publish_event("desktop.device.connected", {"device_id": device_id})

    # Drain queued tasks to device
    await _drain_queue(device_id, websocket, queue)

    try:
        await _ws_loop(device_id, websocket, registry, queue)
    except WebSocketDisconnect:
        log.info("devices: device %s disconnected", device_id)
    except Exception as exc:
        log.warning("devices: device %s error: %s", device_id, exc)
    finally:
        registry.unregister(device_id)
        await _mark_disconnected(device_id)
        _publish_event("desktop.device.disconnected", {"device_id": device_id})


async def _drain_queue(device_id: str, ws: WebSocket, queue) -> None:
    pending = await queue.dequeue_for_device(device_id)
    if not pending:
        return
    tasks = [{"call_id": t.call_id, "tool": t.tool_name, "args": t.payload.get("args", {})} for t in pending]
    try:
        await ws.send_json({"type": "queue_drain", "tasks": tasks})
        for t in pending:
            await queue.update_status(t.id, "dispatched")
    except Exception as exc:
        log.warning("devices: queue_drain to %s failed: %s", device_id, exc)


async def _ws_loop(device_id: str, ws: WebSocket, registry, queue) -> None:
    last_pong = asyncio.get_running_loop().time()

    async def _ping_task() -> None:
        nonlocal last_pong
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            if asyncio.get_running_loop().time() - last_pong > HEARTBEAT_TIMEOUT:
                log.warning("devices: heartbeat timeout for %s", device_id)
                await ws.close(code=1001)
                return
            await ws.send_json({"type": "heartbeat"})

    ping_task = asyncio.create_task(_ping_task())
    try:
        async for message in ws.iter_json():
            await _handle_message(device_id, message, registry, queue)
            if message.get("type") == "heartbeat":
                last_pong = asyncio.get_running_loop().time()
    finally:
        ping_task.cancel()


async def _handle_message(device_id: str, msg: dict, registry, queue) -> None:
    msg_type = msg.get("type")
    call_id = msg.get("call_id")

    if msg_type == "tool_result":
        result = msg.get("result", {})
        registry.resolve_result(call_id, result)
        if call_id:
            await queue.update_status_by_call_id(call_id, "succeeded", result_json=result)
            await _trigger_resume(call_id, result)
        _publish_event("desktop.task.succeeded", {"device_id": device_id, "call_id": call_id})

    elif msg_type == "tool_error":
        error = msg.get("error", "unknown error")
        registry.resolve_error(call_id, error)
        if call_id:
            await queue.update_status_by_call_id(call_id, "failed", error=error)
        _publish_event("desktop.task.failed", {"device_id": device_id, "call_id": call_id, "error": error})

    elif msg_type == "heartbeat":
        pass  # handled by outer loop for last_pong update

    else:
        log.debug("devices: unknown message type %s from %s", msg_type, device_id)


async def _trigger_resume(call_id: str, result: dict) -> None:
    """Trigger graph resume for the thread waiting on this call_id."""
    try:
        queue = get_queue_manager()
        row = await queue.get_by_call_id(call_id)
        if row is None or not row.graph_thread_id:
            return
        import os
        import httpx
        brain_url = os.environ.get("BRAIN_URL", "http://brain:8100")
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{brain_url}/invoke/resume",
                json={"thread_id": row.graph_thread_id, "result": result},
                timeout=10,
            )
    except Exception as exc:
        log.warning("devices: resume trigger failed for call_id %s: %s", call_id, exc)


async def _mark_disconnected(device_id: str) -> None:
    try:
        async with get_session() as session:
            device = await session.get(DesktopDevice, device_id)
            if device:
                device.is_connected = False
                device.last_seen_at = datetime.now(timezone.utc)
                await session.commit()
    except Exception as exc:
        log.warning("devices: failed to mark %s disconnected: %s", device_id, exc)


@router.get("")
async def list_devices() -> list[dict]:
    registry = get_registry()
    async with get_session() as session:
        rows = (await session.execute(select(DesktopDevice))).scalars().all()
        return [
            {
                "id": r.id, "name": r.name, "platform": r.platform,
                "is_connected": registry.is_connected(r.id),
                "last_seen_at": r.last_seen_at.isoformat() if r.last_seen_at else None,
            }
            for r in rows
        ]


def _publish_event(lane: str, payload: dict) -> None:
    try:
        import asyncio as _asyncio
        from ..events import publish
        _asyncio.create_task(publish(lane, payload))
    except Exception:
        pass
