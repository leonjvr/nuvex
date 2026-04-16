"""Inter-org work packet dispatch logic (§11.2–11.9)."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from .db import get_session
from .models.organisation import Organisation
from .models.work_packet import WorkPacket

log = logging.getLogger(__name__)

_DEFAULT_PAYLOAD_LIMIT = 1 * 1024 * 1024  # 1MB
_SYNC_TIMEOUT = 30  # seconds


def _new_packet_id() -> str:
    return str(uuid.uuid4())


async def _get_org(session: Any, org_id: str) -> Organisation | None:
    return await session.get(Organisation, org_id)


async def _validate_communication_link(
    source_org: Organisation, target_org_id: str
) -> None:
    """Raise ValueError if source org has no declared link to target org (§11.2)."""
    links = source_org.communication_links or {}
    allowed = links.get("allowed_targets") or []
    if allowed and target_org_id not in allowed:
        raise ValueError(
            f"Org '{source_org.org_id}' has no communication link to '{target_org_id}'"
        )


async def _validate_payload_size(org: Organisation, payload: dict) -> None:
    """Raise ValueError if payload exceeds org-configured limit (§11.8)."""
    import json
    limit = (org.config or {}).get("max_packet_size_bytes", _DEFAULT_PAYLOAD_LIMIT)
    size = len(json.dumps(payload).encode())
    if size > limit:
        raise ValueError(f"Payload size {size} bytes exceeds limit {limit} bytes")


async def _update_packet_status(
    packet_id: str, status: str, result: dict | None = None, error: str | None = None
) -> None:
    """Update packet status + emit audit event (§11.7, §11.9)."""
    async with get_session() as session:
        packet = await session.get(WorkPacket, packet_id)
        if packet:
            packet.status = status
            packet.updated_at = datetime.now(timezone.utc)
            if result is not None:
                packet.result = result
            if error is not None:
                packet.error = error
            await session.commit()

    # §11.9 — audit trail
    try:
        from .events import publish
        await publish(
            f"work_packet.{status}",
            payload={"packet_id": packet_id, "status": status},
        )
    except Exception as exc:
        log.debug("work_packet audit publish failed (non-fatal): %s", exc)


async def dispatch_work_packet(
    source_org_id: str,
    target_org_id: str,
    packet_type: str,
    payload: dict[str, Any],
    mode: str = "async",
) -> dict[str, Any]:
    """Create and dispatch a work packet (§11.3-§11.4).

    Returns:
      - sync mode: {"packet_id": ..., "status": "completed", "result": ...}
      - async mode: {"packet_id": ..., "status": "pending"}
    """
    async with get_session() as session:
        source_org = await _get_org(session, source_org_id)
        if source_org is None:
            raise ValueError(f"Source org '{source_org_id}' not found")
        target_org = await _get_org(session, target_org_id)
        if target_org is None:
            raise ValueError(f"Target org '{target_org_id}' not found")

        await _validate_communication_link(source_org, target_org_id)
        await _validate_payload_size(source_org, payload)

        packet_id = _new_packet_id()
        packet = WorkPacket(
            id=packet_id,
            source_org_id=source_org_id,
            target_org_id=target_org_id,
            packet_type=packet_type,
            payload=payload,
            status="pending",
            mode=mode,
        )
        session.add(packet)
        await session.commit()

    # Emit created event
    try:
        from .events import publish
        await publish(
            "work_packet.created",
            payload={"packet_id": packet_id, "source_org": source_org_id,
                     "target_org": target_org_id, "type": packet_type},
        )
    except Exception:
        pass

    if mode == "sync":
        return await _dispatch_sync(packet_id, target_org_id, target_org, packet_type, payload)
    else:
        asyncio.ensure_future(_dispatch_async_bg(packet_id, target_org_id, packet_type, payload))
        return {"packet_id": packet_id, "status": "pending"}


async def _get_handler_agent(target_org: Organisation) -> str | None:
    """Return the packet_handler_agent for this org from its config (§11.6)."""
    cfg = target_org.config or {}
    return cfg.get("packet_handler_agent")


async def _invoke_handler(
    target_org_id: str, handler_agent: str, packet_type: str, payload: dict, packet_id: str
) -> str:
    """Invoke the handler agent with the packet as a task (§11.6)."""
    from .routers.invoke import _invoke_internal
    message = (
        f"[Work Packet] type={packet_type} from_org={target_org_id}\n"
        f"packet_id={packet_id}\n"
        f"payload={payload}"
    )
    return await _invoke_internal(
        agent_id=handler_agent,
        message=message,
        channel="work_packet",
        sender=target_org_id,
    )


async def _dispatch_sync(
    packet_id: str, target_org_id: str, target_org: Organisation,
    packet_type: str, payload: dict
) -> dict[str, Any]:
    """Sync dispatch — invoke handler and wait for result (§11.3)."""
    await _update_packet_status(packet_id, "processing")
    handler_agent = await _get_handler_agent(target_org)
    if not handler_agent:
        await _update_packet_status(packet_id, "failed", error="No packet_handler_agent configured")
        return {"packet_id": packet_id, "status": "failed", "error": "No handler configured"}

    try:
        result_text = await asyncio.wait_for(
            _invoke_handler(target_org_id, handler_agent, packet_type, payload, packet_id),
            timeout=_SYNC_TIMEOUT,
        )
        await _update_packet_status(packet_id, "completed", result={"reply": result_text})
        return {"packet_id": packet_id, "status": "completed", "result": {"reply": result_text}}
    except asyncio.TimeoutError:
        await _update_packet_status(packet_id, "timeout", error="Handler timeout")
        return {"packet_id": packet_id, "status": "timeout"}
    except Exception as exc:
        await _update_packet_status(packet_id, "failed", error=str(exc))
        return {"packet_id": packet_id, "status": "failed", "error": str(exc)}


async def _dispatch_async_bg(
    packet_id: str, target_org_id: str, packet_type: str, payload: dict
) -> None:
    """Async background dispatch (§11.4)."""
    try:
        async with get_session() as session:
            target_org = await session.get(Organisation, target_org_id)
        if target_org is None:
            await _update_packet_status(packet_id, "failed", error="Target org not found")
            return

        await _update_packet_status(packet_id, "processing")
        handler_agent = await _get_handler_agent(target_org)
        if not handler_agent:
            await _update_packet_status(packet_id, "failed", error="No packet_handler_agent configured")
            return

        result_text = await _invoke_handler(target_org_id, handler_agent, packet_type, payload, packet_id)
        await _update_packet_status(packet_id, "completed", result={"reply": result_text})
    except Exception as exc:
        log.error("work_packet async dispatch failed for %s: %s", packet_id, exc)
        await _update_packet_status(packet_id, "failed", error=str(exc))
