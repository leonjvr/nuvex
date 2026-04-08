"""POST /skill-convert — LLM-powered OpenClaw → NUVEX skill adapter."""
from __future__ import annotations

import logging
import os
import re

from fastapi import APIRouter
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from ..models_registry import get_llm

log = logging.getLogger(__name__)

router = APIRouter(prefix="/skill-convert", tags=["skills"])

# ── Deterministic substitutions ───────────────────────────────────────────────

_PATH_PATTERN = re.compile(
    r"/home/node/\.openclaw/workspace/skills/(?P<skill>[^/\s\"']+)/scripts/",
    re.IGNORECASE,
)

_ACT_SH_PATTERN = re.compile(
    r"/(?:home/node/\.openclaw|root/\.openclaw)/workspace/skills/\S+/scripts/act\.sh\s+send\s+[^\n]+",
    re.IGNORECASE,
)

_ACT_SH_RELATIVE_PATTERN = re.compile(
    r"(?:consciousness|act)/scripts/act\.sh\s+send\s+[^\n]+",
    re.IGNORECASE,
)

_OPENCLAW_MSG_PATTERN = re.compile(
    r"openclaw message send[^\n]+",
    re.IGNORECASE,
)


def deterministic_rewrite(content: str, agent_id: str) -> str:
    """Apply path and reference substitutions that don't require judgment."""
    # Rewrite skill script paths
    def _replace_path(m: re.Match[str]) -> str:
        skill: str = m.group("skill") or m.group(0)
        return f"/data/agents/{agent_id}/workspace/skills/{skill}/scripts/"

    content = _PATH_PATTERN.sub(_replace_path, content)

    # Remove act.sh send lines (replaced by LLM with NUVEX equivalents)
    content = _ACT_SH_PATTERN.sub("# [NUVEX: mid-turn messaging — see NUVEX channel tool]", content)
    content = _ACT_SH_RELATIVE_PATTERN.sub("# [NUVEX: mid-turn messaging — see NUVEX channel tool]", content)
    content = _OPENCLAW_MSG_PATTERN.sub("# [NUVEX: use delegate_to_agent or channel tool]", content)

    return content


# ── LLM rewrite ───────────────────────────────────────────────────────────────

_SYSTEM_PROMPT = """\
You are a skill-migration assistant. You convert OpenClaw agent skill documentation (SKILL.md files)
to be compatible with the NUVEX agent platform.

OpenClaw and NUVEX are similar: both inject SKILL.md into the agent's system prompt, and both run
skill scripts via a shell tool. The key differences are:

1. **Script paths**: Already rewritten by the caller. Do not change paths.
2. **Mid-turn messaging** (`act.sh send` / `openclaw message send`): OpenClaw agents can send
   WhatsApp/Telegram messages mid-turn to acknowledge requests. NUVEX does not have a mid-turn
   channel tool. Replace any protocol requiring mid-turn sends with: the agent should include a
   brief acknowledgment at the START of its text response before running tools, and send a
   completion message at the END via the `delegate_to_agent` tool if cross-agent notification is
   needed. Remove numbered "ACKNOWLEDGE FIRST" steps that mandate act.sh as the very first call.
3. **OpenClaw-specific escalation targets** (e.g. "Flag to Leon on Telegram (DM `902994355`)"
   "DM `902994355`"): Replace these with "notify the operator via the configured escalation channel"
   without hardcoding any IDs.
4. **`openclaw` CLI references** (`openclaw message send`, `openclaw list`, etc.): Remove or replace
   with the NUVEX shell tool equivalent, or note that the capability is not available.
5. **Consciousness skill references** (`/skills/consciousness/`): Remove — NUVEX does not have
   a consciousness skill.
6. **Keep everything else unchanged**: workflow steps, error protocols, lifecycle rules,
   architecture descriptions, screenshot conventions, project registry format, etc.

Return ONLY the rewritten SKILL.md content — no preamble, no explanation, no code fences.
"""


def _pick_model() -> str:
    """Pick fastest available model for the LLM rewrite step."""
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic/claude-haiku-4-20250514"
    if os.environ.get("GROQ_API_KEY"):
        return "groq/llama-3.3-70b-versatile"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai/gpt-4o-mini"
    return "openai/gpt-4o-mini"


# ── Request / response models ─────────────────────────────────────────────────

class ConvertRequest(BaseModel):
    skill_md: str
    agent_id: str = "maya"
    skill_name: str = ""


class ConvertResponse(BaseModel):
    skill_md: str
    llm_used: str


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=ConvertResponse)
async def convert_skill(req: ConvertRequest) -> ConvertResponse:
    """Rewrite an OpenClaw SKILL.md to be NUVEX-compatible."""
    # Step 1: deterministic substitutions
    prepped = deterministic_rewrite(req.skill_md, req.agent_id)

    # Step 2: LLM semantic rewrite
    model_name = _pick_model()
    try:
        model = get_llm(model_name)
        result = await model.ainvoke([
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=f"Convert this SKILL.md:\n\n{prepped}"),
        ])
        raw = result.content
        converted = raw if isinstance(raw, str) else "".join(
            c if isinstance(c, str) else str(c) for c in raw  # type: ignore[union-attr]
        )
    except Exception as exc:
        log.warning("skill-convert: LLM rewrite failed (%s), returning deterministic-only result", exc)
        # Degrade gracefully — return the deterministic result without LLM polish
        converted = prepped
        model_name = "deterministic-only"

    return ConvertResponse(skill_md=converted, llm_used=model_name)
