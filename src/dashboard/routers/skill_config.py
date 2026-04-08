"""Dashboard — skill config management endpoints (§8.1) using raw SQL."""
from __future__ import annotations

import json
import uuid as _uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text

from ...brain.db import get_session

router = APIRouter(prefix="/api/skill-config", tags=["skill-config"])

_GLOBAL_LIBRARY = "/data/skills"


@router.get("/agents/{agent_id}/skills")
async def list_agent_skill_configs(agent_id: str) -> JSONResponse:
    """List skill configs for an agent using raw SQL."""
    async with get_session() as session:
        rows = await session.execute(
            text(
                "SELECT skill_name, enabled, config_json "
                "FROM agent_skill_config WHERE agent_id = :agent_id"
            ),
            {"agent_id": agent_id},
        )
        configs = [
            {
                "skill_name": r.skill_name,
                "enabled": r.enabled,
                "config_json": r.config_json or {},
            }
            for r in rows
        ]
    return JSONResponse({"configs": configs})


@router.get("/agents/{agent_id}/skills/{skill_name}/schema")
async def get_skill_schema_for_agent(agent_id: str, skill_name: str) -> JSONResponse:
    """Return skill schema fields from .env.example or config.schema.json."""
    import re
    from pathlib import Path

    search_dirs: list[Path] = []
    agent_skills = Path("/data/agents") / agent_id / "workspace" / "skills" / skill_name
    if agent_skills.is_dir():
        search_dirs.append(agent_skills)
    global_skill = Path(_GLOBAL_LIBRARY) / skill_name
    if global_skill.is_dir():
        search_dirs.append(global_skill)

    for d in search_dirs:
        schema_file = d / "config.schema.json"
        if schema_file.is_file():
            raw = json.loads(schema_file.read_text(encoding="utf-8"))
            props = raw.get("properties", {})
            required = raw.get("required", [])
            fields = [
                {
                    "name": name,
                    "required": name in required,
                    "secret": spec.get("x-secret", False),
                    "description": spec.get("description", ""),
                    "type": spec.get("type", "string"),
                }
                for name, spec in props.items()
            ]
            return JSONResponse({"fields": fields})
        env_example = d / ".env.example"
        if env_example.is_file():
            lines = env_example.read_text(encoding="utf-8").splitlines()
            fields_out: list[dict[str, Any]] = []
            tags: dict[str, Any] = {}
            tag_re = re.compile(r"@(\w+)(?:\s+(.+))?")
            for line in lines:
                s = line.strip()
                if s.startswith("#"):
                    m = tag_re.match(s[1:].strip())
                    if m:
                        tags[m.group(1).lower()] = (m.group(2) or "").strip()
                elif "=" in s:
                    name, _, _ = s.partition("=")
                    fields_out.append(
                        {
                            "name": name.strip(),
                            "required": "required" in tags,
                            "secret": "secret" in tags,
                            "description": tags.get("description", ""),
                            "type": "string",
                        }
                    )
                    tags = {}
            return JSONResponse({"fields": fields_out})

    return JSONResponse({"fields": []})


class UpsertConfigRequest(BaseModel):
    enabled: bool = True
    env: dict[str, str] | None = None
    config_json: dict[str, Any] | None = None


@router.put("/agents/{agent_id}/skills/{skill_name}")
async def upsert_skill_config(
    agent_id: str, skill_name: str, body: UpsertConfigRequest
) -> JSONResponse:
    """Create or update skill config (raw SQL, encrypts env vars)."""
    encrypted: bytes | None = None
    if body.env:
        from ...shared.crypto import encrypt_env
        encrypted = encrypt_env(body.env)

    async with get_session() as session:
        existing = await session.execute(
            text(
                "SELECT id FROM agent_skill_config "
                "WHERE agent_id = :agent_id AND skill_name = :skill_name"
            ),
            {"agent_id": agent_id, "skill_name": skill_name},
        )
        row = existing.first()
        if row is None:
            await session.execute(
                text(
                    "INSERT INTO agent_skill_config "
                    "(id, agent_id, skill_name, enabled, env_encrypted, config_json) "
                    "VALUES (:id, :agent_id, :skill_name, :enabled, :env_encrypted, :cfg::jsonb)"
                ),
                {
                    "id": str(_uuid.uuid4()),
                    "agent_id": agent_id,
                    "skill_name": skill_name,
                    "enabled": body.enabled,
                    "env_encrypted": encrypted,
                    "cfg": json.dumps(body.config_json) if body.config_json else None,
                },
            )
        else:
            await session.execute(
                text(
                    "UPDATE agent_skill_config SET enabled = :enabled, "
                    "env_encrypted = COALESCE(:env_encrypted, env_encrypted), "
                    "config_json = COALESCE(:cfg::jsonb, config_json), "
                    "updated_at = now() "
                    "WHERE agent_id = :agent_id AND skill_name = :skill_name"
                ),
                {
                    "agent_id": agent_id,
                    "skill_name": skill_name,
                    "enabled": body.enabled,
                    "env_encrypted": encrypted,
                    "cfg": json.dumps(body.config_json) if body.config_json else None,
                },
            )
        await session.commit()

    return JSONResponse({"status": "ok"})


@router.delete("/agents/{agent_id}/skills/{skill_name}")
async def delete_skill_config(agent_id: str, skill_name: str) -> JSONResponse:
    """Remove skill config using raw SQL."""
    async with get_session() as session:
        result = await session.execute(
            text(
                "DELETE FROM agent_skill_config "
                "WHERE agent_id = :agent_id AND skill_name = :skill_name"
            ),
            {"agent_id": agent_id, "skill_name": skill_name},
        )
        await session.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Skill config not found")
    return JSONResponse({"status": "deleted"})

router = APIRouter(prefix="/api/skill-config", tags=["skill-config"])

_GLOBAL_LIBRARY = "/data/skills"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mask_env(env: dict[str, str]) -> dict[str, str]:
    """Return env dict with values replaced by masked placeholders."""
    return {k: "***" for k in env}


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/agents/{agent_id}/skills")
async def list_agent_skill_configs(agent_id: str) -> JSONResponse:
    """List skill configs for an agent using raw SQL (no brain model imports)."""
    async with get_raw_connection() as conn:
        rows = await conn.execute(
            text(
                "SELECT skill_name, enabled, config_json "
                "FROM agent_skill_config WHERE agent_id = :agent_id"
            ),
            {"agent_id": agent_id},
        )
        configs = [
            {
                "skill_name": r.skill_name,
                "enabled": r.enabled,
                "config_json": r.config_json or {},
            }
            for r in rows
        ]
    return JSONResponse({"configs": configs})


@router.get("/agents/{agent_id}/skills/{skill_name}/schema")
async def get_skill_schema_for_agent(agent_id: str, skill_name: str) -> JSONResponse:
    """Return skill schema fields from .env.example or config.schema.json."""
    from pathlib import Path

    search_dirs: list[Path] = []
    # Agent workspace first
    agent_skills = Path("/data/agents") / agent_id / "workspace" / "skills" / skill_name
    if agent_skills.is_dir():
        search_dirs.append(agent_skills)
    # Global library
    global_skill = Path(_GLOBAL_LIBRARY) / skill_name
    if global_skill.is_dir():
        search_dirs.append(global_skill)

    for d in search_dirs:
        schema_file = d / "config.schema.json"
        if schema_file.is_file():
            raw = json.loads(schema_file.read_text(encoding="utf-8"))
            props = raw.get("properties", {})
            required = raw.get("required", [])
            fields = [
                {
                    "name": name,
                    "required": name in required,
                    "secret": spec.get("x-secret", False),
                    "description": spec.get("description", ""),
                    "type": spec.get("type", "string"),
                }
                for name, spec in props.items()
            ]
            return JSONResponse({"fields": fields})
        env_example = d / ".env.example"
        if env_example.is_file():
            import re
            lines = env_example.read_text(encoding="utf-8").splitlines()
            fields: list[dict[str, Any]] = []
            tags: dict[str, Any] = {}
            tag_re = re.compile(r"@(\w+)(?:\s+(.+))?")
            for line in lines:
                s = line.strip()
                if s.startswith("#"):
                    m = tag_re.match(s[1:].strip())
                    if m:
                        tags[m.group(1).lower()] = (m.group(2) or "").strip()
                elif "=" in s:
                    name, _, _ = s.partition("=")
                    fields.append({
                        "name": name.strip(),
                        "required": "required" in tags,
                        "secret": "secret" in tags,
                        "description": tags.get("description", ""),
                        "type": "string",
                    })
                    tags = {}
            return JSONResponse({"fields": fields})

    return JSONResponse({"fields": []})


class UpsertConfigRequest(BaseModel):
    enabled: bool = True
    env: dict[str, str] | None = None
    config_json: dict[str, Any] | None = None


@router.put("/agents/{agent_id}/skills/{skill_name}")
async def upsert_skill_config(
    agent_id: str, skill_name: str, body: UpsertConfigRequest
) -> JSONResponse:
    """Create or update skill config using raw SQL. Encrypts env vars."""
    encrypted: bytes | None = None
    if body.env:
        from ...shared.crypto import encrypt_env
        encrypted = encrypt_env(body.env)

    async with get_raw_connection() as conn:
        existing = await conn.execute(
            text(
                "SELECT id FROM agent_skill_config "
                "WHERE agent_id = :agent_id AND skill_name = :skill_name"
            ),
            {"agent_id": agent_id, "skill_name": skill_name},
        )
        row = existing.first()

        if row is None:
            row_id = str(_uuid.uuid4())
            await conn.execute(
                text(
                    "INSERT INTO agent_skill_config "
                    "(id, agent_id, skill_name, enabled, env_encrypted, config_json) "
                    "VALUES (:id, :agent_id, :skill_name, :enabled, :env_encrypted, :config_json::jsonb)"
                ),
                {
                    "id": row_id,
                    "agent_id": agent_id,
                    "skill_name": skill_name,
                    "enabled": body.enabled,
                    "env_encrypted": encrypted,
                    "config_json": json.dumps(body.config_json) if body.config_json else None,
                },
            )
        else:
            await conn.execute(
                text(
                    "UPDATE agent_skill_config SET enabled = :enabled, "
                    "env_encrypted = COALESCE(:env_encrypted, env_encrypted), "
                    "config_json = COALESCE(:config_json::jsonb, config_json), "
                    "updated_at = now() "
                    "WHERE agent_id = :agent_id AND skill_name = :skill_name"
                ),
                {
                    "agent_id": agent_id,
                    "skill_name": skill_name,
                    "enabled": body.enabled,
                    "env_encrypted": encrypted,
                    "config_json": json.dumps(body.config_json) if body.config_json else None,
                },
            )
        await conn.commit()

    return JSONResponse({"status": "ok"})


@router.delete("/agents/{agent_id}/skills/{skill_name}")
async def delete_skill_config(agent_id: str, skill_name: str) -> JSONResponse:
    """Remove skill config using raw SQL."""
    async with get_raw_connection() as conn:
        result = await conn.execute(
            text(
                "DELETE FROM agent_skill_config "
                "WHERE agent_id = :agent_id AND skill_name = :skill_name"
            ),
            {"agent_id": agent_id, "skill_name": skill_name},
        )
        await conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Skill config not found")
    return JSONResponse({"status": "deleted"})


@router.get("/global-skills")
async def list_global_skills() -> JSONResponse:
    """List all global library skills with enabled-agent count (§8.2)."""
    from pathlib import Path

    skills_dir = Path(_GLOBAL_LIBRARY)
    if not skills_dir.is_dir():
        return JSONResponse({"skills": []})

    results: list[dict] = []
    for entry in sorted(skills_dir.iterdir()):
        if not entry.is_dir() or not (entry / "SKILL.md").is_file():
            continue
        skill_name = entry.name
        meta: dict = {}
        meta_file = entry / "_meta.json"
        if meta_file.is_file():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        async with get_session() as session:
            count_row = await session.execute(
                text(
                    "SELECT COUNT(*) FROM agent_skill_config "
                    "WHERE skill_name = :name AND enabled = true"
                ),
                {"name": skill_name},
            )
            agent_count = count_row.scalar() or 0

        results.append(
            {
                "name": skill_name,
                "display_name": meta.get("name", skill_name),
                "description": meta.get("description", ""),
                "version": meta.get("version"),
                "agent_count": agent_count,
            }
        )

    return JSONResponse({"skills": results})
