"""Service health monitor — track per-service error rates over rolling windows.

Health states:
  Healthy  — error rate < warn_threshold
  Degraded — error rate >= warn_threshold OR consecutive failures >= degrade_at
  Failed   — error rate >= fail_threshold OR consecutive failures >= fail_at
"""
from __future__ import annotations

import asyncio
import logging
from collections import deque
from datetime import datetime, timezone
from typing import Literal

log = logging.getLogger(__name__)

HealthState = Literal["Healthy", "Degraded", "Failed"]

_DEGRADE_THRESHOLD = 0.20   # 20% error rate → Degraded
_FAIL_THRESHOLD    = 0.50   # 50% error rate → Failed
_WINDOW_SIZE       = 20     # rolling window of last N calls
_DEGRADE_CONSEC    = 3      # consecutive failures → Degraded
_FAIL_CONSEC       = 5      # consecutive failures → Failed


class ServiceStats:
    def __init__(self, name: str) -> None:
        self.name = name
        self._window: deque[bool] = deque(maxlen=_WINDOW_SIZE)
        self._consecutive_failures = 0
        self.state: HealthState = "Healthy"
        self.last_state_change: datetime = datetime.now(timezone.utc)
        self.last_checked: datetime = datetime.now(timezone.utc)
        self.last_error: str | None = None
        self.latency_ms: float | None = None

    def record(self, success: bool, latency_ms: float | None = None, error: str | None = None) -> HealthState:
        self._window.append(success)
        if success:
            self._consecutive_failures = 0
        else:
            self._consecutive_failures += 1
            self.last_error = error

        if latency_ms is not None:
            self.latency_ms = latency_ms

        self.last_checked = datetime.now(timezone.utc)
        return self._compute_state()

    def _compute_state(self) -> HealthState:
        if not self._window:
            return "Healthy"

        error_rate = 1.0 - (sum(self._window) / len(self._window))
        prev = self.state

        if error_rate >= _FAIL_THRESHOLD or self._consecutive_failures >= _FAIL_CONSEC:
            new_state: HealthState = "Failed"
        elif error_rate >= _DEGRADE_THRESHOLD or self._consecutive_failures >= _DEGRADE_CONSEC:
            new_state = "Degraded"
        else:
            new_state = "Healthy"

        if new_state != prev:
            log.info("ServiceHealth state change: %s %s → %s (error_rate=%.1f%%)", 
                     self.name, prev, new_state, error_rate * 100)
            self.last_state_change = datetime.now(timezone.utc)
            self.state = new_state
            # Emit event asynchronously (best-effort)
            asyncio.ensure_future(self._emit_event(prev, new_state))

        return new_state

    async def _emit_event(self, from_state: HealthState, to_state: HealthState) -> None:
        try:
            from . import events
            await events.publish(
                "plugin.health",
                {
                    "service": self.name,
                    "from": from_state,
                    "to": to_state,
                },
            )
        except Exception:  # noqa: BLE001
            pass

    def error_rate(self) -> float:
        if not self._window:
            return 0.0
        return 1.0 - (sum(self._window) / len(self._window))


class ServiceHealthMonitor:
    """Tracks health state for multiple named services."""

    def __init__(self) -> None:
        self._services: dict[str, ServiceStats] = {}

    def _get_or_create(self, service: str) -> ServiceStats:
        if service not in self._services:
            self._services[service] = ServiceStats(service)
        return self._services[service]

    def record(
        self,
        service: str,
        success: bool,
        latency_ms: float | None = None,
        error: str | None = None,
    ) -> HealthState:
        """Record a call result for a service. Returns new state."""
        return self._get_or_create(service).record(success, latency_ms, error)

    def get_state(self, service: str) -> HealthState:
        stats = self._services.get(service)
        return stats.state if stats else "Healthy"

    def get_stats(self, service: str) -> ServiceStats | None:
        return self._services.get(service)

    def all_services(self) -> list[ServiceStats]:
        return list(self._services.values())

    def is_healthy(self, service: str) -> bool:
        return self.get_state(service) == "Healthy"

    def prefer_alternative(self, candidates: list[str]) -> str | None:
        """Return the healthiest candidate from a list (e.g. model providers)."""
        for candidate in candidates:
            if self.is_healthy(candidate):
                return candidate
        # Fall back to least-degraded
        not_failed = [c for c in candidates if self.get_state(c) != "Failed"]
        return not_failed[0] if not_failed else (candidates[0] if candidates else None)

    async def poll_gateway(self, service_name: str, health_url: str, timeout: float = 5.0) -> HealthState:
        """Poll a gateway /health endpoint and record the result."""
        import httpx
        start = asyncio.get_event_loop().time()
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.get(health_url)
            latency = (asyncio.get_event_loop().time() - start) * 1000
            success = resp.status_code == 200
            return self.record(service_name, success, latency_ms=latency)
        except Exception as exc:
            return self.record(service_name, False, error=str(exc))

    async def persist_all(self) -> None:
        """Persist current health state for all services to service_health table."""
        from .db import get_session
        from .models.cron import ServiceHealth
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        async with get_session() as session:
            for stats in self._services.values():
                stmt = pg_insert(ServiceHealth).values(
                    service=stats.name,
                    status=stats.state,
                    latency_ms=stats.latency_ms,
                    error=stats.last_error,
                ).on_conflict_do_update(
                    index_elements=["service"],
                    set_=dict(
                        status=stats.state,
                        latency_ms=stats.latency_ms,
                        error=stats.last_error,
                    ),
                )
                await session.execute(stmt)
            await session.commit()


# Singleton
_monitor: ServiceHealthMonitor | None = None


def get_health_monitor() -> ServiceHealthMonitor:
    global _monitor
    if _monitor is None:
        _monitor = ServiceHealthMonitor()
    return _monitor


async def record_llm_call(
    model: str,
    success: bool,
    latency_ms: float | None = None,
    error: str | None = None,
) -> HealthState:
    """Convenience function — record an LLM call result in the health monitor (26.3)."""
    monitor = get_health_monitor()
    state = monitor.record(model, success=success, latency_ms=latency_ms, error=error)
    # Persist to DB best-effort (avoid slowing down the LLM path)
    try:
        await monitor.persist_all()
    except Exception:
        pass
    return state
