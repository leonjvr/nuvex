"""Skills API — upload, list, remove, and configure skill packages for agents."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/skills", tags=["skills"])

_DATA_ROOT = Path("/data/agents")


def _agent_skills_dir(agent_id: str) -> Path:
    return _DATA_ROOT / agent_id / "workspace" / "skills"


def _meta(skill_dir: Path) -> dict[str, Any]:
    meta_file = skill_dir / "_meta.json"
    if meta_file.is_file():
        try:
            return json.loads(meta_file.read_text())
        except Exception:
            pass
    return {"slug": skill_dir.name, "name": skill_dir.name}  # type: ignore[return-value]


@router.get("")
async def list_skills(agent_id: str = "maya") -> JSONResponse:
    """List all installed skills for an agent."""
    skills_dir = _agent_skills_dir(agent_id)
    if not skills_dir.is_dir():
        return JSONResponse({"skills": []})
    skills: list[dict[str, Any]] = []
    for entry in sorted(skills_dir.iterdir()):
        if entry.is_dir() and (entry / "SKILL.md").is_file():
            meta = _meta(entry)
            meta["has_scripts"] = (entry / "scripts").is_dir()
            skills.append(meta)
    return JSONResponse({"skills": skills})


@router.post("/upload")
async def upload_skill(
    file: UploadFile,
    agent_id: str = "maya",
    overwrite: bool = False,
) -> JSONResponse:
    """Upload a skill package as a ZIP file.

    The ZIP must contain a top-level directory with a ``SKILL.md`` inside.
    Optionally a ``scripts/`` directory and ``_meta.json``.

    Example ZIP layout::

        my-skill/
          SKILL.md
          _meta.json
          scripts/
            provision.sh
    """
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="File must be a .zip archive")

    content = await file.read()
    try:
        zf = zipfile.ZipFile(BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")

    # Detect the top-level directory name in the ZIP
    names = zf.namelist()
    if not names:
        raise HTTPException(status_code=400, detail="ZIP is empty")

    top_dirs = {n.split("/")[0] for n in names if "/" in n}
    if len(top_dirs) != 1:
        raise HTTPException(
            status_code=400,
            detail="ZIP must contain exactly one top-level directory",
        )
    skill_name = top_dirs.pop()

    # Validate that SKILL.md is present
    skill_md_path = f"{skill_name}/SKILL.md"
    if skill_md_path not in names:
        raise HTTPException(
            status_code=400,
            detail=f"ZIP must contain {skill_md_path}",
        )

    skills_dir = _agent_skills_dir(agent_id)
    dest = skills_dir / skill_name

    if dest.exists():
        if not overwrite:
            raise HTTPException(
                status_code=409,
                detail=f"Skill '{skill_name}' already exists. Pass overwrite=true to replace.",
            )
        shutil.rmtree(dest)

    skills_dir.mkdir(parents=True, exist_ok=True)
    zf.extractall(skills_dir)

    # Make scripts executable
    scripts_dir = dest / "scripts"
    if scripts_dir.is_dir():
        for script in scripts_dir.iterdir():
            if script.is_file():
                script.chmod(script.stat().st_mode | 0o111)

    meta = _meta(dest)
    return JSONResponse({"installed": skill_name, "meta": meta}, status_code=201)


@router.delete("/{skill_name}")
async def delete_skill(skill_name: str, agent_id: str = "maya") -> JSONResponse:
    """Remove an installed skill."""
    dest = _agent_skills_dir(agent_id) / skill_name
    if not dest.exists():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    shutil.rmtree(dest)
    return JSONResponse({"deleted": skill_name})


@router.get("/{skill_name}")
async def get_skill(skill_name: str, agent_id: str = "maya") -> JSONResponse:
    """Return metadata and SKILL.md content for a skill."""
    skill_dir = _agent_skills_dir(agent_id) / skill_name
    if not skill_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    meta = _meta(skill_dir)
    skill_md = skill_dir / "SKILL.md"
    meta["skill_md"] = skill_md.read_text() if skill_md.is_file() else ""
    scripts = []
    scripts_dir = skill_dir / "scripts"
    if scripts_dir.is_dir():
        scripts = [s.name for s in sorted(scripts_dir.iterdir()) if s.is_file()]
    meta["scripts"] = scripts
    return JSONResponse(meta)


# ── Credential settings ───────────────────────────────────────────────────────

def _resolve_path(raw: str) -> Path:
    """Expand ~ and env vars in a path string."""
    return Path(os.path.expandvars(os.path.expanduser(raw)))


def _read_credential(spec: dict[str, Any]) -> str:
    """Read current value for a credential entry from disk."""
    if "env_file" in spec:
        env_path = _resolve_path(spec["env_file"])
        if not env_path.is_file():
            return ""
        key = spec.get("key")
        if key:
            for line in env_path.read_text().splitlines():
                if line.startswith(f"{key}="):
                    return line[len(key) + 1:].strip()
            return ""
        return env_path.read_text()
    if "file" in spec:
        file_path = _resolve_path(spec["file"])
        if not file_path.is_file():
            return ""
        return file_path.read_text()
    return ""


def _write_credential(spec: dict[str, Any], value: str) -> None:
    """Write a credential value to the appropriate file."""
    if "env_file" in spec:
        env_path = _resolve_path(spec["env_file"])
        env_path.parent.mkdir(parents=True, exist_ok=True)
        key = spec.get("key")
        if key:
            lines = env_path.read_text().splitlines() if env_path.is_file() else []
            new_lines = [l for l in lines if not l.startswith(f"{key}=")]
            new_lines.append(f"{key}={value}")
            env_path.write_text("\n".join(new_lines) + "\n")
        else:
            env_path.write_text(value)
        return
    if "file" in spec:
        file_path = _resolve_path(spec["file"])
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(value)


async def _fetch_available_groups(channels: list[str]) -> dict[str, list]:
    """Fetch available groups per channel from the respective gateways."""
    result: dict[str, list] = {}
    for ch in channels:
        if ch == "whatsapp":
            gw = os.environ.get("GATEWAY_WA_URL", "http://gateway-wa:8101")
            try:
                async with httpx.AsyncClient(timeout=4) as client:
                    r = await client.get(f"{gw}/groups")
                    result["whatsapp"] = r.json() if r.status_code == 200 else []
            except Exception:
                result["whatsapp"] = []
        elif ch == "telegram":
            result["telegram"] = []  # TODO: implement when TG gateway exposes /groups
    return result


@router.get("/{skill_name}/settings")
async def get_skill_settings(skill_name: str, agent_id: str = "maya") -> JSONResponse:
    """Return current credential/config values for a skill."""
    skill_dir = _agent_skills_dir(agent_id) / skill_name
    if not skill_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    meta = _meta(skill_dir)
    credentials: dict[str, Any] = meta.get("credentials", {})
    values: dict[str, str] = {}
    for cred_key, spec in credentials.items():
        values[cred_key] = _read_credential(spec)

    # Build settings data for declared settings fields
    settings_spec: dict[str, Any] = meta.get("settings", {})
    settings_data: dict[str, Any] = {}
    for field_key, field_spec in settings_spec.items():
        if field_spec.get("type") == "project_bindings":
            file_path = _resolve_path(field_spec["file"])
            projects: dict[str, Any] = {}
            if file_path.is_file():
                try:
                    projects = json.loads(file_path.read_text())
                except Exception:
                    pass
            available_groups = await _fetch_available_groups(field_spec.get("channels", ["whatsapp"]))
            settings_data[field_key] = {
                **field_spec,
                "projects": projects,
                "available_groups": available_groups,
            }

    return JSONResponse({"credentials": credentials, "values": values, "settings": settings_data})


class SkillSettingsPayload(BaseModel):
    values: dict[str, str] = {}
    settings: dict[str, Any] = {}


@router.post("/{skill_name}/settings")
async def save_skill_settings(
    skill_name: str, payload: SkillSettingsPayload, agent_id: str = "maya"
) -> JSONResponse:
    """Write credential/config values for a skill."""
    skill_dir = _agent_skills_dir(agent_id) / skill_name
    if not skill_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    meta = _meta(skill_dir)
    credentials: dict[str, Any] = meta.get("credentials", {})
    saved: list[str] = []
    for cred_key, value in payload.values.items():
        if cred_key not in credentials:
            continue
        _write_credential(credentials[cred_key], value)
        saved.append(cred_key)
    # Handle settings fields (e.g. project_bindings written to a JSON file)
    settings_spec: dict[str, Any] = meta.get("settings", {})
    for field_key, field_spec in settings_spec.items():
        if field_spec.get("type") == "project_bindings" and field_key in payload.settings:
            file_path = _resolve_path(field_spec["file"])
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(json.dumps(payload.settings[field_key], indent=2))
            saved.append(field_key)
    return JSONResponse({"saved": saved})


# ── Skill script actions (streaming) ──────────────────────────────────────────

@router.get("/{skill_name}/actions/{action_name}")
async def run_skill_action(
    skill_name: str, action_name: str, agent_id: str = "maya"
) -> StreamingResponse:
    """Run a skill script action and stream its output as SSE text.

    Currently supported actions:
    - ``gh-login`` — run ``scripts/gh-login.sh`` in the brain container to
      authenticate with GitHub via browser device-flow and persist GH_TOKEN.
    """
    skill_dir = _agent_skills_dir(agent_id) / skill_name
    if not skill_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    script_path = skill_dir / "scripts" / f"{action_name}.sh"
    if not script_path.is_file():
        raise HTTPException(status_code=404, detail=f"Action script '{action_name}.sh' not found")

    async def event_stream():
        proc = await asyncio.create_subprocess_exec(
            "/bin/bash", str(script_path),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "TERM": "dumb", "BROWSER": "echo"},
        )
        assert proc.stdout is not None
        async for line in proc.stdout:
            yield f"data: {line.decode(errors='replace').rstrip()}\n\n"
        await proc.wait()
        yield f"data: [exit:{proc.returncode}]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Credential verification ────────────────────────────────────────────────────

@router.get("/{skill_name}/credentials/{cred_key}/verify")
async def verify_credential(
    skill_name: str, cred_key: str, agent_id: str = "maya"
) -> JSONResponse:
    """Verify a stored credential is still valid. Only GH_TOKEN is supported."""
    if cred_key != "GH_TOKEN":
        raise HTTPException(status_code=400, detail="Only GH_TOKEN verification is supported")

    skill_dir = _agent_skills_dir(agent_id) / skill_name
    if not skill_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")

    meta = _meta(skill_dir)
    cred_spec = (meta.get("credentials") or {}).get(cred_key, {})
    env_file = cred_spec.get("env_file")
    if not env_file:
        return JSONResponse({"valid": False, "reason": "No env_file configured"})

    token = None
    env_path = Path(env_file)
    if env_path.is_file():
        for line in env_path.read_text().splitlines():
            if line.startswith("GH_TOKEN="):
                token = line.split("=", 1)[1].strip()
                break

    if not token:
        return JSONResponse({"valid": False, "reason": "Token not set"})

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            )
        if resp.status_code == 200:
            data = resp.json()
            return JSONResponse({"valid": True, "login": data.get("login")})
        return JSONResponse({"valid": False, "reason": f"GitHub returned {resp.status_code}"})
    except Exception as e:
        return JSONResponse({"valid": False, "reason": str(e)})
