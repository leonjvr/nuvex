"""Skill config schema parsers — .env.example and config.schema.json."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class SkillConfigField:
    name: str
    required: bool = False
    secret: bool = False
    description: str = ""
    default: str | None = None
    type: str = "string"


_TAG_RE = re.compile(r"@(\w+)(?:\s+(.+))?")


def parse_env_example(path: Path) -> list[SkillConfigField]:
    """Parse a .env.example file into SkillConfigField descriptors.

    Supported comment tags (on the line immediately above the var):
      # @required — field must be filled before activation
      # @secret   — value should be masked in the UI
      # @description <text> — human-readable description
      # @default <value>    — default value

    Lines starting with ``#`` that have no tags are treated as plain description.
    """
    fields: list[SkillConfigField] = []
    lines = path.read_text(encoding="utf-8").splitlines()

    pending_required = False
    pending_secret = False
    pending_description = ""
    pending_default: str | None = None

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            comment = stripped[1:].strip()
            m = _TAG_RE.match(comment)
            if m:
                tag = m.group(1).lower()
                value = (m.group(2) or "").strip()
                if tag == "required":
                    pending_required = True
                elif tag == "secret":
                    pending_secret = True
                elif tag == "description":
                    pending_description = value
                elif tag == "default":
                    pending_default = value
            else:
                # Plain comment — accumulate as description
                if comment and not pending_description:
                    pending_description = comment
            continue

        if "=" in stripped and not stripped.startswith("#"):
            name, _, default_val = stripped.partition("=")
            name = name.strip()
            default_val = default_val.strip().strip('"').strip("'") or None
            fields.append(
                SkillConfigField(
                    name=name,
                    required=pending_required,
                    secret=pending_secret,
                    description=pending_description,
                    default=pending_default or default_val,
                )
            )
            # Reset pending state
            pending_required = False
            pending_secret = False
            pending_description = ""
            pending_default = None
        elif not stripped:
            # Blank line resets accumulated context
            pending_required = False
            pending_secret = False
            pending_description = ""
            pending_default = None

    return fields


def parse_config_schema(path: Path) -> list[SkillConfigField]:
    """Parse a config.schema.json file into SkillConfigField descriptors.

    Expected JSON Schema structure:
    {
      "properties": {
        "MY_VAR": {
          "type": "string",
          "description": "...",
          "default": "...",
          "x-secret": true
        }
      },
      "required": ["MY_VAR"]
    }
    """
    raw = json.loads(path.read_text(encoding="utf-8"))
    properties: dict = raw.get("properties", {})
    required_names: list[str] = raw.get("required", [])
    fields: list[SkillConfigField] = []

    for name, spec in properties.items():
        fields.append(
            SkillConfigField(
                name=name,
                required=name in required_names,
                secret=bool(spec.get("x-secret", False)),
                description=spec.get("description", ""),
                default=spec.get("default"),
                type=spec.get("type", "string"),
            )
        )

    return fields
