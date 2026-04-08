"""Brain API — skill management endpoints (§7)."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func

from ...shared.config import get_cached_config
from ...shared.crypto import encrypt_env, decrypt_env
from ..db import get_session
from ..models.skill_config import AgentSkillConfig
from ..skills.resolver import resolve_skill_path
from ..skills.parser import parse_skill_md
from ..skills.schema_parser import parse_env_example, parse_config_schema

router = APIRouter(prefix="/skills", tags=["skills"])


# ── response schemas ──────────────────────────────────────────────────────────

class SkillSummary(BaseModel):
    name: str
    description: str
    agent_count: int = 0


class SkillFieldSchema(BaseModel):
    name: str
    required: bool
    secret: bool
    description: str
    default: str | None
    type: str


class AgentSkillStatus(BaseModel):
    skill_name: str
    enabled: bool
    status: str  # "configured" | "unconfigured" | "missing-required"
    config_json: dict[str, Any] | None


class AgentSkillDetail(BaseModel):
    skill_name: str
    enabled: bool
    config_json: dict[str, Any] | None
    env_keys: list[str]  # env var names present (values masked)


class UpsertSkillRequest(BaseModel):
    enabled: bool = True
    env: dict[str, str] | None = None  # plaintext — encrypted before storage
    config_json: dict[str, Any] | None = None


# ── helpers ───────────────────────────────────────────────────────────────────

_GLOBAL_LIBRARY = "/data/skills"


def _get_skill_schema(skill_name: str, workspace: str | None) -> list:
    """Try to load a skill schema from env.example or config.schema.json."""
    search_dirs: list[Path] = []
    if workspace:
        wp = Path(workspace) / "skills" / skill_name
        if wp.is_dir():
            search_dirs.append(wp)
    gp = Path(_GLOBAL_LIBRARY) / skill_name
    if gp.is_dir():
        search_dirs.append(gp)

    for d in search_dirs:
        schema_file = d / "config.schema.json"
        if schema_file.is_file():
            return parse_config_schema(schema_file)
        env_example = d / ".env.example"
        if env_example.is_file():
            return parse_env_example(env_example)
    return []


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[SkillSummary])
async def list_global_skills() -> list[SkillSummary]:
    """List all skills in the global library with description and agent usage count."""
    global_lib = Path(_GLOBAL_LIBRARY)
    if not global_lib.is_dir():
        return []

    results: list[SkillSummary] = []
    async with get_session() as session:
        # Aggregate usage counts
        counts_rows = await session.execute(
            select(AgentSkillConfig.skill_name, func.count().label("cnt"))
            .group_by(AgentSkillConfig.skill_name)
        )
        counts: dict[str, int] = {row.skill_name: row.cnt for row in counts_rows}

    for skill_dir in sorted(global_lib.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            continue
        try:
            meta = parse_skill_md(skill_md)
            results.append(SkillSummary(
                name=skill_dir.name,
                description=meta.description,
                agent_count=counts.get(skill_dir.name, 0),
            ))
        except Exception:
            pass
    return results


@router.get("/{skill_name}/schema", response_model=list[SkillFieldSchema])
async def get_skill_schema(skill_name: str) -> list[SkillFieldSchema]:
    """Return parsed config schema for a skill."""
    fields = _get_skill_schema(skill_name, None)
    return [SkillFieldSchema(**f.__dict__) for f in fields]


@router.get("/agents/{agent_id}/skills", response_model=list[AgentSkillStatus])
async def list_agent_skills(agent_id: str) -> list[AgentSkillStatus]:
    """List all skills for an agent with configuration status."""
    cfg = get_cached_config()
    agent_def = cfg.agents.get(agent_id)
    if agent_def is None:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    async with get_session() as session:
        rows = await session.scalars(
            select(AgentSkillConfig).where(AgentSkillConfig.agent_id == agent_id)
        )
        configs: dict[str, AgentSkillConfig] = {r.skill_name: r for r in rows}

    results: list[AgentSkillStatus] = []
    for skill_name in agent_def.skills:
        row = configs.get(skill_name)
        schema_fields = _get_skill_schema(skill_name, agent_def.workspace)
        required_names = {f.name for f in schema_fields if f.required}

        if row is None:
            status = "missing-required" if required_names else "unconfigured"
            results.append(AgentSkillStatus(
                skill_name=skill_name,
                enabled=False,
                status=status,
                config_json=None,
            ))
        else:
            env_keys: list[str] = []
            if row.env_encrypted:
                try:
                    env_dict = decrypt_env(row.env_encrypted)
                    env_keys = list(env_dict.keys())
                except Exception:
                    pass
            configured = not required_names or bool(required_names & set(env_keys))
            results.append(AgentSkillStatus(
                skill_name=skill_name,
                enabled=row.enabled,
                status="configured" if configured else "missing-required",
                config_json=row.config_json,
            ))
    return results


@router.get("/agents/{agent_id}/skills/{skill_name}", response_model=AgentSkillDetail)
async def get_agent_skill(agent_id: str, skill_name: str) -> AgentSkillDetail:
    """Get config for one agent-skill pair (env values masked)."""
    async with get_session() as session:
        row = await session.scalar(
            select(AgentSkillConfig).where(
                AgentSkillConfig.agent_id == agent_id,
                AgentSkillConfig.skill_name == skill_name,
            )
        )
    if row is None:
        raise HTTPException(status_code=404, detail="Skill config not found")

    env_keys: list[str] = []
    if row.env_encrypted:
        try:
            env_keys = list(decrypt_env(row.env_encrypted).keys())
        except Exception:
            pass

    return AgentSkillDetail(
        skill_name=row.skill_name,
        enabled=row.enabled,
        config_json=row.config_json,
        env_keys=env_keys,
    )


@router.put("/agents/{agent_id}/skills/{skill_name}")
async def upsert_agent_skill(
    agent_id: str, skill_name: str, body: UpsertSkillRequest
) -> dict:
    """Create or update agent-skill config. Validates against schema."""
    # Validate required fields when env is provided
    cfg = get_cached_config()
    agent_def = cfg.agents.get(agent_id)
    workspace = agent_def.workspace if agent_def else None
    schema_fields = _get_skill_schema(skill_name, workspace)
    required_names = {f.name for f in schema_fields if f.required}
    env = body.env or {}
    missing = required_names - set(env.keys())
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Missing required env vars: {', '.join(sorted(missing))}",
        )

    encrypted: bytes | None = None
    if env:
        encrypted = encrypt_env(env)

    async with get_session() as session:
        row = await session.scalar(
            select(AgentSkillConfig).where(
                AgentSkillConfig.agent_id == agent_id,
                AgentSkillConfig.skill_name == skill_name,
            )
        )
        if row is None:
            row = AgentSkillConfig(
                id=uuid.uuid4(),
                agent_id=agent_id,
                skill_name=skill_name,
            )
            session.add(row)
        row.enabled = body.enabled
        if encrypted is not None:
            row.env_encrypted = encrypted
        if body.config_json is not None:
            row.config_json = body.config_json
        await session.commit()

    return {"status": "ok"}


@router.delete("/agents/{agent_id}/skills/{skill_name}")
async def delete_agent_skill(agent_id: str, skill_name: str) -> dict:
    """Remove agent-skill config."""
    async with get_session() as session:
        row = await session.scalar(
            select(AgentSkillConfig).where(
                AgentSkillConfig.agent_id == agent_id,
                AgentSkillConfig.skill_name == skill_name,
            )
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Skill config not found")
        await session.delete(row)
        await session.commit()
    return {"status": "deleted"}
