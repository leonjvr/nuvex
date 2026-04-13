"""Plugin loader — discovers, validates, and registers NUVEX plugins.

Load ordering:
  1. Entry points (group="nuvex_plugin") — alphabetical by plugin id
  2. /data/plugins/ directory scan — alphabetical
  3. /data/skills/ skill auto-wraps — alphabetical
  4. Agent workspace skill scan (agent-local, highest precedence)
"""
from __future__ import annotations

import importlib
import importlib.util
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Global registry of loaded plugins {plugin_id -> metadata + api}
_loaded_plugins: dict[str, dict[str, Any]] = {}


def get_loaded_plugins() -> dict[str, dict[str, Any]]:
    """Return a copy of the loaded plugins registry."""
    return dict(_loaded_plugins)


def _register_plugin(meta: dict[str, Any], api: Any) -> bool:
    """Register a plugin. Returns False if duplicate (first wins)."""
    pid = meta["id"]
    if pid in _loaded_plugins:
        logger.error(
            "Plugin '%s' already loaded — skipping duplicate from '%s'",
            pid, meta.get("source", "unknown"),
        )
        return False
    _loaded_plugins[pid] = {"meta": meta, "api": api}
    return True


def _load_plugin_fn(fn: Any, source: str = "unknown") -> None:
    """Run a @define_plugin decorated function and register its API."""
    from src.nuvex_plugin.sdk import PluginAPI

    meta = getattr(fn, "__plugin_metadata__", None)
    if meta is None:
        return

    api = PluginAPI(
        plugin_id=meta["id"],
        name=meta["name"],
        permissions=meta.get("permissions", []),
    )
    try:
        fn(api)
    except Exception as exc:
        logger.exception("Plugin '%s' registration raised: %s — skipping", meta["id"], exc)
        return

    meta = dict(meta)
    meta["source"] = source
    _register_plugin(meta, api)


def _load_from_entry_points() -> None:
    """Load plugins from installed package entry points."""
    try:
        from importlib.metadata import entry_points
        eps = entry_points(group="nuvex_plugin")
        for ep in sorted(eps, key=lambda e: e.name):
            try:
                fn = ep.load()
                _load_plugin_fn(fn, source=f"entry_point:{ep.name}")
            except Exception as exc:
                logger.exception("Entry point '%s' failed to load: %s — skipping", ep.name, exc)
    except Exception as exc:
        logger.warning("Entry point discovery failed: %s", exc)


def _load_from_directory(plugins_dir: Path) -> None:
    """Load plugins from /data/plugins/ directory."""
    if not plugins_dir.is_dir():
        return
    for plugin_dir in sorted(plugins_dir.iterdir()):
        if not plugin_dir.is_dir():
            continue
        plugin_file = plugin_dir / "plugin.py"
        if not plugin_file.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location(
                f"nuvex_plugin_dir.{plugin_dir.name}", plugin_file
            )
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)  # type: ignore[attr-defined]
            # Find @define_plugin decorated function
            for attr in dir(mod):
                fn = getattr(mod, attr, None)
                if callable(fn) and hasattr(fn, "__plugin_metadata__"):
                    _load_plugin_fn(fn, source=f"directory:{plugin_dir}")
                    break
        except Exception as exc:
            logger.exception("Directory plugin '%s' failed: %s — skipping", plugin_dir.name, exc)


def _make_skill_plugin_fn(skill_dir: Path, plugin_id: str) -> Any:
    """Generate a @define_plugin registration function for a skill directory."""
    from src.nuvex_plugin.sdk import PluginAPI, define_plugin

    @define_plugin(id=plugin_id, name=plugin_id.replace("-", " ").title())
    def register(api: PluginAPI) -> None:
        from pydantic import BaseModel

        class ShellInput(BaseModel):
            command: str

        scripts_dir = skill_dir / "scripts"
        if scripts_dir.is_dir():
            for script in sorted(scripts_dir.iterdir()):
                if script.suffix in (".sh", ".py") and script.is_file():
                    tool_name = script.stem

                    def make_execute(s=script):
                        async def execute(args: Any, ctx: Any) -> str:
                            import subprocess
                            result = subprocess.run(
                                [str(s), args.command] if hasattr(args, "command") else [str(s)],
                                capture_output=True, text=True, timeout=30
                            )
                            return result.stdout or result.stderr
                        return execute

                    try:
                        api.register_tool(
                            tool_name, f"Run {tool_name} script from {plugin_id}",
                            ShellInput, make_execute(),
                        )
                    except Exception:
                        pass

    return register


def _load_from_skills(skills_dir: Path, prefix: str = "skill") -> None:
    """Auto-wrap skill directories as SkillPlugin entries."""
    if not skills_dir.is_dir():
        return
    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        plugin_file = skill_dir / "plugin.py"
        if not skill_md.is_file():
            continue
        if plugin_file.is_file():
            continue  # proper plugin, already loaded
        plugin_id = f"{prefix}:{skill_dir.name}"
        try:
            fn = _make_skill_plugin_fn(skill_dir, plugin_id)
            _load_plugin_fn(fn, source=f"skill:{skill_dir}")
        except Exception as exc:
            logger.exception("Skill auto-wrap '%s' failed: %s — skipping", skill_dir.name, exc)


async def load_plugins(
    plugins_dir: Path | None = None,
    skills_dir: Path | None = None,
    agent_workspaces: list[tuple[str, Path]] | None = None,
) -> None:
    """Discover, load, and register all plugins.

    Args:
        plugins_dir: Override for /data/plugins/ (useful in tests).
        skills_dir: Override for /data/skills/ (useful in tests).
        agent_workspaces: List of (agent_id, workspace_path) for agent-local skills.
    """
    _loaded_plugins.clear()

    # 1. Entry points
    _load_from_entry_points()

    # 2. /data/plugins/ directory
    _load_from_directory(plugins_dir or Path("/data/plugins"))

    # 3. /data/skills/ skill wraps
    _load_from_skills(skills_dir or Path("/data/skills"), prefix="skill")

    # 4. Agent workspace skill scan (highest precedence)
    if agent_workspaces:
        for agent_id, workspace_path in agent_workspaces:
            agent_skills = workspace_path / "skills"
            _load_from_skills(agent_skills, prefix=f"agent:{agent_id}")

    logger.info("Plugin loader: loaded %d plugins", len(_loaded_plugins))

    # §4.5 — sync loaded plugins to DB (non-fatal)
    await _sync_plugins_to_db()


async def _sync_plugins_to_db() -> None:
    """INSERT or UPDATE plugin_registry records for all loaded plugins (§4.5)."""
    import hashlib, json
    try:
        from ..db import get_session
        from ..models.plugin_registry import PluginRegistry
        from sqlalchemy import select, text as _text

        async with get_session() as session:
            for plugin_id, entry in _loaded_plugins.items():
                meta = entry["meta"]
                perms = meta.get("permissions", [])
                manifest_hash = hashlib.sha256(json.dumps(meta, sort_keys=True, default=str).encode()).hexdigest()
                existing = await session.scalar(
                    select(PluginRegistry).where(PluginRegistry.plugin_id == plugin_id)
                )
                if existing is None:
                    row = PluginRegistry(
                        plugin_id=plugin_id,
                        name=meta.get("name", plugin_id),
                        version=str(meta.get("version", "0.0.0")),
                        source=str(meta.get("source", "unknown")),
                        trust_tier=str(meta.get("trust_tier", "community")),
                        permissions=perms,
                        manifest_hash=manifest_hash,
                    )
                    session.add(row)
                    logger.info("plugin_registry: registered new plugin '%s'", plugin_id)
                else:
                    if existing.manifest_hash != manifest_hash:
                        existing.version = str(meta.get("version", "0.0.0"))
                        existing.manifest_hash = manifest_hash
                        existing.permissions = perms
                        logger.info("plugin_registry: updated plugin '%s' (hash changed)", plugin_id)
            await session.commit()
    except Exception as exc:
        logger.warning("plugin_loader: DB sync failed (non-fatal): %s", exc)


async def shutdown_plugins(timeout: float = 10.0) -> None:
    """Call shutdown callbacks for all loaded plugins."""
    import asyncio
    for pid, entry in list(_loaded_plugins.items()):
        api = entry.get("api")
        if api and api._shutdown_fn:
            try:
                await asyncio.wait_for(api._shutdown_fn(), timeout=timeout)
            except asyncio.TimeoutError:
                logger.warning("Plugin '%s' shutdown timed out", pid)
            except Exception as exc:
                logger.warning("Plugin '%s' shutdown error: %s", pid, exc)


def get_tools_for_plugin(plugin_id: str) -> list[Any]:
    """Generate LangChain BaseTool instances for a plugin's registered tools."""
    entry = _loaded_plugins.get(plugin_id)
    if not entry:
        return []

    api = entry["api"]
    tools: list[Any] = []
    for tool_reg in api._tools.values():
        tools.append(_make_base_tool(plugin_id, tool_reg))
    return tools


def _make_base_tool(plugin_id: str, tool_reg: dict[str, Any]) -> Any:
    """Generate a LangChain BaseTool from a tool registration."""
    from langchain_core.tools import BaseTool

    execute_fn = tool_reg["execute"]
    tool_name = tool_reg["name"]
    input_schema = tool_reg["input_schema"]
    tool_description = tool_reg["description"]
    optional = tool_reg.get("optional", False)

    class PluginTool(BaseTool):
        name: str = tool_name  # type: ignore[assignment]
        description: str = tool_description  # type: ignore[assignment]
        args_schema: Any = input_schema
        _plugin_id: str = plugin_id
        _optional: bool = optional

        async def _arun(self, **kwargs: Any) -> str:  # type: ignore[override]
            from src.nuvex_plugin.sdk import ExecutionContext
            # §5.5 — inject per-agent decrypted plugin config into ExecutionContext
            agent_id: str = getattr(self, "_caller_agent_id", "")
            plugin_cfg: dict[str, Any] = {}
            if agent_id:
                try:
                    from ..models.plugin_config import AgentPluginConfig
                    from ..db import get_session
                    from sqlalchemy import select
                    from ...shared.crypto import decrypt_env
                    async with get_session() as _sess:
                        _row = await _sess.scalar(
                            select(AgentPluginConfig).where(
                                AgentPluginConfig.agent_id == agent_id,
                                AgentPluginConfig.plugin_id == plugin_id,
                            )
                        )
                        if _row:
                            if _row.env_encrypted:
                                plugin_cfg = decrypt_env(_row.env_encrypted)
                            if _row.config_json:
                                plugin_cfg.update(_row.config_json)
                except Exception as _exc:
                    logger.debug("plugin_tool: config retrieval failed (non-fatal): %s", _exc)
            ctx = ExecutionContext(agent_id=agent_id, thread_id="", org_id=getattr(self, "_caller_org_id", "default"), plugin_config=plugin_cfg)
            args = input_schema(**kwargs)
            result = await execute_fn(ctx, args)
            return str(result) if result is not None else ""

        def _run(self, **kwargs: Any) -> str:  # type: ignore[override]
            raise NotImplementedError("Use _arun")

    return PluginTool()


async def get_tools_for_agent(agent_id: str, org_id: str = "default") -> list[Any]:
    """Return all tool instances for an agent, filtered by org's enabled_plugins list (§12.2-12.3)."""
    # Load org's enabled_plugins whitelist
    enabled_plugins: list[str] | None = None
    try:
        from ..db import get_session
        from ..models.organisation import Organisation
        async with get_session() as session:
            org = await session.get(Organisation, org_id)
            if org and org.config:
                ep = org.config.get("enabled_plugins")
                if ep is not None:
                    enabled_plugins = list(ep)
    except Exception as exc:
        logger.debug("get_tools_for_agent: org plugin list fetch failed: %s", exc)

    tools = []
    for plugin_id in list(_loaded_plugins.keys()):
        # §12.2 — skip plugins not in org's enabled list
        if enabled_plugins is not None and plugin_id not in enabled_plugins:
            logger.debug("plugin '%s' skipped — not in org '%s' enabled_plugins list", plugin_id, org_id)
            continue
        for t in get_tools_for_plugin(plugin_id):
            t._caller_agent_id = agent_id  # type: ignore[attr-defined]
            t._caller_org_id = org_id  # type: ignore[attr-defined]
            tools.append(t)
    return tools

