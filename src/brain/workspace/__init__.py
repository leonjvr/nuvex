"""Workspace file loader — reads all bootstrap markdown files for an agent."""
from __future__ import annotations

import json
import logging
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_BOOTSTRAP_FILES = [
    "SOUL.md",
    "IDENTITY.md",
    "AGENTS.md",
    "TOOLS.md",
    "USER.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md",
]

# Files that must NEVER be trimmed from the system prompt
_NEVER_TRIM = {"SOUL.md", "IDENTITY.md"}

# Order in which files are trimmed (lowest priority first)
_TRIM_ORDER = [
    # Daily memory (oldest first — handled dynamically)
    "MEMORY.md",
    "HEARTBEAT.md",
    "TOOLS.md",
    "AGENTS.md",
    # SOUL.md and IDENTITY.md are protected above
]

GOVERNANCE_PREAMBLE = (
    "You are a governed AI agent operating under the NUVEX framework. "
    "All your actions are subject to governance checks: forbidden-list screening, "
    "approval gates for destructive operations, budget limits, data-classification rules, "
    "and policy engine evaluation. "
    "Never attempt to bypass, disable, or trick these controls. "
    "Always complete tasks within your assigned budget and tier permissions.\n\n"
)


def resolve_workspace_path(agent_id: str, org_id: str = "default") -> str:
    """Return the canonical workspace path for (org_id, agent_id).

    Resolution order:
    1. /data/orgs/{org_id}/agents/{agent_id}/workspace/  (org-scoped)
    2. /data/agents/{agent_id}/workspace/                (legacy fallback for default org)
    """
    data_root = os.environ.get("NUVEX_DATA_ROOT", "data")
    org_path = Path(data_root) / "orgs" / org_id / "agents" / agent_id / "workspace"
    if org_path.is_dir():
        return str(org_path)
    # Legacy fallback for default org
    if org_id == "default":
        legacy = Path(data_root) / "agents" / agent_id / "workspace"
        if legacy.is_dir():
            return str(legacy)
    return str(org_path)  # Return canonical path even if not yet created


def load_workspace_files(workspace_path: str, org_id: str = "default", agent_id: str = "") -> dict[str, str]:
    """Return a dict of filename → content for all present bootstrap files.

    Supports org-scoped templates: checks /data/orgs/{org_id}/templates/ before
    global defaults when resolving bootstrap files.
    """
    data_root = os.environ.get("NUVEX_DATA_ROOT", "data")
    root = Path(workspace_path)
    result: dict[str, str] = {}
    for fname in _BOOTSTRAP_FILES:
        fpath = root / fname
        if fpath.is_file():
            result[fname] = fpath.read_text(encoding="utf-8")
        else:
            # §8.5 — check org-level templates before global defaults
            org_template = Path(data_root) / "orgs" / org_id / "templates" / fname
            if org_template.is_file():
                result[fname] = org_template.read_text(encoding="utf-8")
    return result


def load_memory_files(workspace_path: str) -> dict[str, str]:
    """Return a dict of filename → content for MEMORY.md and daily memory files."""
    import re
    root = Path(workspace_path)
    result: dict[str, str] = {}
    memory_md = root / "MEMORY.md"
    if memory_md.is_file():
        result["MEMORY.md"] = memory_md.read_text(encoding="utf-8")
    # Daily memory files: YYYY-MM-DD.md
    _daily_re = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")
    for fpath in root.glob("????-??-??.md"):
        if _daily_re.match(fpath.name):
            result[fpath.name] = fpath.read_text(encoding="utf-8")
    return result


def load_skill_files(
    workspace_path: str,
    skill_names: list[str] | None = None,
    global_library: str = "/data/skills",
) -> dict[str, str]:
    """Return a dict of skill_name → SKILL.md content for skills.

    Resolution order (§16.1):
      1. Agent workspace (<workspace_path>/skills/)
      2. Plugin packages (loaded plugins with SKILL.md)
      3. Global library (/data/skills/)

    When *skill_names* is provided, uses resolve_skill_path() for each name
    (agent workspace takes precedence over global library).
    When None, falls back to scanning <workspace_path>/skills/ directly.
    """
    from ..skills.resolver import resolve_skill_path

    if skill_names is not None:
        result: dict[str, str] = {}
        for name in skill_names:
            skill_dir = resolve_skill_path(workspace_path, name, global_library)
            if skill_dir is not None:
                skill_md = skill_dir / "SKILL.md"
                result[name] = skill_md.read_text(encoding="utf-8")
                continue
            # §16.1 — fall back to plugin loader
            try:
                from ..plugins import get_loaded_plugins
                plugins = get_loaded_plugins()
                # Look for skill-wrapped plugins matching this name
                pid = f"skill:{name}"
                if pid in plugins:
                    entry = plugins[pid]
                    source = entry.get("meta", {}).get("source", "")
                    if isinstance(source, str) and "skill:" in source:
                        skill_path = Path(source.replace("skill:", "", 1))
                        skill_md_file = skill_path / "SKILL.md"
                        if skill_md_file.is_file():
                            result[name] = skill_md_file.read_text(encoding="utf-8")
            except Exception:
                pass
        return result

    # Fallback: scan workspace skills directory
    skills_dir = Path(workspace_path) / "skills"
    result = {}
    if not skills_dir.is_dir():
        return result
    for skill_dir in sorted(skills_dir.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if skill_md.is_file():
            result[skill_dir.name] = skill_md.read_text(encoding="utf-8")
    return result


def load_skill_metas(workspace_path: str) -> dict[str, dict]:
    """Return a dict of skill_name → parsed _meta.json for all skills that have one.

    The _meta.json describes scripts, credential env-var locations, and version info.
    Used to resolve script paths and env files before tool execution.
    """
    skills_dir = Path(workspace_path) / "skills"
    result: dict[str, dict] = {}
    if not skills_dir.is_dir():
        return result
    for skill_dir in sorted(skills_dir.iterdir()):
        meta_file = skill_dir / "_meta.json"
        if meta_file.is_file():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                meta["_skill_dir"] = str(skill_dir.resolve())
                result[skill_dir.name] = meta
            except Exception as exc:
                log.warning("workspace: could not parse %s: %s", meta_file, exc)
    return result


def resolve_skill_env(skill_meta: dict) -> dict[str, str]:
    """Load environment variables for a skill from its declared credential env_files.

    Reads each credentials[*].env_file (dotenv format) and merges vars into a dict.
    Returns only the vars that are actually found — callers merge with os.environ.
    """
    env: dict[str, str] = {}
    credentials = skill_meta.get("credentials", {})
    for _name, cred in credentials.items():
        env_file = cred.get("env_file")
        if not env_file:
            continue
        # Expand ~
        env_file = os.path.expanduser(env_file)
        if not os.path.isfile(env_file):
            continue
        try:
            with open(env_file, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    env[k.strip()] = v.strip().strip('"').strip("'")
        except Exception as exc:
            log.warning("workspace: could not read env_file %s: %s", env_file, exc)
    return env


def activate_skills(message: str, skill_summaries: list) -> list[str]:
    """Return skill names whose description keyword matches the user message.

    Uses simple case-insensitive keyword matching: a skill is activated when
    any word in its name or description appears in the lowercased message.

    Args:
        message:        The user message text.
        skill_summaries: List of SkillMetadata instances.

    Returns:
        List of skill names that match the message.
    """
    message_lower = message.lower()
    activated: list[str] = []
    for meta in skill_summaries:
        keywords: set[str] = set()
        if meta.name:
            keywords.update(meta.name.lower().split())
        if meta.description:
            keywords.update(meta.description.lower().split())
        if any(kw in message_lower for kw in keywords if len(kw) > 2):
            activated.append(meta.name)
    return activated


def _build_available_skills_block(skill_summaries: list) -> str:
    """Build a compact XML <available-skills> block for progressive disclosure."""
    lines = ["<available-skills>"]
    for meta in skill_summaries:
        desc = meta.description.replace("\n", " ")
        lines.append(f'  <skill name="{meta.name}">{desc}</skill>')
    lines.append("</available-skills>")
    return "\n".join(lines)



    """Load persistent memory files for the agent.

    Reads:
    - memory/MEMORY.md  (long-term summaries)
    - memory/YYYY-MM-DD.md for today and yesterday

    Returns a dict of filename → content for all present files.
    """
    memory_dir = Path(workspace_path) / "memory"
    result: dict[str, str] = {}
    if not memory_dir.is_dir():
        return result

    # Long-term summary
    main_memory = memory_dir / "MEMORY.md"
    if main_memory.is_file():
        result["MEMORY.md"] = main_memory.read_text(encoding="utf-8")

    # Today + yesterday daily files
    today = date.today()
    for delta in (0, 1):
        day = today - timedelta(days=delta)
        daily = memory_dir / f"{day.isoformat()}.md"
        if daily.is_file():
            result[daily.name] = daily.read_text(encoding="utf-8")

    return result


def load_all(workspace_path: str) -> dict[str, str]:
    """Load bootstrap files, skill files, and memory files in one call.

    Files are read fresh from disk on every call (hot-reload — no caching).
    """
    files: dict[str, str] = {}
    files.update(load_workspace_files(workspace_path))
    files.update(load_memory_files(workspace_path))
    files.update(load_skill_files(workspace_path))
    return files


def consume_bootstrap_md(workspace_path: str) -> str | None:
    """Return BOOTSTRAP.md content and delete the file (first-run protocol).

    Returns the file content if it existed and was deleted, else None.
    """
    bootstrap_path = Path(workspace_path) / "BOOTSTRAP.md"
    if not bootstrap_path.is_file():
        return None
    content = bootstrap_path.read_text(encoding="utf-8")
    try:
        bootstrap_path.unlink()
        log.info("workspace: BOOTSTRAP.md deleted after first-run inclusion")
    except OSError as exc:
        log.warning("workspace: could not delete BOOTSTRAP.md: %s", exc)
    return content


def _count_tokens(text: str) -> int:
    """Approximate token count using tiktoken (cl100k_base) or char/4 fallback."""
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        return len(text) // 4


def _build_denied_block(denied_actions: list) -> str:
    """Build the [DENIED ACTIONS THIS SESSION] system-prompt block (§32).

    Caps at 10 most recent entries and appends an overflow note when needed.
    """
    recent = denied_actions[-10:]
    overflow = len(denied_actions) - len(recent)
    lines = [
        "[DENIED ACTIONS THIS SESSION]",
        "The following tool calls were blocked by governance. Do not attempt them again "
        "without operator approval:",
    ]
    for da in recent:
        lines.append(f"- {da.tool_name} ({da.governance_stage}): {da.reason}")
    if overflow > 0:
        lines.append(f"({overflow} older denial{'s' if overflow != 1 else ''} omitted)")
    return "\n".join(lines)


def build_historical_context_block(snips: list[dict]) -> str:
    """Format selected snips as a [HISTORICAL CONTEXT] block (§31)."""
    if not snips:
        return ""
    lines = ["[HISTORICAL CONTEXT]", "The following earlier turns are relevant to the current message:"]
    for snip in snips:
        role = snip.get("role", "unknown").upper()
        content = snip.get("content", "")
        lines.append(f"[{role}]: {content}")
    return "\n".join(lines)


def _resolve_style(response_style: str, workspace_path: str, agent_id: str | None) -> str | None:
    """Resolve a response style to its markdown content (§30).

    Priority order (later overrides earlier):
      1. defaults/styles/<name>.md
      2. data/agents/<agent_id>/workspace/styles/<name>.md
    If response_style contains a newline, treat as inline content (no file lookup).
    Returns None if named file cannot be found; logs a warning.
    """
    if "\n" in response_style:
        return response_style  # inline content — no file lookup

    name = response_style.strip()
    resolved: str | None = None

    defaults_path = Path("defaults") / "styles" / f"{name}.md"
    if defaults_path.is_file():
        resolved = defaults_path.read_text(encoding="utf-8")

    if agent_id:
        agent_path = Path(workspace_path) / "styles" / f"{name}.md"
        if agent_path.is_file():
            resolved = agent_path.read_text(encoding="utf-8")

    if resolved is None:
        log.warning("workspace: response_style '%s' not found in defaults/styles/ or agent overrides", name)
    return resolved


def assemble_system_prompt(
    workspace_path: str,
    max_tokens: int = 50_000,
    is_first_run: bool = False,
    memory_block: str = "",
    contact_block: str = "",
    denied_actions: list | None = None,
    response_style: str | None = None,
    agent_id: str | None = None,
    org_id: str = "default",
    historical_context: str = "",
    skill_names: list[str] | None = None,
    skill_disclosure: str = "progressive",
) -> str:
    """Assemble the full system prompt for an agent invocation.

    Injection order:
      1. Governance preamble (never trimmed)
      2. [MEMORY] block — injected after preamble if provided (never trimmed)
      3. SOUL.md (never trimmed)
      4. IDENTITY.md (never trimmed)
      5. USER.md, AGENTS.md, TOOLS.md, HEARTBEAT.md (trimmed if needed)
      6. Skill SKILL.md files (trimmed if needed)
      7. MEMORY.md (trimmed if needed)
      8. Daily memory files — today first, yesterday second (trimmed first)
      9. BOOTSTRAP.md — included once then deleted (if present)

    Context trimming starts from daily memory (oldest first), then MEMORY.md,
    then HEARTBEAT/TOOLS/AGENTS. SOUL.md and IDENTITY.md are never removed.

    Pass memory_block (from MemoryRetriever.build_block()) to inject semantic memories.
    """
    bootstrap_files = load_workspace_files(workspace_path, org_id=org_id, agent_id=agent_id or "")
    memory_files = load_memory_files(workspace_path)

    # Skill loading — progressive vs eager disclosure
    skill_files: dict[str, str] = {}
    progressive_skills_block: str = ""
    if skill_disclosure == "progressive" and skill_names is not None:
        # Load metadata for summaries only; full bodies deferred
        from ..skills.parser import parse_skill_md
        from ..skills.resolver import resolve_skill_path
        summaries = []
        for sname in (skill_names or []):
            skill_dir = resolve_skill_path(workspace_path, sname)
            if skill_dir is not None:
                try:
                    meta = parse_skill_md(skill_dir / "SKILL.md")
                    summaries.append(meta)
                except Exception as exc:
                    log.debug("workspace: could not parse skill %s: %s", sname, exc)
        if summaries:
            progressive_skills_block = _build_available_skills_block(summaries)
    else:
        # Eager mode: include full SKILL.md bodies (current behavior)
        skill_files = load_skill_files(workspace_path, skill_names)

    # Handle BOOTSTRAP.md first-run protocol
    bootstrap_content: str | None = None
    if is_first_run:
        bootstrap_content = consume_bootstrap_md(workspace_path)
    elif "BOOTSTRAP.md" in bootstrap_files:
        # Not first run but file still exists — include and delete
        bootstrap_content = consume_bootstrap_md(workspace_path)

    # Build sections in injection order
    sections: list[tuple[str, str]] = []  # (key, content)

    for fname in ["SOUL.md", "IDENTITY.md", "USER.md", "AGENTS.md", "TOOLS.md", "HEARTBEAT.md"]:
        if fname in bootstrap_files:
            sections.append((fname, bootstrap_files[fname]))

    for skill_name, skill_content in skill_files.items():
        sections.append((f"skill:{skill_name}", skill_content))

    if "MEMORY.md" in memory_files:
        sections.append(("MEMORY.md", memory_files["MEMORY.md"]))

    # Daily memory: today first, yesterday second
    today = date.today()
    for delta in (0, 1):
        day = today - timedelta(days=delta)
        fname = f"{day.isoformat()}.md"
        if fname in memory_files:
            sections.append((fname, memory_files[fname]))

    if bootstrap_content:
        sections.append(("BOOTSTRAP.md", bootstrap_content))

    # Calculate token budget
    preamble_tokens = _count_tokens(GOVERNANCE_PREAMBLE)
    remaining = max_tokens - preamble_tokens

    # Determine which sections to include after trimming
    protected = {"SOUL.md", "IDENTITY.md"}

    # Trim from lowest priority (daily yesterday → daily today → MEMORY.md →
    # HEARTBEAT.md → TOOLS.md → AGENTS.md). Skills are trimmed after memory.
    trim_priority = [
        f"{(today - timedelta(days=1)).isoformat()}.md",
        f"{today.isoformat()}.md",
        "MEMORY.md",
    ] + [f"skill:{s}" for s in reversed(list(skill_files.keys()))] + [
        "HEARTBEAT.md",
        "TOOLS.md",
        "AGENTS.md",
        "USER.md",
    ]
    trim_idx = {k: i for i, k in enumerate(trim_priority)}

    kept: list[tuple[str, str]] = []
    budget = remaining

    # First pass: include all protected sections unconditionally
    for key, content in sections:
        if key in protected:
            budget -= _count_tokens(f"## {key}\n{content}\n\n")
            kept.append((key, content))

    # Second pass: include non-protected in order, skipping if over budget
    # Build list sorted by trim priority (keep high-priority first)
    trimmable = [(k, c) for k, c in sections if k not in protected]
    trimmable.sort(key=lambda t: trim_idx.get(t[0], -1), reverse=True)  # high priority first

    for key, content in trimmable:
        tokens = _count_tokens(f"## {key}\n{content}\n\n")
        if tokens <= budget:
            kept.append((key, content))
            budget -= tokens
        else:
            log.info("workspace: trimmed section %s (%d tokens) from system prompt", key, tokens)

    # Assemble final prompt
    parts = [GOVERNANCE_PREAMBLE]

    # [MEMORY] block injected immediately after governance preamble (28.8)
    if memory_block:
        parts.append(memory_block)

    # §6 — contact identity block injected after memory, before denied actions
    if contact_block:
        parts.append(contact_block)

    # §32 — [DENIED ACTIONS THIS SESSION] block injected after memory, before identity
    if denied_actions:
        parts.append(_build_denied_block(denied_actions))

    # §31 — [HISTORICAL CONTEXT] snip block injected before active messages
    if historical_context:
        parts.append(historical_context)

    # Restore injection order for final output
    key_order = {k: i for i, (k, _) in enumerate(sections)}
    kept.sort(key=lambda t: key_order.get(t[0], 999))

    for key, content in kept:
        display_key = key.replace("skill:", "Skill: ")
        parts.append(f"## {display_key}\n{content}")

    # §4 — progressive disclosure: inject compact skill summaries block
    if progressive_skills_block:
        parts.append(progressive_skills_block)

    # §16.2 — Plugin tool descriptions for loaded plugins
    if agent_id:
        try:
            plugin_tools_block = _build_plugin_tools_block(agent_id, skill_disclosure)
            if plugin_tools_block:
                parts.append(plugin_tools_block)
        except Exception as exc:
            log.debug("workspace: plugin tools block failed: %s", exc)

    # §30 — response style overlay injected after identity content
    if response_style:
        style_content = _resolve_style(response_style, workspace_path, agent_id)
        if style_content:
            parts.append(f"## Response Style\n{style_content}")

    return "\n\n".join(parts)


def _build_plugin_tools_block(agent_id: str, skill_disclosure: str = "progressive") -> str:
    """Build a block describing plugin tools for the system prompt (§16.2–16.4)."""
    try:
        from ..plugins import get_loaded_plugins
        from ...shared.config import get_cached_config
    except Exception:
        return ""

    try:
        cfg = get_cached_config()
        agent_def = cfg.agents.get(agent_id)
        plugins = getattr(agent_def, "plugins", {}) if agent_def else {}
    except Exception:
        return ""

    loaded = get_loaded_plugins()
    lines: list[str] = []

    for plugin_id, plugin_cfg in plugins.items():
        enabled = getattr(plugin_cfg, "enabled", True)
        if not enabled or plugin_id not in loaded:
            continue

        entry = loaded[plugin_id]
        api = entry.get("api")
        if not api or not api._tools:
            continue

        # §16.3: plugins with SKILL.md → progressive gating (summary only)
        # §16.4: plugins without SKILL.md → always visible
        source = entry.get("meta", {}).get("source", "")
        has_skill_md = False
        if isinstance(source, str) and "skill:" in source:
            skill_path = Path(source.replace("skill:", "", 1))
            has_skill_md = (skill_path / "SKILL.md").is_file()

        if has_skill_md and skill_disclosure == "progressive":
            lines.append(f"- **{api.name}** (plugin:{plugin_id}) — {len(api._tools)} tool(s) available (activate to expand)")
        else:
            tool_descs = ", ".join(
                f"`{name}`: {reg['description']}" for name, reg in api._tools.items()
            )
            lines.append(f"- **{api.name}** (plugin:{plugin_id}): {tool_descs}")

    if not lines:
        return ""
    return "## Plugin Tools\n" + "\n".join(lines)
