"""ShellTool — executes a shell command and returns stdout/stderr."""
from __future__ import annotations

import asyncio
import os
import re

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Hard enforcement: the shell tool may ONLY run approved skill scripts.
# Direct SSH commands that write files or execute inline code are forbidden.
# ---------------------------------------------------------------------------
_SKILL_SCRIPTS_ROOT = "/data/agents/maya/workspace/skills/"

# Patterns that are always blocked — even if prefixed with a skill path
_BLOCKED_PATTERNS = [
    # ssh with inline command execution (the shortcut Maya keeps taking)
    re.compile(r'\bssh\b.*@.*"'),
    re.compile(r"\bssh\b.*@.*'"),
    # Inline writes via echo/printf/tee/cat redirection
    re.compile(r"\becho\b.*>"),
    re.compile(r"\bprintf\b.*>"),
    re.compile(r"\btee\b\s"),
    re.compile(r"\bcat\b.*>"),
    # sed/awk in-place edits
    re.compile(r"\bsed\b\s+-i"),
    re.compile(r"\bawk\b.*>"),
    # curl/wget piped to shell
    re.compile(r"\bcurl\b.*\|\s*(ba)?sh"),
    re.compile(r"\bwget\b.*\|\s*(ba)?sh"),
]


def _validate_command(command: str) -> str | None:
    """Return an error string if the command is forbidden, else None."""
    import logging as _logging
    _log = _logging.getLogger(__name__)
    stripped = command.strip()
    _log.warning("shell_tool: _validate_command called with:\n%s", stripped)
    # Must start with the skill scripts root (absolute path to an approved script)
    if not stripped.startswith(_SKILL_SCRIPTS_ROOT):
        msg = (
            "[blocked] The shell tool may only run skill scripts located under "
            f"{_SKILL_SCRIPTS_ROOT}. "
            "Direct SSH commands, inline writes, sed -i, and other shortcuts are forbidden. "
            "Use the approved script: e.g. /data/agents/maya/workspace/skills/dev-server/scripts/copilot.sh"
        )
        _log.warning("shell_tool: BLOCKED command: %.200s", stripped)
        return msg
    # Even approved-path commands must not contain inline write patterns
    for pat in _BLOCKED_PATTERNS:
        if pat.search(stripped):
            return (
                f"[blocked] Command matches forbidden pattern '{pat.pattern}'. "
                "Inline file edits are never allowed. Use copilot.sh to make code changes."
            )
    return None


class _ShellInput(BaseModel):
    command: str = Field(description="Shell command to execute — must be a skill script under /data/agents/maya/workspace/skills/")
    timeout: int = Field(default=600, description="Timeout in seconds (default 600 — dev server ops can take several minutes)")
    working_dir: str | None = Field(default=None, description="Working directory for the command (optional)")
    env: dict[str, str] | None = Field(default=None, description="Additional environment variables to merge (optional)")


class ShellTool(BaseTool):
    name: str = "shell"
    description: str = (
        "Execute a skill script and return stdout + stderr. "
        "ONLY scripts under /data/agents/maya/workspace/skills/ are permitted. "
        "Example: shell(command='/data/agents/maya/workspace/skills/dev-server/scripts/list.sh'). "
        "Direct SSH, sed -i, echo >, or any inline file-write commands will be blocked."
    )
    args_schema: type[BaseModel] = _ShellInput

    async def _arun(self, command: str, timeout: int = 600, working_dir: str | None = None, env: dict[str, str] | None = None) -> str:  # type: ignore[override]
        import logging as _logging
        _log = _logging.getLogger(__name__)
        _log.warning("shell_tool._arun ENTERED:\n%s", command)
        block_msg = _validate_command(command)
        if block_msg:
            _log.warning("shell_tool._arun BLOCKED, returning message")
            return block_msg
        _log.warning("shell_tool._arun ALLOWED, executing subprocess")
        try:
            # Merge skill env vars if available
            merged_env = {**os.environ}
            if env:
                merged_env.update(env)
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=working_dir,
                env=merged_env,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            out = stdout.decode(errors="replace").strip()
            err = stderr.decode(errors="replace").strip()
            parts = [p for p in [out, err] if p]
            return "\n".join(parts) if parts else "[ok] (no output)"
        except asyncio.TimeoutError:
            return f"[error] Command timed out after {timeout}s"
        except Exception as exc:
            return f"[error] {exc}"

    def _run(self, command: str, timeout: int = 600, working_dir: str | None = None) -> str:  # type: ignore[override]
        return asyncio.run(self._arun(command, timeout, working_dir))
