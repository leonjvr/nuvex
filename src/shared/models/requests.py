"""Shared Pydantic models used across brain, gateways, and dashboard."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MessageMetadata(BaseModel):
    sender: str = ""
    sender_name: str = ""
    channel: str = "test"  # whatsapp | telegram | email | test
    group_jid: str | None = None
    is_audio: bool = False
    audio_transcript: str | None = None
    project_label: str | None = None  # set by gateway when a group is bound to a project


class InvokeRequest(BaseModel):
    agent_id: str
    message: str
    thread_id: str | None = None
    channel: str = "test"  # whatsapp | telegram | email | test
    max_iterations: int = 30
    workspace_path: str | None = None  # overrides agent default when set
    metadata: MessageMetadata = Field(default_factory=MessageMetadata)


class ActionItem(BaseModel):
    type: str  # send_message | send_audio | send_file
    target: str
    text: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)


class InvokeResponse(BaseModel):
    invocation_id: str = ""
    thread_id: str = ""
    reply: str = ""
    actions: list[ActionItem] = Field(default_factory=list)
    tokens_used: int = 0
    cost_usd: float = 0.0
    finished: bool = False
    error: str | None = None
    approval_pending: bool = False
    approval_tool: str | None = None


class ResumeRequest(BaseModel):
    invocation_id: str
    thread_id: str
    approved: bool


class HealthResponse(BaseModel):
    status: str  # ok | degraded | error
    db: str      # connected | disconnected
    version: str = "0.1.0"
