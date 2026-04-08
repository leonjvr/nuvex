"""Load MCP servers as LangChain tools for a given agent.

Each agent can declare `mcp_servers` in divisions.yaml:

    mcp_servers:
      context7:
        transport: stdio
        command: npx
        args: ["-y", "@upstash/context7-mcp@latest"]
      playwright:
        transport: stdio
        command: npx
        args: ["-y", "@playwright/mcp@latest"]

Tools from each server are exposed to the LLM as native LangChain tool calls.
When `tool_name_prefix: true` each tool is named ``<server>_<tool>`` to avoid
collisions across servers.
"""
from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import BaseTool

logger = logging.getLogger(__name__)


def _build_connection(cfg: Any) -> dict:
    """Convert McpServerConfig → dict expected by MultiServerMCPClient."""
    if cfg.transport == "sse" or cfg.url:
        return {"url": cfg.url, "transport": "sse"}
    conn: dict = {
        "transport": "stdio",
        "command": cfg.command,
        "args": cfg.args,
    }
    if cfg.env:
        conn["env"] = cfg.env
    return conn


async def load_mcp_tools_for_agent(mcp_servers: dict[str, Any]) -> list[BaseTool]:
    """Return LangChain tools from all MCP servers declared for an agent.

    Args:
        mcp_servers: dict of server name → McpServerConfig
    """
    if not mcp_servers:
        return []

    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        logger.warning("langchain-mcp-adapters not installed — skipping MCP tools")
        return []

    connections = {}
    for name, cfg in mcp_servers.items():
        try:
            connections[name] = _build_connection(cfg)
        except Exception as exc:
            logger.warning("MCP server %r config error: %s — skipping", name, exc)

    if not connections:
        return []

    try:
        client = MultiServerMCPClient(connections, tool_name_prefix=True)
        tools = await client.get_tools()
        logger.info("Loaded %d MCP tools from %d servers: %s",
                    len(tools), len(connections), list(connections.keys()))
        return tools
    except Exception as exc:
        logger.error("Failed to load MCP tools: %s", exc)
        return []
