"""DesktopToolCallTool — routes desktop tool calls via DeviceRegistry or queues them."""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from .registry import get_registry
from .queue import get_queue_manager

log = logging.getLogger(__name__)

TOOL_CALL_TIMEOUT = 120  # seconds

# Tier rank: lower number = higher privilege
_TIER_RANK: dict[str, int] = {"T1": 1, "T2": 2, "T3": 3, "T4": 4}

# Minimum tier required per desktop tool name (tools not listed = forbidden)
_TOOL_MIN_TIER: dict[str, str] = {
    "desktop_screenshot": "T2",
    "desktop_list_windows": "T2",
    "desktop_find_control": "T2",
    "desktop_click_control": "T2",
    "desktop_get_control_text": "T2",
    "desktop_type_text": "T2",
    "desktop_hotkey": "T2",
    "desktop_mouse_click": "T2",
    "desktop_get_clipboard": "T2",
    "desktop_set_clipboard": "T2",
    "desktop_outlook_get_emails": "T2",
    "desktop_outlook_send_email": "T2",
    "desktop_outlook_reply_email": "T2",
    "desktop_outlook_move_email": "T2",
    "desktop_run_app": "T1",
    "desktop_shell_exec": "T1",
}


def _check_tier(tool_name: str, agent_tier: str) -> str | None:
    """Return an error string if the agent tier is insufficient, else None."""
    min_tier = _TOOL_MIN_TIER.get(tool_name)
    if min_tier is None:
        return f'[desktop_tool_error] tool={tool_name} error=unknown_tool'
    agent_rank = _TIER_RANK.get(agent_tier, 99)
    required_rank = _TIER_RANK.get(min_tier, 99)
    if agent_rank > required_rank:
        return (
            f'[desktop_tool_error] error=tier_insufficient '
            f'required_tier={min_tier} agent_tier={agent_tier}'
        )
    return None


class _DesktopToolInput(BaseModel):
    tool: str = Field(description="Name of the desktop tool to call (e.g. desktop_screenshot)")
    args: dict[str, Any] = Field(default_factory=dict, description="Arguments to pass to the tool")


class DesktopToolCallTool(BaseTool):
    """Routes desktop tool calls to the assigned device via WebSocket or queues them."""

    name: str = "desktop_tool_call"
    description: str = (
        "Execute a desktop automation tool on the assigned desktop device. "
        "If the device is offline the call is queued and the graph will be interrupted "
        "until the device reconnects and executes the task."
    )
    args_schema: type[BaseModel] = _DesktopToolInput

    # Pre-bound at tool-bind time
    device_id: str = ""
    agent_id: str = ""
    graph_thread_id: str | None = None
    agent_tier: str = "T2"

    async def _arun(self, tool: str, args: dict[str, Any] | None = None) -> str:  # type: ignore[override]
        if args is None:
            args = {}

        # Enforce tier classification (T3/T4 never reach here but belt-and-suspenders)
        tier_error = _check_tier(tool, self.agent_tier)
        if tier_error:
            return tier_error

        registry = get_registry()
        call_id = str(uuid.uuid4())

        if registry.is_connected(self.device_id):
            return await self._dispatch_live(tool, args, call_id)

        return await self._enqueue(tool, args, call_id)

    async def _dispatch_live(self, tool: str, args: dict, call_id: str) -> str:
        registry = get_registry()
        fut = registry.register_result_waiter(call_id)
        sent = await registry.send(self.device_id, {
            "type": "tool_call",
            "call_id": call_id,
            "tool": tool,
            "args": args,
        })
        if not sent:
            # Device disconnected between check and send — fall through to queue
            return await self._enqueue(tool, args, call_id)
        try:
            result = await asyncio.wait_for(fut, timeout=TOOL_CALL_TIMEOUT)
            return str(result)
        except asyncio.TimeoutError:
            registry.resolve_error(call_id, "timeout")
            return f"[desktop_tool_error] tool={tool} error=timeout"

    async def _enqueue(self, tool: str, args: dict, call_id: str) -> str:
        from langgraph.types import interrupt as _lg_interrupt
        queue = get_queue_manager()
        queue_id = await queue.enqueue(
            agent_id=self.agent_id,
            device_id=self.device_id,
            graph_thread_id=self.graph_thread_id,
            tool_name=tool,
            payload={"tool": tool, "args": args},
            call_id=call_id,
        )
        _emit_queued(self.agent_id, self.device_id, call_id, tool, queue_id)
        _lg_interrupt({
            "type": "desktop_unavailable",
            "queue_id": queue_id,
            "device_id": self.device_id,
            "call_id": call_id,
        })
        return "[queued]"

    def _run(self, tool: str, args: dict[str, Any] | None = None) -> str:  # type: ignore[override]
        return asyncio.run(self._arun(tool, args or {}))


def _emit_queued(agent_id: str, device_id: str, call_id: str, tool_name: str, queue_id: str) -> None:
    try:
        import asyncio as _asyncio
        from ..events import publish
        _asyncio.create_task(publish(
            "desktop.task.queued",
            {"agent_id": agent_id, "device_id": device_id, "call_id": call_id,
             "tool_name": tool_name, "queue_id": queue_id},
            agent_id=agent_id,
        ))
    except Exception:
        pass
