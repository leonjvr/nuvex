"""Dashboard agents router — list and inspect agents."""
from __future__ import annotations

import os
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from ...brain.db import get_session
from ...brain.models.agent import Agent
from ...brain.models.budget import Budget
from ...brain.models.lifecycle import AgentLifecycleEvent
from ...brain.models.thread import Message, Thread
from ...shared.config import get_cached_config

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("")
async def list_agents(org_id: str | None = Query(None)):
    """Return all agents from DB merged with config, falling back to config-only entries."""
    cfg = get_cached_config()

    async with get_session() as session:
        q = select(Agent)
        if org_id:
            q = q.where(Agent.org_id == org_id)
        result = await session.execute(q)
        db_agents = result.scalars().all()

    db_map = {a.id: a for a in db_agents}
    all_ids = list(db_map.keys()) + [
        aid for aid in cfg.agents if aid not in db_map
    ]

    rows = []
    for agent_id in all_ids:
        db = db_map.get(agent_id)
        agent_def = cfg.agents.get(agent_id)
        model_primary = None
        if agent_def and getattr(agent_def, "model", None):
            model_primary = agent_def.model.primary
        rows.append(
            {
                "id": agent_id,
                "name": db.name if db else agent_id,
                "tier": db.tier if db else (getattr(agent_def, "tier", None) if agent_def else None),
                "division": db.division if db else (getattr(agent_def, "division", None) if agent_def else None),
                "lifecycle_state": db.lifecycle_state if db else "idle",
                "model": model_primary,
                "system": bool(getattr(agent_def, "system", False)) if agent_def else False,
            }
        )
    return rows


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    async with get_session() as session:
        result = await session.execute(select(Agent).where(Agent.id == agent_id))
        row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {
        "id": row.id,
        "name": row.name,
        "tier": row.tier,
        "division": row.division,
        "lifecycle_state": row.lifecycle_state,
        "workspace_path": row.workspace_path,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.get("/{agent_id}/status")
async def agent_status(agent_id: str):
    async with get_session() as session:
        agent_res = await session.execute(select(Agent).where(Agent.id == agent_id))
        agent = agent_res.scalar_one_or_none()
        budget_res = await session.execute(select(Budget).where(Budget.agent_id == agent_id))
        budget = budget_res.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {
        "lifecycle_state": agent.lifecycle_state,
        "daily_usd_used": budget.daily_usd_used if budget else 0,
        "daily_usd_limit": budget.daily_usd_limit if budget else None,
        "total_usd_used": budget.total_usd_used if budget else 0,
    }


@router.get("/{agent_id}/lifecycle")
async def agent_lifecycle(agent_id: str, limit: int = 100):
    """Return lifecycle transition events for an agent, newest first."""
    async with get_session() as session:
        agent_res = await session.execute(select(Agent).where(Agent.id == agent_id))
        if agent_res.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Agent not found")
        lc_res = await session.execute(
            select(AgentLifecycleEvent)
            .where(AgentLifecycleEvent.agent_id == agent_id)
            .order_by(AgentLifecycleEvent.created_at.desc())
            .limit(limit)
        )
        events = lc_res.scalars().all()
    return [
        {
            "id": e.id,
            "from_state": e.from_state,
            "to_state": e.to_state,
            "invocation_id": e.invocation_id,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]


@router.get("/{agent_id}/diagnostics")
async def agent_diagnostics(agent_id: str):
    """Return error details, recent lifecycle events, and recent messages for an agent."""
    async with get_session() as session:
        agent_res = await session.execute(select(Agent).where(Agent.id == agent_id))
        agent = agent_res.scalar_one_or_none()
        if agent is None:
            raise HTTPException(status_code=404, detail="Agent not found")

        lc_res = await session.execute(
            select(AgentLifecycleEvent)
            .where(AgentLifecycleEvent.agent_id == agent_id)
            .order_by(AgentLifecycleEvent.created_at.desc())
            .limit(20)
        )
        events = lc_res.scalars().all()

        # Fetch latest thread for this agent then its recent messages
        thread_res = await session.execute(
            select(Thread)
            .where(Thread.agent_id == agent_id)
            .order_by(Thread.updated_at.desc())
            .limit(1)
        )
        thread = thread_res.scalar_one_or_none()
        messages: list[Message] = []
        if thread:
            msg_res = await session.execute(
                select(Message)
                .where(Message.thread_id == thread.id)
                .order_by(Message.created_at.desc())
                .limit(10)
            )
            messages = list(reversed(msg_res.scalars().all()))

    return {
        "agent_id": agent_id,
        "lifecycle_state": agent.lifecycle_state,
        "last_error": agent.last_error,
        "last_error_at": agent.last_error_at.isoformat() if agent.last_error_at else None,
        "lifecycle_events": [
            {
                "id": e.id,
                "from_state": e.from_state,
                "to_state": e.to_state,
                "reason": e.reason,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ],
        "recent_messages": [
            {
                "role": m.role,
                "content": m.content[:500] if m.content else "",
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
    }


# ── Skill assignment ──────────────────────────────────────────────────────────

def _config_path() -> Path:
    return Path(os.environ.get("NUVEX_CONFIG", "config/nuvex.yaml"))


def _read_yaml() -> dict:
    p = _config_path()
    if not p.exists():
        raise HTTPException(status_code=500, detail=f"Config not found: {p}")
    with p.open() as f:
        return yaml.safe_load(f) or {}


def _write_yaml(data: dict) -> None:
    p = _config_path()
    with p.open("w") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


@router.get("/{agent_id}/skills")
async def get_agent_skills(agent_id: str):
    """Return the skill list assigned to this agent in nuvex.yaml."""
    raw = _read_yaml()
    agents = raw.get("agents", [])
    for a in agents:
        if a.get("name") == agent_id:
            return {"skills": a.get("skills", [])}
    raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in config")


class SkillAssignPayload(BaseModel):
    skills: list[str]


# ── Agent config get/put (editable fields from nuvex.yaml) ───────────────────

@router.get("/{agent_id}/config")
async def get_agent_config(agent_id: str):
    """Return the full agent config block from nuvex.yaml."""
    raw = _read_yaml()
    for a in raw.get("agents", []):
        if a.get("name") == agent_id:
            return a
    raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in config")


class AgentConfigPayload(BaseModel):
    name: str | None = None
    tier: str | None = None
    division: str | None = None
    model: dict | None = None
    budget: dict | None = None
    channels: dict | None = None
    recovery: dict | None = None
    mcp_servers: dict | None = None


@router.put("/{agent_id}/config")
async def update_agent_config(agent_id: str, payload: AgentConfigPayload):
    """Merge the supplied fields into the agent block in nuvex.yaml."""
    raw = _read_yaml()
    agents = raw.get("agents", [])
    found = False
    for a in agents:
        if a.get("name") == agent_id:
            update = payload.model_dump(exclude_none=True)
            # Deep-merge nested dicts (model, budget, channels, recovery)
            for k, v in update.items():
                if isinstance(v, dict) and isinstance(a.get(k), dict):
                    a[k].update(v)
                else:
                    a[k] = v
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in config")
    _write_yaml(raw)
    get_cached_config.cache_clear()
    return {"agent_id": agent_id, "updated": True}


@router.put("/{agent_id}/skills")
async def set_agent_skills(agent_id: str, payload: SkillAssignPayload):
    """Replace the full skill list for an agent in nuvex.yaml."""
    raw = _read_yaml()
    agents = raw.get("agents", [])
    found = False
    for a in agents:
        if a.get("name") == agent_id:
            a["skills"] = payload.skills
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in config")
    _write_yaml(raw)
    # Invalidate config cache so next request picks up the change
    get_cached_config.cache_clear()
    return {"agent_id": agent_id, "skills": payload.skills}


# ── MCP server management ─────────────────────────────────────────────────────

class McpParseRequest(BaseModel):
    raw: str


@router.post("/{agent_id}/mcp/parse")
async def parse_mcp_config(agent_id: str, payload: McpParseRequest):
    """Use a fast LLM to convert any pasted MCP config format into McpServerConfig."""
    if not payload.raw.strip():
        raise HTTPException(status_code=400, detail="raw is empty")

    cfg = get_cached_config()
    agent_def = cfg.agents.get(agent_id)
    model_name = "groq/llama-3.3-70b-versatile"  # safe default
    if agent_def and getattr(agent_def, "model", None):
        # prefer fast model — cheap & quick for this parsing task
        model_name = agent_def.model.fast or agent_def.model.primary or model_name

    from ...brain.models_registry import _build_model
    from langchain_core.messages import HumanMessage, SystemMessage

    system = (
        "You are an MCP (Model Context Protocol) server config parser. "
        "Given text in any format — YAML, JSON, npx command line, SSE URL, "
        "prose description, or Claude Desktop config snippet — extract the MCP server "
        "configuration and return ONLY a JSON object with exactly these fields:\n"
        '  "name": short slug identifier (lowercase, hyphens ok, e.g. "github")\n'
        '  "transport": "stdio" or "sse"\n'
        '  "command": executable to run (empty string if transport is sse)\n'
        '  "args": array of string arguments (empty array if none)\n'
        '  "env": object of environment variable names to placeholder values '
        '(use descriptive UPPER_CASE names like "GITHUB_TOKEN" for secrets — do NOT invent actual tokens)\n'
        '  "url": SSE endpoint URL (empty string if transport is stdio)\n\n'
        "Return ONLY the JSON object, no markdown, no explanation."
    )

    try:
        lm = _build_model(model_name)
        response = await lm.ainvoke([
            SystemMessage(content=system),
            HumanMessage(content=payload.raw.strip()),
        ])
        raw_json = response.content.strip()
        # strip markdown code fences if the model wrapped output anyway
        if raw_json.startswith("```"):
            raw_json = raw_json.split("```")[1]
            if raw_json.startswith("json"):
                raw_json = raw_json[4:]
        import json
        parsed = json.loads(raw_json)
        # Normalise to expected shape
        result = {
            "name": str(parsed.get("name", "mcp-server")).lower().replace(" ", "-"),
            "transport": parsed.get("transport", "stdio"),
            "command": parsed.get("command", ""),
            "args": [str(a) for a in parsed.get("args", [])],
            "env": {str(k): str(v) for k, v in parsed.get("env", {}).items()},
            "url": parsed.get("url", ""),
        }
        return result
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Parse failed: {exc}") from exc


class McpServerPayload(BaseModel):
    name: str
    transport: str = "stdio"
    command: str = ""
    args: list[str] = []
    env: dict[str, str] = {}
    url: str = ""


@router.put("/{agent_id}/mcp/{server_name}")
async def upsert_mcp_server(agent_id: str, server_name: str, payload: McpServerPayload):
    """Add or update a single MCP server entry in nuvex.yaml."""
    raw = _read_yaml()
    found = False
    for a in raw.get("agents", []):
        if a.get("name") == agent_id:
            if "mcp_servers" not in a:
                a["mcp_servers"] = {}
            entry: dict = {"transport": payload.transport}
            if payload.transport == "sse":
                entry["url"] = payload.url
            else:
                entry["command"] = payload.command
                entry["args"] = payload.args
            if payload.env:
                entry["env"] = payload.env
            a["mcp_servers"][server_name] = entry
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in config")
    _write_yaml(raw)
    get_cached_config.cache_clear()
    return {"agent_id": agent_id, "server_name": server_name, "updated": True}


@router.delete("/{agent_id}/mcp/{server_name}")
async def delete_mcp_server(agent_id: str, server_name: str):
    """Remove an MCP server entry from nuvex.yaml."""
    raw = _read_yaml()
    found = False
    for a in raw.get("agents", []):
        if a.get("name") == agent_id:
            mcp = a.get("mcp_servers", {})
            if server_name not in mcp:
                raise HTTPException(status_code=404, detail=f"MCP server '{server_name}' not found")
            del mcp[server_name]
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in config")
    _write_yaml(raw)
    get_cached_config.cache_clear()
    return {"agent_id": agent_id, "server_name": server_name, "deleted": True}
