## Context

NUVEX currently stores skills inside each agent's workspace (`/data/agents/<name>/workspace/skills/`). This was carried over from OpenClaw's single-agent model. With NUVEX supporting multiple agents, this creates three problems:

1. **Duplication**: If 3 agents use the `github` skill, the SKILL.md and scripts exist in 3 places
2. **Version drift**: Updating a skill means updating N agent workspaces
3. **Secret sprawl**: `.env` files with API keys sit on the filesystem — no dashboard management, no encryption, no per-agent isolation

What's already implemented (verified against code, not task checkboxes):
- `workspace.py`: `load_skill_files()` reads SKILL.md from agent workspace, `assemble_system_prompt()` injects content with trimming support
- `shared/models/config.py`: `AgentDefinition.skills: list[str]` parses skill allowlist from nuvex.yaml
- `tools_registry.py`: Static stub — returns `[ShellTool()]` for all agents, ignores skills
- `shell_tool.py`: No env injection, no skill awareness
- `hooks.py`: Pre/post hooks work, but HookContext has no skill fields
- No database tables for skill config
- No dashboard skill management

## Goals / Non-Goals

**Goals:**
- Global shared skill library with per-agent override
- Per-agent-skill encrypted secret storage in PostgreSQL
- Dashboard UI for skill management and secret editing
- Skills declare their config schema (`.env.example` or `config.schema.json`)
- Progressive disclosure to reduce token cost
- AgentSkills spec compatibility + OpenClaw `metadata.openclaw` gating support
- Backward compatibility: existing per-agent workspace skills still work (higher precedence)

**Non-Goals:**
- Skill marketplace / ClawHub integration CLI (future phase)
- Embedding-based skill matching (keyword heuristic first, embeddings later)
- Sandbox/Docker isolation for skill scripts (deferred — subprocess isolation for now)
- Multi-version skill support (only one version per skill name in the library)
- Automated skill migration tool from workspace to library (manual copy is fine for now)
- Runtime TypeScript plugin execution — import converts TS→Python; no TS runtime bridge

## Decisions

### 1. Three-layer skill architecture

**Choice:** Global library `/data/skills/` → agent skill binding in `nuvex.yaml` → per-agent config in PostgreSQL

**Alternatives considered:**
- Keep per-agent workspace skills only — simple but doesn't scale beyond 1-2 agents
- Database-only skills (store SKILL.md in DB) — loses git-friendliness, harder to edit
- Shared volume mount per skill — Docker complexity, still filesystem secrets

**Rationale:** Filesystem for code (git-friendly, editable), config file for binding (declarative, auditable), database for secrets (encrypted, dashboard-manageable). Each layer does what it's best at.

### 2. Encrypted env storage in PostgreSQL

**Choice:** `agent_skill_config.env_encrypted` column using Fernet symmetric encryption with key derived from `NUVEX_SECRET_KEY`.

**Alternatives considered:**
- PostgreSQL `pgcrypto` extension — ties encryption to DB, harder to rotate keys
- HashiCorp Vault / external secret manager — overkill for single-VPS deployment
- Asymmetric encryption — unnecessary complexity for server-side-only secrets

**Rationale:** Fernet (from `cryptography` package, already in Python ecosystem) provides authenticated encryption. Key rotation is possible by re-encrypting on key change. Single `NUVEX_SECRET_KEY` env var is simple to manage. If the DB is compromised without the key, secrets are safe.

### 3. `.env.example` as primary config schema format

**Choice:** Skills declare config via `.env.example` with comment annotations. `config.schema.json` optional for complex schemas.

**Alternatives considered:**
- YAML schema in SKILL.md frontmatter — frontmatter is already crowded, schemas can be verbose
- Separate YAML config file — yet another format to learn
- JSON Schema only — not beginner-friendly for simple skills

**Rationale:** `.env.example` is universally understood, already standard practice in most projects, and trivially parseable. Comment annotations (`# required | secret | description`) are lightweight. JSON Schema is the escape hatch for complex cases.

### 4. Progressive disclosure with keyword matching

**Choice:** Load only skill name+description at startup. Keyword match user message against descriptions. Load full body on match.

**Alternatives considered:**
- Always load all skills (current behavior) — works but wastes tokens with 5+ skills
- Embedding similarity — more accurate but adds vector compute on every message
- LLM-based selection — accurate but adds an LLM call before the main call

**Rationale:** Keyword matching is fast, free, and good enough for the typical 3-10 skills. Progressive disclosure saves ~500-2000 tokens per non-matching skill. Backward-compatible via `skill_disclosure: eager` flag. Embeddings can be added later without changing the architecture.

### 5. Skill resolution: agent workspace → global library

**Choice:** Check agent workspace first (override), then global library (default).

**Rationale:** Same precedence as OpenClaw (`<workspace>/skills` > `~/.openclaw/skills`) and standard package override conventions. Agent workspace override is the escape hatch for testing patched skills without affecting other agents.

## Filesystem Layout

```
/data/
├── skills/                              # Global skill library (NEW)
│   ├── elevenlabs/
│   │   ├── SKILL.md
│   │   ├── .env.example                 # Config schema declaration
│   │   └── scripts/
│   │       └── tts.sh
│   ├── github/
│   │   ├── SKILL.md
│   │   ├── config.schema.json           # Complex schema alternative
│   │   └── scripts/
│   │       └── pr-review.sh
│   └── weather/
│       └── SKILL.md
├── agents/
│   └── maya/
│       └── workspace/
│           ├── SOUL.md
│           ├── skills/                   # Agent-specific overrides (optional)
│           │   └── elevenlabs/           # Overrides /data/skills/elevenlabs/
│           │       └── SKILL.md
│           ...
```

## Database Schema Addition

```sql
CREATE TABLE agent_skill_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    env_encrypted BYTEA,         -- Fernet-encrypted JSON: {"KEY": "value"}
    config_json JSONB,           -- Non-secret config: {"voice_id": "rachel"}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (agent_id, skill_name)
);

CREATE INDEX idx_agent_skill_config_agent ON agent_skill_config(agent_id);
```

## Runtime Flow

```
1. Agent invocation arrives
2. Load skill allowlist from nuvex.yaml: ["elevenlabs", "github"]
3. For each skill in allowlist:
   a. resolve_skill_path() → agent workspace or global library
   b. Parse SKILL.md frontmatter (name, description, metadata)
   c. Check gating: metadata.openclaw.requires.bins / .env
   d. Query agent_skill_config for enabled status
4. Build prompt:
   - Progressive mode: inject <available-skills> XML summary
   - Eager mode: inject full SKILL.md bodies
5. On message, check keyword match → activate matching skills → inject full body
6. On tool call to skill script:
   a. SkillEnvInjectionHook identifies skill from path
   b. Loads + decrypts env from agent_skill_config
   c. Falls back to .env file (deprecated) if no DB config
   d. Injects env into subprocess
7. Governance evaluates tool call as normal
8. Shell tool executes with merged environment
```

## Risks / Trade-offs

- **[Risk] Keyword matching is naive** → Mitigation: Works for 3-10 skills with good descriptions. Add embedding similarity as a future enhancement. `skill_disclosure: eager` is the escape hatch.
- **[Risk] NUVEX_SECRET_KEY loss means losing all secrets** → Mitigation: Document backup procedure. Key rotation command re-encrypts all records.
- **[Risk] .env.example parsing is fragile for unusual formats** → Mitigation: Keep parser simple (line-by-line). `config.schema.json` is the fallback for complex cases.
- **[Risk] TS→Python conversion is lossy** → Mitigation: Import generates stubs with TODO markers. Developer must implement the actual logic. Original TS body is preserved as docstring for reference.
- **[Risk] Hook block/approval adds complexity to tool pipeline** → Mitigation: Default behavior is unchanged (hooks return None → allow). Block/approval is opt-in.

## Decision 6: OpenClaw plugin import as one-time conversion

**Choice:** Static TS→Python converter that generates `BaseTool` stubs from `api.registerTool()` calls. No runtime bridge.

**Alternatives considered:**
- Runtime TS execution via Deno subprocess — adds TS runtime dependency, complex IPC, security surface
- Manual conversion guide only — too much friction for plugin authors migrating

**Rationale:** One-time conversion preserves Python-only runtime. Generated stubs give developers a head start. TypeBox→Pydantic mapping covers the common cases (~80% of plugin parameters). Complex logic still needs manual porting but the scaffold is ready.

## Decision 7: Hook block/approval return semantics

**Choice:** PreToolUse hooks MAY return `HookResult(block=True)` or `HookResult(require_approval=True)`. This aligns with OpenClaw's `before_tool_call` return values `{ block: true }` and `{ requireApproval: true }`.

**Alternatives considered:**
- Raise exceptions to block — non-standard, mixes error handling with policy
- Separate block/approval middleware — over-engineering; hooks already run at the right point

**Rationale:** Extending the existing hook system with a return dataclass is minimal effort. Maintains backward compatibility (hooks that return None still work). Enables governance hooks that can block dangerous operations without custom tool wrappers.
- **[Risk] Breaking change for existing workspace skill layout** → Mitigation: Agent workspace skills still work (highest precedence). Existing setups need zero changes. Global library is additive.

## Migration Plan

1. Add `agent_skill_config` migration — no data to migrate, table starts empty
2. Create `/data/skills/` directory in Docker volumes (empty by default)
3. Update `workspace.py` to use precedence chain — backward compatible, agent workspace still checked first
4. Update `shell_tool.py` to accept env dict — backward compatible, env is optional
5. Dashboard skill pages can be added incrementally (API first, then UI)
6. Users migrate secrets from `.env` files to DB config via dashboard at their own pace (`.env` fallback ensures no breakage)

## Open Questions

1. Should `nuvex.yaml` skill allowlist also move to the database (for dashboard-only management)? Current decision: keep in yaml for now (version-controllable), dashboard reads it read-only.
2. Fernet key rotation: implement `nuvex secrets rotate` CLI command now or defer? Current decision: defer to a later phase — document manual re-encryption process.
