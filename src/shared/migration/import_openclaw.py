"""OpenClaw → NUVEX migration helper.

Reads an openclaw.json and /workspace/ directory from a running OpenClaw deployment
and produces a NUVEX config/nuvex.yaml + workspace/ that NUVEX can consume directly.

Usage:
    python -m src.shared.migration.import_openclaw \\
        --openclaw-config /root/.openclaw/openclaw.json \\
        --workspace-src  /root/.openclaw/workspace \\
        --workspace-dst  workspace/ \\
        --output         config/nuvex.yaml
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

import yaml


# ---------------------------------------------------------------------------
# OpenClaw config parser
# ---------------------------------------------------------------------------

def _parse_openclaw_config(path: Path) -> dict[str, Any]:
    """Load and validate openclaw.json."""
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _extract_channels(cfg: dict) -> list[str]:
    channels = cfg.get("channels", {})
    return [name for name, ch in channels.items() if ch.get("enabled", True)]


def _extract_model(cfg: dict) -> dict[str, Any]:
    agents = cfg.get("agents", {})
    defaults = agents.get("defaults", {})
    model_cfg = defaults.get("model", {})
    primary = model_cfg.get("primary", "openai/gpt-4o-mini")
    fallback = model_cfg.get("fallback", "openai/gpt-4o-mini")
    return {"primary": primary, "fallback": fallback}


# ---------------------------------------------------------------------------
# NUVEX config builder
# ---------------------------------------------------------------------------

def _build_nuvex_config(
    openclaw_cfg: dict,
    agent_name: str,
    workspace_dst: str,
) -> dict[str, Any]:
    channels = _extract_channels(openclaw_cfg)
    model = _extract_model(openclaw_cfg)

    # Map OpenClaw model names to NUVEX provider/model format
    def _normalise_model(m: str) -> str:
        mapping = {
            "openai-codex/gpt-5.4": "openai/gpt-4o",
            "anthropic/claude-haiku-4-5": "anthropic/claude-haiku-20240307",
            "groq/llama3-70b-8192": "groq/llama-3.1-70b-versatile",
        }
        return mapping.get(m, m)

    return {
        "agents": {
            agent_name: {
                "name": agent_name,
                "description": f"Migrated from OpenClaw ({','.join(channels)})",
                "workspace_path": workspace_dst,
                "model": {
                    "primary": _normalise_model(model["primary"]),
                    "fallback": _normalise_model(model["fallback"]),
                },
                "routing": {
                    "simple_reply": {"model": _normalise_model(model["primary"]), "tier": "fast"},
                    "conversation": {"model": _normalise_model(model["primary"]), "tier": "standard"},
                    "code_generation": {"model": _normalise_model(model.get("fallback", model["primary"])), "tier": "smart"},
                    "voice_response": {"model": _normalise_model(model["primary"]), "tier": "fast"},
                },
                "budget": {
                    "daily_usd": 5.0,
                    "warn_at_fraction": 0.8,
                    "hard_stop": True,
                },
                "tools": ["shell", "read_file", "write_file", "http_get"],
                "compaction": {
                    "strategy": "summarise",
                    "max_messages": 200,
                    "keep_recent": 20,
                },
            }
        }
    }


# ---------------------------------------------------------------------------
# Workspace migration
# ---------------------------------------------------------------------------

_BOOTSTRAP_FILES = [
    "SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md",
    "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md",
]


def _migrate_workspace(src: Path, dst: Path) -> list[str]:
    """Copy bootstrap files and skills directory to the destination workspace."""
    dst.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []

    for fname in _BOOTSTRAP_FILES:
        src_file = src / fname
        if src_file.is_file():
            shutil.copy2(src_file, dst / fname)
            copied.append(fname)

    # Migrate skills/
    skills_src = src / "skills"
    if skills_src.is_dir():
        skills_dst = dst / "skills"
        if skills_dst.exists():
            shutil.rmtree(skills_dst)
        shutil.copytree(skills_src, skills_dst)
        skill_names = [d.name for d in skills_dst.iterdir() if d.is_dir()]
        copied.append(f"skills/: {', '.join(skill_names)}")

    return copied


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate OpenClaw config to NUVEX")
    parser.add_argument("--openclaw-config", required=True, help="Path to openclaw.json")
    parser.add_argument("--workspace-src", required=True, help="Source workspace directory")
    parser.add_argument("--workspace-dst", default="workspace", help="Destination workspace directory")
    parser.add_argument("--output", default="config/nuvex.yaml", help="Output NUVEX config YAML")
    parser.add_argument("--agent-name", default="maya", help="Agent name in NUVEX config (default: maya)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be written without creating any files",
    )
    parser.add_argument(
        "--list-keys",
        metavar="ENV_FILE",
        help="Scan an OpenClaw .env file and list API keys that need transferring to NUVEX",
    )
    args = parser.parse_args()

    # -- API key scan (independent of migration) ----------------------------
    if args.list_keys:
        _scan_api_keys(Path(args.list_keys))
        return

    openclaw_path = Path(args.openclaw_config)
    workspace_src = Path(args.workspace_src)
    workspace_dst = Path(args.workspace_dst)
    output_path = Path(args.output)

    print(f"Reading OpenClaw config from: {openclaw_path}")
    openclaw_cfg = _parse_openclaw_config(openclaw_path)

    nuvex_cfg = _build_nuvex_config(openclaw_cfg, args.agent_name, str(workspace_dst))
    yaml_output = yaml.dump(nuvex_cfg, default_flow_style=False, allow_unicode=True, sort_keys=False)

    if args.dry_run:
        print("[dry-run] No files will be written.\n")
        print(f"[dry-run] Would migrate workspace: {workspace_src} → {workspace_dst}")
        _migrate_workspace_dry(workspace_src, workspace_dst)
        print(f"\n[dry-run] Would write NUVEX config to: {output_path}\n")
        print(yaml_output)
        return

    print(f"Migrating workspace: {workspace_src} → {workspace_dst}")
    copied = _migrate_workspace(workspace_src, workspace_dst)
    for item in copied:
        print(f"  ✓ {item}")

    print(f"Generating NUVEX config → {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(yaml_output)

    print(f"\nMigration complete.")
    print(f"  Config:    {output_path}")
    print(f"  Workspace: {workspace_dst}/")
    print(f"\nNext steps:")
    print(f"  1. Review {output_path} and set correct model names / budget limits")
    print(f"  2. Copy .env.nuvex.example → .env and fill in secrets")
    print(f"  3. bash scripts/deploy-nuvex.sh")


# ---------------------------------------------------------------------------
# Dry-run helpers
# ---------------------------------------------------------------------------

def _migrate_workspace_dry(src: Path, dst: Path) -> None:
    for fname in _BOOTSTRAP_FILES:
        if (src / fname).is_file():
            print(f"  [dry-run] Would copy {fname} → {dst / fname}")
    skills_src = src / "skills"
    if skills_src.is_dir():
        for skill in sorted(skills_src.iterdir()):
            if skill.is_dir():
                print(f"  [dry-run] Would copy skill: {skill.name}/")


# ---------------------------------------------------------------------------
# API key scanner
# ---------------------------------------------------------------------------

_KEY_PATTERNS = [
    "api_key", "api_token", "secret", "_key", "_token", "password",
]


def _scan_api_keys(env_path: Path) -> None:
    """Print API keys found in an OpenClaw .env file so they can be transferred."""
    if not env_path.is_file():
        print(f"[error] File not found: {env_path}")
        return

    found: list[tuple[str, str]] = []
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key_lower = key.lower()
            if any(pat in key_lower for pat in _KEY_PATTERNS):
                # Mask the value for display
                masked = value[:4] + "****" if len(value) > 4 else "****"
                found.append((key.strip(), masked))

    if not found:
        print("No API keys found.")
        return

    print(f"Found {len(found)} API key(s) in {env_path}:")
    print(f"  {'Variable':<40}  {'Value (masked)'}")
    print(f"  {'-'*40}  {'-'*20}")
    for k, v in found:
        print(f"  {k:<40}  {v}")
    print(f"\nAdd these to your NUVEX .env / server .env as needed.")


if __name__ == "__main__":
    main()
