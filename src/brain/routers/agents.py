"""GET /agents — list registered agents from config."""
from __future__ import annotations

import json
import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...shared.config import get_cached_config
from ...shared.models.config import AgentDefinition

from ...shared.models.config import WhatsAppOrgConfig  # noqa: F401 (used below)

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentUpdateBody(BaseModel):
    lifecycle_state: str | None = None
    tools: list[str] | None = None


def _get_agent_or_404(agent_id: str) -> AgentDefinition:
    try:
        cfg = get_cached_config()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    agent = cfg.agents.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    return agent


@router.delete("/{agent_id}", status_code=204, response_model=None)
async def delete_agent(agent_id: str) -> None:
    agent = _get_agent_or_404(agent_id)
    if agent.system:
        raise HTTPException(
            status_code=403,
            detail=f"Agent '{agent_id}' is a system agent and cannot be deleted",
        )
    # Config-only agents have no DB row to delete — return 204
    return None


@router.patch("/{agent_id}")
async def update_agent(agent_id: str, body: AgentUpdateBody) -> dict:
    agent = _get_agent_or_404(agent_id)

    if agent.system:
        if body.lifecycle_state == "suspended":
            raise HTTPException(
                status_code=403,
                detail=f"Agent '{agent_id}' is a system agent and cannot be suspended",
            )
        if body.tools is not None and len(body.tools) == 0:
            raise HTTPException(
                status_code=403,
                detail=f"Agent '{agent_id}' is a system agent; tool list cannot be set to empty",
            )

    return {"agent_id": agent_id, "updated": True}


@router.get("/{agent_id}/email-config", response_model=dict)
async def get_agent_email_config(agent_id: str) -> dict:
    """Return the email channel config for an agent (read from nuvex.yaml).

    Called by the gateway-email container at startup so credentials are read
    from the user-configured YAML, not baked into env vars.
    The email_pass field is always returned in full (it is a gateway secret).
    """
    agent = _get_agent_or_404(agent_id)
    ch = agent.channels
    if ch is None:
        return {}
    email = ch.email
    return {
        "enabled": email.enabled,
        "imap_host": email.imap_host,
        "imap_port": email.imap_port,
        "smtp_host": email.smtp_host,
        "smtp_port": email.smtp_port,
        "email_user": email.email_user,
        "email_pass": email.email_pass,
    }


@router.get("/whatsapp-config", response_model=WhatsAppOrgConfig)
async def get_whatsapp_org_config() -> WhatsAppOrgConfig:
    """Returns the org-level WhatsApp config (including humanise settings)."""
    try:
        cfg = get_cached_config()
        return cfg.whatsapp
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("", response_model=dict[str, AgentDefinition])
async def list_agents() -> dict[str, AgentDefinition]:
    try:
        cfg = get_cached_config()
        return cfg.agents
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{agent_id}/projects")
async def get_agent_projects(agent_id: str) -> dict:
    """Return the projects.json registry for an agent's Dev Server skill."""
    try:
        cfg = get_cached_config()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    agent = cfg.agents.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    workspace = agent.workspace
    if not workspace:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' has no workspace")
    projects_path = os.path.join(workspace, "config", "projects.json")
    if not os.path.exists(projects_path):
        return {}
    try:
        with open(projects_path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{agent_id}", response_model=AgentDefinition)
async def get_agent(agent_id: str) -> AgentDefinition:
    try:
        cfg = get_cached_config()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    agent = cfg.agents.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    return agent


# ---------------------------------------------------------------------------
# §6.3 — Org-scoped agent endpoints: /api/v1/orgs/{org_id}/agents
# ---------------------------------------------------------------------------

org_agents_router = APIRouter(prefix="/orgs", tags=["orgs-agents"])


@org_agents_router.get("/{org_id}/agents", response_model=list[dict])
async def list_org_agents(org_id: str) -> list[dict]:
    """List all agents belonging to an organisation (from DB)."""
    from ..db import get_session
    from ..models.agent import Agent
    from .middleware import require_active_org
    from sqlalchemy import select
    async with get_session() as session:
        await require_active_org(org_id, session)
        result = await session.execute(
            select(Agent).where(Agent.org_id == org_id).order_by(Agent.name)
        )
        rows = list(result.scalars())
    return [{"id": r.id, "org_id": r.org_id, "name": r.name, "tier": r.tier,
             "division": r.division, "lifecycle_state": r.lifecycle_state} for r in rows]


@org_agents_router.get("/{org_id}/agents/{agent_id}", response_model=dict)
async def get_org_agent(org_id: str, agent_id: str) -> dict:
    """Return a single agent — validates it belongs to the org (3.3)."""
    from ..db import get_session
    from ..models.agent import Agent
    from .middleware import require_active_org
    async with get_session() as session:
        await require_active_org(org_id, session)
        agent = await session.get(Agent, agent_id)
        if agent is None or agent.org_id != org_id:
            raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found in org '{org_id}'")
    return {"id": agent.id, "org_id": agent.org_id, "name": agent.name, "tier": agent.tier,
            "division": agent.division, "lifecycle_state": agent.lifecycle_state}
