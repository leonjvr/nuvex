"""Tools registry — load and return tools available to a given agent."""
from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path

from langchain_core.tools import BaseTool

from .tools.mcp_loader import load_mcp_tools_for_agent
from .tools.shell_tool import ShellTool
from .tools.builtin import ReadFileTool, SendMessageTool, WebFetchTool, WriteFileTool
from .tools.delegate_tool import DelegateToAgentTool

# Tier-to-allowed-tools mapping — lower tier means more restricted
_TIER_ALLOWED: dict[str, set[str]] = {
    "T1": {"shell", "read_file", "write_file", "web_fetch", "send_message", "delegate_to_agent", "create_task", "complete_task"},
    "T2": {"read_file", "write_file", "web_fetch", "send_message", "create_task", "complete_task"},
    "T3": {"read_file", "web_fetch", "send_message"},
    "T4": {"web_fetch"},
}

_BUILTIN_TOOLS: list[BaseTool] = [
    ShellTool(),
    ReadFileTool(),
    WriteFileTool(),
    WebFetchTool(),
    SendMessageTool(),
    DelegateToAgentTool(),
]


def _get_task_tools() -> list[BaseTool]:
    """Lazily import task tools to avoid circular imports at module load time."""
    from .tasks import complete_task, create_task
    return [create_task, complete_task]


def _get_imported_tools() -> list[BaseTool]:
    """Auto-discover tools from src/brain/tools/imported/*/."""
    tools: list[BaseTool] = []
    imported_pkg_path = Path(__file__).parent / "tools" / "imported"
    if not imported_pkg_path.is_dir():
        return tools
    for subpkg in sorted(imported_pkg_path.iterdir()):
        if not subpkg.is_dir() or not (subpkg / "__init__.py").is_file():
            continue
        module_name = f"src.brain.tools.imported.{subpkg.name}"
        try:
            mod = importlib.import_module(module_name)
            for attr_name in getattr(mod, "__all__", []):
                cls = getattr(mod, attr_name, None)
                if cls and isinstance(cls, type) and issubclass(cls, BaseTool):
                    try:
                        tools.append(cls())
                    except Exception:
                        pass
        except Exception:
            pass
    return tools


async def get_tools_for_agent(agent_id: str) -> list[BaseTool]:
    """Return tools available to the given agent, filtered by tier and enabled skills."""
    from ..shared.config import get_cached_config
    try:
        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
        tier = getattr(agent_def, "tier", "T2") if agent_def else "T2"
        mcp_servers = getattr(agent_def, "mcp_servers", {}) if agent_def else {}
        skills = getattr(agent_def, "skills", []) if agent_def else []
        workspace = getattr(agent_def, "workspace", None) if agent_def else None
    except Exception:
        tier = "T2"
        mcp_servers = {}
        skills = []
        workspace = None

    allowed = set(_TIER_ALLOWED.get(tier, _TIER_ALLOWED["T2"]))

    # Extend allowed set with tools declared by enabled skills
    if skills and workspace:
        try:
            from .skills.resolver import resolve_skill_path
            from .skills.parser import parse_skill_md
            for skill_name in skills:
                skill_dir = resolve_skill_path(workspace, skill_name)
                if skill_dir is not None:
                    meta = parse_skill_md(skill_dir / "SKILL.md")
                    allowed.update(meta.allowed_tools)
        except Exception:
            pass

    # Build a delegate tool instance with caller identity so A2A threads are labelled correctly
    delegate_tool = DelegateToAgentTool()
    delegate_tool._caller_agent_id = agent_id  # type: ignore[attr-defined]
    builtin_tools = [
        t if t.name != "delegate_to_agent" else delegate_tool
        for t in _BUILTIN_TOOLS
    ]
    all_tools = [t for t in builtin_tools + _get_task_tools() + _get_imported_tools() if t.name in allowed]

    # MCP tools — only available to T1 agents (unrestricted tier)
    if tier == "T1" and mcp_servers:
        mcp_tools = await load_mcp_tools_for_agent(mcp_servers)
        all_tools = all_tools + mcp_tools

    return all_tools
