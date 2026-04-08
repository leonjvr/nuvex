"""SKILL.md parser — extracts YAML frontmatter and markdown body."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class OpenClawRequires:
    bins: list[str] = field(default_factory=list)
    env: list[str] = field(default_factory=list)


@dataclass
class OpenClawMetadata:
    requires: OpenClawRequires = field(default_factory=OpenClawRequires)
    tools: list[str] = field(default_factory=list)


@dataclass
class SkillMetadata:
    name: str = ""
    description: str = ""
    license: str = ""
    compatibility: list[str] = field(default_factory=list)
    allowed_tools: list[str] = field(default_factory=list)
    openclaw: OpenClawMetadata = field(default_factory=OpenClawMetadata)
    body: str = ""
    raw_frontmatter: dict[str, Any] = field(default_factory=dict)


def _parse_openclaw(raw: dict) -> OpenClawMetadata:
    oc = raw.get("openclaw", {}) or {}
    req = oc.get("requires", {}) or {}
    return OpenClawMetadata(
        requires=OpenClawRequires(
            bins=req.get("bins", []) or [],
            env=req.get("env", []) or [],
        ),
        tools=oc.get("tools", []) or [],
    )


def parse_skill_md(path: Path) -> SkillMetadata:
    """Parse a SKILL.md file and return a SkillMetadata instance.

    Supports YAML frontmatter delimited by ``---`` blocks.
    Falls back to empty metadata if no frontmatter is present.
    """
    text = path.read_text(encoding="utf-8")

    frontmatter: dict[str, Any] = {}
    body = text

    if text.startswith("---"):
        # Find the closing delimiter
        rest = text[3:]
        end = rest.find("\n---")
        if end != -1:
            yaml_block = rest[:end]
            body = rest[end + 4:].lstrip("\n")
            try:
                parsed = yaml.safe_load(yaml_block)
                if isinstance(parsed, dict):
                    frontmatter = parsed
            except yaml.YAMLError:
                pass

    compat = frontmatter.get("compatibility", [])
    if isinstance(compat, str):
        compat = [compat]

    allowed = frontmatter.get("allowed-tools", frontmatter.get("allowed_tools", []))
    if isinstance(allowed, str):
        allowed = [allowed]

    return SkillMetadata(
        name=frontmatter.get("name", ""),
        description=frontmatter.get("description", ""),
        license=frontmatter.get("license", ""),
        compatibility=compat,
        allowed_tools=allowed,
        openclaw=_parse_openclaw(frontmatter),
        body=body,
        raw_frontmatter=frontmatter,
    )
