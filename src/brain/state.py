"""LangGraph state definitions for the NUVEX agent graph."""
from __future__ import annotations

from typing import Annotated, Any
from uuid import uuid4

from langchain_core.messages import AnyMessage
from langgraph.graph import add_messages
from pydantic import BaseModel, Field

from .models.denied_action import DeniedAction


class AgentState(BaseModel):
    """Full state carried through the agent graph nodes."""

    # Core inputs
    agent_id: str
    org_id: str = "default"
    thread_id: str
    invocation_id: str = Field(default_factory=lambda: str(uuid4()))

    # Message history (append-only via add_messages reducer)
    messages: Annotated[list[AnyMessage], add_messages] = Field(default_factory=list)

    # Model routing
    active_model: str = ""
    model_tier: str = "standard"  # fast | standard | power

    # Tool execution
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    tool_results: list[dict[str, Any]] = Field(default_factory=list)

    # Governance
    approval_pending: bool = False
    approval_action: str = ""
    approval_approved: bool = False

    # Budget
    tokens_used: int = 0
    cost_usd: float = 0.0
    budget_exceeded: bool = False

    # Lifecycle
    iteration: int = 0
    max_iterations: int = 30
    finished: bool = False
    error: str | None = None

    # Pass-through metadata (from InvokeRequest)
    channel: str = ""
    sender: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)

    # Contact identity resolution (populated by ContactResolver in invoke.py)
    contact_id: str | None = None
    contact_trust_tier: int = 0  # 0=T0 .. 4=T4
    contact_sanction: str | None = None  # NULL | temp_ban | hard_ban | shadowban | under_review
    contact_sanction_until: str | None = None  # ISO8601 if temp_ban

    # Workspace & tool context
    workspace_path: str | None = None
    active_tools: list[str] = Field(default_factory=list)
    project_context: str | None = None  # injected when a project is bound to the conversation

    # Tool schema locking (§33) — hash + serialized schema cached per session
    tool_schema_hash: str | None = None
    tool_schema_cache: list[dict] | None = None

    # §29 — consecutive low-yield turn counter
    low_yield_turns: int = 0

    # §32 — denied governance actions accumulated in this session
    denied_actions: list[DeniedAction] = Field(default_factory=list)

    class Config:
        arbitrary_types_allowed = True
