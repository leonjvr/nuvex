"""Load and validate divisions.yaml into NuvexConfig."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .models.config import AgentDefinition, ModelConfig, NuvexConfig


def _resolve_model(raw: Any) -> ModelConfig:
    """Accept either a string or a dict for model config."""
    if isinstance(raw, str):
        return ModelConfig(primary=raw)
    if isinstance(raw, dict):
        return ModelConfig(**raw)
    return ModelConfig()


def _parse_agent(raw: dict[str, Any]) -> AgentDefinition:
    if "model" in raw:
        raw = {**raw, "model": _resolve_model(raw["model"])}
    return AgentDefinition(**raw)


def load_config(path: str | Path | None = None) -> NuvexConfig:
    """Load divisions.yaml. Raises if not found and no DATABASE_URL fallback."""
    if path is None:
        path = Path(os.environ.get("NUVEX_CONFIG", "config/divisions.yaml"))
    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}")

    with path.open() as f:
        raw = yaml.safe_load(f) or {}

    # Parse agents list → dict keyed by agent name
    agents_raw = raw.pop("agents", [])
    parsed_agents = {a["name"]: _parse_agent(a) for a in agents_raw}

    cfg = NuvexConfig(**raw, agents=parsed_agents)

    # Fall back to DATABASE_URL env var
    if cfg.database.url is None:
        db_url = os.environ.get("DATABASE_URL")
        if db_url:
            cfg.database.url = db_url

    if cfg.database.url is None:
        raise ValueError(
            "No database configured. Set database.url in divisions.yaml "
            "or DATABASE_URL environment variable."
        )

    return cfg


def get_agent(cfg: NuvexConfig, agent_id: str) -> AgentDefinition | None:
    return cfg.agents.get(agent_id)


@lru_cache(maxsize=1)
def get_cached_config() -> NuvexConfig:
    return load_config()
