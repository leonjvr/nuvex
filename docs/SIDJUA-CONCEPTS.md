# SIDJUA Concepts Guide

A plain-language introduction to how SIDJUA works. Each chapter builds on the previous one. You do not need to be a developer to understand this guide.

---

## 1. What is SIDJUA?

Imagine you use ChatGPT or Claude today. You talk to ONE AI. You ask it a question, it answers. If you need something different — research, writing, coding, checking — you ask the same one AI to do all of it. It tries its best, but it is one generalist doing everything.

SIDJUA is different. With SIDJUA, you do not talk to one AI. You build a **team** of AIs. Each one has a specific job, specific skills, and specific rules it must follow. Think of it like building a small company:

- You have a researcher who finds information
- You have a writer who creates documents
- You have a quality checker who reviews work
- You have a manager who coordinates the team

Each of these is a separate AI agent with its own specialization. When you give SIDJUA a task, the system figures out which agents need to work on it, coordinates them, and delivers the result. The agents can use different AI models — a cheaper fast one for simple tasks, a smarter expensive one for complex decisions.

But here is the most important part — the part that makes SIDJUA truly different from every other tool: **governance**.

In a real company, employees follow rules. They cannot spend money without approval. They cannot access confidential documents without clearance. They cannot make decisions above their authority.

SIDJUA enforces the same rules on AI agents — automatically. Before any agent does anything, the system checks: Is this allowed? Is there enough budget? Does someone need to approve this? If the answer is no, the agent is **blocked**. Not warned, not logged — blocked. The action simply does not happen.

No other platform does this. Other tools let you run multiple AIs, but they just hope the AIs behave. SIDJUA makes it architecturally impossible for an agent to break the rules you set.

**To summarize:** ChatGPT/Claude = one AI you chat with. SIDJUA = a governed team of specialized AIs that work together on your tasks, with rules that are enforced before every action.

You are talking to the Guide right now — one agent in your SIDJUA system. When you are ready, the Guide will help you create your own agents and build your team.

---

### Technical Summary (for advanced users)

SIDJUA stands for **Structured Intelligence for Distributed Joint Unified Automation**. It is an open-source platform — licensed under AGPL-3.0 — for running AI agents inside your own infrastructure in a governed, auditable, and cost-controlled way.

SIDJUA is not a chatbot and not a standalone AI service. It is infrastructure — the same way a database or a message broker is infrastructure — that you run on your own server, laptop, or container. Your data never has to leave your network. The AI models can be local (Ollama, LM Studio) or cloud (Anthropic, OpenAI, Google), but SIDJUA itself runs where you put it.

SIDJUA ships with a REST API, a CLI (`sidjua`), and a web of subsystems that work together. The single entry point for configuration is one YAML file — `divisions.yaml` — which describes your organization and governance rules. From that file, `sidjua apply` provisions everything else automatically.

---

## 2. Agents — Your AI Team Members

An **agent** in SIDJUA is a named, configured AI process that can receive tasks, reason about them, and take actions. Each agent has:

- **An identity** — a unique ID, a name, and a description of its role
- **An LLM provider and model** — for example, Anthropic's Claude Haiku 4.5 or Google's Gemini 2.0 Flash
- **A skill file** — a Markdown document that tells the agent who it is, what it is allowed to do, and what constitutes a quality result
- **A tier** — where it sits in the chain of command (T1, T2, or T3)
- **A division** — which part of your organization it belongs to
- **A budget** — hard limits on per-task cost, hourly burn rate, and monthly spend

Agents are defined in YAML files stored in `agents/definitions/`. When you run `sidjua agent create`, the system generates this file for you and stores the definition in the database. You can then start, stop, and reconfigure agents without restarting the whole system.

An agent's lifecycle has six states: `stopped`, `starting`, `active`, `idle`, `stopping`, and `error`. The orchestrator monitors all active agents and restarts any that crash, using an exponential backoff strategy.

Agents do not run independently and uncontrollably. Every action they attempt must pass through the governance pipeline first. If an action is blocked, the agent receives a clear message explaining why and must find a different approach.

---

## 3. Divisions — Organizing Your Team

A **division** is a logical organizational unit — analogous to a department in a company. Every agent, task, and cost record belongs to a division.

Divisions are defined in `divisions.yaml`, your single source of configuration truth. Each division has:

- A short machine-readable **code** (e.g. `engineering`, `marketing`, `legal`)
- A **name** in one or more languages
- A **scope** description of what work belongs there
- Flags for whether it is `required` (always provisioned) and `active` (participates in routing)
- A **head** — the senior agent responsible for that division's work

When you run `sidjua apply`, the system reads `divisions.yaml` and creates directory structures, database tables, RBAC roles, routing entries, skill directories, audit views, and cost-tracking entries for each division — all automatically.

Divisions create boundaries. An agent in the `marketing` division cannot, by default, access data classified for the `engineering` division. These boundaries are enforced by the governance pipeline (see Chapter 5), not just by convention.

A typical `divisions.yaml` entry looks like:

```yaml
schema_version: "1.0"

company:
  name: "Acme Corp"
  size: "small"

divisions:
  - code: engineering
    name:
      en: Engineering
    required: true
    active: true
    head:
      role: Lead Engineer
      agent: eng-lead
```

---

## 4. Tiers — The Chain of Command

Agents in SIDJUA are organized into three tiers, forming a clear hierarchy:

| Tier | Role | Max Reasoning Turns | Default Task Timeout |
|------|------|--------------------|--------------------|
| **T1** | Strategic / Executive | 20 turns | 60 minutes |
| **T2** | Management / Department Head | 15 turns | 30 minutes |
| **T3** | Worker / Specialist | 10 turns | 10 minutes |

The tier determines what an agent is *allowed* to do. T1 agents set direction, approve large expenditures, and handle escalations from T2. T2 agents decompose objectives into concrete tasks and delegate them to T3. T3 agents execute specific, well-defined work.

When a T3 agent encounters something beyond its authority — a decision that requires judgment above its level, a cost that would exceed its budget, or a situation it cannot resolve — it **escalates** to its T2 supervisor. If T2 cannot resolve it, escalation goes to T1. If T1 cannot resolve it, the task becomes a human-in-the-loop decision visible in `sidjua decide`.

This chain prevents agents from making decisions beyond their authority without an explicit override. It is not just organizational structure — it is enforced by the task state machine and the budget cascade (see Chapter 10).

---

## 5. The Governance Layer — Your Rules, Enforced Automatically

The governance layer is the heart of SIDJUA. Before an agent can take any action — send an email, write a file, call an external API, execute code, or spend money — that action passes through the governance pipeline. Each stage can block the action entirely, pause it pending human approval, or pass it with a warning.

**Stage 0 — Security Filter (optional):** Network egress control. When configured, all web and API requests are checked against a security filter before the rest of the pipeline runs. Two modes are available:

- **Blacklist mode** (default): explicitly listed targets are blocked; everything else is allowed. Use this to block known-bad domains, IPs, or API endpoints.
- **Whitelist mode**: only explicitly listed targets are allowed; everything else is blocked. Use this for maximum lockdown — agents can only reach pre-approved endpoints.

The security filter also supports CIDR-range enforcement: you can restrict outbound network traffic to specific IPv4 address ranges. Configure via `governance/security/security.yaml` or change the mode at runtime with `sidjua governance security-mode`.

**Stage 1 — Forbidden:** Actions that can never happen regardless of context. Configured in `governance/boundaries/forbidden-actions.yaml`. Example: no agent may ever sign a contract without explicit human approval.

**Stage 2 — Approval:** Actions that require human sign-off under certain conditions. The request is queued; a human reviews it in `sidjua decide`. Example: any external API call costing more than $5 must be approved by the division head.

**Stage 3 — Budget:** Projected spend is checked against the division's daily and monthly limits stored in the database. If the action would exceed the limit, it is blocked. If it approaches the warning threshold, a warning is issued.

**Stage 4 — Classification:** Data sensitivity levels (PUBLIC, INTERNAL, CONFIDENTIAL, SECRET, FYEO) are matched against the agent's clearance level. A T3 agent with CONFIDENTIAL clearance cannot touch SECRET data.

**Stage 5 — Policy:** Custom rules checked against the action. Rules can be `hard` (BLOCK on violation) or `soft` (WARN and continue). This is where organization-specific rules live.

Every pipeline decision — pass, block, or pause — is written to the audit trail. There is no way to silently bypass the pipeline; an agent that does not go through it is a bug, not a feature.

### Security Layer Modes

The Stage 0 security filter is optional and configurable without restarting the system.

**Blacklist mode** (the default): you define what is blocked. Suitable for most teams — add known-bad domains, IP ranges, or API endpoints to the blocked list, and agents can freely reach everything else.

**Whitelist mode**: you define what is allowed. Every network-facing action (web requests, API calls) is blocked by default unless the target appears on the approved list. This is appropriate for regulated environments, air-gapped networks, or situations where agents should only ever communicate with a small, known set of endpoints.

Pattern forms supported in both modes:
| Pattern | Matches |
|---|---|
| `*` | Everything |
| `*.example.com` | Any subdomain of example.com (and the bare domain) |
| `api.example.com/*` | Any path under api.example.com |
| `api.example.com` | Exact match only |

CIDR enforcement (both modes): if `allowed_networks` contains IPv4 CIDR ranges (e.g. `10.0.0.0/8`), any request to a bare IP address or a URL whose host is an IP will be blocked unless it falls within one of those ranges. Hostname targets are not subject to CIDR enforcement (DNS resolution is outside SIDJUA's scope in V1).

To switch modes:
```
sidjua governance security-mode whitelist   # enable whitelist
sidjua governance security-mode blacklist   # revert to blacklist
sidjua governance security-mode             # show current mode
```

Run `sidjua apply` after any configuration change to reload the governance config from disk.

---

## 6. Tasks — Getting Work Done

A **task** is the unit of work in SIDJUA. When you run `sidjua run "Summarize Q1 financials"`, you create a root task. That task flows through the system, gets assigned to an agent, and may be broken into smaller sub-tasks by that agent.

Every task has:

- A **type**: `root` (submitted by a human), `delegation` (created by a T1/T2 agent for a subordinate), `consultation` (peer questions between agents at the same tier), or `synthesis` (a parent gathering results from children)
- A **status**: `CREATED → PENDING → ASSIGNED → RUNNING → WAITING → REVIEW → DONE` or terminated states (`FAILED`, `ESCALATED`, `CANCELLED`)
- A **priority**: CRITICAL (0), URGENT (1), REGULAR (2), LOW (3), or BACKGROUND (4) — lower number = higher priority
- A **budget**: token limit and USD cost limit per task; charged against the agent's and division's running totals
- A **classification**: the sensitivity level of the data involved
- A **TTL**: how long the task may run before being considered stuck — 3,600 s for T1, 1,800 s for T2, 600 s for T3

Tasks are stored in a SQLite database. Their full result is written to a file; a short management summary is stored in the database for quick lookup. Parents wait for all children to complete before synthesizing the final result.

---

## 7. The Reasoning Loop — How Agents Think

When an agent receives a task, it enters a multi-turn reasoning loop. Each "turn" is one round-trip to the LLM:

1. The agent's **system prompt** (built from its skill file) and the task description are assembled into a conversation.
2. A set of structured **decision tools** is offered to the LLM. The agent must call one of them — it cannot respond with plain text.
3. The LLM returns a **decision**:
   - `think_more` — the agent needs another turn to reason further
   - `use_tool` — call an external tool (must pass governance first)
   - `decompose_task` — break the work into sub-tasks and delegate
   - `request_consultation` — ask a peer agent for help
   - `escalate_task` — the agent cannot complete this; pass it up
   - `execute_result` — the task is done; write the result

The loop has safety rails:
- **Max turns**: 20 (T1), 15 (T2), 10 (T3) — after that, the task escalates automatically
- **Max tool calls**: 50 per task — after that, a partial result is forced
- **Turn timeout**: 120 seconds — the LLM call is retried once, then the task escalates
- **Context overflow**: when the conversation approaches the model's context limit, older turns are summarized automatically
- **Checkpoint**: every 5 turns, the conversation state is saved to the database, so the agent can resume after a crash

Every tool call goes through the governance pipeline before the tool executes. If governance blocks it, the agent receives the block reason as a message and must try a different approach.

---

## 8. Providers — Plugging In AI Models

SIDJUA uses a **provider catalog** — a built-in registry of 12 cloud providers and 8 local/self-hosted options. Providers are not locked in; you can add any OpenAI-compatible endpoint with `sidjua provider add-custom`.

Built-in cloud providers include: Anthropic, OpenAI, Google Gemini, Groq, DeepSeek, Mistral, Cohere, Grok/xAI, Kimi/Moonshot, Together AI, Fireworks AI, and Cloudflare Workers AI (which has a free tier).

Built-in local providers include: Ollama, LM Studio, StudioLM, LocalAI, llama.cpp server, vLLM, TGI (HuggingFace), and Jan.

Each provider has a preferred **API format**: Anthropic's own format or OpenAI-compatible. SIDJUA adapts to both. Models in the catalog include recommended tier assignments (T1/T2/T3) based on their capabilities and pricing.

Each agent can optionally specify a `fallback_provider` and `fallback_model`. If the primary provider fails (rate limit, outage, timeout), the agent automatically retries with the fallback. This is configured per agent in its YAML definition:

```yaml
provider: groq
model: llama-3.3-70b-versatile
fallback_provider: google-gemini
fallback_model: gemini-2.0-flash
```

API keys are never stored in plaintext. You register a **key reference** with `sidjua key add`, which points to an environment variable. The key itself stays in your environment; SIDJUA only stores the reference name.

---

## 9. Skills — Teaching Agents What to Do

A **skill file** is a Markdown document that defines an agent's identity, authority, and standards. It is the agent's constitution — loaded into the system prompt before every task.

The recommended format (v2) is plain Markdown with specific section headings:

```markdown
# My Agent — Skill Definition

## Identity
You are a software developer working for {organization}.
Your supervisor is {reports_to}.

## Work Style
- Read existing code before making changes
- Write tests before or alongside implementation

## Decision Authority
- You MAY: write code, run tests, read files
- You MAY NOT: delete production data, push to main branch
- ESCALATE: architecture decisions, security concerns

## Quality Standards
- All code must pass existing tests
- No hardcoded secrets

## Supervision Expectations
1. Write result to result file: files changed, test results
2. Management summary: task completed, confidence score
```

Three template variables are automatically substituted at load time:
- `{agent_name}` — the agent's configured name
- `{organization}` — your company name from `divisions.yaml`
- `{reports_to}` — the ID of the agent's supervisor

Skill files live in `agents/skills/` and are referenced in the agent's YAML definition. SIDJUA ships with 9 built-in skill templates: `strategic-lead`, `department-head`, `code-worker`, `researcher`, `writer`, `data-analyst`, `customer-support`, `video-editor`, and `custom` (blank starter). View them with `sidjua agent templates`.

---

## 10. Cost Tracking & Budgets — Controlling Spend

SIDJUA enforces a four-level budget cascade. Every LLM call must pass all four levels before executing:

1. **Organization** — the global monthly spending cap
2. **Division** — the division's daily and monthly limits (set in `cost-centers.yaml`, synced by `sidjua apply`)
3. **Agent** — per-agent monthly cap and hourly burn rate limit
4. **Task** — the per-task USD limit specified when the task was submitted

If any level would be exceeded by the estimated cost of the next LLM call, the action is blocked. The lowest applicable limit wins.

Alert levels fire at configurable thresholds (default: 80% of limit). When an agent's monthly spend reaches 80%, a `BUDGET_WARNING` event is emitted. At 100%, a `BUDGET_EXHAUSTED` event fires and all pending tasks for that agent are cancelled.

Cost records are written to the `cost_ledger` table in real time as each LLM call completes, so the totals used for budget checks are always current. You can view costs by division, agent, or time period with `sidjua costs`.

---

## 11. The Audit Trail — Everything Is Recorded

Every governance decision, task event, agent action, and budget alert is written to the audit trail. This is not optional and cannot be disabled.

The audit trail is stored in the `audit_trail` SQLite table. `sidjua apply` creates a per-division SQL view (`audit_engineering`, `audit_marketing`, etc.) so you can query events for a specific division without scanning the entire table.

What is always recorded, regardless of log level settings:
- Every governance pipeline decision (pass, block, pause) and which stage triggered it
- Every escalation
- Every approval request and its outcome
- Every governance enforcement (blocked actions)
- Every error

The default retention period is 365 days. Records older than the retention window are exported before deletion (as JSON and CSV by default). The full audit configuration lives in `governance/audit/audit-config.yaml` — generated by `sidjua apply` on first run, then never overwritten, so your customizations are preserved.

You can inspect the live audit stream with `sidjua logs --type governance` or query historical records by task, agent, division, or time range.

---

## 12. Configuration as Code — YAML All the Way

SIDJUA is designed around the principle that everything should be declarative, version-controllable, and reproducible. There is no GUI for core configuration.

Key configuration files:

| File | Purpose | Format |
|------|---------|--------|
| `config/divisions.yaml` | Organizational structure, one source of truth | `schema_version: "1.0"` |
| `agents/definitions/<id>.yaml` | Agent definitions | `schema_version: "1.0"` |
| `agents/skills/<id>.md` | Agent skill files | Markdown |
| `.system/cost-centers.yaml` | Budget limits per division | Generated by `sidjua apply` |
| `governance/boundaries/forbidden-actions.yaml` | Stage 1 rules | YAML rules list |
| `governance/approval-workflows.yaml` | Stage 2 rules | YAML workflows list |
| `governance/policy/*.yaml` | Stage 5 rules | YAML rules with optional cron schedule |
| `governance/audit/audit-config.yaml` | Audit settings | Generated on first apply |

The `sidjua apply` command reads `divisions.yaml` and provisions all supporting structures in 10 idempotent steps. Re-running apply after editing the YAML brings the system into sync with the new configuration. Before each apply, SIDJUA creates a governance snapshot so you can roll back to any previous state with `sidjua governance rollback <version>` (up to 10 snapshots are kept).

---

## 13. Security & Air-Gap — Your Data Stays Yours

SIDJUA is built for organizations that cannot or will not send sensitive data to third-party services. The key security properties:

**Local execution**: SIDJUA itself runs entirely inside your infrastructure. The SQLite database, audit trail, agent state, and all result files stay on your servers.

**Local models**: If you use Ollama, LM Studio, or another local provider, no data ever leaves your network — not even to Anthropic or OpenAI. Cloud providers are pluggable, not mandatory.

**Data classification**: Five classification levels — PUBLIC, INTERNAL, CONFIDENTIAL, SECRET, FYEO — control which agents can touch which data. A T3 agent cannot read a SECRET document. An agent in one division cannot, by default, access another division's confidential data.

**Key management**: API keys are never stored in SIDJUA's database. They stay in environment variables; SIDJUA stores only the variable name. You manage secrets with your existing secret management tooling.

**Governance snapshots**: Before each `sidjua apply`, the current configuration is snapshotted. If a change has unintended consequences, you can roll back to a previous governance state without data loss.

**Non-root container**: The Docker image runs as a non-root user (`sidjua`, uid/gid 1001). The production container includes only what is needed to run (`tini`, `tar`, `sqlite3`) and nothing else.

**REST API authentication**: The HTTP API uses `Authorization: Bearer <key>` for all endpoints. Keys are generated with `sidjua api-key generate` and can be rotated without downtime (60-second grace period). Short-lived SSE tickets are used for event streaming so that long-lived keys never appear in server logs.

**Input validation**: All user-supplied path parameters in the REST API and GUI are validated against a strict safe-ID pattern (`[a-zA-Z0-9_-]{1,128}`). Request bodies are size-limited (2 MiB by default, configurable via `SIDJUA_MAX_BODY_SIZE`). CSRF origin validation blocks cross-origin POST requests from browser contexts.

**Agent sandbox isolation**: When the `bubblewrap` sandbox provider is enabled, agent processes run inside OS-level Linux namespaces with restricted filesystem and network access. See Section 21 for details.

---

## 14. The Guide Agent — Your Built-In Assistant

SIDJUA ships with a built-in assistant called the **Guide**, installed automatically when you run `sidjua init`. The Guide is a T2 agent powered by Cloudflare Workers AI (Llama 4 Scout), which operates on the free tier — no API key required, no account needed, no cost.

```bash
sidjua init          # creates workspace + installs Guide
sidjua chat guide    # open an interactive conversation
```

Inside the Guide chat session, you can type natural language messages or use slash commands:

| Command | Description |
|---------|-------------|
| `/key <provider> <api-key>` | Add an API key for a provider |
| `/key <provider>` | Show provider-specific setup guide |
| `/key` | Show provider recommendation menu |
| `/providers` | List all supported providers with pricing |
| `/agents` | List configured agents |
| `/status` | Show workspace status (files and providers) |
| `/costs` | Show cost summary from the database |
| `/help` | Show available commands |
| `/exit` | End the chat session |

The `/key` command is particularly useful for getting started. Type `/key` to see a recommendation menu; type `/key groq gsk_your-key` to add a key in one step. The key is written to `.system/providers/<provider>.yaml` and activates immediately.

The Guide answers questions about SIDJUA configuration, agent creation, governance rules, and provider selection. It can walk you through creating your first custom agent end to end.

The `sidjua setup` command remains available for non-interactive configuration checks (`sidjua setup --validate`, `sidjua setup --suggest`).

---

## 15. What Makes SIDJUA Different?

SIDJUA occupies a specific position in the AI tools landscape that is worth spelling out.

**Governance is not an add-on.** In most AI agent frameworks, governance is something you bolt on after the fact — logging middleware, optional guardrails. In SIDJUA, governance is the foundation. The five-stage pipeline is mandatory and synchronous. There is no way to run an agent that bypasses it.

**The audit trail is complete.** Not sampled, not summarized, not optional. Every governance decision for every action for every agent is recorded. One year of history is kept by default. You can answer "what did agent X do on date Y and why was action Z blocked?" for any event in the system.

**No lock-in.** SIDJUA works with 12 cloud providers and 8 local providers out of the box. You can add any OpenAI-compatible endpoint. Switching providers is a one-line change in an agent's YAML definition. You own your data, your configuration, and your audit trail.

**AGPL-3.0.** The entire platform is open source. You can read every line of code that governs your agents. There are no proprietary black-box components.

**Designed for teams, usable by one person.** The division/tier hierarchy is designed for enterprises, but it works equally well for a single person running a few agents on a laptop. The `solo` size preset in `divisions.yaml` provisions the minimum necessary structure without imposing organizational complexity you do not need.

**Budget governance is built in.** Most agent frameworks let you set a cost limit as an afterthought. In SIDJUA, every LLM call passes through a four-level budget cascade (organization → division → agent → task) before it executes. Agents are automatically paused when any level is exhausted. The cost ledger records every call in real time, and `sidjua costs` gives an accurate breakdown at any moment.

**Managed migration path.** If you are moving from another AI agent platform (OpenClaw, Moltbot), `sidjua import openclaw` converts your existing agents in one step — preserving skills and API keys, automatically applying SIDJUA governance to everything that was previously ungoverned. You keep what you built; you gain what you needed.

---

## 16. The Module System — Extending SIDJUA

Modules are installable packages that add domain-specific agent capability to your workspace. A module typically contains a pre-built agent definition, skill files, integration code, and documentation for a specific platform or use case.

Modules are installed with a single command:

```bash
sidjua module install discord
```

During installation, SIDJUA prompts you to enter any required secrets (API tokens, webhook URLs). In non-interactive environments (CI, Docker), secrets are read from environment variables instead.

Available modules:

| ID | Name | Description |
|----|------|-------------|
| `discord` | Discord Bot | Discord integration — post updates, announce releases, route community questions to agents |

After installing a module, module-specific commands become available:

```bash
sidjua discord status                      # verify configuration
sidjua discord post-dev-update             # post a commit summary to your dev-log channel
sidjua discord announce "V1.0 released!"   # post to announcement channel
```

Installed modules live in `~/.sidjua/modules/<module-id>/`. You can inspect, reconfigure, or remove them:

```bash
sidjua module status discord    # show install status and missing secrets
sidjua module list              # see all available and installed modules
sidjua module uninstall discord # remove the module
```

The module system is designed to grow. Future modules (SAP, Jira, Slack, ERP connectors) follow the same install-and-configure pattern.

---

## 17. Migration — Importing From Other Platforms

If you have agents built on another platform — OpenClaw, Moltbot, or a compatible JSON5 agent format — you can migrate them to SIDJUA without losing what you have built.

```bash
sidjua import openclaw
```

The importer reads your existing configuration (`~/.openclaw/openclaw.json` by default), extracts the agent definition and skills, and creates a fully governed SIDJUA agent in your workspace.

**What gets imported:**
- Agent name, provider, and model settings
- Skill files (SKILL.md per skill)
- API keys (migrated to SIDJUA's provider config; original keys are masked in output)
- Channel/integration configuration (Discord, webhooks)

**What SIDJUA adds automatically:**
- Five-stage pre-action governance pipeline
- Audit trail
- Budget enforcement (monthly and per-task limits)
- Division assignment and RBAC roles

The `--dry-run` flag shows exactly what would be created without making any changes:

```bash
sidjua import openclaw --dry-run
```

This is useful for reviewing the migration plan before committing to it.

For teams migrating multiple agents, the `--division`, `--tier`, and `--budget` options let you place agents correctly in your organizational structure from the start:

```bash
sidjua import openclaw \
  --division engineering \
  --tier 2 \
  --budget 100.00
```

Collision detection prevents overwriting an existing agent with the same derived ID. If a collision is detected, the import stops and reports the conflict.

> **Beta notice:** The OpenClaw importer has not been tested against all OpenClaw
> configuration variants. A beta warning is printed to the terminal when the command
> runs. If you encounter issues, please report them at
> https://github.com/GoetzKohlberg/sidjua/issues — your real-world config helps us
> improve compatibility.

---

## 18. Secrets Management

Secrets — API keys, tokens, passwords, and other sensitive values — are stored in an encrypted database separate from the main workspace. The secrets database lives at `.system/secrets.db`.

**Namespaces** organize secrets by scope:

| Namespace | Purpose |
|-----------|---------|
| `global` | Workspace-wide secrets accessible to any agent |
| `providers` | Provider API keys (Anthropic, OpenAI, etc.) |
| `divisions/<code>` | Division-scoped secrets (e.g. `divisions/engineering`) |

The CLI (`sidjua secret`) provides admin-level access that bypasses RBAC:

```bash
sidjua secret set providers anthropic-key --value "sk-ant-..."
sidjua secret get providers anthropic-key
sidjua secret list providers
sidjua secret rotate providers anthropic-key
sidjua secret delete providers old-key
sidjua secret namespaces
```

Values are never logged and never appear in `--json` output of `sidjua secret list` or `sidjua secret info`. The `info` command shows only metadata (namespace, key name, creation time, last rotation).

**RBAC enforcement** applies when agents access secrets through `GovernedSecretsProvider` (the programmatic interface). Four permissions control access:

| Permission | Description |
|------------|-------------|
| `secrets.read` | Read secret values |
| `secrets.write` | Write new secrets |
| `secrets.rotate` | Rotate existing secrets |
| `secrets.admin` | Full access including delete and namespace management |

Division agents have `secrets.read` for their own division namespace by default. Cross-namespace access requires explicit grant.

The Guide agent's `/key` command stores provider API keys using the `providers` namespace. Keys added via `/key` are immediately available to any agent that uses the corresponding provider.

---

## 19. Memory & Semantic Search

SIDJUA includes a knowledge pipeline that lets agents search past conversations and imported documents using semantic (vector) similarity — not just keyword matching.

### Importing knowledge

```bash
sidjua memory import ~/exports/claude-chats.zip
sidjua memory import ./docs/ --collection internal-docs
```

The importer parses Claude conversation exports (ZIP), Markdown files, PDFs, DOCX, and plain text. Each document is split into overlapping chunks, embedded into vectors, and stored in SQLite alongside a BM25 full-text index.

### Searching

```bash
sidjua memory search "how does budget enforcement work"
sidjua memory search "last week's architecture decision" --collection internal-docs
```

Results are ranked by a hybrid score combining vector similarity (semantic meaning) and BM25 (keyword overlap). The top-ranked chunks are returned with source attribution.

### Embedding providers

| Provider | Model | Dimensions | Cost |
|----------|-------|-----------|------|
| OpenAI (recommended) | `text-embedding-3-large` | 3072 | Per token |
| Cloudflare Workers AI | `@cf/baai/bge-base-en-v1.5` | 768 | Free |
| BM25 only | — | — | Free, keyword search only |

SIDJUA auto-selects the embedder based on available credentials:
- `OPENAI_API_KEY` present → OpenAI (`text-embedding-3-large`)
- `SIDJUA_CF_ACCOUNT_ID` + `SIDJUA_CF_TOKEN` present → Cloudflare Workers AI
- Neither → BM25 keyword search only

You can configure the embedder explicitly:

```bash
sidjua config embedding openai
sidjua config embedding cloudflare
```

### Collection management

```bash
sidjua memory status                  # show all collections
sidjua memory status my-collection    # show one collection
sidjua memory re-embed                # re-embed all collections with current provider
sidjua memory clear my-collection     # delete all chunks and vectors
sidjua memory verify                  # check WAL integrity
sidjua memory recover                 # re-embed chunks missing vectors (WAL recovery)
```

### Adaptive chunking

The pipeline uses adaptive chunking: if a chunk exceeds the embedding model's token limit, it is automatically split into smaller parts. The `re-embed` command re-processes all chunks with the current embedder — use it after switching providers or after a failed import.

---

## 20. The Init Dialog — Zero-Config First Experience

`sidjua init` is designed to get you from nothing to a working agent workspace in under a minute without manual file editing. When run in a terminal (TTY), it presents a guided 3-step dialog:

**Step 1 — Workspace name:** Defaults to the current directory name. Press Enter to accept.

**Step 2 — Memory & Knowledge:** Choose how you want to store and search agent memory:
- OpenAI embeddings (best quality, requires API key)
- Cloudflare embeddings (free, 768 dimensions)
- BM25 keyword search (no API key, no setup)
- Skip (configure later with `sidjua memory activate`)

**Step 3 — AI Provider:** Choose a provider for your own agents (the built-in Guide works without any provider):
- Groq — free tier, fast inference
- Google AI Studio — free tier, Gemini models
- OpenAI — paid, GPT-4 class models
- Anthropic — paid, Claude models
- Skip (configure later with `sidjua config provider`)

After the dialog, the selected API keys are written to `.system/providers/<provider>.yaml` and `.env`. The workspace is ready immediately.

**Non-interactive mode** — for CI pipelines, Docker containers, and scripted environments:

```bash
sidjua init --yes                                              # all defaults, no dialog
sidjua init --yes --provider groq --provider-key gsk_abc123   # with provider pre-set
sidjua init --yes --memory cloudflare                          # with embedder pre-set
```

When stdin is not a TTY (pipe, redirect, Docker exec), the dialog is skipped automatically — `--yes` is implied.

---

## 21. Agent Sandboxing

By default, SIDJUA agents are regular Node.js child processes — they run with the same filesystem and network access as the SIDJUA process itself. For production deployments where agents may execute untrusted code or handle sensitive data, you can enable **OS-level sandbox isolation**.

### What sandboxing does

When sandboxing is enabled, each agent's shell-level tool invocations are wrapped with access controls:

- **Filesystem isolation** — agents cannot read files outside their allowed paths (e.g., `~/.ssh`, `~/.gnupg` are denied by default). You can additionally restrict write access.
- **Network isolation** — agents' HTTP/HTTPS traffic is routed through a local filtering proxy. You define which domains are allowed or denied.

### Configuration

Add a `sandbox` section to `divisions.yaml`:

```yaml
sandbox:
  provider: "bubblewrap"    # "none" (default) or "bubblewrap"
  defaults:
    network:
      allowedDomains:           # domains agents are allowed to connect to
        - "api.openai.com"
        - "api.anthropic.com"
      deniedDomains: []
    filesystem:
      denyRead:                 # paths agents cannot read
        - "~/.ssh"
        - "~/.gnupg"
        - "/etc/shadow"
      allowWrite: []            # additional writable paths (workdir always writable)
      denyWrite: []
```

### Providers

| Provider | Description |
|----------|-------------|
| `none` | No isolation. Agents run as normal child processes. **Default.** |
| `bubblewrap` | OS-level isolation via bubblewrap (Linux) or sandbox-exec (macOS). Network filtering via local HTTP/SOCKS proxy. |

### Checking dependencies

Before enabling bubblewrap, verify that required system packages are installed:

```bash
sidjua sandbox check
```

Example output:
```
Sandbox Status
  Provider configured: bubblewrap
  Dependencies available: yes

Ready for sandboxed agent execution.

NOTE: Running in Docker requires extra capabilities:
  docker run --cap-add=SYS_ADMIN --security-opt seccomp=unconfined ...
```

### Docker requirements

Running bubblewrap inside a container requires the `SYS_ADMIN` capability so that bwrap can create user namespaces:

```bash
docker run --cap-add=SYS_ADMIN --security-opt seccomp=unconfined sidjua:latest
```

With Docker Compose:

```yaml
services:
  sidjua:
    cap_add:
      - SYS_ADMIN
    security_opt:
      - seccomp:unconfined
```

Without these flags, bubblewrap will fail to start and SIDJUA will exit with an error. The `none` provider (default) requires no extra capabilities.

### Install dependencies

```bash
# Ubuntu / Debian
sudo apt install bubblewrap socat

# Alpine Linux
sudo apk add bubblewrap socat

# macOS (socat not needed)
brew install bubblewrap
```

---

## 22. The Guide API Proxy

The Guide agent runs on Cloudflare Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct`) for free. But this requires Cloudflare credentials (`SIDJUA_CF_ACCOUNT_ID` + `SIDJUA_CF_TOKEN`) to make direct Workers AI calls.

For users who have not configured Cloudflare credentials, SIDJUA falls back to the **Guide API Proxy** — a free hosted endpoint at `guide-api.sidjua.com` that forwards Guide requests to the same Cloudflare model without requiring any credentials on the user's side.

This means `sidjua chat guide` works with **zero configuration** — no API key, no account, no environment variables — right after `sidjua init`.

The chat header shows which mode is active:

```
[direct]  — using your Cloudflare credentials
[proxy]   — using the free SIDJUA proxy (guide-api.sidjua.com)
[offline] — no connection available, running from cache
```

The proxy is rate-limited per IP to prevent abuse. For high-volume use or guaranteed availability, configure your own Cloudflare credentials.

---

## 23. The Web Management Console — Optional Visual Interface

SIDJUA ships with an optional web management console built with **React 18 + TypeScript**. The console connects to a running SIDJUA server over REST + SSE and provides a real-time visual interface for everything the CLI can show.

### What it provides

- **Dashboard** — live agent status, task queue depth, cost totals for the last 24 hours, and a governance compliance summary
- **Agents page** — filterable agent list with division and status filters; click any row to open a detail panel showing current task, success rate, recent audit events, and Start/Stop controls
- **Governance page** — policy rule tree and snapshot history with diff view
- **Audit Log** — event-type filtering, live follow mode, export
- **Cost Tracking** — per-division and per-agent breakdowns with time period selection
- **Configuration** — read-only view of divisions config, system info, and log levels
- **Settings** — server URL and API key management, connection test

### How it connects

The GUI connects to a SIDJUA server at a URL you configure in Settings
(default: `http://localhost:3000`). It uses the same REST API and SSE event stream as
the CLI. The server must be started separately with `sidjua server start`.

### When to use it

The GUI is entirely optional — all functionality is available via the CLI. Use it when
you want real-time visibility without running `watch sidjua status`, or when you are
managing multiple agents and want to click through details rather than composing
filter flags.

### Running the GUI

```bash
cd sidjua-gui
npm install

# Development (browser)
npm run dev

# Development (native window)
open http://localhost:4000

# Production build (creates .deb / .AppImage / .dmg / .msi)
./scripts/build.sh
```

Requirements: Node.js 22+, Rust stable ([rustup.rs](https://rustup.rs)).
See `sidjua-gui/README.md` for the complete build guide.

### Security properties

The GUI enforces the same security model as the REST API — all requests include your
API key. Additional protections specific to the GUI:
- Content Security Policy restricts network connections to `localhost` and `127.0.0.1` only
- API key is obfuscated in local storage (base64+reverse encoding)
- All dynamic URL path segments are validated before use
- `no-referrer` policy prevents the SSE ticket from appearing in server logs
- Fetch requests are cancelled when components unmount (no dangling connections)


---

## 24. Update & Lifecycle Management

SIDJUA distinguishes two ownership domains:

- **`system/`** — SIDJUA-owned files: governance rules, migration scripts, schemas, and provider definitions. These are replaced on every update.
- **`data/`** — Your files: agent configurations, division settings, secrets, logs, knowledge, and backups. These are *never modified* by SIDJUA updates.

This separation guarantees that running `sidjua update` cannot corrupt your data.

### System Governance Rules

The `system/governance/` directory contains a baseline set of mandatory security rules that ship with SIDJUA:

- **SYS-SEC-001 through SYS-SEC-008** — credential isolation, no plaintext secrets, network boundaries, tool sandboxing, audit integrity, budget enforcement, prompt injection defense, and human escalation
- **SYS-GOV-001 / SYS-GOV-002** — the governance layer itself cannot be disabled, and agent hierarchy is always enforced

These rules **cannot be weakened or disabled**. They are enforced before every agent action.

You can add your own rules in `data/governance/policies/`. Your rules can only *add* new constraints — they cannot override or weaken the system baseline. If you attempt to add a rule that conflicts with a system rule, SIDJUA reports the conflict and ignores your version. See `sidjua rules --validate`.

### Update Flow

```
sidjua update
  1. Check — query npm registry for new version
  2. Changelog — display what changed
  3. Confirm — you approve the upgrade
  4. Backup — snapshot current system/ and migration state
  5. Install — replace system/ with new version
  6. Migrate — run any pending schema migrations
  7. Selftest — verify the installation is healthy
  8. Report — confirm success and show rollback command
```

At every step, failure triggers an automatic rollback to the pre-update state. You can also roll back manually at any time with `sidjua rollback`.

### Governance Ruleset Versioning

The governance ruleset (`system/governance/VERSION`) is versioned independently from the SIDJUA product version. This allows security rule updates to ship without requiring a full version upgrade.

To update only governance rules (without a product version bump): `sidjua update --governance`

### Embedding Migration

When the embedding model changes (different model, different dimensions, or different provider), all stored knowledge vectors must be regenerated. The source text is safe — it lives in SQLite (`data/.system/sidjua.db`) and is never deleted. Vectors are a derived artifact.

**Migration requires downtime:** all agents must be stopped while re-embedding runs.

```bash
# Stop agents, then:
sidjua migrate-embeddings --dry-run   # see estimate first
sidjua migrate-embeddings             # run migration
sidjua migrate-embeddings --resume    # if interrupted
sidjua migrate-embeddings --rollback  # restore previous vectors
```

Migration automatically creates a vector backup before clearing the old collection. Progress is persisted so interrupted migrations can resume from where they left off.


---

## Integration Gateway

The Integration Gateway (#503) is SIDJUA's governed bridge between AI agents and external services. Every outbound API call — whether to GitHub, Slack, an internal REST API, or a local script — flows through the gateway, which enforces policy, tracks cost, and records a tamper-evident audit trail.

### Dual-Path Architecture

The gateway routes each request through one of two paths:

**Deterministic path** — Used for adapters defined in `governance/integrations/*.yaml`. The adapter YAML specifies the exact service URL, auth method, available actions, and per-action governance rules (risk level, approval requirements, rate limits). The gateway resolves credentials, calls the external service, and returns the result.

**Intelligent path** — Used when no adapter matches. The gateway calls an LLM to discover the correct API endpoint from a cached OpenAPI schema. Discovered schemas are stored in the schema store and can be promoted to full adapters once they prove reliable.

```
Agent → GatewayRequest
           ↓
    RouteResolver.resolve()
      ├── "deterministic"  → HttpExecutor  → external API
      ├── "intelligent"    → IntelligentPathResolver → LLM → external API
      └── "blocked"        → PolicyEnforcer rejection
```

### Adapter Definition

Adapters live in `governance/integrations/<service>.yaml`:

```yaml
name: github
type: deterministic
protocol: rest
base_url: https://api.github.com
auth:
  type: api_key
  header: Authorization
  secret_ref: GITHUB_TOKEN
actions:
  list_repos:
    method: GET
    path: /user/repos
    governance:
      risk_level: low
      require_approval: false
      rate_limit: "30/minute"
      budget_per_call: 0.00
  create_issue:
    method: POST
    path: /repos/{owner}/{repo}/issues
    governance:
      risk_level: medium
      require_approval: false
      rate_limit: "10/minute"
      budget_per_call: 0.00
enabled: true
```

### Governance Flow

Every request passes through these enforcement stages before execution:

1. **Validation** — Required fields (`agent_id`, `service`, `action`, `division`) must be present.
2. **Route resolution** — Adapter and action are looked up; disabled adapters or unknown services are blocked.
3. **Policy check** — `PolicyEnforcer` applies `WebAccessPolicy` rules (allowlist/blocklist per division).
4. **Credential resolution** — Secrets are fetched from division-scoped or global namespace.
5. **Execution** — HTTP call / script / CLI / MCP bridge runs with timeout enforcement.
6. **Audit** — Every outcome is written to `integration_audit_events` regardless of success or failure.

### Schema Store and Promotion

When an agent calls an unknown service via the intelligent path, the gateway stores the discovered OpenAPI schema in the schema store. After 10+ successful calls at ≥80% success rate, the service becomes eligible for promotion:

```bash
sidjua integration promote my-api --review   # inspect generated adapter YAML
# → copy YAML to governance/integrations/my-api.yaml
sidjua apply                                  # activate the adapter
```

### REST API

The gateway is also accessible via the REST API for agent-to-gateway calls:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/integrations` | List all adapters and discovered schemas |
| `GET` | `/api/v1/integrations/:service` | Get adapter details |
| `POST` | `/api/v1/integrations/:service/execute` | Execute an action |
| `POST` | `/api/v1/integrations/add` | Add integration from OpenAPI spec |
| `GET` | `/api/v1/integrations/:service/test` | Test connectivity |
| `GET` | `/api/v1/integrations/audit` | Query audit log |
| `GET` | `/api/v1/integrations/promote/:service` | Check promotion eligibility |
