"""Skill path resolver — agent workspace takes precedence over global library."""
from __future__ import annotations

from pathlib import Path


def resolve_skill_path(
    workspace_path: str,
    skill_name: str,
    global_library: str = "/data/skills",
) -> Path | None:
    """Return the directory containing the skill, or None if not found.

    Precedence:
      1. <workspace_path>/skills/<skill_name>/
      2. <global_library>/<skill_name>/

    A skill directory is considered valid when it contains a SKILL.md file.
    """
    workspace_skill = Path(workspace_path) / "skills" / skill_name
    if (workspace_skill / "SKILL.md").is_file():
        return workspace_skill

    global_skill = Path(global_library) / skill_name
    if (global_skill / "SKILL.md").is_file():
        return global_skill

    return None
