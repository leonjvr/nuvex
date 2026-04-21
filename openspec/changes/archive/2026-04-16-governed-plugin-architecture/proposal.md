## Why

NUVEX is a multi-agent platform deploying into organisations where systems are messy — legacy ERPs with direct DB access only, self-built internal tools, SaaS platforms with REST APIs, and everything in between. The current architecture hard-codes all capabilities (tools, providers, channels) into the Brain service. Adding support for a new system means modifying core code, which doesn't scale: it blocks community contributions, slows enterprise deployments, and couples every integration to the Brain release cycle. NUVEX needs a plugin architecture that makes the platform extensible — letting organisations, integrators, and the community ship connectors, providers, and tools as independent packages — while preserving NUVEX's core differentiator: structural governance that plugins cannot bypass.

## What Changes

- **NEW**: Python Plugin SDK (`nuvex.plugin`) — typed registration API (`api.register_tool()`, `api.register_connector()`, `api.register_provider()`, `api.register_channel()`, `api.register_hook()`) with Pydantic schemas, declared permissions, and config schema support
- **NEW**: Plugin loader in the Brain service — discovers, validates, and loads plugins at startup from `/data/plugins/` (global) and per-agent config, with sandboxed execution and permission enforcement
- **NEW**: Declared permission model — plugins declare capabilities they need (`network`, `db:read`, `db:write`, `env:SAP_*`, `filesystem:/data/exports`), governance enforces at runtime; undeclared capabilities are blocked
- **NEW**: Trust tiers for plugins — verified (signed, reviewed, auto-update), community (published, unreviewed, requires `--trust`), private (org-internal, local path)
- **NEW**: Plugin registry CLI — `nuvex plugins install`, `nuvex plugins list`, `nuvex plugins remove`, `nuvex plugins verify`
- **NEW**: Per-agent plugin scoping — agents declare enabled plugins in config; each agent sees only its own plugin tools, with per-agent-plugin encrypted config in PostgreSQL
- **NEW**: Connector plugin type — standardised pattern for integrating external systems (REST API, direct DB, file-based) with read/write tool generation, connection pooling, and health checks
- **NEW**: Provider plugin type — extend model routing with new LLM providers without modifying core `route_model` node
- **NEW**: Hook plugin type — register pre/post-tool hooks that run AFTER governance hooks (priority 100+), supporting block/approval return semantics
- **BREAKING**: Skill plugins subsume the standalone skill system — a skill becomes a plugin type (SKILL.md + tools + config in one package), unifying the two extension models. Existing standalone skills remain loadable via backward-compatible wrapper.
- **Modified**: Governance pipeline wraps all plugin tool executions unconditionally — the "governance sandwich" guarantee: forbidden checks, budget enforcement, and policy evaluation cannot be bypassed or influenced by plugins
- **Modified**: `tools_registry.py` becomes the plugin tool aggregator — dynamically loads tools from enabled plugins per agent
- **Modified**: `HookRegistry` gains priority ordering and governance-reserved priority range (0–99)

## Capabilities

### New Capabilities
- `plugin-sdk`: Python Plugin SDK — `nuvex.plugin` package with `define_plugin()`, `PluginAPI` registration interface, Pydantic-typed tool registration, config schema declaration, and permission manifest
- `plugin-loader`: Brain-side plugin discovery, validation, and lifecycle management — scans `/data/plugins/`, validates manifests, enforces permission declarations, manages startup/shutdown
- `plugin-permissions`: Declared capability model for plugins — permission types (network, db, env, filesystem), runtime enforcement via governance, undeclared = blocked
- `plugin-trust-tiers`: Plugin signing, trust classification (verified/community/private), and installation policies
- `plugin-registry-cli`: CLI commands for plugin management — install from registry or local path, list, remove, verify signatures, inspect manifests
- `plugin-connectors`: Standardised connector plugin type for external system integrations — connection management, read/write tool generation, health monitoring, pre-built patterns for REST API and direct DB access
- `plugin-providers`: Provider plugin type for LLM model providers — extends `route_model` without core changes, config schema for API keys and endpoints
- `plugin-channels`: Channel plugin type for messaging platforms — extends gateway registration, message format adapters, per-agent channel binding
- `plugin-hooks`: Hook plugin type with priority ordering, governance-reserved range, block/approval return semantics
- `plugin-config`: Per-agent-plugin configuration storage in PostgreSQL — encrypted secrets, non-secret config, config schema validation, dashboard management

### Modified Capabilities
- `tool-hooks`: **AMENDMENT** — HookRegistry gains priority ordering with governance-reserved range (0–99); plugin hooks start at priority 100; `HookResult` return semantics enforced sequentially
- `skill-system`: **AMENDMENT** — Skills become a plugin type (`skill-plugin`); existing SKILL.md format is preserved but loaded through the plugin loader; standalone skill loading path remains as backward-compatible wrapper
- `governance-pipeline`: **AMENDMENT** — Governance nodes explicitly documented as plugin-impervious; forbidden checks, budget enforcement, and policy evaluation wrap all tool executions regardless of source (built-in or plugin)
- `workspace-bootstrap`: **AMENDMENT** — Plugin manifests injected into agent context alongside skills; plugin tool descriptions available in system prompt

## Impact

- **Brain service**: `tools_registry.py` refactored to plugin-aware aggregator; `hooks.py` gains priority ordering; `server.py` mounts plugin management endpoints; `graph.py` governance nodes documented as non-pluggable
- **Config**: `AgentDefinition` in `config.py` gains `plugins: dict[str, PluginConfig]` alongside existing `skills` list (skills become syntactic sugar for skill-type plugins)
- **Database**: New tables — `plugin_registry` (installed plugins, trust tier, manifest hash), `agent_plugin_config` (per-agent-plugin encrypted config, inherits pattern from `agent_skill_config`)
- **Filesystem**: `/data/plugins/` directory for global plugin packages; each plugin is a Python package with manifest
- **CLI**: New `nuvex plugins` subcommand group under existing CLI; eventual registry protocol for `nuvex plugins install <name>`
- **Dashboard**: Plugin management pages — installed plugins, per-agent plugin enablement, per-agent-plugin config/secret editor
- **Governance**: No structural changes — governance nodes already wrap all tool execution. Amendment documents the guarantee explicitly.
- **Gateway containers**: No changes — gateways remain thin HTTP bridges. Channel plugins register in the Brain and route messages through existing `actions` mechanism.
- **Dependency on skill-architecture-refactor**: The `agent-skill-config` encrypted storage pattern, config schema format (`.env.example`), and progressive disclosure become shared infrastructure. Skill-architecture-refactor should be implemented first or merged into this change as the skill-plugin type.
- **Migration**: Existing `skills: [elevenlabs, github]` config continues to work — loader wraps standalone skills as skill-plugins transparently. No forced migration.
