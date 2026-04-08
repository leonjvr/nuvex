## Context

NUVEX is a Python/LangGraph multi-agent platform running on a single Hetzner VPS. The Brain service is a FastAPI app that orchestrates agents through a governance-wrapped StateGraph. Currently all tools are hard-coded in `tools_registry.py` (a static list returning `[ShellTool()]`), hooks are registered via decorators in `hooks.py` (flat list, no priority), and model routing is built into the `route_model` graph node. There is no mechanism for external code to add tools, providers, or channels without modifying Brain source.

The codebase already has:
- `HookRegistry` with pre/post hooks, `HookContext` with abort support, 5-second timeout per hook
- `AgentDefinition` with `skills: list[str]` and `forbidden_tools: list[str]`
- Governance graph nodes: `check_forbidden` → `check_budget` → `call_llm` → `check_policy` → `execute_tools` — these are LangGraph nodes, not hooks
- Gateway containers (WhatsApp/Telegram/Email) that call Brain via `POST /api/v1/invoke`
- `agent_skill_config` table design (from skill-architecture-refactor) for encrypted per-agent-skill config

The parallel `skill-architecture-refactor` change designed a 3-layer skill system (global library + yaml binding + DB config). This design subsumes skills into the plugin system as a plugin type, reusing the encrypted config and schema patterns.

## Goals / Non-Goals

**Goals:**
- Plugins can register tools, connectors, providers, channels, and hooks as independent Python packages
- Governance wraps all plugin tool executions unconditionally — the "governance sandwich" is structural, not opt-in
- Plugins declare permissions; undeclared capabilities are blocked at runtime
- Per-agent plugin scoping: each agent sees only tools from its enabled plugins
- Per-agent-plugin config with encrypted secrets in PostgreSQL
- Plugin trust tiers: verified, community, private
- CLI for plugin management: install, list, remove, verify
- Existing skills continue to work with zero migration
- Enterprise integration story: organisations can write private connector plugins for their internal systems

**Non-Goals:**
- Plugin marketplace / hosted registry (future — start with local path and git URL install)
- Process-level sandboxing (deferred — plugins run in the Brain process; permission enforcement is at the SDK level, not OS level)
- Plugin-contributed LangGraph nodes (plugins cannot modify the governance graph structure)
- Hot-reload of plugins (requires Brain restart; live reload adds too much complexity for V1)
- TypeScript/Node.js plugin support (Python-only; OpenClaw TS plugins need conversion via `nuvex plugins import`)
- Plugin dependency resolution (plugins declare Python deps; user installs them; no automatic transitive resolution for V1)
- Multi-version plugin support (one version per plugin ID active at a time)

## Decisions

### 1. Plugin = Python package with `nuvex_plugin` entry point

**Choice:** Plugins are standard Python packages that declare a `nuvex_plugin` entry point group in `pyproject.toml`. The Brain discovers installed plugins via `importlib.metadata.entry_points()`.

```toml
# Plugin's pyproject.toml
[project.entry-points.nuvex_plugin]
sap-connector = "nuvex_sap:register"
```

**Alternatives considered:**
- Directory scan of `/data/plugins/` (like skills) — works for simple cases but doesn't handle Python dependencies; can't `pip install` to a scan directory cleanly
- Custom manifest file (like OpenClaw's `openclaw.plugin.json`) — adds a non-standard format; Python already has `pyproject.toml` for metadata
- Plugin class that subclasses `NuvexPlugin` — OOP overhead; registration function is simpler and matches OpenClaw's `register(api)` pattern

**Rationale:** Using Python's standard entry point mechanism means plugins are installable via `pip install nuvex-sap-connector` (or `uv add`), discoverable without file scanning, and compatible with standard packaging tools. The registration function pattern is familiar to OpenClaw plugin authors. For local/private plugins, `pip install -e ./my-plugin` works.

**Discovery also supports unpackaged plugins** via `/data/plugins/<name>/plugin.py` for simple single-file plugins that don't need packaging. The loader falls back to directory scan after entry points.

### 2. Registration API via PluginAPI object

**Choice:** The registration function receives a `PluginAPI` object with typed methods:

```python
from nuvex.plugin import define_plugin, PluginAPI
from pydantic import BaseModel, Field

class QueryInput(BaseModel):
    sql: str = Field(description="SQL query to execute")

def register(api: PluginAPI):
    api.register_tool(
        name="sap_query",
        description="Query SAP via RFC",
        input_schema=QueryInput,
        execute=run_query,
    )
    api.register_hook("pre_tool", my_hook, priority=150)
    api.register_config_schema({
        "SAP_HOST": {"type": "string", "required": True},
        "SAP_PASSWORD": {"type": "string", "required": True, "secret": True},
    })
```

**Key methods:**
| Method | Registers |
|---|---|
| `api.register_tool(name, description, input_schema, execute, optional=False)` | Agent tool (LangChain `BaseTool` generated from Pydantic schema) |
| `api.register_connector(name, config_schema, connect, health_check)` | External system connector with connection pooling |
| `api.register_provider(id, name, models, invoke)` | LLM provider for model routing |
| `api.register_channel(id, name, send, receive, health_check)` | Messaging channel |
| `api.register_hook(event, handler, priority=100)` | Pre/post-tool hook |
| `api.register_config_schema(schema)` | Plugin config requirements |

**Alternatives considered:**
- Decorator-based registration (`@nuvex.tool(...)`) — attractive API but harder to scope to a plugin; global decorators can conflict
- Class-based tools (require subclassing `BaseTool`) — too much boilerplate for simple tools; we generate the `BaseTool` from the Pydantic schema internally

**Rationale:** Function-based API with typed object is the simplest approach. Pydantic schemas for tool inputs give validation + JSON schema generation for free. Internally, `register_tool()` generates a `BaseTool` subclass so it integrates with LangChain without the plugin author knowing.

### 3. Governance sandwich — plugins cannot bypass governance nodes

**Choice:** The LangGraph governance nodes (`check_forbidden`, `check_budget`, `check_policy`) are hard-coded in `build_graph()` and not exposed to the plugin API. All tool calls — built-in or plugin — flow through the same graph:

```
route_model → check_forbidden → check_budget → call_llm → check_policy → execute_tools
                                                                              ↑
                                                                    plugin tools here
```

Plugins CAN register hooks that run during `execute_tools` (pre/post tool use), but:
- Governance hooks (priority 0–99) always run before plugin hooks (priority 100+)
- Governance hooks CAN block; plugin hooks CAN block but cannot unblock a governance block
- The `forbidden_tools` check happens at the graph node level, before `execute_tools` is reached

**Alternatives considered:**
- Let plugins register custom graph nodes — too much power; a malicious plugin could bypass governance
- Run governance as hooks instead of graph nodes — hooks can be skipped/reordered; graph nodes are structural
- Separate governance graph from execution graph — adds complexity; current single graph is clean

**Rationale:** The graph structure _is_ the governance guarantee. A plugin tool named `sap_query` goes through `check_forbidden` (is it in the forbidden list?), `check_budget` (has the agent exceeded budget?), and `check_policy` (does it violate any custom policies?) before it ever reaches `execute_tools`. No plugin code runs in those nodes.

### 4. Permission model — declared capabilities enforced at SDK level

**Choice:** Plugins declare required permissions in their registration:

```python
@define_plugin(
    id="sap-connector",
    permissions=["network", "env:SAP_*", "db:read:external"],
)
def register(api: PluginAPI):
    ...
```

Permission types:
| Permission | Grants | Enforced by |
|---|---|---|
| `network` | HTTP/TCP outbound calls | `PluginHttpClient` wrapper (replaces raw `httpx`/`aiohttp`) |
| `db:read` | Read from NUVEX PostgreSQL | `PluginDbSession` wrapper (read-only transaction) |
| `db:write` | Write to NUVEX PostgreSQL | `PluginDbSession` wrapper |
| `db:read:external` | Plugin manages its own external DB connection | Audit-logged but not proxied |
| `env:PATTERN` | Access to matching env vars | `api.get_env()` filters by declared patterns |
| `filesystem:PATH` | Read/write to specific paths | `api.read_file()` / `api.write_file()` check path prefix |

**Enforcement is SDK-level, not OS-level.** The `PluginAPI` object only exposes methods the plugin has permission for. A plugin without `network` permission doesn't get `api.http_client`. A malicious plugin could bypass this by importing `httpx` directly — OS-level sandboxing (process isolation) is a non-goal for V1 but noted as a future enhancement.

**Alternatives considered:**
- OS-level sandboxing via subprocess (like OpenClaw's approach for shell scripts) — heavy; adds IPC complexity; breaks for plugins that need to interact with LangChain objects
- No permission model — simple but loses the governance story
- Allowlist at the Python import level — fragile; `importlib` can be abused

**Rationale:** SDK-level enforcement covers the honest-plugin case and provides clear documentation of what a plugin needs. Trust tiers cover the honesty assumption: verified plugins are reviewed, community plugins require `--trust`, private plugins are your own code. For V2, process isolation via subprocess + IPC can be added for community plugins.

### 5. Hook priority ordering

**Choice:** Refactor `HookRegistry` from a flat list to a priority-ordered list:

```
Priority 0-99:   Governance hooks (reserved, cannot be registered by plugins)
                 - audit_hook (priority 0)
                 - cost_tracking_hook (priority 10)
Priority 100+:   Plugin hooks (registered via api.register_hook())
                 - compliance_check (priority 100)
                 - custom_logging (priority 200)
```

- Hooks within the same priority level run in registration order
- A `HookResult(block=True)` from any hook stops the chain
- A governance hook block cannot be overridden by a plugin hook
- Plugin hooks cannot register in the 0–99 range

**Alternatives considered:**
- Keep flat list, just append plugin hooks after governance — works but no explicit priority control; fragile ordering
- Named phases (governance_phase, plugin_phase) — cleaner conceptually but over-engineered for the current hook count

**Rationale:** Priority numbers are simple, flexible, and familiar (CSS z-index, middleware ordering). The reserved range creates a hard boundary. If we add more governance hooks later, they slot into 0–99 without affecting plugin hooks.

### 6. Per-agent plugin scoping and config

**Choice:** Reuse the pattern from skill-architecture-refactor. Agent config in `nuvex.yaml`:

```yaml
agents:
  maya:
    plugins:
      sap-connector:
        enabled: true
      github:
        enabled: true
        config:
          default_org: "acme-corp"  # non-secret config inline
    skills: [elevenlabs]  # backward-compat shorthand for skill-type plugins
```

Per-agent-plugin secrets stored in `agent_plugin_config` table (same schema as `agent_skill_config`):
- `id`, `agent_id`, `plugin_id`, `enabled`, `env_encrypted` (Fernet), `config_json` (JSONB), timestamps
- Managed via dashboard or CLI

At tool resolution time:
1. `get_tools_for_agent(agent_id)` reads agent config
2. For each enabled plugin, load the plugin's tools
3. Inject per-agent config into tools via closure (decrypted env available to `execute()`)
4. Return combined tool list to LangGraph

**Alternatives considered:**
- Global plugin config only (all agents share same SAP credentials) — doesn't work for multi-agent; agent A needs system X, agent B needs system Y
- Plugin config in YAML only (no DB) — can't manage secrets via dashboard; can't rotate per-agent

**Rationale:** Per-agent scoping is NUVEX's multi-agent advantage over OpenClaw. The encrypted DB config pattern is already designed in skill-architecture-refactor. Unifying `agent_skill_config` and `agent_plugin_config` into one table makes sense since skills are becoming a plugin type.

### 7. Connector plugin type — standardised external system pattern

**Choice:** Connectors are a specialised plugin type that wraps external system access:

```python
@define_plugin(
    id="mssql-connector",
    permissions=["db:read:external", "env:MSSQL_*"],
)
def register(api: PluginAPI):
    api.register_connector(
        name="mssql",
        config_schema=MSSQLConfig,
        connect=create_connection_pool,
        health_check=ping_db,
    )
    api.register_tool(
        name="mssql_query",
        description="Execute SQL query against MSSQL database",
        input_schema=SQLQueryInput,
        execute=run_query,  # uses connector's connection pool
    )
    api.register_tool(
        name="mssql_write",
        description="Execute INSERT/UPDATE/DELETE on MSSQL database",
        input_schema=SQLWriteInput,
        execute=run_write,
        optional=True,  # must be explicitly allowed per agent
    )
```

`register_connector()` creates a managed connection pool that:
- Initialises on Brain startup (or lazy on first use)
- Gets health-checked by the existing `plugin-health` spec infrastructure
- Is available to the plugin's tool `execute()` functions via closure
- Is shut down cleanly on Brain stop

**Rationale:** External system access is the primary enterprise use case. By formalising connectors, we standardise connection pooling, health checking, and credential management. Write tools are `optional=True` by default — agents must be explicitly granted write access per the principle of least privilege.

### 8. Provider plugin type — extending model routing

**Choice:** Provider plugins register themselves with the model routing system:

```python
api.register_provider(
    id="mistral",
    name="Mistral AI",
    models=["mistral-large", "mistral-small", "codestral"],
    invoke=call_mistral,
    config_schema=MistralConfig,
)
```

The `route_model` node already resolves model by tier (fast/standard/power). Provider plugins add to the available model pool. If an agent's config references `mistral-large` as their `primary` model, the router finds the `mistral` provider and uses its `invoke` function.

**Alternatives considered:**
- LiteLLM as universal provider proxy — adds a dependency; not all providers are supported; custom enterprise models won't be in LiteLLM
- LangChain ChatModel subclasses only — works but forces plugin authors to understand LangChain internals

**Rationale:** A thin `invoke(messages, config) -> response` interface is the simplest contract. Internally we wrap it in a LangChain ChatModel adapter for graph compatibility. Plugin authors don't need to know LangChain.

### 9. Skill plugins — backward-compatible unification

**Choice:** Skills become a plugin type. The loader recognises skill directories (containing `SKILL.md`) and wraps them as a `SkillPlugin`:

```
/data/plugins/elevenlabs/          # plugin package (has __init__.py or plugin.py)
/data/skills/elevenlabs/           # skill directory (has SKILL.md)
/data/agents/maya/workspace/skills/elevenlabs/  # agent-local skill
```

Precedence:
1. Agent-local skill directory (highest — override)
2. Global plugin package (if plugin type)
3. Global skill directory (backward compat)

When the loader encounters a skill directory (no `plugin.py`, has `SKILL.md`):
- Auto-generates a `SkillPlugin` wrapper
- SKILL.md body becomes the prompt injection content
- `.env.example` becomes the config schema
- Scripts become shell tools scoped to the skill

When the loader encounters a plugin package (has `plugin.py` or entry point):
- Loads via standard registration API
- Plugin MAY include a SKILL.md for prompt context

Config key `skills: [elevenlabs]` is syntactic sugar — the loader resolves it as `plugins: {elevenlabs: {enabled: true}}` internally.

**Rationale:** No forced migration. Existing skill directories continue to work. Plugin authors who want more power (custom Python tools, typed schemas, provider registrations) use the plugin API. Skills that just need prompt text + shell scripts stay simple.

### 10. Plugin installation — local-first, registry later

**Choice:** V1 supports two install methods:

```bash
# From local path (private/org plugins)
nuvex plugins install ./my-connector/

# From git URL
nuvex plugins install git+https://github.com/acme/nuvex-sap-connector.git

# From PyPI (community/verified)
nuvex plugins install nuvex-sap-connector
```

All methods use `pip install` (or `uv add`) under the hood into the Brain's Python environment. The `plugin_registry` DB table tracks what's installed:

| Column | Purpose |
|---|---|
| `id` (UUID) | Primary key |
| `plugin_id` (TEXT, UNIQUE) | Plugin identifier from manifest |
| `name` (TEXT) | Display name |
| `version` (TEXT) | Installed version |
| `source` (TEXT) | Install source (path, git URL, PyPI) |
| `trust_tier` (TEXT) | `verified` / `community` / `private` |
| `permissions` (JSONB) | Declared permissions |
| `manifest_hash` (TEXT) | SHA-256 of plugin source for integrity |
| `installed_at` (TIMESTAMPTZ) | When installed |

A dedicated NUVEX plugin registry (like ClawHub) is a future goal. For V1, PyPI + git URLs cover the use cases.

**Rationale:** Using standard Python packaging avoids building custom package management. `uv add` is already NUVEX's package manager. Local path install covers the enterprise case (private plugins never leave the org). Git URL covers sharing without a registry.

## Risks / Trade-offs

- **[Risk] SDK-level permission enforcement is bypassable** → Mitigation: Trust tiers. Verified plugins are reviewed. Community plugins require `--trust` flag. Private plugins are the org's own code. V2 adds process isolation for untrusted plugins.
- **[Risk] Plugins running in-process can crash the Brain** → Mitigation: Plugin tool execution already wrapped in try/except with timeout in `execute_tools` node. Add plugin-level error budget: 3 consecutive failures → plugin auto-disabled, dashboard notification.
- **[Risk] Plugin dependency conflicts with Brain's packages** → Mitigation: Pin Brain dependencies. Plugins must declare compatible ranges. V2 can explore virtualenv isolation per plugin.
- **[Risk] Plugin tools not going through governance** → Mitigation: Not possible by design. All tools — built-in and plugin — are called via `execute_tools` node which is downstream of `check_forbidden`, `check_budget`, and `check_policy`. A plugin cannot call its tools outside the graph.
- **[Risk] Migration complexity from standalone skills** → Mitigation: Zero migration needed. Skills auto-wrapped as SkillPlugin. Only plugin authors who want more power need to learn the plugin API.
- **[Risk] Enterprise DB connectors holding long-lived connections** → Mitigation: Connector health checks + connection pool timeouts. Brain shutdown gracefully closes all connector pools.
- **[Risk] Too many plugin tools bloating agent prompts** → Mitigation: Progressive disclosure from skill-architecture-refactor applies to plugin tools too. Only enabled + relevant tools injected per message.

## Migration Plan

1. **Phase 1** — Plugin SDK + Loader: Ship `nuvex.plugin` package, plugin loader in Brain startup, entry point discovery. No breaking changes. Existing skills continue to work.
2. **Phase 2** — Connector + Provider types: Ship connector and provider plugin patterns. Build 2–3 reference connectors (PostgreSQL read, REST API, MSSQL) to validate patterns.
3. **Phase 3** — CLI + Dashboard: Ship `nuvex plugins` commands and dashboard plugin management pages.
4. **Phase 4** — Trust + Permissions: Ship signing, verification, and runtime permission enforcement.
5. **Phase 5** — Community registry: Launch NUVEX plugin registry for publishing/discovery.

Each phase is independently deployable. Rollback = revert to prior Brain image (plugins are additive; removing a plugin just means its tools disappear from agents).

## Open Questions

1. **Unified table or separate?** Should `agent_skill_config` and `agent_plugin_config` be one table (`agent_plugin_config`) since skills are becoming plugins? (Proposed: yes — merge into one table, add `plugin_type` column)
2. **Channel plugins and gateway containers** — Channel plugins register in Brain, but gateways are separate containers. Does a channel plugin replace a gateway container, or does it run inside the Brain and communicate with users via a protocol adapter? (Proposed: V1 channel plugins only add to Brain-side routing; existing gateway containers remain for WhatsApp/Telegram/Email; new channels added purely as Brain-side plugins would need their own listener, deferring this to V2)
3. **Plugin auto-update policy** — Should verified plugins auto-update on Brain restart? (Proposed: no auto-update in V1; explicit `nuvex plugins update` command; auto-update is V2 with rollback support)
