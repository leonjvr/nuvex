"""NUVEX CLI — admin utilities.

Usage:
    python -m src.brain.cli audit verify [--agent AGENT_ID]
    python -m src.brain.cli audit list   [--agent AGENT_ID] [--limit N]
    python -m src.brain.cli import openclaw [--config PATH] [--agent AGENT_ID]
                                            [--dest PATH] [--dry-run] [--skills]
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# audit verify
# ---------------------------------------------------------------------------

async def _audit_verify(agent_id: str | None) -> int:
    """Walk the governance_audit chain and report broken SHA-256 links.

    Returns the exit code (0 = clean, 1 = broken links found).
    """
    from .db import init_engine, get_session
    from .models.governance import GovernanceAudit
    from sqlalchemy import select

    init_engine()

    async with get_session() as session:
        q = select(GovernanceAudit).order_by(GovernanceAudit.id)
        if agent_id:
            q = q.where(GovernanceAudit.agent_id == agent_id)
        result = await session.execute(q)
        rows = result.scalars().all()

    if not rows:
        print("No audit entries found.")
        return 0

    broken = 0
    prev_hash: str | None = None

    for row in rows:
        # Recompute hash from action + tool_name + stage
        raw = json.dumps(
            {"tool": row.tool_name or "", "action": row.action, "stage": row.stage},
            sort_keys=True,
        )
        expected_hash = hashlib.sha256(raw.encode()).hexdigest()

        # Check stored hash matches recomputed
        if row.sha256_hash != expected_hash:
            print(
                f"[FAIL] id={row.id} agent={row.agent_id} "
                f"stored_hash={row.sha256_hash[:12]}… "
                f"expected={expected_hash[:12]}…"
            )
            broken += 1
        else:
            # Check chain continuity (prev_hash must match previous row's hash)
            if prev_hash is not None and row.prev_hash is not None:
                if row.prev_hash != prev_hash:
                    print(
                        f"[CHAIN] id={row.id} chain break: "
                        f"prev_hash={row.prev_hash[:12]}… "
                        f"expected={prev_hash[:12]}…"
                    )
                    broken += 1

        prev_hash = row.sha256_hash

    total = len(rows)
    if broken == 0:
        print(f"Audit chain OK — {total} entries verified.")
    else:
        print(f"\n{broken}/{total} entries failed verification.")
    return 1 if broken else 0


async def _audit_list(agent_id: str | None, limit: int) -> None:
    from .db import init_engine, get_session
    from .models.governance import GovernanceAudit
    from sqlalchemy import select

    init_engine()

    async with get_session() as session:
        q = (
            select(GovernanceAudit)
            .order_by(GovernanceAudit.id.desc())
            .limit(limit)
        )
        if agent_id:
            q = q.where(GovernanceAudit.agent_id == agent_id)
        result = await session.execute(q)
        rows = result.scalars().all()

    if not rows:
        print("No audit entries found.")
        return

    print(f"{'ID':<6} {'Agent':<20} {'Action':<30} {'Decision':<10} {'Stage':<20} {'Created'}")
    print("-" * 100)
    for row in reversed(rows):
        ts = row.created_at.strftime("%Y-%m-%d %H:%M:%S") if row.created_at else ""
        print(
            f"{row.id:<6} {row.agent_id:<20} {(row.action or '')[:28]:<30} "
            f"{row.decision:<10} {row.stage:<20} {ts}"
        )


# ---------------------------------------------------------------------------
# import openclaw
# ---------------------------------------------------------------------------

def _cmd_import_openclaw(args: argparse.Namespace) -> int:
    """Execute ``nuvex import openclaw``.

    Tasks 14.2 (mapping), 14.3 (workspace copy), 14.5 (dry-run), 14.6 (key
    listing) are all routed through here.
    """
    import yaml  # soft-dep; present via pyyaml in the venv

    from .import_openclaw import (
        parse_openclaw_config,
        map_to_divisions_yaml,
        copy_workspace_files,
        list_api_keys,
        map_baileys_credentials,
    )

    openclaw_base = Path(args.openclaw_base or Path.home() / ".openclaw")
    config_path = Path(args.config) if args.config else (openclaw_base / "openclaw.json")

    if not config_path.exists():
        print(f"[error] openclaw.json not found at {config_path}", file=sys.stderr)
        return 1

    try:
        config = parse_openclaw_config(config_path)
    except Exception as exc:
        print(f"[error] Failed to parse {config_path}: {exc}", file=sys.stderr)
        return 1

    entry = map_to_divisions_yaml(
        config,
        agent_id=args.agent or None,
        openclaw_base=openclaw_base,
    )

    # 14.6 — list API keys for manual transfer
    keys = list_api_keys(openclaw_base)
    if keys:
        print("\n=== API keys to transfer manually to NUVEX .env ===")
        for k, v in keys.items():
            print(f"  {k}={v}")

    # 14.4 — Baileys credentials
    creds = map_baileys_credentials(openclaw_base)
    if creds:
        print(f"\n=== Baileys credentials detected ===")
        print(f"  Add volume mount to docker-compose.local.yml:")
        print(f"    - {creds}:/data/baileys-credentials:ro")

    # 14.2 — show generated YAML
    print("\n=== Generated NUVEX agent entry (divisions.yaml) ===")
    # Remove internal _baileys_ key from output (already reported above)
    display_entry = {k: v for k, v in entry.items() if not k.startswith("_")}
    print(yaml.dump({"agents": [display_entry]}, default_flow_style=False, sort_keys=False))

    if args.dry_run:
        print("[dry-run] No files written.")
        return 0

    # 14.3 — workspace file copy
    if args.skills or not args.no_workspace:
        dest_workspace = args.dest or entry.get("workspace") or f"/data/agents/{entry['name']}/workspace"
        if Path(dest_workspace).exists() or args.force:
            copied = copy_workspace_files(
                openclaw_base=openclaw_base,
                dest_workspace=dest_workspace,
                include_skills=bool(args.skills),
            )
            if copied:
                print(f"\n=== Workspace files copied to {dest_workspace} ===")
                for p in copied:
                    print(f"  {p}")
        else:
            print(
                f"\n[skip] Destination workspace {dest_workspace!r} does not yet exist. "
                "Pass --force to create it."
            )

    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(prog="nuvex", description="NUVEX admin CLI")
    subparsers = parser.add_subparsers(dest="command")

    # audit subcommand
    audit_parser = subparsers.add_parser("audit", help="Governance audit tools")
    audit_sub = audit_parser.add_subparsers(dest="subcommand")

    # audit verify
    verify_parser = audit_sub.add_parser("verify", help="Verify SHA-256 audit chain integrity")
    verify_parser.add_argument("--agent", help="Filter by agent ID")

    # audit list
    list_parser = audit_sub.add_parser("list", help="List recent audit entries")
    list_parser.add_argument("--agent", help="Filter by agent ID")
    list_parser.add_argument("--limit", type=int, default=50, help="Max rows to show (default: 50)")

    # import subcommand
    import_parser = subparsers.add_parser("import", help="Import configuration from external platforms")
    import_sub = import_parser.add_subparsers(dest="import_subcommand")

    # import openclaw
    oc_parser = import_sub.add_parser("openclaw", help="Import OpenClaw agent config → NUVEX divisions.yaml")
    oc_parser.add_argument("--config", help="Path to openclaw.json (default: ~/.openclaw/openclaw.json)")
    oc_parser.add_argument("--openclaw-base", help="OpenClaw installation root (default: ~/.openclaw)")
    oc_parser.add_argument("--agent", help="Override agent name in generated config")
    oc_parser.add_argument("--dest", help="Override destination workspace path")
    oc_parser.add_argument("--dry-run", action="store_true", help="Display generated config without writing files")
    oc_parser.add_argument("--skills", action="store_true", help="Copy skill directories from OpenClaw workspace")
    oc_parser.add_argument("--no-workspace", action="store_true", help="Skip workspace file copy")
    oc_parser.add_argument("--force", action="store_true", help="Create destination workspace if it does not exist")

    # plugins subcommand
    plugins_parser = subparsers.add_parser("plugins", help="Plugin management")
    plugins_sub = plugins_parser.add_subparsers(dest="plugins_subcommand")
    pi_parser = plugins_sub.add_parser("import", help="Import an OpenClaw plugin")
    pi_parser.add_argument("path", help="Path to the OpenClaw plugin directory")

    args = parser.parse_args()

    if args.command == "audit":
        if args.subcommand == "verify":
            code = asyncio.run(_audit_verify(args.agent))
            sys.exit(code)
        elif args.subcommand == "list":
            asyncio.run(_audit_list(args.agent, args.limit))
        else:
            audit_parser.print_help()
    elif args.command == "import":
        if args.import_subcommand == "openclaw":
            sys.exit(_cmd_import_openclaw(args))
        else:
            import_parser.print_help()
    elif args.command == "plugins":
        if args.plugins_subcommand == "import":
            from .plugins import main_plugins
            sys.exit(main_plugins(["import", args.path]))
        else:
            plugins_parser.print_help()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
