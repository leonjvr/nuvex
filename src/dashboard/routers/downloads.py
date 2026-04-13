"""Dashboard: desktop agent download endpoints."""
from __future__ import annotations

import io
import json
import os
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse

router = APIRouter(prefix="/api/downloads", tags=["downloads"])

_PLATFORMS = [
    {"id": "windows", "label": "Windows", "coming_soon": False},
    {"id": "macos", "label": "macOS", "coming_soon": True},
    {"id": "linux", "label": "Linux", "coming_soon": True},
]

def _version() -> str:
    """Read version from <exe>.version file alongside the binary, fall back to env var."""
    exe_path = os.environ.get("DESKTOP_AGENT_DOWNLOAD_PATH", "")
    if exe_path:
        v_file = Path(exe_path + ".version")
        if v_file.is_file():
            return v_file.read_text().strip()
    return os.environ.get("DESKTOP_AGENT_VERSION", "0.2.0")


def _brain_public_url() -> str:
    """Return the publicly reachable brain URL to embed in the downloaded config."""
    return os.environ.get("BRAIN_PUBLIC_URL", "")


@router.get("/desktop-agent/latest")
async def get_latest_metadata() -> dict:
    return {
        "version": _version(),
        "platforms": _PLATFORMS,
        "brain_url": _brain_public_url(),
    }


@router.get("/desktop-agent/config")
async def download_config():
    """Return a pre-filled desktop-agent.json with the brain URL embedded."""
    brain_url = _brain_public_url()
    if not brain_url:
        raise HTTPException(
            status_code=404,
            detail="BRAIN_PUBLIC_URL is not configured on this server. Set it in the environment.",
        )
    config = {"brain_url": brain_url, "device_id": "", "auth_token": "", "desktop_mode": "ask", "idle_threshold_seconds": 60}
    content = json.dumps(config, indent=2).encode("utf-8")
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=desktop-agent.json"},
    )


@router.get("/desktop-agent/bundle/{platform}")
async def download_bundle(platform: str):
    """Return a ZIP containing the EXE and a pre-filled desktop-agent.json."""
    meta = next((p for p in _PLATFORMS if p["id"] == platform), None)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform}")
    if meta["coming_soon"]:
        raise HTTPException(status_code=404, detail=f"Platform '{platform}' not yet available")

    exe_path_str = os.environ.get("DESKTOP_AGENT_DOWNLOAD_PATH", "")
    exe_bytes: bytes | None = None
    if exe_path_str and Path(exe_path_str).is_file():
        exe_bytes = Path(exe_path_str).read_bytes()

    brain_url = _brain_public_url()
    config = {"brain_url": brain_url, "device_id": "", "auth_token": "", "desktop_mode": "ask", "idle_threshold_seconds": 60}
    config_bytes = json.dumps(config, indent=2).encode("utf-8")

    ver = _version()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_STORED) as zf:
        zf.writestr("desktop-agent.json", config_bytes)
        if exe_bytes:
            zf.writestr(f"nuvex-desktop-{ver}.exe", exe_bytes)
        else:
            # No binary yet — ship config only so users can still get pre-filled URL
            zf.writestr(
                "README.txt",
                f"NUVEX Desktop Agent v{ver}\n\nBrain URL: {brain_url or '(not configured)'}\n\nThe EXE is not yet available for download from this server.\n"
                "Download nuvex-desktop.exe separately and place it in the same folder as desktop-agent.json.\n"
                "Then run the EXE — the server URL will be pre-filled.\n",
            )
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=nuvex-desktop-{ver}-{platform}.zip"},
    )


@router.get("/desktop-agent/file/{platform}")
async def download_file(platform: str):
    meta = next((p for p in _PLATFORMS if p["id"] == platform), None)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Unknown platform: {platform}")
    if meta["coming_soon"]:
        raise HTTPException(status_code=404, detail=f"Platform '{platform}' not yet available")

    redirect_url = os.environ.get("DESKTOP_AGENT_DOWNLOAD_URL", "")
    if redirect_url:
        return RedirectResponse(url=redirect_url, status_code=302)

    download_path = os.environ.get("DESKTOP_AGENT_DOWNLOAD_PATH", "")
    if download_path and Path(download_path).is_file():
        return FileResponse(
            path=download_path,
            filename=f"nuvex-desktop-{_version()}.exe",
            media_type="application/octet-stream",
        )

    raise HTTPException(status_code=404, detail="Desktop agent binary not available yet")
