"""Desktop agent configuration — load/save from %APPDATA%\\Nuvex\\desktop-agent.json."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


class DesktopAgentConfig(BaseModel):
    brain_url: str = "http://localhost:9100"
    device_id: str = ""
    auth_token: str = ""
    desktop_mode: Literal["ask", "auto"] = "ask"
    idle_threshold_seconds: int = 60


def _config_path() -> Path:
    appdata = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
    return Path(appdata) / "Nuvex" / "desktop-agent.json"


def load_config() -> DesktopAgentConfig:
    path = _config_path()
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return DesktopAgentConfig(**data)
        except Exception:
            pass
    return DesktopAgentConfig()


def save_config(cfg: DesktopAgentConfig) -> None:
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(cfg.model_dump_json(indent=2), encoding="utf-8")


def is_first_run(cfg: DesktopAgentConfig) -> bool:
    return not cfg.brain_url or not cfg.auth_token
