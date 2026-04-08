"""SkillEnvInjectionHook — pre-tool-use hook that injects skill env vars.

Detects skill scripts by path, queries agent_skill_config, decrypts env,
and sets ctx.skill_env for use by the shell tool.
Falls back to .env file with a deprecation warning.
"""
from __future__ import annotations

import logging
import os

from . import HookContext, HookResult, register_pre_hook

log = logging.getLogger(__name__)

# Path prefix that identifies a skill script
_SKILL_PATH_PREFIX = "/data/agents/"


def _is_skill_command(command: str) -> tuple[bool, str | None]:
    """Return (True, skill_name) if *command* invokes a skill script."""
    stripped = command.strip()
    if not stripped.startswith(_SKILL_PATH_PREFIX):
        return False, None
    # Extract skill name from path: /data/agents/<agent>/workspace/skills/<skill>/…
    parts = stripped.split("/")
    try:
        skills_idx = parts.index("skills")
        return True, parts[skills_idx + 1]
    except (ValueError, IndexError):
        return False, None


async def skill_env_injection_hook(ctx: HookContext) -> HookResult | None:
    """Inject encrypted skill env vars from DB into HookContext.

    Only runs for shell tool calls. Tries DB first; falls back to legacy
    .env files with a deprecation warning.
    """
    if ctx.tool_name != "shell":
        return None

    command = (ctx.tool_input or {}).get("command", "")
    is_skill, skill_name = _is_skill_command(command)
    if not is_skill or not skill_name:
        return None

    ctx.skill_name = skill_name

    # Attempt DB lookup
    env_vars = await _load_from_db(ctx.agent_id, skill_name)
    if env_vars is not None:
        ctx.skill_env = env_vars
        return None

    # Fallback: scan workspace .env files (legacy / backward-compat)
    env_vars = _load_from_workspace(ctx.agent_id, skill_name)
    if env_vars:
        log.warning(
            "skill_env: agent=%s skill=%s — using legacy .env fallback; "
            "migrate credentials to agent_skill_config table",
            ctx.agent_id,
            skill_name,
        )
        ctx.skill_env = env_vars

    return None


async def _load_from_db(agent_id: str, skill_name: str) -> dict[str, str] | None:
    """Query agent_skill_config and decrypt env. Returns None if not found."""
    try:
        from ..db import get_session
        from ..models.skill_config import AgentSkillConfig
        from ...shared.crypto import decrypt_env
        from sqlalchemy import select

        async with get_session() as session:
            row = await session.scalar(
                select(AgentSkillConfig).where(
                    AgentSkillConfig.agent_id == agent_id,
                    AgentSkillConfig.skill_name == skill_name,
                    AgentSkillConfig.enabled.is_(True),
                )
            )
            if row is None:
                return None
            if row.env_encrypted:
                return decrypt_env(row.env_encrypted)
            return {}
    except Exception as exc:
        log.debug("skill_env: DB lookup failed (non-fatal): %s", exc)
        return None


def _load_from_workspace(agent_id: str, skill_name: str) -> dict[str, str]:
    """Load env vars from workspace skill .env files (legacy fallback)."""
    env_file = os.path.join(
        "/data/agents", agent_id, "workspace", "skills", skill_name, ".env"
    )
    result: dict[str, str] = {}
    if not os.path.isfile(env_file):
        return result
    try:
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                result[k.strip()] = v.strip().strip('"').strip("'")
    except Exception as exc:
        log.warning("skill_env: could not read legacy .env %s: %s", env_file, exc)
    return result


# Register as a pre-tool-use hook so it runs automatically on every tool call
register_pre_hook(skill_env_injection_hook)
