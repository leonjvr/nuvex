"""POST /api/skills/import-openclaw — import an OpenClaw skill ZIP and convert it for NUVEX."""
from __future__ import annotations

import json
import os
import re
import shutil
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/skills", tags=["skills"])

_DATA_ROOT = Path("/data/agents")
_BRAIN_URL = os.environ.get("BRAIN_URL", "http://brain:8100")

# Patterns rewritten deterministically in scripts (same logic as brain's skill_convert)
_PATH_PATTERN = re.compile(
    r"/home/node/\.openclaw/workspace/skills/(?P<skill>[^/\s\"']+)/scripts/",
    re.IGNORECASE,
)
_ACT_SH_PATTERN = re.compile(
    r"/(?:home/node/\.openclaw|root/\.openclaw)/workspace/skills/\S+/scripts/act\.sh\s+send\s+[^\n]+",
    re.IGNORECASE,
)
_OPENCLAW_MSG_PATTERN = re.compile(r"openclaw message send[^\n]+", re.IGNORECASE)


def _rewrite_script(content: str, agent_id: str) -> str:
    """Apply path substitutions inside script files."""
    def _replace_path(m: re.Match[str]) -> str:
        skill: str = m.group("skill") or m.group(0)
        return f"/data/agents/{agent_id}/workspace/skills/{skill}/scripts/"

    content = _PATH_PATTERN.sub(_replace_path, content)
    content = _ACT_SH_PATTERN.sub("# [NUVEX: mid-turn messaging not available]", content)
    content = _OPENCLAW_MSG_PATTERN.sub("# [NUVEX: use shell tool or delegate_to_agent]", content)
    return content


def _agent_skills_dir(agent_id: str) -> Path:
    return _DATA_ROOT / agent_id / "workspace" / "skills"


def _read_meta(skill_dir: Path) -> dict[str, Any]:
    meta_file = skill_dir / "_meta.json"
    if meta_file.is_file():
        try:
            return json.loads(meta_file.read_text())
        except Exception:
            pass
    return {"slug": skill_dir.name, "name": skill_dir.name}


async def _llm_convert_skill_md(skill_md: str, agent_id: str, skill_name: str) -> tuple[str, str]:
    """Call the brain /skill-convert endpoint to LLM-rewrite the SKILL.md."""
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{_BRAIN_URL}/skill-convert",
                json={"skill_md": skill_md, "agent_id": agent_id, "skill_name": skill_name},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["skill_md"], data.get("llm_used", "unknown")
    except Exception as exc:
        # Degrade gracefully — return the original (deterministically prepped) content
        return skill_md, f"error:{exc}"


@router.post("/import-openclaw")
async def import_openclaw_skill(
    file: UploadFile,
    agent_id: str = "maya",
    overwrite: bool = False,
) -> JSONResponse:
    """Import an OpenClaw skill ZIP and convert it for NUVEX.

    Performs two conversion passes:
    1. Deterministic: rewrites script paths + removes act.sh / openclaw-cli calls in all files
    2. LLM: semantically rewrites SKILL.md to remove OpenClaw-specific protocol and replace
       with NUVEX equivalents (mid-turn acks, escalation contacts, consciousness skill refs)

    The ZIP must follow the standard skill layout::

        my-skill/
          SKILL.md
          _meta.json        (optional)
          scripts/
            provision.sh    (optional)
    """
    if not file.filename or not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="File must be a .zip archive")

    content = await file.read()
    try:
        zf = zipfile.ZipFile(BytesIO(content))
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")

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

    skill_md_zip_path = f"{skill_name}/SKILL.md"
    if skill_md_zip_path not in names:
        raise HTTPException(
            status_code=400,
            detail=f"ZIP must contain {skill_md_zip_path}",
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

    # Extract to a temp directory first
    skills_dir.mkdir(parents=True, exist_ok=True)
    zf.extractall(skills_dir)

    # ── Pass 1: deterministic rewrite on all text files ───────────────────────
    for fpath in dest.rglob("*"):
        if not fpath.is_file():
            continue
        try:
            text = fpath.read_text(encoding="utf-8", errors="replace")
            rewritten = _rewrite_script(text, agent_id)
            if rewritten != text:
                fpath.write_text(rewritten, encoding="utf-8")
        except Exception:
            pass  # skip binary files

    # ── Pass 2: LLM rewrite of SKILL.md ──────────────────────────────────────
    skill_md_path = dest / "SKILL.md"
    raw_skill_md = skill_md_path.read_text(encoding="utf-8")
    converted_skill_md, llm_used = await _llm_convert_skill_md(raw_skill_md, agent_id, skill_name)
    skill_md_path.write_text(converted_skill_md, encoding="utf-8")

    # ── Make scripts executable ───────────────────────────────────────────────
    scripts_dir = dest / "scripts"
    if scripts_dir.is_dir():
        for script in scripts_dir.iterdir():
            if script.is_file():
                script.chmod(script.stat().st_mode | 0o111)

    meta = _read_meta(dest)
    return JSONResponse(
        {
            "imported": skill_name,
            "source": "openclaw",
            "llm_used": llm_used,
            "meta": meta,
        },
        status_code=201,
    )
