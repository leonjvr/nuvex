## 1. Plugin SDK Package

- [ ] 1.1 Create `src/nuvex_plugin/` package with `__init__.py` exporting `define_plugin`, `PluginAPI`, `HookResult`, `ExecutionContext`
- [ ] 1.2 Implement `define_plugin()` decorator — accepts `id` (required), `name` (required), `version`, `permissions: list[str]`, `requires: list[str]`; stores metadata on the registration function; raises `PluginDefinitionError` if `id` missing
- [ ] 1.3 Implement `PluginAPI` class — constructed by loader with plugin metadata and permissions; holds registrations for tools, connectors, providers, channels, hooks, config schema
- [ ] 1.4 Implement `PluginAPI.register_tool(name, description, input_schema, execute, optional=False)` — validates Pydantic BaseModel schema, stores tool registration; raises `PluginConflictError` on duplicate name
- [ ] 1.5 Implement `PluginAPI.register_connector(name, config_schema, connect, health_check)` — stores connector registration
- [ ] 1.6 Implement `PluginAPI.register_provider(id, name, models, invoke, config_schema)` — stores provider registration
- [ ] 1.7 Implement `PluginAPI.register_channel(id, name, send, receive, health_check)` — stores channel registration
- [ ] 1.8 Implement `PluginAPI.register_hook(event, handler, priority=100)` — validates priority >= 100; raises `PluginPermissionError` for 0-99 range
- [ ] 1.9 Implement `PluginAPI.register_config_schema(schema: dict)` — stores config schema with field types, required flags, secret flags, descriptions, defaults
- [ ] 1.10 Implement `PluginAPI.register_http_route(path, handler, methods)` — stores HTTP route registration for channel webhooks
- [ ] 1.11 Implement `ExecutionContext` dataclass — `agent_id`, `thread_id`, `plugin_config: dict[str, Any]`
- [ ] 1.12 Implement `HookResult` dataclass — `block: bool = False`, `require_approval: bool = False`, `reason: str | None = None`

## 2. Plugin Permissions Enforcement

- [ ] 2.1 Implement permission-gated `PluginHttpClient` — wraps `httpx.AsyncClient`; only constructed for plugins with `network` permission; logs plugin_id, method, URL, status to audit trail
- [ ] 2.2 Implement `PluginAPI.get_env(key)` — filters by declared `env:PATTERN` permissions using glob matching; raises `PermissionDeniedError` on mismatch; reads from agent's decrypted plugin config
- [ ] 2.3 Implement `PluginAPI.read_file(path)` / `write_file(path, data)` — validates path against declared `filesystem:PATH` permissions; raises `PermissionDeniedError` on path outside declared prefix
- [ ] 2.4 Implement `PluginDbSession` wrapper — provides read-only SQLAlchemy session for `db:read` permission, read-write for `db:write`; raises `PermissionDeniedError` if not declared
- [ ] 2.5 Implement permission denial audit logging — log plugin_id, operation, required permission as security warning on every denied access

## 3. Plugin Loader

- [ ] 3.1 Create `src/brain/plugin_loader.py` — main loader module
- [ ] 3.2 Implement entry point discovery — `importlib.metadata.entry_points(group="nuvex_plugin")`; iterate, import, extract `@define_plugin` metadata
- [ ] 3.3 Implement `/data/plugins/` directory scan fallback — find directories with `plugin.py`, dynamically import, extract `@define_plugin` metadata
- [ ] 3.4 Implement `/data/skills/` auto-wrap — find directories with `SKILL.md` but no `plugin.py`; generate `SkillPlugin` wrapper with shell tools from `scripts/`
- [ ] 3.5 Implement agent workspace skill scan — find agent-local skills in `/data/agents/<name>/workspace/skills/`; auto-wrap as `SkillPlugin` with highest precedence
- [ ] 3.6 Implement plugin validation — check for duplicate ids (first wins, log error for second); catch registration exceptions (skip plugin, continue loading)
- [ ] 3.7 Implement plugin load ordering — entry point plugins alphabetical → `/data/plugins/` directory alphabetical → skill auto-wraps alphabetical
- [ ] 3.8 Implement `PluginAPI` construction per plugin — create API object with permission filtering based on declared permissions
- [ ] 3.9 Implement BaseTool generation — from `register_tool()` registrations, generate LangChain `BaseTool` subclass with `args_schema` from Pydantic model and `_arun` delegating to execute function
- [ ] 3.10 Implement plugin shutdown — call each plugin's `shutdown()` callback (if registered) with 10-second timeout; close connector pools

## 4. Plugin Registry Database

- [ ] 4.1 Create `src/brain/models/plugin_registry.py` — SQLAlchemy model `PluginRegistry` with columns: id (UUID), plugin_id (TEXT UNIQUE), name, version, source, trust_tier, permissions (JSONB), manifest_hash, installed_at
- [ ] 4.2 Create `src/brain/models/plugin_config.py` — SQLAlchemy model `AgentPluginConfig` with columns: id (UUID), agent_id (TEXT), plugin_id (TEXT), plugin_type (TEXT, default 'plugin'), enabled (BOOLEAN), env_encrypted (BYTEA), config_json (JSONB), created_at, updated_at; unique constraint on (agent_id, plugin_id)
- [ ] 4.3 Write Alembic migration `0003_add_plugin_tables.py` — CREATE TABLE `plugin_registry` and `agent_plugin_config` with indexes on agent_id and plugin_id
- [ ] 4.4 Register models in `src/brain/models_registry.py` so Alembic discovers them
- [ ] 4.5 Implement loader DB sync — on load, INSERT or UPDATE `plugin_registry` records; detect version/hash changes and log info

## 5. Plugin Config Encryption & Retrieval

- [ ] 5.1 Create `src/shared/crypto.py` — Fernet encryption helper: `encrypt_env(data: dict, key: str) -> bytes` and `decrypt_env(token: bytes, key: str) -> dict`; key from `NUVEX_SECRET_KEY` env var; raise on missing key
- [ ] 5.2 Add `NUVEX_SECRET_KEY` validation at Brain startup — refuse to start if key missing and encrypted plugin configs exist
- [ ] 5.3 Implement config save flow — validate against plugin's config schema; encrypt secret fields; store in `agent_plugin_config`
- [ ] 5.4 Implement config retrieval flow — query `agent_plugin_config` by agent_id + plugin_id; decrypt env_encrypted; merge with config_json; return as dict
- [ ] 5.5 Implement config injection into tool execution — pass decrypted config as `ExecutionContext.plugin_config` to tool's execute function

## 6. Hook Registry Refactor

- [ ] 6.1 Refactor `HookRegistry` in `hooks.py` — replace flat `list[HookFn]` with priority-ordered list of `(priority: int, hook: HookFn)` tuples; sort by priority ascending, then registration order
- [ ] 6.2 Update `register_pre` / `register_post` to accept `priority` parameter (default 0 for governance hooks)
- [ ] 6.3 Add plugin hook registration method — accept hooks at priority >= 100 only; reject 0-99 with `PluginPermissionError`
- [ ] 6.4 Add `plugin_id`, `plugin_config` fields to `HookContext` dataclass; preserve existing `skill_name`, `skill_env` fields for backward compat
- [ ] 6.5 Implement `HookResult` processing in `_run_hooks()` — check return value for `HookResult`; if `block=True`, stop chain and set `ctx.abort`; if `require_approval=True`, create pending approval record
- [ ] 6.6 Ensure backward compat — hooks that return `None` or set `ctx.abort` directly still work unchanged
- [ ] 6.7 Update `run_pre_hooks` to populate `ctx.plugin_id` and `ctx.plugin_config` from tool metadata before executing hooks

## 7. Tools Registry Refactor

- [ ] 7.1 Refactor `tools_registry.py` `get_tools_for_agent(agent_id)` — accept agent config; load built-in tools + plugin tools for enabled plugins
- [ ] 7.2 Implement plugin tool collection — for each enabled plugin, collect `BaseTool` instances generated by the loader
- [ ] 7.3 Implement per-agent tool filtering — only include tools from plugins listed in the agent's config; respect `optional` flag (only include if explicitly enabled)
- [ ] 7.4 Inject per-agent plugin config into tool closures — each tool's execute function receives the correct agent's decrypted config

## 8. Config Loader Update

- [ ] 8.1 Add `plugins: dict[str, PluginAgentConfig]` field to `AgentDefinition` in `config.py` — `PluginAgentConfig` with `enabled: bool`, `config: dict[str, Any]` (non-secret inline config)
- [ ] 8.2 Implement `skills` → `plugins` expansion — config loader expands `skills: [elevenlabs]` to `plugins: {elevenlabs: {enabled: true}}`; `plugins:` key takes precedence on conflict
- [ ] 8.3 Validate plugin references — warn if agent config references a plugin id not found in `plugin_registry`

## 9. Brain Startup Integration

- [ ] 9.1 Integrate plugin loader into `server.py` `lifespan()` — call `load_plugins()` after database init, before router mounting
- [ ] 9.2 Initialise connector pools at startup — for each connector registration, call `connect()` with decrypted config
- [ ] 9.3 Register provider plugins with model routing — extend `route_model` to check plugin providers when resolving model identifier
- [ ] 9.4 Mount channel plugin HTTP routes — under `/plugins/<plugin-id>/` namespace on the FastAPI app
- [ ] 9.5 Register plugin hooks in HookRegistry — at priority levels declared by plugins (100+)
- [ ] 9.6 Implement graceful shutdown — call plugin shutdown callbacks, close connector pools, with 10-second timeout per plugin

## 10. Brain API — Plugin Endpoints

- [ ] 10.1 Create `src/brain/routers/plugins.py` — `GET /api/v1/plugins` list all installed plugins with id, name, version, trust_tier, tool count, agent usage count
- [ ] 10.2 Add `GET /api/v1/plugins/{plugin_id}` — detailed plugin info: metadata, permissions, config schema, registered tools, registered hooks
- [ ] 10.3 Add `GET /api/v1/plugins/{plugin_id}/schema` — returns config schema for dashboard form generation
- [ ] 10.4 Add `GET /api/v1/agents/{agent_id}/plugins` — list plugins for agent with config status (configured/unconfigured/missing-required)
- [ ] 10.5 Add `GET /api/v1/agents/{agent_id}/plugins/{plugin_id}` — agent-plugin config with masked secrets
- [ ] 10.6 Add `PUT /api/v1/agents/{agent_id}/plugins/{plugin_id}` — save agent-plugin config with schema validation and encryption
- [ ] 10.7 Add `DELETE /api/v1/agents/{agent_id}/plugins/{plugin_id}` — remove agent-plugin config
- [ ] 10.8 Add `GET /api/v1/models` — list all available models from built-in and plugin providers
- [ ] 10.9 Mount plugins router in `server.py`

## 11. Plugin Registry CLI

- [ ] 11.1 Create `src/brain/cli/plugins.py` — CLI subcommand group for `nuvex plugins`
- [ ] 11.2 Implement `nuvex plugins install <source>` — detect source type (local path / git URL / PyPI); run `uv add` / `pip install`; assign trust tier; record in `plugin_registry`; print restart notice
- [ ] 11.3 Implement `nuvex plugins install --trust` flag — required for community (PyPI) packages; refuse without flag
- [ ] 11.4 Implement `nuvex plugins list` — query `plugin_registry`; display table (id, name, version, tier, source, agent count); support `--json` output
- [ ] 11.5 Implement `nuvex plugins remove <id>` — warn if agents have config; on confirm, delete `agent_plugin_config` records, run `uv remove`, delete `plugin_registry` record
- [ ] 11.6 Implement `nuvex plugins verify <id>` — compute current package hash; compare against `plugin_registry.manifest_hash`; report match/mismatch
- [ ] 11.7 Implement `nuvex plugins info <id>` — display full metadata, permissions, config schema, tools, hooks, agents using the plugin

## 12. Trust Tiers & Signing

- [ ] 12.1 Implement trust tier assignment in install flow — local path → `private`; git URL → `private`; PyPI → `community` (or `verified` if signature valid)
- [ ] 12.2 Implement signature verification placeholder — for V1, log "signature verification not yet implemented" for PyPI packages; always classify as `community`
- [ ] 12.3 Store trust tier in `plugin_registry.trust_tier` and display in CLI and dashboard

## 13. Connector Plugin Support

- [ ] 13.1 Implement connector pool manager in plugin loader — `ConnectorPool` class managing per-agent-plugin connection pools with lazy init, health check interval (60s), and graceful shutdown
- [ ] 13.2 Implement connector health monitoring — health check called every 60 seconds; 3 consecutive failures → mark unhealthy; recovery on next success
- [ ] 13.3 Integrate connector health with existing `plugin-health` infrastructure (if available) or standalone health tracking
- [ ] 13.4 Implement `RestConnectorBase` helper class — base URL, auth config, `get()`/`post()`/`put()`/`delete()` methods with automatic auth header injection, configurable retry, structured error responses

## 14. Provider Plugin Support

- [ ] 14.1 Implement provider registry — global dict mapping model identifiers to provider invoke functions
- [ ] 14.2 Implement LangChain ChatModel adapter — wraps plugin provider's `invoke(messages, model, config, tools)` function in a `BaseChatModel` subclass for graph compatibility
- [ ] 14.3 Update `route_model` node to check plugin provider registry when resolving model identifier — if agent's model config references a plugin model, use plugin provider
- [ ] 14.4 Implement per-agent provider config — pass agent's decrypted plugin config to provider's invoke function

## 15. Channel Plugin Support

- [ ] 15.1 Implement channel registry — global dict mapping channel id to send/receive functions
- [ ] 15.2 Implement channel action routing — when `execute_tools` produces an action targeting a plugin channel, route to the channel plugin's `send()` function
- [ ] 15.3 Mount channel HTTP routes under `/plugins/<plugin-id>/` namespace for webhook receivers
- [ ] 15.4 Implement per-agent channel binding — route inbound messages only to agents that have the channel plugin enabled

## 16. Workspace & Prompt Integration

- [ ] 16.1 Update `workspace.py` `load_skill_files()` to use plugin loader for skill resolution — agent workspace → plugin packages → global skills
- [ ] 16.2 Update `assemble_system_prompt()` to include plugin tool descriptions in the tools context section
- [ ] 16.3 Ensure progressive disclosure applies to plugins with SKILL.md — summary-only initially, full body on activation
- [ ] 16.4 Ensure plugins without SKILL.md always have their tools visible to the LLM (no progressive gating)

## 17. Dashboard — Plugin Management

- [ ] 17.1 Create `src/dashboard/routers/plugins.py` — proxy endpoints to brain plugin API
- [ ] 17.2 Build installed plugins page — list all plugins with id, name, version, trust tier badge, tool count, agent count
- [ ] 17.3 Build plugin detail page — show metadata, permissions, config schema, registered tools/hooks, agents using plugin
- [ ] 17.4 Build per-agent plugin picker — checkboxes in agent detail page for enabling/disabling plugins
- [ ] 17.5 Build per-agent-plugin config panel — auto-generated form from config schema, password inputs for secrets, empty-means-no-change on save
- [ ] 17.6 Implement config validation in dashboard — required fields must be filled before save; show validation errors inline

## 18. Testing

- [ ] 18.1 Write unit test for `define_plugin()` — metadata extraction, missing id error, valid permissions
- [ ] 18.2 Write unit test for `PluginAPI.register_tool()` — Pydantic schema validation, duplicate name detection, optional flag
- [ ] 18.3 Write unit test for permission enforcement — `get_env()` pattern matching, `http_client` availability, `read_file()` path checking, denial logging
- [ ] 18.4 Write unit test for plugin loader — entry point discovery mock, directory scan, skill auto-wrap, duplicate id handling, exception recovery
- [ ] 18.5 Write unit test for `HookRegistry` priority ordering — governance before plugin, same-priority registration order, block stops chain
- [ ] 18.6 Write unit test for `HookResult` processing — block, require_approval, None return, legacy ctx.abort compat
- [ ] 18.7 Write unit test for `encrypt_env()` / `decrypt_env()` — round-trip, missing key error
- [ ] 18.8 Write unit test for config save/retrieve — schema validation, secret encryption, non-secret JSONB, merged retrieval
- [ ] 18.9 Write unit test for `get_tools_for_agent()` — built-in + plugin tools, per-agent filtering, optional tool gating
- [ ] 18.10 Write unit test for skills → plugins expansion — `skills:` shorthand, `plugins:` override, conflict resolution
- [ ] 18.11 Write integration test for plugin tool governance — plugin tool blocked by forbidden list, budget exceeded, policy denied
- [ ] 18.12 Write integration test for connector lifecycle — pool creation, health check, failure detection, recovery, shutdown
- [ ] 18.13 Write integration test for provider plugin — model routing resolves to plugin provider, invoke called with correct config
- [ ] 18.14 Write integration test for full plugin flow — install plugin, enable for agent, configure, invoke tool, verify governance audit captured
