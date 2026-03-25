# SIDJUA Quick Start

SIDJUA V0.9 introduces a zero-config path: three commands get you from nothing to an interactive AI guide with no API key, no account, and no configuration required. The guide agent runs on Cloudflare Workers AI (free tier) and is pre-installed by `sidjua init`.

---

## 1. Zero-Config Start

This path works immediately after installation. No account creation, no API key, no Docker.

### Step 1: Install

```bash
npm install -g sidjua
```

Or run from source:

```bash
git clone https://github.com/GoetzKohlberg/sidjua.git
cd sidjua
npm ci && npm run build
npm link
```

Requirements: Node.js >= 22.0.0

### Step 2: Initialize a workspace

```bash
sidjua init
```

When run in a terminal, `sidjua init` presents an interactive 3-step dialog:

```
  SIDJUA — Initializing workspace...

  [1/3] Workspace name (default: my-project):

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
    (c) OpenAI — paid, best quality
    (d) Anthropic — paid, best quality
    (e) Other — enter provider and key manually
    (f) Skip for now — only Guide agent available

  ✓ Workspace created: my-project
  ✓ Memory: not configured (add later: sidjua memory activate)
  ✓ Provider: groq (llama-3.3-70b-versatile)
  ✓ Guide agent ready — try: sidjua chat guide
```

You can press Enter to accept defaults at each step. The Guide agent works at step (f) — no provider key is required to use it.

`sidjua init` creates the following in your current directory:

```
.system/
  sidjua.db
  providers/
    cloudflare.yaml   # pre-configured, no key required
    groq.yaml         # template (fill in key when ready)
    google.yaml       # template (fill in key when ready)
agents/
  agents.yaml
  definitions/
    guide.yaml        # pre-installed guide agent
  skills/
    guide.md
  templates/
governance/
  CHARTER.md
  boundaries/
    defaults.yaml
divisions.yaml
docs/                 # bundled documentation
```

The guide agent is fully configured and ready to use immediately.

**For CI/Docker/automated environments** — skip the dialog with `--yes`:

```bash
sidjua init --yes                                            # all defaults
sidjua init --yes --provider groq --provider-key gsk_abc123 # with provider
```

Options:
- `--work-dir <path>` — initialize in a specific directory instead of cwd
- `--force` — overwrite an existing workspace
- `--quiet` — suppress output
- `--yes` — non-interactive mode (skip all prompts, use defaults)
- `--provider <name>` — pre-select provider: `groq`, `google`, `openai`, `anthropic`
- `--provider-key <key>` — API key for the selected provider
- `--memory <mode>` — embedding mode: `openai`, `cloudflare`, `bm25`, `skip`

### Step 3: Chat with the guide

```bash
sidjua chat guide
```

The guide agent answers questions about SIDJUA, explains concepts, and can walk you through creating your own agents. It runs on Cloudflare Workers AI at no cost.

Available slash commands inside the chat session:

| Command | Description |
|---------|-------------|
| `/key <provider> <key>` | Add a provider API key |
| `/providers` | List configured providers |
| `/agents` | List available agents |
| `/status` | Workspace status |
| `/costs` | Cost summary |
| `/help` | Show all commands |
| `/exit` | Exit chat |

When you are ready to add a paid or free-tier provider for better model quality, use `/key` inside the chat session (see Section 2).

---

## 2. Add Your First Provider

The zero-config Cloudflare Workers AI provider covers basic usage. When you want access to more capable models, add one of these providers. All three have free tiers.

### Add a provider key inside the guide chat

```
/key groq gsk_your-key-here
/key google AIza_your-key-here
/key anthropic sk-ant-your-key-here
```

Provider details:

| Provider | Free Tier | Quality |
|----------|-----------|---------|
| Groq | 1,000 requests/day | Good — fast inference |
| Google | 250 requests/day | Good — Gemini models |
| Anthropic | Paid, no free tier | Best — Claude models |

### Add a provider key from the command line (scripted environments)

```bash
sidjua key add groq gsk_your-key-here
sidjua key add google AIza_your-key-here
sidjua key add anthropic sk-ant-your-key-here
```

---

## 3. Configure Your Organization

`divisions.yaml` is the single source of truth for your agent organization structure. Edit it to match your team, then run `sidjua apply` to provision all systems.

### Edit divisions.yaml

```yaml
schema_version: "1.0"

company:
  name: "My Organization"
  size: "solo"              # solo | small | medium | large | enterprise

divisions:
  - code: engineering
    name:
      en: Engineering
    required: true
    active: true
    head:
      role: Lead Engineer
      agent: null           # set to agent ID after creating an agent
```

Key fields:
- `code` — machine identifier used in commands and routing
- `required: true` — always provisioned regardless of size preset
- `active: true` — division participates in task routing
- `head.agent` — ID of the agent that leads this division

### Apply the configuration

```bash
sidjua apply --verbose
```

```
[1/10]  VALIDATE     divisions.yaml parsed and validated
[2/10]  FILESYSTEM   Directory structure created
[3/10]  DATABASE     SQLite schema initialized
[4/10]  SECRETS      Secrets paths provisioned
[5/10]  RBAC         Role assignments generated
[6/10]  ROUTING      Agent routing table built
[7/10]  SKILLS       Skill directories assigned
[8/10]  AUDIT        Audit partitions initialized
[9/10]  COST_CENTERS Budget tracking configured
[10/10] FINALIZE     State file written
```

`apply` is idempotent. Run it again after editing `divisions.yaml` to sync changes.

Preview changes without applying:

```bash
sidjua apply --dry-run
```

Apply a single step:

```bash
sidjua apply --step ROUTING
```

---

## 4. Create Your First Agent

```bash
sidjua agent create my-worker \
  --name "My Worker" \
  --provider groq \
  --model llama-3.3-70b-versatile \
  --division engineering \
  --tier 3 \
  --budget-per-task 0.10 \
  --budget-monthly 5.00
```

Start the agent and verify it is active:

```bash
sidjua agent start my-worker

sidjua agent list
# ID           TIER  PROVIDER  MODEL                    DIV          STATUS
# my-worker    T3    groq      llama-3.3-70b-versatile  engineering  active
```

---

## 5. Start the Orchestrator and Run Tasks

```bash
# Start the orchestrator in the background
sidjua start

# Submit a task — governance pipeline runs before execution
sidjua run "Summarize the current engineering priorities" \
  --division engineering \
  --wait

# View completed tasks
sidjua tasks --status done
```

Every task passes through the Pre-Action Governance Pipeline before any LLM call is made. The pipeline has up to six stages: Security Filter (Stage 0, optional), Forbidden, Approval, Budget, Classification, and Policy. Blocked tasks are logged with the enforcement reason.

Inspect the governance trail:

```bash
sidjua logs --type governance
```

**Enterprise lockdown (whitelist mode):** For regulated environments, switch the security filter to whitelist mode so agents can only reach pre-approved network endpoints:

```bash
sidjua governance security-mode whitelist
# Edit governance/security/security.yaml to add your allowed endpoints
sidjua apply   # reload configuration
```

In whitelist mode, any web request, API call, or HTTP POST to a target not on the `allowed` list is blocked at Stage 0 — before any other governance stage runs. Run `sidjua governance security-mode` with no arguments to see the current mode.

---

## 6. REST API (Optional)

The REST API enables programmatic access and integration with external systems.

Generate an API key and start the server:

```bash
sidjua api-key generate
# Generated API key (save this — it will not be shown again):
#   a3f8e2c1...

export SIDJUA_API_KEY="a3f8e2c1..."
sidjua server start
```

Example requests:

```bash
curl -H "Authorization: Bearer $SIDJUA_API_KEY" \
  http://localhost:3000/api/v1/health

curl -H "Authorization: Bearer $SIDJUA_API_KEY" \
  http://localhost:3000/api/v1/tasks
```

The server also supports SSE event streaming at `/api/v1/events` for real-time task updates:

```bash
curl -N "http://localhost:3000/api/v1/events?token=$SIDJUA_API_KEY"
```

---

## 7. Monitoring

```bash
sidjua status                  # Workspace overview and agent states
sidjua costs --period 24h      # Spending for the last 24 hours
sidjua logs --follow           # Live event stream
```

---

## 8. Next Steps

- [CLI-REFERENCE.md](CLI-REFERENCE.md) — Complete command reference
- [SIDJUA-CONCEPTS.md](SIDJUA-CONCEPTS.md) — Plain-language explanation of all SIDJUA concepts
- [SIDJUA-APPLY-TECH-SPEC-V1.md](SIDJUA-APPLY-TECH-SPEC-V1.md) — Apply pipeline specification
- [PRE-ACTION-PIPELINE-SPEC-V1.md](PRE-ACTION-PIPELINE-SPEC-V1.md) — Governance pipeline specification
- `sidjua agent templates` — Browse built-in agent templates
- `sidjua policy add` — Add governance policy rules
- `sidjua backup create` — Create a workspace backup before making changes

### Optional: Desktop GUI

SIDJUA includes a native desktop application for real-time visual management of
agents, tasks, governance rules, and costs. It connects to any running SIDJUA server
over REST + SSE.

```bash
# Start the REST API server first
sidjua api-key generate          # save the key shown
export SIDJUA_API_KEY="..."
sidjua server start

# Build and run the GUI (requires Node.js 22+ and Rust)
cd sidjua-gui && npm install && npm run dev
```

See [sidjua-gui/README.md](../sidjua-gui/README.md) for installation details and
native package builds (`.deb`, `.AppImage`, `.dmg`, `.msi`).

### Optional: Agent Sandboxing

For production deployments where agents may execute untrusted code, SIDJUA supports
OS-level process isolation via bubblewrap (Linux namespaces):

```bash
# Check if dependencies are available
sidjua sandbox check

# Enable in divisions.yaml
#   sandbox:
#     provider: "bubblewrap"
```

See [SIDJUA-CONCEPTS.md](SIDJUA-CONCEPTS.md) section 21 for full details.

---

## Migrating from OpenClaw / Clawdbot

If you currently use OpenClaw or Clawdbot, SIDJUA can import your existing agent
configurations in one command:

```bash
# Preview what will be imported (no changes made)
sidjua import openclaw --dry-run

# Import config + skill files
sidjua import openclaw --skills /path/to/skills/

# Import and assign to a specific division
sidjua import openclaw --division engineering --tier 2 --budget 100.00

# Skip credential migration
sidjua import openclaw --no-secrets
```

**What gets imported:**
- Agent name, provider, and model settings
- Skill files (converted to SIDJUA's SKILL.md format)
- API keys (masked in output, stored in `.system/imported-env.sh`)
- Channel/integration config (Discord, webhooks)

**What SIDJUA adds automatically:**
- Pre-action governance enforcement
- Audit trail for every agent action
- Per-task and per-month budget limits
- Division assignment and RBAC roles

The `--dry-run` flag shows exactly what would be created without writing anything. Use
it first to review the migration plan.

> **Beta notice:** The OpenClaw importer has not been tested against all OpenClaw
> configuration variants. If you encounter issues, please [report them on
> GitHub](https://github.com/GoetzKohlberg/sidjua/issues).

See [CLI-REFERENCE.md](CLI-REFERENCE.md) for the full list of import flags.

---

## Keeping SIDJUA Up to Date

SIDJUA includes a built-in update system that manages both the CLI and the system governance
rules bundled inside it.

**Check for updates:**
```bash
sidjua update --check      # non-destructive check; shows what's available
sidjua version             # see installed version, ruleset version, and schema version
```

**Apply an update:**
```bash
sidjua update              # interactive: shows what changes, asks to confirm
sidjua update --yes        # non-interactive (for CI/CD)
```

Before installing, the updater automatically backs up your current `system/` directory.
If something goes wrong you can immediately recover:

```bash
sidjua rollback            # restore the most recent pre-update backup
sidjua rollback --list     # see all available restore points
sidjua rollback --to 0.9.7 # restore a specific archived version
```

**System governance rules protect you automatically.** The governance ruleset embedded in
every SIDJUA release defines the safety policies your agents run under. When you update
SIDJUA, the ruleset updates too — without requiring any changes to `divisions.yaml`. In
environments where rules must be approved before deployment, use whitelist mode:

```yaml
# divisions.yaml
governance:
  whitelist_mode: true      # only rules in governance/allowed-rules.yaml are active
  auto_update_rules: false  # governance rules are not updated without explicit approval
```

SIDJUA also prints a one-line notification on startup whenever a new version is available,
so you never have to remember to check manually.
