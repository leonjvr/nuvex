"""Dispatcher — routes tool_call frames to registered tool implementations."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Awaitable

log = logging.getLogger(__name__)

ToolFn = Callable[..., Awaitable[Any]]


class Dispatcher:
    def __init__(self, registry: dict[str, ToolFn]) -> None:
        self._registry = registry

    async def dispatch(self, frame: dict, conn) -> None:
        call_id = frame.get("call_id", "")
        tool_name = frame.get("tool", "")
        args = frame.get("args", {})

        fn = self._registry.get(tool_name)
        if fn is None:
            log.warning("dispatcher: unknown tool '%s'", tool_name)
            await conn.send({
                "type": "tool_error",
                "call_id": call_id,
                "error": f"unknown tool: {tool_name}",
                "category": "not_available",
            })
            return

        try:
            result = await fn(**args) if asyncio.iscoroutinefunction(fn) else fn(**args)
            await conn.send({"type": "tool_result", "call_id": call_id, "result": result})
        except Exception as exc:
            log.warning("dispatcher: tool '%s' error: %s", tool_name, exc)
            category = _classify_error(exc)
            await conn.send({
                "type": "tool_error",
                "call_id": call_id,
                "error": str(exc),
                "category": category,
            })


def _classify_error(exc: Exception) -> str:
    name = type(exc).__name__.lower()
    if "com" in name or "pywintypes" in name:
        return "com_error"
    if "uia" in name or "auto" in name:
        return "uia_error"
    if "timeout" in name:
        return "timeout"
    if "permission" in name or "access" in name:
        return "permission_error"
    return "unknown"
