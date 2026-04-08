"""PiiMaskHook — redact PII patterns from tool outputs before the LLM sees them (§34)."""
from __future__ import annotations

import logging
import re
from typing import Any

from . import HookContext, HookResult

log = logging.getLogger(__name__)


class PiiMaskHook:
    """PostToolUse hook that replaces regex-matched patterns with [REDACTED].

    Activated automatically when the agent's ``pii_patterns`` config list is non-empty.
    Patterns are compiled once per instance and applied to the tool output string.
    """

    def __init__(self, patterns: list[str], tool_pattern: str = "*") -> None:
        self._regexes: list[re.Pattern] = []
        for p in patterns:
            try:
                self._regexes.append(re.compile(p))
            except re.error as exc:
                log.warning("pii_mask: invalid pattern %r — skipped: %s", p, exc)
        self._tool_pattern = tool_pattern

    def _matches_tool(self, tool_name: str) -> bool:
        if self._tool_pattern == "*":
            return True
        return bool(re.search(self._tool_pattern, tool_name))

    async def __call__(self, ctx: HookContext) -> HookResult | None:
        if not self._regexes:
            return None
        if not self._matches_tool(ctx.tool_name):
            return None

        output = ctx.tool_output
        if not isinstance(output, str):
            return None

        redacted = output
        for rx in self._regexes:
            redacted = rx.sub("[REDACTED]", redacted)

        if redacted == output:
            return HookResult()  # no matches — pass through unchanged

        return HookResult(result_override=redacted)


def make_pii_mask_hook(agent_id: str) -> PiiMaskHook | None:
    """Return a configured PiiMaskHook for the agent, or None if not configured."""
    try:
        from ...shared.config import get_cached_config, get_agent
        cfg = get_cached_config()
        agent_def = get_agent(cfg, agent_id)
        if agent_def and agent_def.pii_patterns:
            return PiiMaskHook(patterns=agent_def.pii_patterns)
    except Exception as exc:
        log.warning("pii_mask: could not load config for agent=%s: %s", agent_id, exc)
    return None
