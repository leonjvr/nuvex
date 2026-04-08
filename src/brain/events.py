"""In-process async event bus with persistent event log."""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from .db import get_session
from .models.events import Event

log = logging.getLogger(__name__)

Handler = Callable[[dict[str, Any]], Awaitable[None]]

_subscriptions: dict[str, list[Handler]] = {}

# Event retention: default 30 days
DEFAULT_RETENTION_DAYS = 30


def subscribe(lane: str, handler: Handler) -> None:
    _subscriptions.setdefault(lane, []).append(handler)


async def publish(
    lane: str,
    payload: dict[str, Any],
    agent_id: str | None = None,
    invocation_id: str | None = None,
    failure_class: str | None = None,
) -> None:
    """Persist the event then fan-out to all lane subscribers."""
    event_id = uuid.uuid4()

    # 20.4 — auto-classify failure if not provided
    if failure_class is None and payload.get("status") == "error":
        failure_class = _classify_failure_class(payload)

    async with get_session() as session:
        ev = Event(
            id=event_id,
            lane=lane,
            status="pending",
            failure_class=failure_class,
            agent_id=agent_id,
            invocation_id=invocation_id,
            payload=payload,
        )
        session.add(ev)
        await session.commit()

    handlers = _subscriptions.get(lane, [])
    for handler in handlers:
        try:
            await handler(payload)
        except Exception as exc:
            log.error("Event handler failed lane=%s handler=%s: %s", lane, handler, exc)
            async with get_session() as session:
                result = await session.get(Event, event_id)
                if result:
                    result.status = "failed"
                    result.failure_class = result.failure_class or "handler_error"
                    result.error = str(exc)
                    result.retry_count += 1
                    await session.commit()
            continue

    async with get_session() as session:
        result = await session.get(Event, event_id)
        if result and result.status == "pending":
            result.status = "delivered"
            result.processed_at = datetime.now(timezone.utc)
            await session.commit()


def _classify_failure_class(payload: dict[str, Any]) -> str:
    """Map payload error signals to failure class strings (20.4)."""
    error = str(payload.get("error", "")).lower()
    http_status = payload.get("http_status")

    if http_status == 429 or "rate" in error or "too many" in error:
        return "transient"
    if http_status in (500, 502, 503, 504):
        return "transient"
    if http_status == 402 or "budget" in error or "limit exceeded" in error:
        return "permanent"
    if http_status in (400, 401, 403, 404):
        return "permanent"
    if "timeout" in error or "timed out" in error:
        return "transient"
    if "context" in error and "length" in error:
        return "degraded"
    if "connection" in error or "disconnect" in error or "peer closed" in error:
        return "transient"
    return "unknown"


async def purge_old_events(retention_days: int = DEFAULT_RETENTION_DAYS) -> int:
    """Delete events older than `retention_days`. Returns count deleted (20.6)."""
    from sqlalchemy import delete
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    try:
        async with get_session() as session:
            result = await session.execute(
                delete(Event).where(Event.created_at < cutoff)
            )
            await session.commit()
            deleted = result.rowcount
            if deleted:
                log.info("events: purged %d events older than %dd", deleted, retention_days)
            return deleted
    except Exception as exc:
        log.error("events: purge failed: %s", exc)
        return 0


async def start_retention_worker(interval_hours: int = 24) -> None:
    """Background task: periodically purge old events (20.6)."""
    async def _loop() -> None:
        while True:
            await asyncio.sleep(interval_hours * 3600)
            await purge_old_events()

    asyncio.ensure_future(_loop())
    log.info("events: retention worker started (interval=%dh)", interval_hours)

