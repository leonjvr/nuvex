"""GET /agents — list registered agents from config."""
from __future__ import annotations

import json
import os

from fastapi import APIRouter, HTTPException

from ...shared.config import get_cached_config
from ...shared.models.config import AgentDefinition

from ...shared.models.config import WhatsAppOrgConfig  # noqa: F401 (used below)

router = APIRouter(prefix="/agents", tags=["agents"])


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
