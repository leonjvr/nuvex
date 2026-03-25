# SIDJUA CLI Reference

Complete reference for all `sidjua` commands. Version V0.11.0.

Run `sidjua <command> --help` for inline option summaries.

---

## Global Options

The following options apply across most commands:

| Option | Description | Default |
|--------|-------------|---------|
| `--work-dir <path>` | Working directory (workspace root) | current directory |
| `--json` | Machine-readable JSON output | false |
| `--help`, `-h` | Print help for any command | — |

---

## First-Run & Bootstrap

### `sidjua init`

Create a new SIDJUA workspace in the current directory. Installs the built-in Guide
agent, which works immediately with no API key or account required (uses embedded
Cloudflare Workers AI on the free tier).

When run interactively (stdin is a TTY and `--yes` is not set), `sidjua init` presents
a 3-step dialog that configures your workspace without any manual file editing:

1. **Workspace name** — defaults to the current directory name
2. **Memory & Knowledge** — choose an embedding provider (OpenAI, Cloudflare, BM25-only, or skip)
3. **AI Provider** — choose a provider and enter its API key (Groq, Google, OpenAI, Anthropic, or skip)

After the dialog, the workspace is created and the selected API keys are written to
`.system/providers/<provider>.yaml` and `.env`.

**Synopsis:** `sidjua init [--work-dir <path>] [--force] [--quiet] [--yes] [--provider <name>] [--provider-key <key>] [--memory <mode>]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--work-dir <path>` | Target directory for the workspace | cwd |
| `--force` | Re-initialize even if workspace already exists | false |
| `--quiet` | Suppress output | false |
| `--yes` | Non-interactive: skip dialog, use defaults | false |
| `--provider <name>` | Pre-select provider: `groq`\|`google`\|`openai`\|`anthropic` | — |
| `--provider-key <key>` | Provider API key (use with `--provider`) | — |
| `--memory <mode>` | Memory mode: `openai`\|`cloudflare`\|`bm25`\|`skip` | `skip` |

**What it creates:**

```
.system/                     Internal database and provider config
  sidjua.db                  SQLite database
  providers/                 Provider credential templates
    cloudflare.yaml          Embedded (no key needed)
    groq.yaml                Template — add key with /key
    google.yaml              Template — add key with /key
agents/
  agents.yaml                List of configured agents
  definitions/guide.yaml     Guide agent definition
  skills/guide.md            Guide skill file
  templates/                 Agent templates (worker, manager, researcher, developer)
governance/
  CHARTER.md                 Governance charter (edit to customize)
  boundaries/defaults.yaml   Default action boundaries
divisions.yaml               Organizational structure (edit to customize)
docs/                        Bundled reference documentation
```

**Interactive example:**

```bash
$ sidjua init

  SIDJUA — Initializing workspace...

  [1/3] Workspace name (default: my-project): my-project

  [2/3] Memory & Knowledge
        Choose embedding mode:
    (a) Activate with OpenAI embeddings (recommended)
    (b) Activate with Cloudflare embeddings (free)
    (c) BM25 only (keyword search, no API key needed)
    (d) Skip memory for now

  [3/3] AI Provider
        Set up a provider:
    (a) Groq — free, fast, no credit card
    (b) Google AI Studio — free, smart, no credit card
    ...

  ✓ Workspace created: my-project
  ✓ Memory: not configured (add later: sidjua memory activate)
  ✓ Provider: groq (llama-3.3-70b-versatile)
  ✓ Guide agent ready — try: sidjua chat guide
```

**Non-interactive / CI / Docker example:**

```bash
# Skip dialog entirely — use defaults (no provider, BM25 memory)
sidjua init --yes

# Pre-configure a provider non-interactively
sidjua init --yes --provider groq --provider-key gsk_abc123

# With OpenAI embeddings
sidjua init --yes --provider openai --provider-key sk-proj-... --memory openai
```

**Notes:**
- Idempotent — safe to run in an already-initialized workspace (existing files are not overwritten)
- Use `--force` to overwrite all generated files (user-edited files are also overwritten)
- In non-TTY environments (Docker, CI), the dialog is automatically skipped — equivalent to `--yes`
- See also: `sidjua setup`, `sidjua apply`

---

### `sidjua setup`

Interactive guided setup assistant. Answers questions about provider configuration,
divisions.yaml editing, and initial deployment. Uses Cloudflare Workers AI (free tier)
for natural language answers; falls back to bundled documentation if offline.

**Synopsis:** `sidjua setup [--ask <topic>] [--validate] [--suggest] [options]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--ask <topic>` | Ask the assistant a specific question | — |
| `--validate` | Validate current provider configuration | false |
| `--suggest` | Get provider recommendations | false |
| `--budget <level>` | Budget constraint for suggestions: `zero`\|`low`\|`standard`\|`high` | `standard` |
| `--use-case <desc>` | Your use case (narrows suggestions) | — |
| `--local-only` | Only suggest local/offline providers | false |

**Example:**

```bash
$ sidjua setup
$ sidjua setup --ask "which model is best for T1 agents?"
$ sidjua setup --suggest --budget low --local-only
$ sidjua setup --validate
```

---

### `sidjua apply`

Bootstrap the AI workspace from `divisions.yaml`. Provisions 10 subsystems in order.
Idempotent — safe to re-run after editing `divisions.yaml`.

**Synopsis:** `sidjua apply [--config <path>] [--dry-run] [--verbose] [--force] [--step <name>]`

**Options:**

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--config <path>` | | Path to divisions.yaml | `./divisions.yaml` |
| `--dry-run` | `-n` | Show plan without executing | false |
| `--verbose` | `-v` | Detailed output per step | false |
| `--force` | `-f` | Skip confirmation prompts | false |
| `--step <name>` | | Run only one step (and prerequisites) | all steps |
| `--work-dir <path>` | | Working directory | cwd |

**Provisioning steps:**

| Step | Name | Description |
|------|------|-------------|
| 1 | `VALIDATE` | Parse and validate divisions.yaml |
| 2 | `FILESYSTEM` | Create directory structure |
| 3 | `DATABASE` | Initialize SQLite schema (v1.8) |
| 4 | `SECRETS` | Provision secrets paths |
| 5 | `RBAC` | Generate role assignments |
| 6 | `ROUTING` | Build agent routing table |
| 7 | `SKILLS` | Assign skill directories per division |
| 8 | `AUDIT` | Initialize audit partitions and views |
| 9 | `COST_CENTERS` | Configure budget tracking |
| 10 | `FINALIZE` | Write state file |

**Example:**

```bash
$ sidjua apply --verbose
[1/10] VALIDATE     ✓ divisions.yaml parsed (2 divisions, 4 agents)
[2/10] FILESYSTEM   ✓ Directory structure created
[3/10] DATABASE     ✓ SQLite schema initialized (v1.8)
[4/10] SECRETS      ✓ Secrets paths provisioned
[5/10] RBAC         ✓ Role assignments generated
[6/10] ROUTING      ✓ Agent routing table built
[7/10] SKILLS       ✓ Skill directories assigned
[8/10] AUDIT        ✓ Audit partitions initialized
[9/10] COST_CENTERS ✓ Budget tracking configured
[10/10] FINALIZE    ✓ State file written

✓ Apply complete. Run 'sidjua status' to verify.

$ sidjua apply --dry-run          # preview without changes
$ sidjua apply --step DATABASE    # run only the DATABASE step
```

**Notes:**
- Re-run after every `divisions.yaml` change
- Creates a governance snapshot before applying; roll back with `sidjua governance rollback`
- `--step` runs the named step and all steps it depends on

---

### `sidjua status`

Show current workspace state: divisions, last apply result, and database path.

**Synopsis:** `sidjua status [--work-dir <path>]`

**Example:**

```bash
$ sidjua status
Workspace: /home/user/my-project
Database:  .system/sidjua.db
Applied:   2026-03-01 14:23:11 (10 steps, 0 errors)
Divisions: engineering (active), marketing (active)
```

---

## Orchestrator Control

### `sidjua start`

Start the orchestrator and all configured agents.

**Synopsis:** `sidjua start [--foreground] [--log-level <level>] [--config <path>]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--foreground` | Run in foreground (no daemon) | false |
| `--log-level <level>` | `debug`\|`info`\|`warn`\|`error` | `info` |
| `--config <path>` | Path to orchestrator.yaml | `governance/orchestrator.yaml` |
| `--work-dir <path>` | Working directory | cwd |

**Example:**

```bash
$ sidjua start                            # background daemon
$ sidjua start --foreground --log-level debug
```

---

### `sidjua stop-orchestrator`

Graceful orchestrator shutdown. Drains in-flight tasks before stopping.

**Synopsis:** `sidjua stop-orchestrator [--force] [--timeout <seconds>]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--force` | SIGKILL immediately, skip drain | false |
| `--timeout <seconds>` | Max drain time | `60` |
| `--work-dir <path>` | Working directory | cwd |

---

### `sidjua pause` / `sidjua resume`

Pause stops the orchestrator from accepting new tasks (in-progress tasks continue).
Resume restarts task acceptance.

```bash
sidjua pause   [--work-dir <path>]
sidjua resume  [--work-dir <path>]
```

---

### `sidjua health`

System health check. Reports orchestrator state, agent availability, and database
connectivity.

**Synopsis:** `sidjua health [--json]`

```bash
$ sidjua health
$ sidjua health --json
```

**REST equivalent:** `GET /api/v1/orchestrator/status`

---

## Task Execution

### `sidjua run [description]`

Submit a task. The 5-stage governance pipeline (Forbidden → Approval → Budget →
Classification → Policy) runs before the task reaches any agent.

**Synopsis:** `sidjua run [description] [options]`

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `description` | Optional | Natural-language task description (use `--file` as alternative) |

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--file <path>` | Load task from YAML file | — |
| `--priority <level>` | `critical`\|`urgent`\|`regular`\|`low`\|`background` | `regular` |
| `--division <code>` | Target division | — |
| `--budget <tokens>` | Token budget limit | `100000` |
| `--cost-limit <usd>` | Cost limit in USD | `5.0` |
| `--tier <n>` | Target agent tier (1–3) | `1` |
| `--wait` | Block until task completes | false |
| `--timeout <seconds>` | Max wait time (with `--wait`) | `600` |
| `--json` | Output task ID in JSON | false |
| `--work-dir <path>` | Working directory | cwd |

**Example:**

```bash
$ sidjua run "Summarize the Q1 financials"
Task submitted: task-abc123

$ sidjua run "Draft release notes" \
    --division engineering \
    --cost-limit 2.00 \
    --wait
Guide: Task completed. Result written to .system/tasks/task-xyz/result.md
```

**Notes:**
- Governance enforcement is synchronous and mandatory; blocked tasks return exit code 1
- Budget check uses the *projected* cost of the first LLM call; subsequent calls are checked per-turn
- See also: `sidjua task watch`, `sidjua decide`

**REST equivalent:** `POST /api/v1/tasks/run`

---

### `sidjua tasks [id]`

List tasks or inspect a specific task.

**Synopsis:** `sidjua tasks [id] [options]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--status <s>` | `active`\|`pending`\|`running`\|`done`\|`failed`\|`all` | `active` |
| `--division <code>` | Filter by division | — |
| `--agent <id>` | Filter by agent | — |
| `--tier <n>` | Filter by tier | — |
| `--limit <n>` | Max entries | `20` |
| `--summary` | Show result summary only | false |
| `--result` | Output full result | false |
| `--tree` | Show ASCII delegation tree | false |
| `--json` | Machine-readable output | false |
| `--work-dir <path>` | Working directory | cwd |

**Example:**

```bash
$ sidjua tasks
$ sidjua tasks --status done --division engineering
$ sidjua tasks task-abc123 --tree
$ sidjua tasks task-abc123 --result
```

**REST equivalents:** `GET /api/v1/tasks`, `GET /api/v1/tasks/:id`

---

### `sidjua task <subcommand>`

Fine-grained task operations.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `stop <id>` | `sidjua task stop <id> [--force] [--reason <text>]` | Cancel with configurable reason |
| `watch <id>` | `sidjua task watch <id> [--timeout <s>]` | Stream live progress |
| `result <id>` | `sidjua task result <id> [--json]` | Print full result |
| `tree <id>` | `sidjua task tree <id> [--json]` | Print delegation tree |
| `cancel <id>` | `sidjua task cancel <id> [--json]` | Cancel task and all sub-tasks |

**`task stop` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Skip confirmation prompt | false |
| `--reason <text>` | Cancellation reason | `user_cancelled` |
| `--json` | JSON output | false |
| `--work-dir <path>` | Working directory | cwd |

**`task watch` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--timeout <seconds>` | Max watch time | `600` |
| `--work-dir <path>` | Working directory | cwd |

**Example:**

```bash
$ sidjua task watch task-abc123         # live updates, exits on completion
$ sidjua task result task-abc123        # print completed result
$ sidjua task tree task-abc123          # show parent → child structure
$ sidjua task cancel task-abc123        # cancel gracefully
$ sidjua task stop task-abc123 --force  # SIGKILL
```

**REST equivalents:** `POST /api/v1/tasks/:id/cancel`, `GET /api/v1/tasks/:id/result`, `GET /api/v1/tasks/:id/tree`

---

### `sidjua decide [id]`

Handle human-in-the-loop decisions for escalated tasks.

**Synopsis:** `sidjua decide [id] [--action <a>] [options]`

**Options:**

| Flag | Description |
|------|-------------|
| `--action <a>` | `retry`\|`cancel`\|`reassign`\|`resolve` |
| `--guidance <text>` | Additional instructions (for `retry`) |
| `--agent <id>` | Target agent (for `reassign`) |
| `--result <text>` | Human-provided result (for `resolve`) |
| `--result-file <path>` | Load result from file |
| `--json` | JSON output |
| `--work-dir <path>` | Working directory |

**Example:**

```bash
$ sidjua decide                                    # list pending escalations
$ sidjua decide task-xyz --action retry --guidance "Use the backup database"
$ sidjua decide task-xyz --action reassign --agent backup-agent
$ sidjua decide task-xyz --action resolve --result "Answer: 42"
$ sidjua decide task-xyz --action cancel
```

---

### `sidjua queue`

View Task Pipeline queue status and backpressure metrics.

**Synopsis:** `sidjua queue [--agent <id>] [--json]`

```bash
$ sidjua queue
$ sidjua queue --agent my-agent --json
```

---

## Agent Lifecycle

### `sidjua agents [id]`

Quick snapshot of all agents (read from running orchestrator or database).

**Synopsis:** `sidjua agents [id] [--tier <n>] [--status <s>] [--json]`

**Options:**

| Flag | Description |
|------|-------------|
| `--tier <n>` | Filter by tier (1–3) |
| `--status <s>` | Filter: `idle`\|`busy`\|`overloaded`\|`crashed` |
| `--json` | JSON output |
| `--work-dir <path>` | Working directory |

**Example:**

```bash
$ sidjua agents
$ sidjua agents --tier 3 --status idle
$ sidjua agents my-agent
```

**REST equivalent:** `GET /api/v1/agents`, `GET /api/v1/agents/:id`

---

### `sidjua agent <subcommand>`

Full agent lifecycle management.

#### `sidjua agent create [id]`

Create a new agent. Supports interactive wizard, command-line flags, a template, or a
YAML file.

**Synopsis:** `sidjua agent create [id] [options]`

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `id` | Optional | Agent ID (lowercase, letters/digits/hyphens, start with letter) |

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--template <id>` | Start from a built-in template | — |
| `--file <path>` | Load definition from YAML | — |
| `--name <name>` | Agent display name | — |
| `--tier <n>` | Agent tier (1–3) | `3` |
| `--provider <id>` | LLM provider ID | — |
| `--model <id>` | Model ID | — |
| `--division <code>` | Division code | — |
| `--capabilities <list>` | Comma-separated capability list | — |
| `--budget-per-task <usd>` | Max cost per task in USD | — |
| `--budget-monthly <usd>` | Monthly budget cap in USD | — |
| `--skill <path>` | Path to skill.md file | — |
| `--quick` | Minimal prompts | false |
| `--json` | JSON output | false |
| `--work-dir <path>` | Working directory | cwd |

**Example:**

```bash
$ sidjua agent create                    # interactive wizard

$ sidjua agent create my-developer \
    --provider anthropic \
    --model claude-haiku-4-5-20251001 \
    --division engineering \
    --tier 3 \
    --budget-per-task 0.50 \
    --budget-monthly 20.00

$ sidjua agent create --template researcher --division intelligence
```

**Notes:**
- Agent ID must be unique, lowercase, 1–63 characters, start with a letter
- `guide` is reserved; use `sidjua chat guide` for the built-in Guide agent
- For paid providers, the wizard shows per-token pricing and prompts for budget limits
- See also: `sidjua agent templates`

#### `sidjua agent list`

**Synopsis:** `sidjua agent list [--division <code>] [--tier <n>] [--status <s>] [--json]`

```bash
$ sidjua agent list
$ sidjua agent list --division engineering --tier 2
```

#### `sidjua agent show <id>`

Full details: provider, model, budget utilization, skill path, capabilities, supervisor chain.

```bash
$ sidjua agent show my-developer
```

#### `sidjua agent edit <id>`

Hot-reconfigure a running agent. Fields that require restart are flagged in the output.

**Options:**

| Flag | Description |
|------|-------------|
| `--model <id>` | Change model |
| `--budget-monthly <usd>` | Change monthly budget |
| `--budget-per-task <usd>` | Change per-task budget |
| `--division <code>` | Change division (requires restart) |
| `--tier <n>` | Change tier (requires restart) |
| `--skill <path>` | Change skill file path |
| `--json` | JSON output |
| `--work-dir <path>` | Working directory |

```bash
$ sidjua agent edit my-developer --budget-monthly 50
$ sidjua agent edit my-developer --model claude-sonnet-4-6 --tier 2
```

#### `sidjua agent start <id>` / `sidjua agent stop <id>`

Activate or deactivate an agent.

| Flag | Command | Description |
|------|---------|-------------|
| `--force` | `stop` | Immediate stop (SIGKILL) |
| `--json` | both | JSON output |
| `--work-dir <path>` | both | Working directory |

```bash
$ sidjua agent start my-developer
$ sidjua agent stop my-developer
$ sidjua agent stop my-developer --force
```

**REST equivalents:** `POST /api/v1/agents/:id/start`, `POST /api/v1/agents/:id/stop`

#### `sidjua agent delete <id>`

Remove an agent definition.

| Flag | Description |
|------|-------------|
| `--keep-history` | Preserve audit trail (soft delete) |
| `--force` | Skip confirmation prompt |
| `--json` | JSON output |
| `--work-dir <path>` | Working directory |

```bash
$ sidjua agent delete my-developer
$ sidjua agent delete my-developer --keep-history --force
```

#### `sidjua agent health <id>`

Budget utilization, status, and recent error summary for a specific agent.

```bash
$ sidjua agent health my-developer
```

#### `sidjua agent templates`

List built-in agent templates. Pass `--template <id>` to `agent create` to use one.

```bash
$ sidjua agent templates
$ sidjua agent templates --json
```

Built-in templates: `worker`, `manager`, `researcher`, `developer`

---

## Provider & Key Management

### `sidjua provider <subcommand>`

Manage LLM providers from the built-in catalog and add custom OpenAI-compatible
endpoints.

#### `sidjua provider list`

**Synopsis:** `sidjua provider list [--cloud] [--local] [--custom]`

| Flag | Description |
|------|-------------|
| `--cloud` | Cloud providers only |
| `--local` | Local/self-hosted providers only |
| `--custom` | Custom-added providers only |

```bash
$ sidjua provider list
$ sidjua provider list --cloud
$ sidjua provider list --local
```

Built-in cloud providers include: Anthropic, OpenAI, Google Gemini, Groq, DeepSeek,
Mistral, Cohere, Grok/xAI, Kimi/Moonshot, Together AI, Fireworks AI, Cloudflare Workers AI
(embedded, free tier), and more.

Built-in local providers include: Ollama, LM Studio, StudioLM, LocalAI, llama.cpp,
vLLM, TGI (HuggingFace), Jan.

#### `sidjua provider models <id>`

List models available for a provider.

```bash
$ sidjua provider models anthropic
$ sidjua provider models groq
```

#### `sidjua provider add-custom`

Register a custom OpenAI-compatible endpoint.

**Required options:**

| Flag | Description |
|------|-------------|
| `--id <id>` | Provider ID (lowercase letters/digits/-/_) |
| `--name <name>` | Display name |
| `--base-url <url>` | Base URL of the endpoint |
| `--model <model>` | Default model ID |

**Optional options:**

| Flag | Description |
|------|-------------|
| `--api-key <key>` | API key |
| `--header <kv>` | Custom HTTP header (`key:value`), repeatable |
| `--no-probe` | Skip capability auto-detection |

```bash
$ sidjua provider add-custom \
    --id ollama \
    --name "Ollama (local)" \
    --base-url http://localhost:11434/v1 \
    --model llama3.2

$ sidjua provider add-custom \
    --id my-vllm \
    --name "vLLM GPU server" \
    --base-url http://gpu-box:8000/v1 \
    --model meta-llama/Llama-3-8b-instruct \
    --header "X-Custom-Auth:token123"
```

#### `sidjua provider remove <id>`

Remove a custom provider registration.

```bash
$ sidjua provider remove ollama
```

#### `sidjua provider test`

Probe an endpoint for connectivity and capability detection.

**Required options:**

| Flag | Description |
|------|-------------|
| `--base-url <url>` | Base URL to test |
| `--model <model>` | Model ID to test with |

**Optional options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--api-key <key>` | API key | — |
| `--timeout <ms>` | Timeout per probe step | `15000` |

```bash
$ sidjua provider test \
    --base-url http://localhost:11434/v1 \
    --model llama3.2
# → ✓ Connected. Completion: OK. Token count: OK.
```

---

### `sidjua key <subcommand>`

Manage named API key references. Keys are never stored in plaintext — references point
to environment variables or literal values kept outside SIDJUA's database.

#### `sidjua key add <name>`

Register a named key reference.

**Required options:**

| Flag | Description |
|------|-------------|
| `--provider <id>` | Provider this key is for (e.g. `anthropic`) |
| `--source <spec>` | `env:VAR_NAME` or `literal:VALUE` |

**Optional options:**

| Flag | Description |
|------|-------------|
| `--agent <id>` | Restrict this key to a specific agent (repeatable) |

```bash
$ sidjua key add anthropic-key \
    --provider anthropic \
    --source env:ANTHROPIC_API_KEY

$ sidjua key add groq-shared \
    --provider groq \
    --source env:GROQ_API_KEY \
    --agent researcher-1 \
    --agent researcher-2
```

#### `sidjua key list`

List all registered key references.

```bash
$ sidjua key list
```

#### `sidjua key test <name>`

Verify a key reference resolves and authenticates successfully.

```bash
$ sidjua key test anthropic-key
```

#### `sidjua key remove <name>`

Remove a key reference.

```bash
$ sidjua key remove anthropic-key
```

**Notes:**
- Use the Guide's `/key` command as an alternative for common providers
- Key references are stored in `.system/providers/<provider>.yaml`

---

## Knowledge Pipeline

### `sidjua knowledge <subcommand>`

Manage document collections for agent knowledge retrieval (hybrid BM25 + vector search).

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `create <id>` | `sidjua knowledge create <id> [options]` | Create a new collection |
| `import <id> <file>` | `sidjua knowledge import <id> <file>` | Add document(s) to a collection |
| `list` | `sidjua knowledge list [--json]` | List all collections |
| `show <id>` | `sidjua knowledge show <id> [--json]` | Collection details and statistics |
| `search <id> <query>` | `sidjua knowledge search <id> <query> [--top-k <n>]` | Search a collection |
| `reindex <id>` | `sidjua knowledge reindex <id>` | Rebuild search index |
| `delete <id>` | `sidjua knowledge delete <id> [--force]` | Delete collection and all chunks |

**`knowledge create` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--name <name>` | Display name | — |
| `--description <text>` | Description | — |
| `--classification <level>` | `PUBLIC`\|`INTERNAL`\|`CONFIDENTIAL`\|`SECRET`\|`FYEO` | `INTERNAL` |
| `--chunking <strategy>` | `semantic`\|`fixed`\|`paragraph` | `semantic` |
| `--chunk-size <n>` | Target chunk size in tokens | `500` |
| `--work-dir <path>` | Working directory | cwd |

**`knowledge search` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--top-k <n>` | Number of results | `5` |
| `--json` | JSON output | false |
| `--work-dir <path>` | Working directory | cwd |

**Example:**

```bash
$ sidjua knowledge create research-docs \
    --name "Research Papers" \
    --classification CONFIDENTIAL

$ sidjua knowledge import research-docs ./papers/ \
    --chunk-size 600

$ sidjua knowledge search research-docs "transformer architecture" --top-k 10
$ sidjua knowledge reindex research-docs
$ sidjua knowledge delete research-docs --force
```

---

## Governance

### `sidjua policy <subcommand>`

Manage governance policy rules applied during the pre-action pipeline (Stage 5).

| Subcommand | Description |
|------------|-------------|
| `add [text]` | Add a policy rule (natural language or YAML file) |
| `list` | List all active policy rules |
| `test [scenario]` | Run policy scenario tests |
| `validate` | Check rule consistency |

**`policy add` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--file <path>` | Path to YAML policy file | — |
| `--dry-run` | Show what would be added, without deploying | false |
| `--work-dir <path>` | Working directory | cwd |

**`policy test` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--task <description>` | Action description to test | — |
| `--agent <id>` | Agent ID performing the action | — |
| `--action <pattern>` | Action pattern (e.g. `file.delete`) | — |
| `--verbose` | Show all evaluated rules | false |
| `--json` | JSON output | false |
| `--work-dir <path>` | Working directory | cwd |

**`policy list` options:**

| Flag | Description |
|------|-------------|
| `--type <t>` | Filter: `forbidden`\|`approval`\|`escalation`\|`budget`\|`custom` |
| `--json` | JSON output |
| `--work-dir <path>` | Working directory |

**Example:**

```bash
$ sidjua policy add "Agents must not access files outside /app/data"
$ sidjua policy add --file governance/policies/my-rule.yaml
$ sidjua policy list
$ sidjua policy test --agent my-agent --action "file.delete" --verbose
$ sidjua policy validate
```

**Notes:**
- Natural language input is parsed by an LLM into structured YAML policy rules
- Hard rules (`verdict: BLOCK`) terminate the action; soft rules (`verdict: WARN`) continue
- Rules are stored in `governance/policy/`

---

### `sidjua governance <subcommand>`

Manage governance configuration snapshots and security filter settings.

| Subcommand | Description |
|------------|-------------|
| `history` | List all available governance snapshots |
| `rollback <version>` | Restore a previous governance configuration |
| `diff <version>` | Show what changed since a previous version |
| `security-mode [mode]` | Get or set the security filter mode |

**`governance history` options:**

| Flag | Description |
|------|-------------|
| `--json` | JSON output |
| `--work-dir <path>` | Working directory |

**`governance rollback` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Skip confirmation prompt | false |
| `--config <path>` | Path to divisions.yaml | `./divisions.yaml` |
| `--work-dir <path>` | Working directory | cwd |

**`governance diff` options:**

| Flag | Description |
|------|-------------|
| `--json` | JSON output |
| `--config <path>` | Path to divisions.yaml |
| `--work-dir <path>` | Working directory |

**`governance security-mode` options:**

| Flag | Description |
|------|-------------|
| `--json` | JSON output (read mode only) |
| `--work-dir <path>` | Working directory |

**Example:**

```bash
$ sidjua governance history
$ sidjua governance diff v3
$ sidjua governance rollback v3 --force

# Read the current security filter mode
$ sidjua governance security-mode
Security filter mode: blacklist

# Switch to whitelist mode (block all network actions except those in the allowlist)
$ sidjua governance security-mode whitelist
Security filter mode set to: whitelist
Run 'sidjua apply' for the change to take effect.

# Revert to blacklist mode
$ sidjua governance security-mode blacklist

# JSON output for scripting
$ sidjua governance security-mode --json
{"mode":"blacklist","configured":true}
```

**Notes:**
- Up to 10 snapshots are retained; oldest are pruned automatically
- Rollback does not modify `divisions.yaml` — edit it separately after rolling back
- Rollback also available via REST: `POST /api/v1/governance/rollback/:version`
- `security-mode` edits `governance/security/security.yaml` in place, preserving all other settings
- After changing the security mode, run `sidjua apply` to reload the governance configuration
- See [Security Layer Modes](SIDJUA-CONCEPTS.md#security-layer-modes) for pattern syntax and CIDR enforcement details

---

## Tools & Environments

### `sidjua tool <subcommand>`

Manage agent tools (MCP adapters, computer-use, SSH, composite tools).

| Subcommand | Description |
|------------|-------------|
| `list` | List all registered tools |
| `show <id>` | Tool details and capabilities |
| `test <id>` | Test tool connectivity |
| `start <id>` | Start a tool adapter |
| `stop <id>` | Stop a tool adapter |
| `test-action <tool-id> <capability>` | Execute a single capability for testing |

All `tool` subcommands accept `--db <path>` (path to `sidjua.db`, default: `./sidjua.db`).

**`tool test-action` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--params <json>` | Action parameters as JSON string | `{}` |
| `--agent <id>` | Agent ID performing the action | `cli` |
| `--db <path>` | Path to sidjua.db | `./sidjua.db` |

**Example:**

```bash
$ sidjua tool list
$ sidjua tool show mcp-filesystem
$ sidjua tool test mcp-filesystem
$ sidjua tool test-action mcp-filesystem read_file --params '{"path":"/tmp/test.txt"}'
```

---

### `sidjua env <subcommand>`

Manage execution environments (local, SSH, container).

| Subcommand | Description |
|------------|-------------|
| `list` | List configured environments |
| `show <id>` | Environment details |
| `test <id>` | Test environment connectivity |
| `add` | Add a new environment (interactive) |

All `env` subcommands accept `--db <path>` (default: `./sidjua.db`).

```bash
$ sidjua env list
$ sidjua env show production
$ sidjua env test production
$ sidjua env add
```

---

## Costs, Logs & Output

### `sidjua costs`

Cost breakdown across divisions, agents, and time periods. Reads from `cost_ledger`
table (populated by every LLM call in the inline and orchestrator paths).

**Synopsis:** `sidjua costs [--division <code>] [--agent <id>] [--period <p>] [--json]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--division <code>` | Filter by division | — |
| `--agent <id>` | Filter by agent | — |
| `--period <p>` | `1h`\|`24h`\|`7d`\|`30d`\|`all` | `24h` |
| `--json` | JSON output | false |
| `--work-dir <path>` | Working directory | cwd |

**Example:**

```bash
$ sidjua costs
$ sidjua costs --period 7d
$ sidjua costs --division engineering --period 30d
$ sidjua costs --agent my-developer --json
```

**Output columns:** agent, division, provider, model, input tokens, output tokens, cost (USD)

**REST equivalent:** `GET /api/v1/costs`

---

### `sidjua logs`

Audit trail viewer with governance-aware filtering.

**Synopsis:** `sidjua logs [options]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--task <id>` | Filter by task (includes all sub-tasks) | — |
| `--agent <id>` | Filter by agent | — |
| `--division <code>` | Filter by division | — |
| `--type <t>` | `delegation`\|`escalation`\|`pipeline`\|`governance`\|`all` | — |
| `--since <date>` | ISO 8601 start date (e.g. `2026-03-01`) | — |
| `--follow` | Live tail mode | false |
| `--limit <n>` | Max entries | `50` |
| `--json` | JSON output | false |
| `--work-dir <path>` | Working directory | cwd |

**Example:**

```bash
$ sidjua logs
$ sidjua logs --type governance --since 2026-03-01
$ sidjua logs --task task-abc123
$ sidjua logs --follow
```

**REST equivalent:** `GET /api/v1/audit`

---

### `sidjua output <subcommand>`

Inspect task outputs stored in the dual-storage layer (DB summary + file content).

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `list <task-id>` | `sidjua output list <task-id>` | List outputs for a task |
| `show <output-id>` | `sidjua output show <output-id>` | Show output content |
| `search <query>` | `sidjua output search <query> [--limit <n>]` | Full-text search across outputs |
| `stats` | `sidjua output stats` | Storage statistics |
| `summary show <task-id>` | `sidjua output summary show <task-id>` | Show management summary |

All `output` subcommands accept `--work-dir <path>`.

```bash
$ sidjua output list task-abc123
$ sidjua output show out-xyz789
$ sidjua output search "sprint retrospective" --limit 10
$ sidjua output stats
$ sidjua output summary show task-abc123
```

**REST equivalents:** `GET /api/v1/tasks/:taskId/outputs`, `GET /api/v1/outputs/:id`, `GET /api/v1/outputs/search`, `GET /api/v1/outputs/stats`

---

## Logging

### `sidjua logging <subcommand>`

Runtime log level control. Changes are ephemeral — reset on process restart.

| Subcommand | Description |
|------------|-------------|
| `status` | Show current log levels per component |
| `set [component] [level]` | Change log level globally or per component |

**`logging status` options:**

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

**`logging set` options:**

| Flag | Description |
|------|-------------|
| `--global <level>` | Set the global default level |

**Valid levels:** `debug` | `info` | `warn` | `error` | `fatal` | `off`

**Example:**

```bash
$ sidjua logging status
$ sidjua logging set info              # set global level
$ sidjua logging set api-server debug  # set component level
$ sidjua logging set orchestrator warn
```

**REST equivalents:** `GET /api/v1/logging/status`, `PUT /api/v1/logging/:component`

---

## Backup & Restore

### `sidjua backup <subcommand>`

Full workspace backup and restore. Archives the SQLite database, configuration files,
and governance snapshots.

| Subcommand | Description |
|------------|-------------|
| `create` | Create a new backup archive |
| `list` | List available backups |
| `info <id-or-path>` | Show backup metadata |
| `restore <id-or-path>` | Restore from a backup |
| `delete <id>` | Delete a backup |

All `backup` subcommands accept `--work-dir <path>` and `--config <path>`.

**`backup create` options:**

| Flag | Description |
|------|-------------|
| `--label <name>` | Human-readable label |
| `--output <path>` | Write archive to this path (default: configured backup directory) |

**`backup restore` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--force` | Skip confirmation and running-agents check | false |
| `--dry-run` | Validate without modifying anything | false |

**`backup delete` options:**

| Flag | Description |
|------|-------------|
| `--force` | Skip confirmation |

**Example:**

```bash
$ sidjua backup create --label "pre-upgrade"
$ sidjua backup list
$ sidjua backup info sidjua-backup-20260301.tar.gz
$ sidjua backup restore sidjua-backup-20260301.tar.gz --dry-run
$ sidjua backup restore sidjua-backup-20260301.tar.gz
$ sidjua backup delete old-backup-id --force
```

**Notes:**
- `restore` automatically creates a safety backup of the current state before overwriting
- Stop the orchestrator before restoring to avoid database conflicts

---

## Sandbox

### `sidjua sandbox check`

Check if sandbox dependencies are available and report the configured sandbox provider
status. Reads `divisions.yaml` from the current workspace (or `--config`).

**Synopsis:** `sidjua sandbox check [--work-dir <path>] [--config <path>]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--work-dir <path>` | Workspace directory | current directory |
| `--config <path>` | Path to divisions.yaml | `./divisions.yaml` |

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Provider is `none`, or provider is `bubblewrap` with all dependencies present |
| 1 | Provider is `bubblewrap` but one or more dependencies are missing |

**Examples:**

```bash
# Check sandbox status using default divisions.yaml
sidjua sandbox check

# Check in a specific workspace
sidjua sandbox check --work-dir /srv/sidjua

# Check against an explicit config file
sidjua sandbox check --config /etc/sidjua/divisions.yaml
```

**Example output (provider: none):**
```
Sandbox Status
  Provider configured: none (passthrough)
  No sandbox isolation active.

To enable sandboxing, set sandbox.provider: "bubblewrap" in divisions.yaml.
```

**Example output (provider: bubblewrap, deps available):**
```
Sandbox Status
  Provider configured: bubblewrap
  Dependencies available: yes

Ready for sandboxed agent execution.

NOTE: Running in Docker requires extra capabilities:
  docker run --cap-add=SYS_ADMIN --security-opt seccomp=unconfined ...
```

**Example output (provider: bubblewrap, deps missing):**
```
Sandbox Status
  Provider configured: bubblewrap
  Dependencies available: no
  Missing: bwrap not found, socat not found

Install dependencies:
  Ubuntu/Debian: sudo apt install bubblewrap socat
  Alpine:        sudo apk add bubblewrap socat
  macOS:         brew install bubblewrap  (socat not needed on macOS)
```

**Sandbox configuration reference** — in `divisions.yaml`:

```yaml
sandbox:
  provider: "none"          # "none" | "bubblewrap"
  defaults:
    network:
      allowedDomains: []    # empty = allow all
      deniedDomains: []
    filesystem:
      denyRead:
        - "~/.ssh"
        - "~/.gnupg"
        - "/etc/shadow"
      allowWrite: []
      denyWrite: []
```

See [SIDJUA-CONCEPTS.md §21 Agent Sandboxing](./SIDJUA-CONCEPTS.md) for full details.

---

## Secrets Management

### `sidjua secret <subcommand>`

Manage encrypted secrets. These commands bypass RBAC and require admin access. Secrets
are stored in the workspace secrets store and are accessible to agents at runtime via
the secrets API.

**Namespaces:** `global`, `providers`, `divisions/<code>`

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `set <namespace> <key>` | `sidjua secret set <namespace> <key> [--value <v>] [--work-dir <path>]` | Write a secret value |
| `get <namespace> <key>` | `sidjua secret get <namespace> <key> [--work-dir <path>]` | Read a secret value |
| `list <namespace>` | `sidjua secret list <namespace> [--work-dir <path>]` | List secret keys in a namespace |
| `delete <namespace> <key>` | `sidjua secret delete <namespace> <key> [--work-dir <path>]` | Delete a secret |
| `info <namespace> <key>` | `sidjua secret info <namespace> <key> [--work-dir <path>]` | Show metadata for a secret |
| `rotate <namespace> <key>` | `sidjua secret rotate <namespace> <key> [--value <v>] [--work-dir <path>]` | Rotate to a new value |
| `namespaces` | `sidjua secret namespaces [--work-dir <path>]` | List all namespaces |

**Options common to all subcommands:**

| Flag | Description | Default |
|------|-------------|---------|
| `--work-dir <path>` | Working directory | cwd |

**Additional options for `set` and `rotate`:**

| Flag | Description | Default |
|------|-------------|---------|
| `--value <v>` | Secret value (omit to read from stdin) | — |

**Example:**

```bash
$ sidjua secret set providers ANTHROPIC_API_KEY --value sk-ant-abc123...
$ sidjua secret get providers ANTHROPIC_API_KEY
$ sidjua secret list providers
$ sidjua secret info providers ANTHROPIC_API_KEY
$ sidjua secret rotate providers ANTHROPIC_API_KEY --value sk-ant-newkey...
$ sidjua secret delete providers ANTHROPIC_API_KEY
$ sidjua secret namespaces

# Read value from stdin (omit --value):
$ echo "sk-ant-abc123..." | sidjua secret set providers ANTHROPIC_API_KEY

# Division-scoped secret:
$ sidjua secret set divisions/engineering DB_PASSWORD --value s3cr3t
```

**Notes:**
- Admin access only — bypasses RBAC enforcement
- All secrets are encrypted at rest
- Use `global` namespace for workspace-wide secrets, `providers` for API keys,
  `divisions/<code>` for division-scoped secrets

**REST equivalents:** See [Secrets](#secrets) in the REST API Endpoint Reference.

---

## REST API Server

### `sidjua server <subcommand>`

Manage the HTTP REST API server.

#### `sidjua server start`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--port <port>` | Listening port | `3000` |
| `--host <host>` | Bind address | `127.0.0.1` |
| `--api-key <key>` | API key (overrides `SIDJUA_API_KEY`) | — |
| `--work-dir <path>` | Working directory (PID file location) | cwd |
| `--dev` | Include stack traces in error responses | false |

```bash
$ sidjua server start
$ sidjua server start --port 8080 --host 0.0.0.0
$ sidjua server start --dev
```

Requires `SIDJUA_API_KEY` env var or `--api-key` flag. Writes a PID file to `{work-dir}/.system/server.pid` for use by `sidjua server stop`.

#### `sidjua server stop`

Send SIGTERM to the running server process via the PID file written by `server start`.

| Flag | Description | Default |
|------|-------------|---------|
| `--work-dir <path>` | Working directory (PID file location) | cwd |

```bash
$ sidjua server stop
$ sidjua server stop --work-dir /var/lib/sidjua
```

#### `sidjua server status`

```bash
$ sidjua server status
```

---

### `sidjua api-key <subcommand>`

Manage REST API authentication keys.

#### `sidjua api-key generate`

Generate a new API key. Printed once — save it immediately.

```bash
$ sidjua api-key generate
Generated API key (save this — it will not be shown again):
  a3f8e2c1d4b5...

To use:
  export SIDJUA_API_KEY="a3f8e2c1d4b5..."
  sidjua server start
```

#### `sidjua api-key rotate`

Generate a new key while keeping the old key valid during a grace period (zero-downtime
rotation).

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--grace-seconds <sec>` | How long the old key remains valid | `60` |

```bash
$ sidjua api-key rotate --grace-seconds 120
```

---

## Module System

### `sidjua module <subcommand>`

Manage installable agent modules. Modules are pre-packaged integrations (Discord, SAP,
ERP, and others) that can be installed into a SIDJUA workspace.

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `list` | `sidjua module list [--work-dir <path>]` | List all available and installed modules |
| `status <id>` | `sidjua module status <id> [--work-dir <path>]` | Show install and configuration status |
| `install <id>` | `sidjua module install <id> [--work-dir <path>]` | Install a module into the workspace |
| `uninstall <id>` | `sidjua module uninstall <id> [--work-dir <path>]` | Uninstall a module |

**Available modules:** `discord` (Discord Bot)

**`module install` behavior:**
- Interactive by default — prompts for required secrets
- Non-interactive when STDIN is not a TTY — reads secrets from environment variables

**Example:**

```bash
$ sidjua module list
$ sidjua module status discord
$ sidjua module install discord
$ sidjua module uninstall discord
```

---

### `sidjua discord <subcommand>`

Interact with the Discord bot module. Requires the `discord` module to be installed
(via `sidjua module install discord`).

| Subcommand | Synopsis | Description |
|------------|----------|-------------|
| `status` | `sidjua discord status [--work-dir <path>]` | Check Discord bot installation and connectivity |
| `post-dev-update` | `sidjua discord post-dev-update [--issues <ids>] [--work-dir <path>]` | Post a commit-centric dev update to the configured dev-log channel |
| `announce <message>` | `sidjua discord announce <message> [--mention-role <roleId>] [--work-dir <path>]` | Post an announcement to Discord |

**`discord post-dev-update` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--issues <ids>` | Comma-separated issue numbers to include (e.g. `"42,43"`) | — |
| `--work-dir <path>` | Working directory | cwd |

**`discord announce` options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--mention-role <roleId>` | Discord role ID to mention in the announcement | — |
| `--work-dir <path>` | Working directory | cwd |

**Example:**

```bash
$ sidjua discord status
$ sidjua discord post-dev-update --issues "42,43"
$ sidjua discord announce "Deployment complete — v1.2.0 is live"
$ sidjua discord announce "Scheduled maintenance tonight" --mention-role 1234567890
```

---

## Migration

### `sidjua import <subcommand>`

Import agents from other platforms. Applies SIDJUA governance automatically during
import (pre-action pipeline, audit trail, budget enforcement, division RBAC).

#### `sidjua import openclaw`

Import an OpenClaw agent into the SIDJUA workspace.

**Synopsis:** `sidjua import openclaw [options]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--config <path>` | Path to `openclaw.json` | `~/.openclaw/openclaw.json` |
| `--skills <path>` | Path to OpenClaw skills directory | — |
| `--dry-run` | Preview import without making changes | false |
| `--no-secrets` | Skip API key migration | false |
| `--budget <amount>` | Monthly budget limit in USD | `50.00` |
| `--division <name>` | Assign agent to division | `general` |
| `--tier <n>` | Set agent tier (1–3) | `3` |
| `--name <name>` | Override agent name | — |
| `--model <spec>` | Override model (e.g. `anthropic/claude-sonnet-4-5`) | — |
| `--work-dir <path>` | Workspace directory | cwd |

**What gets imported:**
- Agent definition
- Skills (converted to `SKILL.md` format)
- API keys (migrated, masked in output)

**What gets added automatically:**
- Pre-action governance pipeline
- Audit trail
- Budget enforcement
- Division RBAC

**Example:**

```bash
$ sidjua import openclaw --dry-run
$ sidjua import openclaw --config ./openclaw.json --division engineering --tier 2
$ sidjua import openclaw --budget 100.00 --name "My Imported Agent"
$ sidjua import openclaw --no-secrets     # skip key migration
```

**Notes:**
- Credential values are masked in output (e.g. `sk-ant-...abc`)
- Migrated API keys are stored in `.system/imported-env.sh`
- Collision detection: reports if an agent with the same ID already exists
- A beta notice is printed to stderr before each import run

> **Beta:** The OpenClaw importer has not been tested against all OpenClaw configuration
> variants. If you encounter unexpected behavior, please [report it on
> GitHub](https://github.com/GoetzKohlberg/sidjua/issues).

---

## Chat

### `sidjua chat [agent]`

Start an interactive conversation with an agent. Defaults to the built-in `guide` agent
if no agent name is provided.

**Synopsis:** `sidjua chat [options] [agent]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `[agent]` | Agent ID to chat with | `guide` |
| `--work-dir <path>` | Working directory | cwd |
| `--model <id>` | Override the agent's configured LLM model | — |
| `--verbose` | Show tool calls and debug info | false |

**Example:**

```bash
$ sidjua chat guide
$ sidjua chat guide --verbose
$ sidjua chat guide --model claude-haiku-4-5-20251001
$ sidjua chat my-agent
```

**Notes:**
- The `guide` agent works immediately after `sidjua init` with no API key required
- Type `/help` at the `You:` prompt to see available chat slash commands
- Type any natural language message to interact with the agent
- See "Guide Agent Interactive Commands" section below for slash command reference

---

## Memory

### `sidjua memory <subcommand>`

Manage personal memory from Claude chat export imports. Stores conversation history
as searchable embeddings in the `default-memory` collection.

#### `sidjua memory import <file>`

Import a Claude chat export (ZIP or JSON) into the default memory collection.

**Synopsis:** `sidjua memory import [options] <file>`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `<file>` | Path to Claude chat export `.zip` or `.json` | — |
| `--work-dir <path>` | Workspace directory | cwd |

**Example:**

```bash
$ sidjua memory import ~/exports/claude-chats.zip
$ sidjua memory import ~/exports/conversations.json
```

#### `sidjua memory status`

Show the status of the default memory collection: chunk count, vector coverage,
embedding provider, and last import timestamp.

**Synopsis:** `sidjua memory status [--work-dir <path>]`

#### `sidjua memory search <query>`

Search the default memory collection using vector + BM25 hybrid ranking.

**Synopsis:** `sidjua memory search [options] <query>`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `<query>` | Natural language search query | — |
| `--top-k <n>` | Number of results to return | 10 |
| `--work-dir <path>` | Workspace directory | cwd |

**Example:**

```bash
$ sidjua memory search "architecture discussion from last week"
$ sidjua memory search "database migration approach" --top-k 5
```

#### `sidjua memory clear [collection]`

Delete all chunks and vectors for a collection. Defaults to `default-memory`.

**Synopsis:** `sidjua memory clear [--work-dir <path>] [collection]`

#### `sidjua memory re-embed [collection]`

Re-embed all chunks from the database with the current embedding provider. Useful
after switching providers or upgrading embedding dimensions.

**Synopsis:** `sidjua memory re-embed [--work-dir <path>] [collection]`

#### `sidjua memory verify [collection]`

Health-check: verify every chunk has a corresponding vector, dimensions are consistent,
and there are no duplicates.

**Synopsis:** `sidjua memory verify [--work-dir <path>] [collection]`

#### `sidjua memory recover [collection]`

Re-embed any chunks that have pending WAL entries but no stored vector. Used to
recover from interrupted imports or embedding failures.

**Synopsis:** `sidjua memory recover [--work-dir <path>] [collection]`

**Example:**

```bash
$ sidjua memory import ~/exports/claude-chats.zip
$ sidjua memory status
$ sidjua memory search "API design patterns"
$ sidjua memory recover               # fix any incomplete embeddings
$ sidjua memory verify                # confirm everything is consistent
```

---

## Configuration

### `sidjua config <subcommand>`

Manage SIDJUA system configuration settings.

#### `sidjua config embedding <provider>`

Activate semantic search with the specified embedding provider. Runs a bulk
re-embedding of all existing data before enabling real-time embedding.

**Synopsis:** `sidjua config embedding [options] <provider>`

**Providers:**

| Provider | Description |
|----------|-------------|
| `cloudflare-bge` | Cloudflare Workers AI (`@cf/baai/bge-base-en-v1.5`), 768 dimensions, free |
| `ollama-nomic` | Local Ollama (`nomic-embed-text`), 768 dimensions, offline |
| `google-embedding` | Google Generative AI embeddings, 768 dimensions |
| `openai-large` | OpenAI `text-embedding-3-large`, 3072 dimensions, best quality |

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `<provider>` | Provider ID (see table above) | — |
| `--batch-size <n>` | Rows per embedding batch | 50 |
| `--base-url <url>` | Ollama base URL (only for `ollama-nomic`) | `http://localhost:11434` |
| `--dry-run` | Count pending rows without embedding | false |
| `--work-dir <path>` | Workspace directory | cwd |

**Example:**

```bash
$ sidjua config embedding openai-large
$ sidjua config embedding cloudflare-bge
$ sidjua config embedding ollama-nomic --base-url http://localhost:11434
$ sidjua config embedding openai-large --dry-run   # preview count
```

**Notes:**
- Changing providers requires re-embedding all data (dimensions differ between providers)
- Use `--dry-run` first to see how many chunks will be processed
- Embeddings are stored in SQLite as Float32 BLOBs

---

## Summary

### `sidjua summary <subcommand>`

Inspect governed task summaries generated by the orchestrator.

#### `sidjua summary show <task-id>`

Show the latest management summary for a completed task.

**Synopsis:** `sidjua summary show [options] <task-id>`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `<task-id>` | Task UUID | — |
| `--work-dir <path>` | Workspace directory | cwd |

**Example:**

```bash
$ sidjua summary show a1b2c3d4-...
```

**Notes:**
- Summaries are generated automatically on task completion
- Use `sidjua output list <task-id>` for full output files; use `sidjua summary show` for the high-level synthesis

---

## Guide Agent Interactive Commands

When running `sidjua chat guide`, the following slash commands are available at the
`You:` prompt.

```bash
sidjua chat guide
sidjua chat guide --verbose       # show tool calls
sidjua chat guide --model <id>    # override default model
```

### `/help`

Print the command reference.

```
You: /help
```

### `/key <provider> <api-key>`

Save an API key for a provider. The key is written to `.system/providers/<provider>.yaml`
and activates that provider for subsequent agent creation.

```
You: /key groq gsk_abc123def456ghi789
You: /key anthropic sk-ant-abc123...
```

**Supported providers:** `groq`, `google`, `anthropic`, `openai`, `deepseek`, `grok`,
`mistral`, `cohere`

**Validation:** Keys must be at least 8 characters. Keys shorter than 8 characters are
rejected with an error message.

### `/providers`

Show the provider recommendation menu. Lists all available providers with setup
instructions and directs you to use `/key` to activate a provider.

```
You: /providers
```

The output includes all supported providers (cloud and local), their model offerings,
pricing tier, and the specific `/key` command to run for each one.

### `/status`

Show a checklist of workspace configuration files (present / missing).

```
You: /status

  Workspace status:
    ✓ divisions.yaml
    ✗ agents/agents.yaml
    ✓ governance/CHARTER.md
    ...
```

### `/agents`

List agents currently configured in `agents/agents.yaml`, with definition details
(tier, division, provider) when the definition file exists.

```
You: /agents
```

### `/costs` (also `/cost`)

Show a cost summary from the `cost_ledger` database table.

```
You: /costs
```

### `/exit` (also `/quit`, `/bye`)

End the chat session cleanly.

```
You: /exit
Goodbye!
```

**Notes:**
- The Guide operates in offline mode (canned responses) when no Cloudflare credentials
  are embedded. All slash commands work regardless of online/offline status.
- Type any natural language message to chat with the Guide about SIDJUA configuration,
  agent creation, or governance concepts.
- The Guide can create agents through conversation: describe the agent you need and it
  will generate the YAML definition and skill file automatically.

---

## Configuration Files Reference

### `divisions.yaml`

Primary configuration file. Defines your organization, divisions, and governance scope.
Read by `sidjua apply` to provision all subsystems.

```yaml
schema_version: "1.0"

company:
  name: "My Organization"
  size: "solo"              # solo | small | medium | large | enterprise

divisions:
  - code: engineering       # machine identifier used in CLI commands
    name:
      en: Engineering       # display name (localized)
    required: true          # always provisioned regardless of size preset
    active: true            # participates in task routing
    head:
      role: Lead Engineer
      agent: eng-lead       # agent ID once created; null before
    scope: "Software development and infrastructure"
    budget:
      monthly_usd: 100.00
      daily_usd:   10.00
```

**Key fields:**

| Field | Description |
|-------|-------------|
| `schema_version` | Always `"1.0"` |
| `company.size` | Preset: `solo`\|`small`\|`medium`\|`large`\|`enterprise` |
| `divisions[].code` | Short identifier — used in all CLI commands and routing |
| `divisions[].required` | If `true`, provisioned even if size preset omits it |
| `divisions[].active` | If `false`, excluded from routing (disabled division) |
| `divisions[].head.agent` | Set to agent ID after creating the division head |
| `divisions[].budget` | Optional per-division spending limits |
| `divisions[].budget.monthly_usd` | Monthly spending limit in USD for the division |
| `divisions[].budget.daily_usd` | Daily spending limit in USD for the division |

**Budget configuration:** Per-division spending limits are set directly in `divisions.yaml`
under `divisions[].budget.monthly_usd` and `divisions[].budget.daily_usd`. There is no
separate spending-limits file — all budget configuration lives in `divisions.yaml`.

Re-run `sidjua apply` after every edit.

---

### `agents/definitions/<id>.yaml`

Per-agent definition. Generated by `sidjua agent create`; edit manually to adjust
advanced settings.

```yaml
id: my-developer
name: My Developer
tier: 3                         # 1 (strategic) | 2 (management) | 3 (worker)
division: engineering
provider: anthropic
model: claude-haiku-4-5-20251001
fallback_provider: groq
fallback_model: llama-3.3-70b-versatile
capabilities:
  - code.write
  - code.test
budget:
  per_task_usd: 0.50
  per_month_usd: 20.00
skill: agents/skills/my-developer.md
schedule: on-demand
max_concurrent_tasks: 5
checkpoint_interval_seconds: 60
```

---

### `agents/skills/<id>.md`

Agent skill file — loaded into the system prompt before every task. Plain Markdown,
no frontmatter.

```markdown
# My Developer — Skill Definition

## Identity
You are a software developer working for {organization}.
Your supervisor is {reports_to}.

## Decision Authority
- You MAY: write code, run tests, read project files
- You MAY NOT: push to main branch, delete production data
- ESCALATE: architecture changes, security vulnerabilities

## Work Style
- Read existing code before making changes
- Write tests alongside implementation
- Ask for clarification when requirements are ambiguous

## Output Standards
1. Write result to the designated output file
2. Include a management summary: scope, approach, outcome
3. Flag risks or blockers discovered during execution
```

Template variables substituted at load time: `{agent_name}`, `{organization}`, `{reports_to}`

---

### `governance/boundaries/defaults.yaml`

Default action boundaries generated by `sidjua init`. Edit to tighten or loosen
restrictions. Used by the Forbidden (Stage 1) and Approval (Stage 2) pipeline stages.

---

### `governance/CHARTER.md`

Human-readable governance charter. Not machine-parsed — maintained for organizational
alignment and audit purposes.

---

### `.system/providers/<provider>.yaml`

Provider credential configuration. Written by `sidjua init` (templates) and updated by
the Guide's `/key` command.

Example (`groq.yaml`):
```yaml
provider: groq
enabled: true
api_key: gsk_abc123...
requires_key: true
```

The `cloudflare.yaml` template has `enabled: true` and `embedded: true` — no key
required for the embedded Guide agent tier.

---

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `SIDJUA_API_KEY` | REST API server | Bearer token for all non-public API endpoints |
| `SIDJUA_CF_ACCOUNT_ID` | Guide agent | Override embedded Cloudflare account ID |
| `SIDJUA_CF_TOKEN` | Guide agent | Override embedded Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare provider adapter | Account ID for direct provider use |
| `CLOUDFLARE_AI_API_KEY` | Cloudflare provider adapter | API key for direct provider use |
| `ANTHROPIC_API_KEY` | Key manager | Anthropic API key (via `env:ANTHROPIC_API_KEY` key ref) |
| `OPENAI_API_KEY` | Key manager | OpenAI API key (via `env:OPENAI_API_KEY` key ref) |
| `NOTIFY_SOCKET` | Systemd watchdog | Set automatically by systemd; enables watchdog heartbeat |
| `BUILD_DATE` | Docker image | Container build timestamp (read-only) |
| `VCS_REF` | Docker image | Git commit at build time (read-only) |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error — message written to stderr |

All errors are written to `stderr`. Success output is written to `stdout`. When `--json`
is specified and an error occurs, the JSON error object is written to `stdout` (so it can
be parsed by scripts regardless of exit code).

---

## REST API Endpoint Reference

The REST API is available at `http://localhost:3000` (default). All endpoints except
`/health` and `/info` require `Authorization: Bearer <SIDJUA_API_KEY>`.

SSE streaming (`GET /api/v1/events`) uses query-parameter authentication
(`?token=<key>`) because the EventSource browser API does not support custom headers.

### System

| Method | Path | CLI equivalent | Description |
|--------|------|----------------|-------------|
| GET | `/health` | `sidjua health` | Public health check |
| GET | `/info` | — | Build metadata (version, git ref) |

### Tasks

| Method | Path | CLI equivalent | Description |
|--------|------|----------------|-------------|
| GET | `/api/v1/tasks` | `sidjua tasks` | List tasks |
| POST | `/api/v1/tasks` | — | Create task (raw) |
| POST | `/api/v1/tasks/run` | `sidjua run` | Submit task via ExecutionBridge |
| GET | `/api/v1/tasks/:id` | `sidjua tasks <id>` | Get task |
| DELETE | `/api/v1/tasks/:id` | `sidjua task stop <id>` | Cancel task |
| POST | `/api/v1/tasks/:id/cancel` | `sidjua task cancel <id>` | Cancel + sub-tasks |
| GET | `/api/v1/tasks/:id/status` | `sidjua task watch <id>` | Task status |
| GET | `/api/v1/tasks/:id/result` | `sidjua task result <id>` | Full result |
| GET | `/api/v1/tasks/:id/tree` | `sidjua task tree <id>` | Delegation tree |
| GET | `/api/v1/tasks/:id/summary` | `sidjua output summary show <id>` | Management summary |

### Agents

| Method | Path | CLI equivalent | Description |
|--------|------|----------------|-------------|
| GET | `/api/v1/agents` | `sidjua agents` | List agents |
| GET | `/api/v1/agents/:id` | `sidjua agents <id>` | Agent details |
| POST | `/api/v1/agents/:id/start` | `sidjua agent start <id>` | Start agent |
| POST | `/api/v1/agents/:id/stop` | `sidjua agent stop <id>` | Stop agent |

### Divisions

| Method | Path | CLI equivalent | Description |
|--------|------|----------------|-------------|
| GET | `/api/v1/divisions` | `sidjua status` | List divisions |
| GET | `/api/v1/divisions/:name` | — | Division details |

### Costs & Audit

| Method | Path | CLI equivalent | Description |
|--------|------|----------------|-------------|
| GET | `/api/v1/costs` | `sidjua costs` | Cost summary |
| GET | `/api/v1/audit` | `sidjua logs` | Audit trail |
| GET | `/api/v1/audit/tasks/:id` | `sidjua logs --task <id>` | Task audit entries |

### Outputs

| Method | Path | CLI equivalent | Description |
|--------|------|----------------|-------------|
| GET | `/api/v1/outputs/search` | `sidjua output search` | Full-text search |
| GET | `/api/v1/outputs/stats` | `sidjua output stats` | Storage stats |
| GET | `/api/v1/outputs/:id` | `sidjua output show <id>` | Output content |
| GET | `/api/v1/tasks/:taskId/outputs` | `sidjua output list <id>` | Task outputs |
| POST | `/api/v1/tasks/:taskId/outputs` | — | Store output |

### Governance

| Method | Path | CLI equivalent | Description |
|--------|------|----------------|-------------|
| GET | `/api/v1/governance/status` | `sidjua governance history` | Snapshot list |
| GET | `/api/v1/governance/history` | `sidjua governance history` | Full history |
| POST | `/api/v1/governance/rollback/:version` | `sidjua governance rollback` | Rollback |
| GET | `/api/v1/governance/diff/:version` | `sidjua governance diff` | Config diff |

### Secrets

| Method | Path | CLI equivalent | Description |
|--------|------|----------------|-------------|
| GET | `/api/v1/secrets/namespaces` | `sidjua secret namespaces` | List namespaces |
| GET | `/api/v1/secrets/keys?namespace=<n>` | `sidjua secret list <namespace>` | List keys |
| GET | `/api/v1/secrets/value?namespace=<n>&key=<k>` | `sidjua secret get <namespace> <key>` | Read value |
| PUT | `/api/v1/secrets/value` | `sidjua secret set <namespace> <key>` | Write value |
| DELETE | `/api/v1/secrets/value?namespace=<n>&key=<k>` | `sidjua secret delete <namespace> <key>` | Delete |
| GET | `/api/v1/secrets/info?namespace=<n>&key=<k>` | `sidjua secret info <namespace> <key>` | Metadata |
| POST | `/api/v1/secrets/rotate` | `sidjua secret rotate <namespace> <key>` | Rotate value |

### Orchestrator & Logging

| Method | Path | CLI equivalent | Description |
|--------|------|----------------|-------------|
| GET | `/api/v1/orchestrator/status` | `sidjua health` | Orchestrator state |
| POST | `/api/v1/orchestrator/pause` | `sidjua pause` | Pause task acceptance |
| POST | `/api/v1/orchestrator/resume` | `sidjua resume` | Resume task acceptance |
| GET | `/api/v1/logging/status` | `sidjua logging status` | Log levels |
| PUT | `/api/v1/logging/:component` | `sidjua logging set` | Set log level |

### Events (SSE)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/events?token=<key>` | Server-Sent Events stream |

Optional query filters: `?division=<code>&agent=<id>&task=<id>&lastEventId=<n>`

`lastEventId` enables replay — reconnecting clients receive missed events from the last
5 minutes.

---

## Update & Lifecycle Management Commands

---

### `sidjua version`

**Synopsis:** `sidjua version [--json]`

Show comprehensive version information including SIDJUA product version, governance ruleset version, schema version, Node.js version, and resolved directory paths.

**Options:**
| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

**Example:**
```
$ sidjua version

SIDJUA v0.11.0
Governance Ruleset: 1.0 (10 rules)
Schema Version: 4
Node.js: v22.22.0
Data Directory: /home/user/.sidjua
System Directory: /usr/lib/node_modules/sidjua/system
```

---

### `sidjua update`

**Synopsis:** `sidjua update [options]`

Check for and install SIDJUA updates. The full update flow: lock → check → changelog → confirm → backup → download → verify → install → migrate → selftest → unlock → report.

If a migration fails, the previous version is automatically restored.

**Options:**
| Flag | Description |
|------|-------------|
| `--check` | Only check for updates, don't install |
| `--governance` | Update governance ruleset only (no schema migration) |
| `--yes` | Auto-confirm without interactive prompt |
| `--force-unlock` | Release a stale lock before starting |

**Examples:**
```bash
sidjua update --check           # Check without installing
sidjua update                   # Interactive update
sidjua update --yes             # Non-interactive update
sidjua update --governance      # Update governance rules only
```

---

### `sidjua rollback`

**Synopsis:** `sidjua rollback [options]`

Restore a previous SIDJUA version from the version archive. Audit logs are never modified. User data is never touched.

**Options:**
| Flag | Description |
|------|-------------|
| `--to <version>` | Target version to restore (e.g., `0.10.0`) |
| `--list` | List available versions for rollback |
| `--yes` | Auto-confirm |
| `--force-unlock` | Release stale lock before starting |

**Examples:**
```bash
sidjua rollback --list          # List available versions
sidjua rollback --to 0.10.0    # Rollback to a specific version
sidjua rollback                 # Interactive (shows picker)
```

---

### `sidjua changelog [version]`

**Synopsis:** `sidjua changelog [version]`

Show the changelog for a specific SIDJUA version. Omit version to show the latest available.

**Examples:**
```bash
sidjua changelog             # Latest version changelog
sidjua changelog 0.10.1     # Specific version changelog
```

---

### `sidjua backup create`

**Synopsis:** `sidjua backup create [--label <text>] [--output <path>] [--work-dir <path>]`

Create a full workspace backup. Backs up configuration, agents, and database state.

**Examples:**
```bash
sidjua backup create                          # Default backup
sidjua backup create --label "before-update"  # Named backup
```

---

### `sidjua backup list`

**Synopsis:** `sidjua backup list [--work-dir <path>]`

List all available backups with creation dates, sizes, and labels.

---

### `sidjua backup restore <id>`

**Synopsis:** `sidjua backup restore <backup-id> [--force] [--dry-run]`

Restore a backup by ID. Use `sidjua backup list` to find backup IDs.

---

### `sidjua migrate-embeddings`

**Synopsis:** `sidjua migrate-embeddings [options]`

Re-embed all knowledge chunks with a new embedding model. Required when the embedding model, dimensions, or provider changes.

**Important:** All agents must be stopped before running this command. The system creates a backup of current vectors automatically.

**Options:**
| Flag | Description |
|------|-------------|
| `--dry-run` | Show estimate only — no changes made |
| `--resume` | Resume an interrupted migration |
| `--rollback` | Restore pre-migration vector state |
| `--model <name>` | Override target embedding model |
| `--batch-size <n>` | Documents per API call (default: 20) |
| `--rate-limit <n>` | Max API requests per second (default: 1) |
| `--yes` | Auto-confirm |

**Examples:**
```bash
sidjua migrate-embeddings --dry-run           # See estimate first
sidjua migrate-embeddings                     # Interactive migration
sidjua migrate-embeddings --resume            # Resume if interrupted
sidjua migrate-embeddings --rollback          # Restore previous vectors
sidjua migrate-embeddings --model text-embedding-3-large --batch-size 50
```

**Example output:**
```
Scanning knowledge base...

  Total documents: 2,117
  Target model: text-embedding-3-large
  Collections: default, engineering-kb

Estimation:
  Batches: 106 (20 docs/batch)
  Estimated time: ~8 minutes
  Estimated cost: ~$0.14

Proceed with embedding migration? [y/N]
```

---

### `sidjua selftest`

**Synopsis:** `sidjua selftest [options]`

**Alias:** `sidjua doctor`

Run a comprehensive battery of system integrity checks across 7 categories: workspace, provider, agent, governance, resource, docker, and dependency. Reports a health score (0–100) and, with `--fix`, auto-repairs fixable issues such as missing directory structure.

**Options:**
| Flag | Description |
|------|-------------|
| `--json` | Output full report as JSON |
| `--fix` | Attempt to auto-repair fixable failures before re-checking |
| `--verbose` | Include additional details in each check result |
| `--category <cats>` | Comma-separated list of categories to run (workspace, provider, agent, governance, resource, docker, dependency) |
| `--work-dir <path>` | Path to SIDJUA workspace (default: current directory) |

**Exit codes:**
| Code | Meaning |
|------|---------|
| `0` | Health score ≥ 80 (healthy) |
| `1` | Health score < 80 (degraded) |
| `2` | Could not run checks (error) |

**Check categories:**

| Category | Checks |
|----------|--------|
| `workspace` | WorkDirExists, ConfigFileValid, DatabasesAccessible, DirectoryStructure |
| `provider` | ProviderApiKeyValid, ProviderConnectivity |
| `agent` | AgentDatabaseIntegrity, AgentConfigValid |
| `governance` | GovernanceRulesLoadable, PolicyEnforcementFunctional, DivisionConfigConsistent |
| `resource` | NodeVersion, DiskSpace, PortAvailability |
| `docker` | DockerAvailable, ContainerHealthy |
| `dependency` | NodeModulesPresent, CriticalDepsVersions |

**Example — full check:**
```
$ sidjua selftest

SIDJUA System Selftest  (health score: 92/100)

  workspace
    ✓  Work directory exists and is writable
    ✓  Config file valid
    ✓  Databases accessible
    ✓  Directory structure

  resource
    ✓  Node.js version
    ⚠  Disk space  (412 MB free — below 500 MB threshold)
    ✓  Port availability

  dependency
    ✓  node_modules present
    ✓  Critical dependency versions

Health score: 92/100  (8 passed, 1 warned, 0 failed, 5 skipped)
Recommendations: (none)
```

**Example — auto-fix missing directories:**
```
$ sidjua selftest --fix --category workspace

  workspace
    ✗  Directory structure  (missing: agents, divisions)
       → Applying fix...
    ✓  Directory structure  (fixed)

Health score: 100/100
```

**Example — JSON output:**
```
$ sidjua selftest --json
{
  "healthScore": 92,
  "checks": [...],
  "summary": { "total": 14, "passed": 8, "warned": 1, "failed": 0, "skipped": 5 },
  "recommendations": [],
  "version": "0.9.7",
  "timestamp": "2026-03-14T07:00:00.000Z"
}
```

**REST API cross-reference:** `GET /api/v1/selftest`, `POST /api/v1/selftest/fix`

---

### `sidjua rules`

**Synopsis:** `sidjua rules [options]`

List active governance rules (system baseline + user extensions).

**Options:**
| Flag | Description |
|------|-------------|
| `--system` | List only system (mandatory) rules |
| `--user` | List only user-defined rules |
| `--version` | Show governance ruleset version info |
| `--validate` | Check for conflicts between system and user rules |
| `--json` | Output as JSON |

**Example:**
```
$ sidjua rules

SIDJUA Governance Rules (Ruleset 1.0)

=== System Rules (mandatory, 10 rules) ===
  [CRIT] SYS-SEC-001      Agent credential isolation
  [CRIT] SYS-SEC-002      No plaintext secrets in config
  ...
```


---

## Audit & Compliance Commands

> `sidjua audit` provides the **analyzed compliance perspective** on top of raw event data.
> For the raw event stream, see `sidjua logs`.

---

### `sidjua audit report`

Generate a compliance report showing rules enforced and a compliance score.

```
sidjua audit report [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--division <name>` | Filter by division |
| `--agent <id>` | Filter by agent ID |
| `--since <date>` | Start of period (ISO date, default: 30 days ago) |
| `--until <date>` | End of period (ISO date, default: now) |
| `--policy-type <type>` | Filter by event/policy type |
| `--json` | Machine-readable JSON output |
| `--work-dir <path>` | Workspace directory (default: cwd) |

**Examples:**
```bash
# Last 30 days, all divisions
sidjua audit report

# Engineering division, JSON output
sidjua audit report --division engineering --json

# Specific date range
sidjua audit report --since 2026-01-01 --until 2026-01-31
```

**REST equivalent:** `GET /api/v1/audit/report?division=engineering&since=2026-01-01`

---

### `sidjua audit violations`

List policy violations (blocked and escalated events).

```
sidjua audit violations [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--division <name>` | Filter by division |
| `--agent <id>` | Filter by agent ID |
| `--since <date>` | Start of period (ISO date) |
| `--until <date>` | End of period (ISO date) |
| `--severity <level>` | Filter by severity: `low` \| `medium` \| `high` \| `critical` |
| `--json` | Machine-readable JSON output |
| `--work-dir <path>` | Workspace directory |

**Examples:**
```bash
# All violations last 30 days
sidjua audit violations

# High and critical only
sidjua audit violations --severity high
sidjua audit violations --severity critical

# Specific agent, JSON
sidjua audit violations --agent agent-001 --json
```

**REST equivalent:** `GET /api/v1/audit/violations?severity=high` (supports `limit`, `offset` pagination; returns `X-Total-Count` header)

---

### `sidjua audit agents`

Show per-agent trust scores and compliance metrics.

```
sidjua audit agents [options]
```

Trust score formula: `trustScore = (successfulTasks / totalTasks) × 100 − (violations × 5)`, clamped to 0–100.

**Options:**
| Flag | Description |
|------|-------------|
| `--division <name>` | Filter by division |
| `--agent <id>` | Filter by specific agent |
| `--since <date>` | Start of period |
| `--until <date>` | End of period |
| `--json` | Machine-readable JSON output |
| `--work-dir <path>` | Workspace directory |

**Examples:**
```bash
sidjua audit agents
sidjua audit agents --division engineering --json
```

**REST equivalent:** `GET /api/v1/audit/agents` (returns `X-Total-Count` header)

---

### `sidjua audit summary`

Show a compact compliance summary (totals, compliance rate, top violations, division breakdown).

```
sidjua audit summary [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--since <date>` | Start of period (default: 30 days ago) |
| `--until <date>` | End of period |
| `--json` | Machine-readable JSON output |
| `--work-dir <path>` | Workspace directory |

**Examples:**
```bash
sidjua audit summary
sidjua audit summary --since 2026-01-01 --json
```

**REST equivalent:** `GET /api/v1/audit/summary`

---

### `sidjua audit export`

Export comprehensive audit data to file.

```
sidjua audit export --format <csv|json> [options]
```

> Note: PDF export is deferred to a future version. Use `--format json` and pipe through a report generator.

**Options:**
| Flag | Description |
|------|-------------|
| `--format <fmt>` | **Required.** `csv` or `json` |
| `--output <path>` | Output file path (default: `sidjua-audit-YYYY-MM-DD.{ext}`) |
| `--division <name>` | Filter by division |
| `--agent <id>` | Filter by agent ID |
| `--since <date>` | Start of period |
| `--until <date>` | End of period |
| `--work-dir <path>` | Workspace directory |

**Examples:**
```bash
# JSON export (violations + agents + report + summary)
sidjua audit export --format json

# CSV export (violations and agent trust scores)
sidjua audit export --format csv --output /tmp/audit-q1.csv

# Last quarter, engineering only
sidjua audit export --format json \
  --division engineering \
  --since 2026-01-01 --until 2026-03-31 \
  --output /tmp/q1-engineering-audit.json
```

**REST equivalent:** `GET /api/v1/audit/export?format=json` (returns file download with appropriate `Content-Type` and `Content-Disposition` headers)

---

### REST API Summary

All audit endpoints are under `/api/v1/audit/`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/audit/report` | Compliance report |
| `GET` | `/api/v1/audit/violations` | Violation list (paginated) |
| `GET` | `/api/v1/audit/agents` | Agent trust scores |
| `GET` | `/api/v1/audit/summary` | Compact summary |
| `GET` | `/api/v1/audit/export` | File download (CSV or JSON) |

Common query parameters: `division`, `agent`, `since`, `until`, `severity`, `policyType`, `limit` (1–1000), `offset`.

Paginated endpoints return an `X-Total-Count` response header.

---

## Error Telemetry Commands

Commands for managing error telemetry reporting. Error telemetry helps improve SIDJUA by
reporting anonymized crash and error data. All data is PII-redacted before sending.

### `sidjua telemetry status`

Show the current telemetry mode, installation ID, endpoint configuration, and local buffer statistics.

**Synopsis:** `sidjua telemetry status [--work-dir <path>] [--json]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--work-dir <path>` | Working directory | cwd |
| `--json` | Machine-readable JSON output | false |

**Example output:**
```
Telemetry status
  Mode:              auto
  Installation ID:   550e8400-e29b-41d4-a716-446655440000
  Primary endpoint:  https://errors.sidjua.com/v1/report
  Fallback endpoint: https://errors-direct.sidjua.com/v1/report
  Buffer:
    Pending: 0
    Sent:    42
    Total:   42
```

---

### `sidjua telemetry enable`

Enable automatic error reporting (sets mode to `auto`). Events will be sent to the configured
endpoints silently without prompting.

**Synopsis:** `sidjua telemetry enable [--work-dir <path>]`

---

### `sidjua telemetry disable`

Disable error reporting (sets mode to `off`). Existing pending events remain in the local buffer
but are not sent. Use `sidjua telemetry flush` to drain them first if desired.

**Synopsis:** `sidjua telemetry disable [--work-dir <path>]`

---

### `sidjua telemetry flush`

Manually drain all pending buffered events to the server. Useful when the server was temporarily
unavailable and events accumulated locally.

**Synopsis:** `sidjua telemetry flush [--work-dir <path>] [--json]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--work-dir <path>` | Working directory | cwd |
| `--json` | Machine-readable JSON output | false |

**Example output:**
```
Sending 5 pending event(s)...
5 sent, 0 failed.
```

Exit code 1 if any events failed to send.

---

### `sidjua telemetry reset`

Clear the local event buffer and regenerate the installation ID. This is a destructive operation
that cannot be undone. Requires `--confirm` flag.

**Synopsis:** `sidjua telemetry reset --confirm [--work-dir <path>]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--confirm` | Required: confirm destructive reset | false |
| `--work-dir <path>` | Working directory | cwd |

```bash
sidjua telemetry reset --confirm
```


---

## `sidjua integration` — Integration Gateway

Manage external service integrations via the Integration Gateway (#503).

---

### `sidjua integration list`

List all registered (YAML-defined) adapters and discovered integrations.

**Synopsis:** `sidjua integration list [--work-dir <path>] [--json]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--work-dir <path>` | Working directory | cwd |
| `--json` | Machine-readable JSON output | false |

**Example output:**
```
Registered Integrations:

NAME         PROTOCOL  TYPE           ACTIONS  ENABLED
github       rest      deterministic  8        yes
slack        webhook   deterministic  4        yes
n8n          rest      deterministic  12       yes

Discovered Integrations (not yet promoted):

NAME          USAGE  SUCCESS RATE  QUALITY
my-crm-api    15     0.93          discovered
```

---

### `sidjua integration info <service>`

Show full details for a registered integration adapter.

**Synopsis:** `sidjua integration info <service> [--work-dir <path>] [--json]`

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<service>` | Adapter name (e.g., `github`, `slack`) |

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--work-dir <path>` | Working directory | cwd |
| `--json` | Machine-readable JSON output | false |

**Example output:**
```
Integration: github
  Protocol : rest
  Base URL : https://api.github.com
  Auth     : api_key  (ref: GITHUB_TOKEN)
  Enabled  : yes

Actions:
  list_repos      GET  /repos   risk=low    approval=no   rate=30/minute
  create_issue    POST /issues  risk=medium approval=no   rate=10/minute
```

---

### `sidjua integration add`

Add a new integration from an OpenAPI specification URL or inline content.

**Synopsis:** `sidjua integration add --service <name> --spec-url <url> [--work-dir <path>]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--service <name>` | Service name (required) | — |
| `--spec-url <url>` | URL of the OpenAPI spec | — |
| `--spec-content <json>` | Inline OpenAPI spec JSON | — |
| `--work-dir <path>` | Working directory | cwd |

**Example:**
```bash
sidjua integration add --service my-api --spec-url https://api.example.com/openapi.json
# Integration 'my-api' added (discovered). Use 'integration promote my-api' to generate an adapter.
```

---

### `sidjua integration test <service>`

Test connectivity to a registered integration by executing its first low-risk action.

**Synopsis:** `sidjua integration test <service> [--work-dir <path>] [--json]`

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<service>` | Adapter name to test |

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--work-dir <path>` | Working directory | cwd |
| `--json` | Machine-readable JSON output | false |

**Example output:**
```
Testing integration: github
  Action  : list_repos
  Status  : 200 OK
  Elapsed : 142ms
  Result  : SUCCESS
```

Exit code 1 if the connectivity test fails.

---

### `sidjua integration audit`

Query the integration gateway audit log.

**Synopsis:** `sidjua integration audit [--service <name>] [--last <period>] [--limit <n>] [--work-dir <path>] [--json]`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--service <name>` | Filter by service name | all |
| `--last <period>` | Time window: `1h`, `24h`, `7d`, `30d` | `24h` |
| `--limit <n>` | Maximum rows (max 500) | 100 |
| `--work-dir <path>` | Working directory | cwd |
| `--json` | Machine-readable JSON output | false |

**Example output:**
```
Integration Audit Log (last 24h):

TIME                 SERVICE   ACTION      RISK    STATUS  MS
2026-03-15T08:00:00  github    list_repos  low     200     142
2026-03-15T07:55:00  slack     post_msg    low     200     88
```

---

### `sidjua integration promote <service>`

Check whether a discovered integration is eligible for promotion to a full adapter YAML.

**Synopsis:** `sidjua integration promote <service> [--review] [--work-dir <path>] [--json]`

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<service>` | Discovered service name |

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--review` | Print the generated adapter YAML for review | false |
| `--work-dir <path>` | Working directory | cwd |
| `--json` | Machine-readable JSON output | false |

**Example output:**
```
Service  : my-crm-api
Eligible : ELIGIBLE (15 calls, 93% success rate)

Generated adapter YAML:
---
name: my-crm-api
type: deterministic
protocol: rest
...
```

Place the generated YAML in `governance/integrations/my-crm-api.yaml` and run `sidjua apply` to activate.
