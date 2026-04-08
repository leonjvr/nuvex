"""Additional built-in tools: read_file, write_file, web_fetch, send_message."""
from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from .shell_tool import ShellTool

# ── read_file ─────────────────────────────────────────────────────────────────

class _ReadFileInput(BaseModel):
    path: str = Field(description="Absolute or relative path to read")
    max_bytes: int = Field(default=65536, description="Max bytes to read (default 64 KB)")


class ReadFileTool(BaseTool):
    name: str = "read_file"
    description: str = "Read a file from disk and return its contents."
    args_schema: type[BaseModel] = _ReadFileInput

    async def _arun(self, path: str, max_bytes: int = 65536) -> str:  # type: ignore[override]
        try:
            p = Path(path)
            if not p.exists():
                return f"[error] File not found: {path}"
            size = p.stat().st_size
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(max_bytes)
            if size > max_bytes:
                content += f"\n... [truncated — {size - max_bytes} bytes omitted]"
            return content
        except Exception as exc:
            return f"[error] {exc}"

    def _run(self, path: str, max_bytes: int = 65536) -> str:  # type: ignore[override]
        return asyncio.run(self._arun(path, max_bytes))


# ── write_file ───────────────────────────────────────────────────────────────

class _WriteFileInput(BaseModel):
    path: str = Field(description="Absolute or relative path to write")
    content: str = Field(description="Content to write to the file")
    append: bool = Field(default=False, description="Append to file instead of overwrite")


class WriteFileTool(BaseTool):
    name: str = "write_file"
    description: str = "Write or append content to a file on disk."
    args_schema: type[BaseModel] = _WriteFileInput

    async def _arun(self, path: str, content: str, append: bool = False) -> str:  # type: ignore[override]
        try:
            p = Path(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            mode = "a" if append else "w"
            with open(p, mode, encoding="utf-8") as f:
                f.write(content)
            return f"[ok] Written {len(content)} chars to {path}"
        except Exception as exc:
            return f"[error] {exc}"

    def _run(self, path: str, content: str, append: bool = False) -> str:  # type: ignore[override]
        return asyncio.run(self._arun(path, content, append))


# ── web_fetch ─────────────────────────────────────────────────────────────────

class _WebFetchInput(BaseModel):
    url: str = Field(description="URL to fetch")
    timeout: int = Field(default=15, description="Timeout in seconds")
    max_chars: int = Field(default=8000, description="Max response characters to return")


class WebFetchTool(BaseTool):
    name: str = "web_fetch"
    description: str = "Fetch a URL and return the response body as text."
    args_schema: type[BaseModel] = _WebFetchInput

    async def _arun(self, url: str, timeout: int = 15, max_chars: int = 8000) -> str:  # type: ignore[override]
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
                resp = await client.get(url, headers={"User-Agent": "NuvexAgent/0.1"})
                text = resp.text[:max_chars]
                if len(resp.text) > max_chars:
                    text += f"\n... [truncated — response was {len(resp.text)} chars]"
                return f"Status: {resp.status_code}\n\n{text}"
        except Exception as exc:
            return f"[error] {exc}"

    def _run(self, url: str, timeout: int = 15, max_chars: int = 8000) -> str:  # type: ignore[override]
        return asyncio.run(self._arun(url, timeout, max_chars))


# ── send_message ──────────────────────────────────────────────────────────────

class _SendMessageInput(BaseModel):
    channel: str = Field(description="Target channel: whatsapp, telegram, email")
    recipient: str = Field(description="Recipient identifier (JID, user ID, email address)")
    message: str = Field(description="Message text to send")
    agent_id: str = Field(default="", description="Source agent ID (auto-filled if omitted)")


class SendMessageTool(BaseTool):
    name: str = "send_message"
    description: str = (
        "Queue an outbound message to a recipient via a specified channel "
        "(whatsapp, telegram, email). The gateway picks up and delivers it."
    )
    args_schema: type[BaseModel] = _SendMessageInput

    async def _arun(  # type: ignore[override]
        self, channel: str, recipient: str, message: str, agent_id: str = ""
    ) -> str:
        try:
            from ..db import get_session
            from ..models.tasks import Task  # reuse Task model for action queue
            import uuid, json

            # Insert into a lightweight actions_queue using the tasks table
            # with action_type metadata in context field.
            async with get_session() as session:
                from ..models.tasks import Task
                action = Task(
                    id=str(uuid.uuid4()),
                    agent_id=agent_id or "system",
                    title=f"send_message:{channel}:{recipient[:30]}",
                    description=message[:1000],
                    status="pending",
                    context={
                        "action_type": "send_message",
                        "channel": channel,
                        "recipient": recipient,
                        "message": message,
                    },
                )
                session.add(action)
                await session.commit()
            return f"[ok] Message queued for {channel}:{recipient}"
        except Exception as exc:
            return f"[error] queuing send_message: {exc}"

    def _run(self, channel: str, recipient: str, message: str, agent_id: str = "") -> str:  # type: ignore[override]
        return asyncio.run(self._arun(channel, recipient, message, agent_id))


# ── Registry ──────────────────────────────────────────────────────────────────

ALL_TOOLS = [ShellTool(), ReadFileTool(), WriteFileTool(), WebFetchTool(), SendMessageTool()]


def get_tool(name: str) -> BaseTool | None:
    return next((t for t in ALL_TOOLS if t.name == name), None)
