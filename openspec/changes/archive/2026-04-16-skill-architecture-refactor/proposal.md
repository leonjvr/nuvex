## Why

NUVEX supports multiple agents, but the current skill system (designed from OpenClaw's single-agent model) stores skills inside each agent's workspace. This creates duplication when multiple agents share a skill, version drift across copies, and makes secret management impossible from the dashboard. Skills need a shared library with per-agent configuration, and secrets must be stored in PostgreSQL (encrypted) — not in `.env` files on disk — so the dashboard can manage them.

Additionally, the current implementation loads all skill SKILL.md content into every prompt regardless of relevance. Adopting progressive disclosure (load only name+description at startup, full content on activation) saves tokens and aligns with the AgentSkills open standard and OpenClaw's approach.

## What Changes

- **BREAKING**: Skill storage moves from per-agent (`/data/agents/<name>/workspace/skills/`) to a global skill library (`/data/skills/`). Agent workspaces can still override with local copies (higher precedence).
- New `agent_skill_config` PostgreSQL table stores per-agent-skill secrets and configuration (encrypted at rest), replacing per-skill `.env` files as the source of truth.
- Skills declare their configuration schema via `.env.example` or `config.schema.json` in the skill directory, enabling the dashboard to auto-generate config forms.
- SKILL.md frontmatter is parsed at load time; `metadata.openclaw` gating fields (`requires.bins`, `requires.env`) are supported for ClawHub/OpenClaw compatibility.
- Prompt injection uses progressive disclosure: only name+description loaded initially, full SKILL.md body loaded when task matches.
- Dashboard gains skill management UI: per-agent skill picker, per-agent-skill secret/config editor, skill library browser.
- `tools_registry.py` becomes skill-aware: agent's tool list is filtered by their enabled skills.
- Shell tool gains per-agent-skill environment injection from database config (not `.env` files).

## Capabilities

### New Capabilities
- `skill-library`: Global shared skill storage with per-agent override precedence
- `agent-skill-config`: Per-agent-skill configuration and encrypted secret storage in PostgreSQL
- `skill-config-schema`: Skill authors declare configuration requirements via `.env.example` or `config.schema.json`
- `skill-dashboard`: Dashboard UI for skill management — skill picker, config editor, secret management
- `skill-progressive-disclosure`: Token-efficient skill injection — summary at load, full content on activation
- `openclaw-plugin-compat`: OpenClaw plugin import CLI and hook block/approval semantics for cross-platform compatibility

### Modified Capabilities
- `skill-system`: **AMENDMENT** — Skill directory structure changes from per-agent workspace to global library; frontmatter parsing added; `.env` file replaced by DB-backed config
- `tool-hooks`: **AMENDMENT** — Shell tool execution gains per-agent-skill environment injection from DB config; PreToolUse hooks gain block/approval return semantics
- `workspace-bootstrap`: **AMENDMENT** — Skill loading in `assemble_system_prompt` switches from eager (all skills) to progressive disclosure

## Impact

- **Database**: New `agent_skill_config` table + migration
- **Config**: `nuvex.yaml` agent `skills` list remains (allowlist), but skill resolution path changes
- **Brain**: `workspace.py` skill loading refactored; `tools_registry.py` becomes skill-aware; `shell_tool.py` gains env injection
- **Dashboard**: New router (`routers/skills.py`), new frontend pages for skill management
- **Filesystem**: `/data/skills/` directory added alongside existing `/data/agents/` structure
- **Migration path**: Existing per-agent workspace skills continue to work (override precedence); users can gradually move skills to global library
- **OpenClaw compatibility**: ClawHub skills (AgentSkills format) work with zero modification; `metadata.openclaw` gating fields respected
- **Plugin import**: `nuvex plugins import` CLI converts OpenClaw TypeScript tool plugins to Python `BaseTool` stubs — one-time conversion, no TS runtime needed
- **Hook semantics**: PreToolUse hooks gain `block` and `require_approval` return values, aligned with OpenClaw's `before_tool_call` return contract
