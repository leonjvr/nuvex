"""In-memory WebSocket registry for connected desktop devices."""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import WebSocket

log = logging.getLogger(__name__)

# Awaitable result resolvers: call_id → future holding the result dict
_result_waiters: dict[str, asyncio.Future] = {}


class DeviceRegistry:
    """Thread-safe in-memory registry of connected device WebSockets."""

    def __init__(self) -> None:
        self._connections: dict[str, "WebSocket"] = {}

    def register(self, device_id: str, ws: "WebSocket") -> None:
        self._connections[device_id] = ws
        log.info("devices: registered device %s", device_id)

    def unregister(self, device_id: str) -> None:
        self._connections.pop(device_id, None)
        log.info("devices: unregistered device %s", device_id)

    def get(self, device_id: str) -> "WebSocket | None":
        return self._connections.get(device_id)

    def is_connected(self, device_id: str) -> bool:
        return device_id in self._connections

    def list_connected(self) -> list[str]:
        return list(self._connections.keys())

    async def send(self, device_id: str, message: dict) -> bool:
        """Send a JSON message to a device. Returns False if not connected."""
        ws = self._connections.get(device_id)
        if ws is None:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception as exc:
            log.warning("devices: send to %s failed: %s", device_id, exc)
            self.unregister(device_id)
            return False

    def register_result_waiter(self, call_id: str) -> asyncio.Future:
        """Register a future that will receive the tool result for call_id."""
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        _result_waiters[call_id] = fut
        return fut

    def resolve_result(self, call_id: str, result: dict) -> bool:
        """Resolve the waiting future for call_id with result."""
        fut = _result_waiters.pop(call_id, None)
        if fut is None:
            return False
        if not fut.done():
            fut.set_result(result)
        return True

    def resolve_error(self, call_id: str, error: str) -> bool:
        """Reject the waiting future for call_id with an error."""
        fut = _result_waiters.pop(call_id, None)
        if fut is None:
            return False
        if not fut.done():
            fut.set_exception(RuntimeError(error))
        return True


# Module-level singleton — shared by router and tool
_registry: DeviceRegistry | None = None


def get_registry() -> DeviceRegistry:
    global _registry
    if _registry is None:
        _registry = DeviceRegistry()
    return _registry
