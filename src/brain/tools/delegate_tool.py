"""delegate_to_agent tool — allows one agent to hand a task off to another agent."""
from __future__ import annotations

import asyncio
import logging

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)


class _DelegateInput(BaseModel):
    agent_id: str = Field(description="ID of the target agent to delegate the task to")
    message: str = Field(description="Task description or message to pass to the target agent")
    thread_id: str = Field(default="", description="Optional thread ID to continue within the same thread")


class DelegateToAgentTool(BaseTool):
    name: str = "delegate_to_agent"
    description: str = (
        "Delegate a sub-task to another agent. Use when a task requires "
        "specialised skills from a different agent. Returns the delegated "
        "agent's reply."
    )
    args_schema: type[BaseModel] = _DelegateInput

    async def _arun(  # type: ignore[override]
        self, agent_id: str, message: str, thread_id: str = ""
    ) -> str:
        """Queue an invocation on the target agent and return its reply."""
        try:
            from ..routers.invoke import _invoke_internal

            # caller_agent_id is injected by get_tools_for_agent via tool metadata
            caller = getattr(self, "_caller_agent_id", None)
            reply = await _invoke_internal(
                agent_id=agent_id,
                message=message,
                thread_id=thread_id or None,
                channel="delegation",
                caller_agent_id=caller,
            )
            return f"[{agent_id}] {reply}"
        except Exception as exc:
            log.error("delegate_to_agent failed for %s: %s", agent_id, exc)
            return f"[error] delegation to {agent_id} failed: {exc}"

    def _run(self, agent_id: str, message: str, thread_id: str = "") -> str:  # type: ignore[override]
        return asyncio.run(self._arun(agent_id, message, thread_id))
