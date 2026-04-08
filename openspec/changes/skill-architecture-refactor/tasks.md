## 1. Database Schema & Migration

- [x] 1.1 Create SQLAlchemy model `src/brain/models/skill_config.py` — `AgentSkillConfig` with columns: id (UUID), agent_id, skill_name, enabled, env_encrypted (LargeBinary), config_json (JSONB), created_at, updated_at, unique constraint on (agent_id, skill_name)
- [x] 1.2 Write Alembic migration `0003_add_agent_skill_config.py` — CREATE TABLE `agent_skill_config` with index on agent_id
- [x] 1.3 Register model in `src/brain/models_registry.py` so Alembic discovers it

## 2. Encryption Layer

- [x] 2.1 Create `src/shared/crypto.py` — Fernet encryption helper: `encrypt_env(data: dict, key: str) -> bytes` and `decrypt_env(token: bytes, key: str) -> dict`. Key derived from `NUVEX_SECRET_KEY` env var. Raise on missing key.
- [x] 2.2 Add `NUVEX_SECRET_KEY` to `.env.example` and validate presence at brain startup

## 3. Skill Library & Resolution

- [x] 3.1 Create `src/brain/skills/` package with `__init__.py`
- [x] 3.2 Create `src/brain/skills/resolver.py` — `resolve_skill_path(workspace_path: str, skill_name: str, global_library: str = "/data/skills") -> Path | None` implementing agent-workspace → global-library precedence
- [x] 3.3 Create `src/brain/skills/parser.py` — `parse_skill_md(path: Path) -> SkillMetadata` that extracts YAML frontmatter (name, description, license, compatibility, metadata, allowed-tools) and markdown body from SKILL.md
- [x] 3.4 Create `src/brain/skills/gating.py` — `check_skill_eligible(metadata: SkillMetadata) -> tuple[bool, str | None]` that checks `metadata.openclaw.requires.bins` (on PATH) and `metadata.openclaw.requires.env` (in agent config)
- [x] 3.5 Create `src/brain/skills/schema_parser.py` — `parse_env_example(path: Path) -> list[SkillConfigField]` and `parse_config_schema(path: Path) -> list[SkillConfigField]` for config schema declaration parsing

## 4. Workspace & Prompt Assembly Amendments

- [x] 4.1 Refactor `workspace.py` `load_skill_files()` to use `resolve_skill_path()` for each skill in agent's allowlist (agent workspace → global library precedence)
- [x] 4.2 Add `skill_disclosure` field to `AgentDefinition` in `src/shared/models/config.py` (default: `"progressive"`, alternative: `"eager"`)
- [x] 4.3 Implement progressive disclosure in `assemble_system_prompt()`: when mode is `progressive`, inject compact XML `<available-skills>` with name+description only; when `eager`, inject full bodies (current behavior)
- [x] 4.4 Implement `activate_skills(message: str, skill_summaries: list[SkillMetadata]) -> list[str]` keyword matching function that returns skill names whose description matches the user message

## 5. Tool Registry & Skill-Aware Tool Filtering

- [x] 5.1 Refactor `tools_registry.py` `get_tools_for_agent()` to accept agent config, load built-in tools + skill-declared tools based on agent's enabled skills
- [x] 5.2 Load builtin tools from `src/brain/tools/builtin.py` (ReadFileTool, WriteFileTool, WebFetchTool, SendMessageTool) — these are already implemented but not registered in the registry

## 6. Skill Environment Injection

- [x] 6.1 Add `skill_name: str | None` and `skill_env: dict[str, str] | None` fields to `HookContext` in `hooks.py`
- [x] 6.2 Create `SkillEnvInjectionHook` (PreToolUse) in `hooks.py` — detects skill scripts by path, queries `agent_skill_config`, decrypts env, sets `ctx.skill_env`; falls back to `.env` file with deprecation warning
- [x] 6.3 Update `shell_tool.py` `_arun()` to accept optional `env: dict` parameter and pass it to `create_subprocess_shell()` via the `env` kwarg (merged with `os.environ`)
- [x] 6.4 Update `execute_tools.py` to pass `ctx.skill_env` from HookContext to the tool execution when available

## 7. Brain API — Skill Endpoints

- [x] 7.1 Create `src/brain/routers/skills.py` — `GET /api/v1/skills` list all skills from global library with name, description, agent usage count
- [x] 7.2 Add `GET /api/v1/skills/{skill_name}/schema` — returns parsed config schema (from `.env.example` or `config.schema.json`)
- [x] 7.3 Add `GET /api/v1/agents/{agent_id}/skills` — list all skills for agent with config status (configured/unconfigured/missing-required)
- [x] 7.4 Add `GET /api/v1/agents/{agent_id}/skills/{skill_name}` — get config for one agent-skill pair (env values masked)
- [x] 7.5 Add `PUT /api/v1/agents/{agent_id}/skills/{skill_name}` — create/update agent-skill config with validation against skill schema
- [x] 7.6 Add `DELETE /api/v1/agents/{agent_id}/skills/{skill_name}` — remove agent-skill config
- [x] 7.7 Mount skills router in `src/brain/server.py`

## 8. Dashboard — Skill Management UI

- [x] 8.1 Create `src/dashboard/routers/skills.py` — proxy endpoints to brain skill API (or direct DB access)
- [x] 8.2 Build skill library page in dashboard frontend — lists all global skills with name, description, agent count
- [x] 8.3 Build per-agent skill picker in agent detail page — checkboxes for available skills
- [x] 8.4 Build per-agent-skill config panel — auto-generated form from skill schema, with secret field masking
- [x] 8.5 Implement secret field handling: masked display, password input, empty-means-no-change on save
- [x] 8.6 Implement client-side validation: required fields must be filled before save

## 9. Integration & Testing

- [x] 9.1 Write unit test for `resolve_skill_path()` — precedence chain with both locations, missing skill, etc.
- [x] 9.2 Write unit test for `parse_skill_md()` — valid frontmatter, missing frontmatter, OpenClaw metadata
- [x] 9.3 Write unit test for `parse_env_example()` — all tag combinations, no comments, edge cases
- [x] 9.4 Write unit test for `encrypt_env()` / `decrypt_env()` — round-trip, missing key error
- [ ] 9.5 Write integration test for skill env injection flow — agent invokes skill script, receives DB-stored env vars
- [ ] 9.6 Write integration test for progressive disclosure — prompt contains only summaries, activation adds full body
- [ ] 9.7 Write integration test for backward compatibility — agent with workspace-only skills still works correctly

## 10. Hook Block/Approval Semantics

- [x] 10.1 Create `HookResult` dataclass in `src/brain/hooks.py` with fields: `block: bool = False`, `require_approval: bool = False`, `reason: str | None = None`
- [x] 10.2 Update `execute_tools.py` PreToolUse hook runner to check `HookResult` return — if `block=True`, skip tool and return reason as tool error
- [x] 10.3 Implement approval-required flow: when `require_approval=True`, create pending approval DB record and return suspension message to agent
- [x] 10.4 Create `src/brain/models/approval.py` — `PendingApproval` model (id, agent_id, thread_id, tool_name, tool_input, reason, status, created_at, resolved_at, resolved_by)
- [x] 10.5 Write Alembic migration for `pending_approvals` table
- [x] 10.6 Add `POST /api/v1/approvals/{id}/approve` and `POST /api/v1/approvals/{id}/reject` endpoints in brain API
- [x] 10.7 Surface pending approvals in dashboard with approve/reject buttons
- [x] 10.8 Update hook runner to process multiple PreToolUse hooks sequentially — first `block=True` stops the chain

## 11. OpenClaw Plugin Import CLI

- [x] 11.1 Create `src/brain/tools/imported/` package with `__init__.py`
- [x] 11.2 Create `src/cli/plugins.py` — `nuvex plugins import <path>` command that reads OpenClaw `manifest.json` and scans for `api.registerTool()` calls
- [x] 11.3 Create `src/cli/plugin_converter.py` — TypeBox→Pydantic schema converter: `Type.String` → `str`, `Type.Number` → `float`, `Type.Boolean` → `bool`, `Type.Optional(T)` → `T | None`, `Type.Array(T)` → `list[T]`, fallback to `Any` with TODO comment
- [x] 11.4 Generate Python `BaseTool` subclass file per `registerTool()` call — class name derived from tool name, `_run()` stub with original TS body as docstring reference
- [x] 11.5 Generate `__init__.py` exporting all converted tool classes and `SKILL.md` with metadata from manifest
- [x] 11.6 Update `tools_registry.py` to auto-discover tools from `src/brain/tools/imported/*/` packages
- [x] 11.7 Write unit test for TypeBox→Pydantic conversion — all supported type mappings and unsupported fallback
- [x] 11.8 Write integration test — import a sample OpenClaw plugin scaffold and verify generated Python tools are importable and structurally correct
