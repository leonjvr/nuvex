"""Skill eligibility gating — checks binary and env-var requirements."""
from __future__ import annotations

import os
import shutil

from .parser import SkillMetadata


def check_skill_eligible(metadata: SkillMetadata) -> tuple[bool, str | None]:
    """Return (eligible, reason) for the given skill metadata.

    Checks:
      - metadata.openclaw.requires.bins  — each binary must be on PATH
      - metadata.openclaw.requires.env   — each env var must be non-empty

    Returns:
        (True, None) when all requirements are satisfied.
        (False, reason) describing the first unmet requirement.
    """
    for binary in metadata.openclaw.requires.bins:
        if shutil.which(binary) is None:
            return False, f"required binary not found on PATH: {binary}"

    for var in metadata.openclaw.requires.env:
        if not os.environ.get(var):
            return False, f"required env var not set: {var}"

    return True, None
