"""Dashboard workspace router — view and edit agent workspace files."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...shared.config import get_cached_config

router = APIRouter(prefix="/api/workspace", tags=["workspace"])

_MAX_SIZE = 256 * 1024  # 256 KB safety cap per file read


def _workspace_root(agent_id: str) -> Path:
    cfg = get_cached_config()
    agent = cfg.agents.get(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    workspace = agent.workspace or f"data/agents/{agent_id}/workspace"
    root = Path(workspace)
    if not root.is_absolute():
        root = Path(os.environ.get("NUVEX_WORKSPACE_BASE", "/app")) / root
    if not root.is_dir():
        raise HTTPException(status_code=404, detail="Workspace directory not found")
    return root


@router.get("/{agent_id}/files")
async def list_workspace_files(agent_id: str):
    root = _workspace_root(agent_id)
    files = []
    for path in sorted(root.rglob("*")):
        if path.is_file():
            rel = path.relative_to(root).as_posix()
            files.append({"path": rel, "size": path.stat().st_size})
    return {"agent_id": agent_id, "files": files}


@router.get("/{agent_id}/files/{file_path:path}")
async def read_workspace_file(agent_id: str, file_path: str):
    root = _workspace_root(agent_id)
    full = (root / file_path).resolve()
    # Guard against path traversal
    if not full.is_relative_to(root.resolve()):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not full.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if full.stat().st_size > _MAX_SIZE:
        raise HTTPException(status_code=413, detail="File too large to read via API")
    return {"path": file_path, "content": full.read_text(encoding="utf-8", errors="replace")}


class FileWrite(BaseModel):
    content: str


@router.put("/{agent_id}/files/{file_path:path}", status_code=204)
async def write_workspace_file(agent_id: str, file_path: str, body: FileWrite):
    root = _workspace_root(agent_id)
    full = (root / file_path).resolve()
    if not full.is_relative_to(root.resolve()):
        raise HTTPException(status_code=400, detail="Invalid path")
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(body.content, encoding="utf-8")
