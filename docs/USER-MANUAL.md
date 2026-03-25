# SIDJUA User Manual

Workflow-oriented guide for operating SIDJUA day to day.

For precise command syntax and option tables, see [CLI-REFERENCE.md](CLI-REFERENCE.md).
For conceptual background, see [SIDJUA-CONCEPTS.md](SIDJUA-CONCEPTS.md).

---

## 1. Daily Operations

### Submitting a Task

```bash
# Minimal — routed to the highest-priority available agent
sidjua run "Summarize the latest customer feedback"

# Target a division and wait for the result
sidjua run "Draft the sprint retrospective" \
    --division engineering \
    --wait

# High-priority, cost-capped
sidjua run "Investigate the production outage" \
    --priority urgent \
    --division engineering \
    --cost-limit 5.00 \
    --wait
```

Every task submission passes through the five-stage governance pipeline synchronously.
If governance blocks the task, `sidjua run` exits with code 1 and prints the enforcement
reason on stderr.

### Watching Progress

```bash
sidjua task watch task-abc123          # live updates, exits on completion
sidjua tasks --status running          # all running tasks across all divisions
sidjua tasks --status done --limit 5   # last 5 completed tasks
```

### Getting Results

```bash
sidjua task result task-abc123         # full result text
sidjua tasks task-abc123 --summary     # management summary only (fast)
sidjua task tree task-abc123           # delegation tree (see sub-tasks)
```

### Handling Escalations

When an agent cannot resolve a task within its authority, it escalates. Escalated tasks
appear in the decision queue:

```bash
sidjua decide                                       # list pending escalations
sidjua decide task-xyz --action retry \
    --guidance "Use the backup data source"
sidjua decide task-xyz --action reassign \
    --agent senior-developer
sidjua decide task-xyz --action resolve \
    --result "The answer is: use the v2 API endpoint"
sidjua decide task-xyz --action cancel
```

### Checking Costs

```bash
sidjua costs --period 24h              # today's spend
sidjua costs --period 7d              # this week
sidjua costs --division engineering   # by division
sidjua costs --agent my-developer     # by agent
```

### Reviewing the Audit Trail

```bash
sidjua logs --type governance          # governance decisions (blocks, approvals)
sidjua logs --task task-abc123         # all events for a task tree
sidjua logs --follow                   # live tail
sidjua logs --since 2026-03-01 --type escalation
```

---

## 2. Adding New Agents

### Step 1 — Choose a Provider and Model

Run `sidjua provider list` to see what is available. If you already have an API key for
a provider, register it:

```bash
# Via key reference (recommended)
sidjua key add groq-key --provider groq --source env:GROQ_API_KEY

# Via the Guide's /key command (interactive)
sidjua chat guide
You: /key groq gsk_abc123...
```

To test connectivity before creating an agent:

```bash
sidjua provider test \
    --base-url https://api.groq.com/openai/v1 \
    --model llama-3.3-70b-versatile \
    --api-key $GROQ_API_KEY
```

### Step 2 — Create the Agent

Interactive wizard (recommended for first time):

```bash
sidjua agent create
```

Non-interactive (scripted):

```bash
sidjua agent create my-researcher \
    --name "Research Analyst" \
    --provider groq \
    --model llama-3.3-70b-versatile \
    --division intelligence \
    --tier 3 \
    --budget-per-task 0.30 \
    --budget-monthly 15.00
```

From a template:

```bash
sidjua agent create --template researcher --division intelligence
```

Via the Guide (natural language):

```bash
sidjua chat guide
You: I need a research agent for the intelligence division.
     It should use Groq with Llama 3, tier 3, $0.30 per task budget.
Guide: Creating agent "research-analyst" for the intelligence division...
       ✓ agents/definitions/research-analyst.yaml
       ✓ agents/skills/research-analyst.md
```

### Step 3 — Edit the Skill File

Open `agents/skills/<id>.md` and customize the agent's identity, decision authority,
work style, and output standards. The skill file is the agent's constitution — take
time to write it well. See `agents/templates/` for examples.

### Step 4 — Activate the Agent

```bash
sidjua agent start my-researcher
sidjua agent list    # verify status = active
```

### Step 5 — Register in divisions.yaml (optional)

If this agent leads a division, set the `head.agent` field and re-apply:

```yaml
divisions:
  - code: intelligence
    head:
      agent: my-researcher   # ← add this
```

```bash
sidjua apply
```

---

## 3. Provider Configuration

### Built-in Catalog

SIDJUA ships with a catalog of cloud and local providers. No installation is required —
configure credentials and the provider is ready to use.

```bash
sidjua provider list --cloud    # cloud providers
sidjua provider list --local    # local/self-hosted providers
sidjua provider models groq     # models for a specific provider
```

### Registering API Keys

Keys are stored as references to environment variables — never as plaintext in
SIDJUA's database.

```bash
# Register a reference
sidjua key add groq-key --provider groq --source env:GROQ_API_KEY

# Then set the variable in your environment (or .env file)
export GROQ_API_KEY=gsk_abc123...

# Verify
sidjua key test groq-key
```

### Custom Endpoints (Ollama, vLLM, etc.)

```bash
# Add a local Ollama instance
sidjua provider add-custom \
    --id ollama-local \
    --name "Ollama (MacBook)" \
    --base-url http://localhost:11434/v1 \
    --model llama3.2

# Test connectivity
sidjua provider test \
    --base-url http://localhost:11434/v1 \
    --model llama3.2

# Use it for an agent
sidjua agent create my-local-worker \
    --provider ollama-local \
    --model llama3.2 \
    --division engineering \
    --tier 3
```

### Fallback Chains

Each agent can specify a fallback provider for resilience:

```yaml
# agents/definitions/my-agent.yaml
provider: groq
model: llama-3.3-70b-versatile
fallback_provider: google-gemini
fallback_model: gemini-2.0-flash
```

If Groq rate-limits the agent, it automatically retries with Google Gemini.

---

## 4. Governance Customization

### Adding Policy Rules

```bash
# Natural language — parsed into structured YAML by an LLM
sidjua policy add "Agents must not read files outside /app/data"

# Preview before deploying
sidjua policy add "No agent may call external APIs after 22:00 UTC" --dry-run

# From YAML file
sidjua policy add --file governance/policies/data-access.yaml

# List all active rules
sidjua policy list

# Test a specific action against policy
sidjua policy test \
    --agent my-developer \
    --action "file.read" \
    --task "Read /etc/passwd" \
    --verbose
```

Policy rules are stored in `governance/policy/`. Hard rules block; soft rules warn.

### Governance Snapshots

Every `sidjua apply` creates a snapshot of the current governance configuration. If
a policy change causes problems, roll back:

```bash
sidjua governance history           # list snapshots
sidjua governance diff v5           # what changed since snapshot v5
sidjua governance rollback v5       # restore snapshot v5
```

### Budget Limits

Division budgets are set in `divisions.yaml` under `budget:` and applied via
`sidjua apply`. To set them in the database directly (without editing YAML):

```bash
# After sidjua apply, set limits in cost_budgets table
sqlite3 .system/sidjua.db \
  "INSERT OR REPLACE INTO cost_budgets VALUES ('engineering', 100.0, 10.0, 80)"
# (division_code, monthly_limit_usd, daily_limit_usd, alert_threshold_percent)
```

Alert fires at 80% of limit by default. When a limit is hit, the action is blocked and
a `BUDGET_EXHAUSTED` event is emitted to the SSE stream.

---

## 5. Backup Strategy

### When to Back Up

- Before any `sidjua apply` (automatic snapshot covers configuration; backup covers everything)
- Before upgrading SIDJUA
- Before making structural changes to `divisions.yaml`
- On a schedule (daily for active deployments)

### Creating Backups

```bash
sidjua backup create --label "pre-upgrade"
sidjua backup list
```

Backups include: SQLite database, `divisions.yaml`, agent definitions, governance
configuration, and governance snapshots.

### Restoring

```bash
# Validate the archive first
sidjua backup restore sidjua-backup-20260301.tar.gz --dry-run

# Stop the orchestrator before restoring
sidjua stop-orchestrator

# Restore (automatically backs up current state first)
sidjua backup restore sidjua-backup-20260301.tar.gz

# Restart
sidjua start
```

### Automated Backups (cron example)

```bash
# /etc/cron.daily/sidjua-backup
#!/bin/bash
cd ~/my-project
sidjua backup create --label "daily-$(date +%Y%m%d)"

# Keep only the last 7 backups
sidjua backup list --json | \
  jq -r '.[7:][] | .id' | \
  xargs -I {} sidjua backup delete {} --force
```

---

## 6. Monitoring

### Health Checks

```bash
sidjua health                          # human-readable
sidjua health --json                   # machine-readable (for scripts/monitoring)
```

Via REST API (works in Docker health checks):

```bash
curl -s http://localhost:3000/health
# → {"status":"ok","database":"connected","orchestrator":"active"}
```

### Agent Status

```bash
sidjua agents                          # all agents
sidjua agent health my-developer       # budget and status for one agent
```

### Cost Monitoring

```bash
sidjua costs --period 24h              # today's spend
sidjua costs --period 30d             # monthly spend

# JSON output for integration with external dashboards
sidjua costs --period 30d --json | jq '.rows[] | select(.total_cost_usd > 1.0)'
```

### SSE Event Stream

Subscribe to real-time events from the REST API:

```javascript
const events = new EventSource(
  'http://localhost:3000/api/v1/events?token=YOUR_API_KEY'
);
events.onmessage = (e) => console.log(JSON.parse(e.data));
```

Filter by division, agent, or task:

```
GET /api/v1/events?token=KEY&division=engineering&task=task-abc123
```

### Log Level Tuning

```bash
sidjua logging set debug               # verbose (development)
sidjua logging set api-server debug    # one component only
sidjua logging set info                # back to normal
```

---

## 7. Upgrading SIDJUA

### Manual Install

```bash
# 1. Back up everything
sidjua backup create --label "pre-upgrade"

# 2. Stop the orchestrator
sidjua stop-orchestrator

# 3. Pull new code
git pull origin main

# 4. Install dependencies and rebuild
npm ci
npm run build

# 5. Re-apply (runs new migrations automatically)
sidjua apply

# 6. Restart
sidjua start
sidjua health
```

### Docker

```bash
# 1. Back up
docker compose exec sidjua sidjua backup create --label "pre-upgrade"

# 2. Pull new image
docker compose pull

# 3. Restart with zero-downtime (if using --no-deps)
docker compose up -d sidjua

# 4. Verify
docker compose exec sidjua sidjua health
```

### After Upgrading

- Run `sidjua apply` — each upgrade may include new migration steps
- Check `sidjua governance history` — a snapshot was created automatically
- Review `sidjua costs --period 1h` to confirm the new version is processing tasks
  and recording costs correctly
- If anything is wrong: `sidjua backup restore <pre-upgrade-backup>`

---

## Error Telemetry

SIDJUA can automatically report anonymized error data to help improve the platform.

### What Is Collected

When enabled, SIDJUA reports:
- **Error type** (e.g., `TypeError`, `DatabaseError`) — the class name only
- **Stack hash** — a SHA-256 hash of the sanitized stack trace (not the trace itself)
- **Fingerprint** — a hash used to deduplicate identical errors across installations
- **System metadata** — SIDJUA version, Node.js version, OS platform, CPU architecture

### What Is NOT Collected

- No API keys or secrets (all `sk-...`, `Bearer ...` patterns are stripped)
- No file paths (replaced with `<path>`)
- No IP addresses (replaced with `<ip>`)
- No email addresses (replaced with `<email>`)
- No URLs containing credentials (replaced with `<url-redacted>`)
- No full stack traces (only the hash is sent)
- No task content, agent names, or workspace configuration

### Modes

| Mode | Behavior |
|------|----------|
| `ask` | Default on new installs. Logs a prompt the first time an error occurs. No data is sent until you run `sidjua telemetry enable`. |
| `auto` | Errors are sent silently and automatically. |
| `off` | No errors are sent. Events are stored locally only. |

### Managing Telemetry

```bash
# Check current mode and buffer status
sidjua telemetry status

# Opt in (recommended — helps us fix bugs faster)
sidjua telemetry enable

# Opt out
sidjua telemetry disable

# Manually send buffered events (if server was temporarily down)
sidjua telemetry flush

# Reset local buffer and generate a new installation ID
sidjua telemetry reset --confirm
```

### Local Buffer and Offline Resilience

All error events are stored locally in `.system/telemetry.db` **before** any network request is made.
If the telemetry server is unavailable, events stay buffered locally (up to 100 events) and retry on
the next `report()` call or explicit `sidjua telemetry flush`. The installation never blocks waiting
for telemetry — all reporting is non-blocking and fire-and-forget.

### Installation ID

SIDJUA generates a random UUID on first `sidjua init` and stores it in `.system/telemetry.json`.
This ID is a random UUID with no relationship to any user account, email address, or machine identity.
It is used only to deduplicate reports from the same installation.

Run `sidjua telemetry reset --confirm` to regenerate it at any time.
