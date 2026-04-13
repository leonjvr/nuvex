"""Plugin Registry CLI — `nuvex plugins` subcommand group (§11)."""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path


async def _install(source: str, trust: bool) -> int:
    """11.2 — Install a plugin from local path, git URL, or PyPI."""
    # Determine source type and trust tier
    source_path = Path(source)
    if source_path.exists():
        trust_tier = "private"
        install_cmd = None
        log_source = str(source_path.resolve())
    elif source.startswith("git+") or source.startswith("https://") or ".git" in source:
        trust_tier = "private"
        install_cmd = ["uv", "add", source]
        log_source = source
    else:
        # PyPI package — requires --trust flag
        if not trust:
            print(
                f"ERROR: Installing from PyPI requires --trust flag.\n"
                f"  nuvex plugins install --trust {source}\n"
                f"This grants the plugin read access to your NUVEX environment."
            )
            return 1
        trust_tier = "community"
        # §12.2 — signature verification placeholder
        print(f"NOTE: Signature verification not yet implemented for '{source}'. "
              f"Classifying as 'community'.")
        install_cmd = ["uv", "add", source]
        log_source = f"pypi:{source}"

    if install_cmd:
        result = subprocess.run(install_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"ERROR: Install failed:\n{result.stderr}")
            return result.returncode

    # Record in plugin_registry
    try:
        from ..db import init_engine, get_session
        from ..models.plugin_registry import PluginRegistry
        from sqlalchemy import select
        import uuid

        init_engine()
        async with get_session() as session:
            plugin_id = source.split("/")[-1].replace(".git", "")
            existing = await session.execute(
                select(PluginRegistry).where(PluginRegistry.plugin_id == plugin_id)
            )
            row = existing.scalar_one_or_none()
            if not row:
                row = PluginRegistry(
                    id=uuid.uuid4(),
                    plugin_id=plugin_id,
                    name=plugin_id,
                    version="unknown",
                    source=log_source,
                    trust_tier=trust_tier,
                    permissions=[],
                )
                session.add(row)
                await session.commit()
        print(f"Plugin '{plugin_id}' installed (tier={trust_tier}). Restart brain to activate.")
    except Exception as exc:
        print(f"Plugin installed but DB registration failed: {exc}")

    return 0


async def _list_plugins(as_json: bool) -> int:
    """11.4 — List installed plugins."""
    from ..db import init_engine, get_session
    from ..models.plugin_registry import PluginRegistry
    from ..models.plugin_config import AgentPluginConfig
    from sqlalchemy import select, func

    init_engine()
    async with get_session() as session:
        result = await session.execute(select(PluginRegistry))
        rows = result.scalars().all()

        plugins = []
        for row in rows:
            usage_result = await session.execute(
                select(func.count()).select_from(AgentPluginConfig).where(
                    AgentPluginConfig.plugin_id == row.plugin_id
                )
            )
            agent_count = usage_result.scalar_one_or_none() or 0
            plugins.append({
                "id": row.plugin_id,
                "name": row.name,
                "version": row.version,
                "tier": row.trust_tier,
                "source": row.source or "",
                "agent_count": agent_count,
            })

    if as_json:
        print(json.dumps(plugins, indent=2))
    else:
        if not plugins:
            print("No plugins installed.")
            return 0
        print(f"{'ID':<30} {'NAME':<25} {'VERSION':<10} {'TIER':<12} {'AGENTS'}")
        print("-" * 85)
        for p in plugins:
            print(f"{p['id']:<30} {p['name']:<25} {p['version']:<10} {p['tier']:<12} {p['agent_count']}")
    return 0


async def _remove(plugin_id: str) -> int:
    """11.5 — Remove a plugin."""
    from ..db import init_engine, get_session
    from ..models.plugin_registry import PluginRegistry
    from ..models.plugin_config import AgentPluginConfig
    from sqlalchemy import select

    init_engine()
    async with get_session() as session:
        usage_result = await session.execute(
            select(AgentPluginConfig).where(AgentPluginConfig.plugin_id == plugin_id)
        )
        agent_configs = usage_result.scalars().all()
        if agent_configs:
            print(f"WARNING: {len(agent_configs)} agent(s) have config for '{plugin_id}'.")
            confirm = input("Delete agent configs and remove plugin? [y/N] ")
            if confirm.lower() != "y":
                print("Aborted.")
                return 1
            for cfg in agent_configs:
                await session.delete(cfg)

        result = await session.execute(
            select(PluginRegistry).where(PluginRegistry.plugin_id == plugin_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            print(f"Plugin '{plugin_id}' not found.")
            return 1
        await session.delete(row)
        await session.commit()

    print(f"Plugin '{plugin_id}' removed. Restart brain to deactivate.")
    return 0


async def _verify(plugin_id: str) -> int:
    """11.6 — Verify plugin manifest hash."""
    from ..db import init_engine, get_session
    from ..models.plugin_registry import PluginRegistry
    from sqlalchemy import select

    init_engine()
    async with get_session() as session:
        result = await session.execute(
            select(PluginRegistry).where(PluginRegistry.plugin_id == plugin_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            print(f"Plugin '{plugin_id}' not found.")
            return 1

        if not row.manifest_hash:
            print(f"Plugin '{plugin_id}': no manifest hash recorded.")
            return 0

        # Try to compute current hash
        try:
            import importlib.metadata
            dist = importlib.metadata.distribution(plugin_id)
            files = list(dist.files or [])
            current_hash = hashlib.sha256(
                b"".join(f.read_bytes() for f in files if f.suffix == ".py")
            ).hexdigest()
            if current_hash == row.manifest_hash:
                print(f"Plugin '{plugin_id}': hash MATCH ✓")
            else:
                print(f"Plugin '{plugin_id}': hash MISMATCH! recorded={row.manifest_hash[:12]}… current={current_hash[:12]}…")
                return 1
        except Exception as exc:
            print(f"Could not compute current hash: {exc}")
    return 0


async def _info(plugin_id: str) -> int:
    """11.7 — Show full plugin info."""
    from ..db import init_engine, get_session
    from ..models.plugin_registry import PluginRegistry
    from ..plugins import get_loaded_plugins
    from sqlalchemy import select

    init_engine()
    async with get_session() as session:
        result = await session.execute(
            select(PluginRegistry).where(PluginRegistry.plugin_id == plugin_id)
        )
        row = result.scalar_one_or_none()
        if not row:
            print(f"Plugin '{plugin_id}' not found in registry.")
            return 1

    plugins = get_loaded_plugins()
    api = plugins.get(plugin_id, {}).get("api")

    print(f"Plugin: {row.name} ({row.plugin_id})")
    print(f"  Version:    {row.version}")
    print(f"  Source:     {row.source}")
    print(f"  Trust tier: {row.trust_tier}")
    print(f"  Permissions: {json.dumps(row.permissions or [])}")
    if api:
        print(f"  Tools:  {list(api._tools.keys())}")
        print(f"  Hooks:  {[h['event'] for h in api._hooks]}")
        print(f"  Schema: {json.dumps(api._config_schema, indent=2)}")
    else:
        print("  (Plugin not loaded in current process)")
    return 0


def run_plugins_cli(args: list[str]) -> int:
    """Entry point for `nuvex plugins` subcommands."""
    parser = argparse.ArgumentParser(prog="nuvex plugins")
    sub = parser.add_subparsers(dest="cmd")

    install_p = sub.add_parser("install")
    install_p.add_argument("source")
    install_p.add_argument("--trust", action="store_true")

    list_p = sub.add_parser("list")
    list_p.add_argument("--json", action="store_true", dest="as_json")

    remove_p = sub.add_parser("remove")
    remove_p.add_argument("id")

    verify_p = sub.add_parser("verify")
    verify_p.add_argument("id")

    info_p = sub.add_parser("info")
    info_p.add_argument("id")

    ns = parser.parse_args(args)

    if ns.cmd == "install":
        return asyncio.run(_install(ns.source, ns.trust))
    elif ns.cmd == "list":
        return asyncio.run(_list_plugins(ns.as_json))
    elif ns.cmd == "remove":
        return asyncio.run(_remove(ns.id))
    elif ns.cmd == "verify":
        return asyncio.run(_verify(ns.id))
    elif ns.cmd == "info":
        return asyncio.run(_info(ns.id))
    else:
        parser.print_help()
        return 1
