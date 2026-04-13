"""read_tool_result built-in tool — retrieve overflow content by handle.

Spec: hermes-inspired-runtime §2.5
"""
from __future__ import annotations

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field


class _ReadToolResultInput(BaseModel):
    handle: str = Field(description="UUID reference handle returned in a truncated tool output")
    offset: int = Field(default=0, description="Character offset for pagination (default 0)")


class ReadToolResultTool(BaseTool):
    name: str = "read_tool_result"
    description: str = (
        "Retrieve the full content of a truncated tool output by its reference handle. "
        "Use the handle from a '[Output truncated ... reference: <handle>]' message. "
        "Set offset to paginate through very large results."
    )
    args_schema: type[BaseModel] = _ReadToolResultInput

    # Injected at tool-call time from execute_tools context
    _thread_id: str = ""

    async def _arun(self, handle: str, offset: int = 0) -> str:  # type: ignore[override]
        from ...shared.config import get_cached_config
        try:
            cfg = get_cached_config()
            max_chars = cfg.tools.result_budget.default_max_chars
        except Exception:
            max_chars = 30000

        from .result_budget import read_overflow
        return read_overflow(
            handle=handle,
            thread_id=self._thread_id,
            max_chars=max_chars,
            offset=offset,
        )

    def _run(self, handle: str, offset: int = 0) -> str:  # type: ignore[override]
        import asyncio
        return asyncio.get_event_loop().run_until_complete(self._arun(handle, offset))
