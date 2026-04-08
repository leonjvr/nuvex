"""OpenClaw → NUVEX import utilities — tasks 14.2–14.6.

Provides:
  - ``parse_openclaw_config``   — load and sanitize openclaw.json
  - ``map_to_divisions_yaml``   — generate a NUVEX agent entry
  - ``list_api_keys``           — scan .env for transferable keys (14.6)
  - ``copy_workspace_files``    — copy .md + skills/ bootstrap files (14.3)
  - ``map_baileys_credentials`` — detect and map Baileys credential path (14.4)
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Bootstrap files that should be migrated workspace-to-workspace.
_BOOTSTRAP_FILES = [
    "SOUL.md", "AGENTS.md", "TOOLS.md", "IDENTITY.md",
    "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md", "MEMORY.md",
]

# API key names we care about listing for manual transfer.
_KNOWN_API_KEY_NAMES = {
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "COHERE_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "PERPLEXITY_API_KEY",
    "TOGETHER_API_KEY",
    "MISTRAL_API_KEY",
    "ELEVENLABS_API_KEY",
}


# ---------------------------------------------------------------------------
# 14.2 — openclaw.json parsing (JSON5-tolerant)
# ---------------------------------------------------------------------------

def _sanitize_json5(raw: str) -> str:
    """Strip JSON5 extensions so the result is parseable by json.loads.

    Handles:
      - Single-line comments ``//``
      - Multi-line comments ``/* … */``
      - Trailing commas before ``}`` / ``]``
      - Single-quoted strings
      - Unquoted object keys
    """
    out = raw
    # Remove /* ... */ comments
    out = re.sub(r"/\*[\s\S]*?\*/", "", out)
    # Remove // comments (line-by-line to avoid stripping URLs)
    lines = []
    for line in out.split("\n"):
        in_str = False
        escaped = False
        for i, ch in enumerate(line):
            if escaped:
                escaped = False
                continue
            if ch == "\\":
                escaped = True
                continue
            if ch == '"' and not in_str:
                in_str = True
                continue
            if ch == '"' and in_str:
                in_str = False
                continue
            if not in_str and ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
                line = line[:i]
                break
        lines.append(line)
    out = "\n".join(lines)
    # Single-quoted strings → double-quoted
    out = re.sub(
        r"'((?:[^'\\]|\\.)*)'",
        lambda m: '"' + m.group(1).replace('\\"', '"').replace("\\'", "'").replace('"', '\\"') + '"',
        out,
    )
    # Unquoted object keys
    out = re.sub(r'([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*):', r'\1"\2"\3:', out)
    # Trailing commas
    out = re.sub(r",(\s*[}\]])", r"\1", out)
    return out


def parse_openclaw_config(config_path: str | Path) -> dict[str, Any]:
    """Load and parse an ``openclaw.json`` file.

    Accepts standard JSON and the JSON5 superset used by older OpenClaw
    installations.
    """
    path = Path(config_path)
    raw = path.read_text(encoding="utf-8")
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        sanitized = _sanitize_json5(raw)
        return json.loads(sanitized)


# ---------------------------------------------------------------------------
# Model provider mapping
# ---------------------------------------------------------------------------

_MODEL_ALIASES: dict[str, str] = {
    "claude": "anthropic/claude-sonnet-4-20250514",
    "claude-sonnet": "anthropic/claude-sonnet-4-20250514",
    "claude-haiku": "anthropic/claude-haiku-4-20250514",
    "claude-opus": "anthropic/claude-opus-4-20250514",
    "gpt-4": "openai/gpt-4o",
    "gpt-4o": "openai/gpt-4o",
    "gpt-3.5": "openai/gpt-3.5-turbo",
    "llama": "groq/llama-3.3-70b",
    "gemini": "google/gemini-2.0-flash",
}


def _resolve_model(raw: str | None) -> str | None:
    if not raw:
        return None
    lower = raw.lower()
    for alias, resolved in _MODEL_ALIASES.items():
        if alias in lower:
            return resolved
    # Already looks like provider/model format
    if "/" in raw:
        return raw
    return raw


# ---------------------------------------------------------------------------
# 14.2 — Map openclaw config → NUVEX divisions.yaml agent block
# ---------------------------------------------------------------------------

def map_to_divisions_yaml(
    config: dict[str, Any],
    agent_id: str | None = None,
    openclaw_base: str | Path | None = None,
) -> dict[str, Any]:
    """Convert a parsed OpenClaw config dict to a NUVEX agent entry dict.

    The returned dict can be serialized with ``yaml.dump`` and appended to
    the agents list in ``config/nuvex.yaml`` or ``config/divisions.yaml``.

    Parameters
    ----------
    config:
        Parsed ``openclaw.json`` content.
    agent_id:
        Optional override for the agent name; defaults to
        ``config["identity"]["name"]`` lowercased or ``"agent"``.
    openclaw_base:
        Path to the openclaw installation root (``~/.openclaw``). Used to
        detect the Baileys credentials directory for task 14.4.
    """
    identity = config.get("identity", {})
    agent_cfg = config.get("agent", {})
    channels = config.get("channels", {})
    skills = config.get("skills", {})
    model_cfg = agent_cfg.get("model", {})

    name = agent_id or (identity.get("name") or "agent").lower().replace(" ", "_")

    workspace_path = agent_cfg.get("workspace") or f"/data/agents/{name}/workspace"

    primary = _resolve_model(model_cfg.get("primary"))
    fallback = _resolve_model(model_cfg.get("fallback"))

    entry: dict[str, Any] = {
        "name": name,
        "workspace": workspace_path,
        "model": {
            "primary": primary or "anthropic/claude-sonnet-4-20250514",
            "fast": "groq/llama-3.3-70b",
        },
        "budget": {
            "per_task_usd": 0.50,
            "daily_usd": 5.0,
            "monthly_usd": 50.0,
        },
        "compaction": {
            "threshold": 50,
            "preserve_recent": 10,
            "summary_max_tokens": 2000,
            "mode": "safeguard",
        },
        "recovery": {
            "llm_retries": 2,
            "llm_retry_delay_seconds": 5,
        },
    }

    if fallback:
        entry["model"]["fallback"] = fallback

    # --- Channels ---
    channel_block: dict[str, Any] = {}

    wa = channels.get("whatsapp", {})
    if wa is not None:
        allow_from = wa.get("allowFrom") or []
        groups = wa.get("groups", {}) or {}
        channel_block["whatsapp"] = {
            "enabled": True,
            "dm_policy": "pairing",
            "group_policy": "allowlist" if allow_from or groups else "deny",
        }

    tg = channels.get("telegram", {})
    if tg is not None:
        channel_block["telegram"] = {
            "enabled": True,
            "dm_policy": "pairing",
            "group_policy": "allowlist",
            "require_mention": True,
        }

    channel_block.setdefault("email", {"enabled": False})

    if channel_block:
        entry["channels"] = channel_block

    # --- Skills ---
    skill_entries = (skills.get("entries") or {}) if skills else {}
    enabled_skills = [k for k, v in skill_entries.items() if (v or {}).get("enabled", True)]
    if enabled_skills:
        entry["skills"] = enabled_skills

    # --- Baileys credential mount (14.4) ---
    if openclaw_base:
        creds_dir = Path(openclaw_base) / "credentials"
        if creds_dir.exists():
            entry["_baileys_credentials_path"] = str(creds_dir)

    return entry


# ---------------------------------------------------------------------------
# 14.3 — Workspace file copy
# ---------------------------------------------------------------------------

def copy_workspace_files(
    openclaw_base: str | Path,
    dest_workspace: str | Path,
    include_skills: bool = True,
) -> list[str]:
    """Copy OpenClaw bootstrap .md files (and optionally skills/) to dest.

    Returns a list of paths that were copied.
    """
    src_ws = Path(openclaw_base) / "workspace"
    dest_ws = Path(dest_workspace)
    dest_ws.mkdir(parents=True, exist_ok=True)

    copied: list[str] = []

    for fname in _BOOTSTRAP_FILES:
        src_file = src_ws / fname
        if src_file.exists():
            dst = dest_ws / fname
            shutil.copy2(src_file, dst)
            copied.append(str(dst))
            log.debug("copied %s → %s", src_file, dst)

    # Also copy any .md file not in the static list
    for md_file in src_ws.glob("*.md"):
        if md_file.name not in _BOOTSTRAP_FILES:
            dst = dest_ws / md_file.name
            shutil.copy2(md_file, dst)
            copied.append(str(dst))

    if include_skills:
        src_skills = src_ws / "skills"
        if src_skills.exists():
            dest_skills = dest_ws / "skills"
            if dest_skills.exists():
                shutil.rmtree(dest_skills)
            shutil.copytree(src_skills, dest_skills)
            copied.append(str(dest_skills))
            log.debug("copied skills/ → %s", dest_skills)

    return copied


# ---------------------------------------------------------------------------
# 14.4 — Baileys credential mapping
# ---------------------------------------------------------------------------

def map_baileys_credentials(openclaw_base: str | Path) -> str | None:
    """Return the Baileys credential directory path if it exists, else None."""
    creds = Path(openclaw_base) / "credentials"
    return str(creds) if creds.exists() else None


# ---------------------------------------------------------------------------
# 14.6 — API key listing from .env
# ---------------------------------------------------------------------------

def list_api_keys(openclaw_base: str | Path) -> dict[str, str]:
    """Scan OpenClaw's .env for known API keys to transfer manually.

    Returns a dict of key_name → masked_value (first 4 + ****).
    """
    env_path = Path(openclaw_base) / ".env"
    if not env_path.exists():
        return {}

    found: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key in _KNOWN_API_KEY_NAMES and value:
            # Mask all but first 4 chars
            visible = value[:4]
            found[key] = f"{visible}{'*' * min(len(value) - 4, 20)}"

    return found
