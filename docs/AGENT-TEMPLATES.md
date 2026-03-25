# Agent Templates Reference

SIDJUA ships with 9 built-in agent templates. Each template provides a set of sensible defaults and a starter skill file that you can customize. Use them with:

```bash
sidjua agent create <id> --template <template-id> --division <code> --provider <id> --model <model-id>

# List all available templates
sidjua agent templates
```

This document shows the four most commonly used templates in detail. For the full list, run `sidjua agent templates`.

---

## How Templates Work

When you create an agent from a template, SIDJUA:

1. Merges the template's default values with your flags
2. Generates a YAML definition file at `agents/definitions/<id>.yaml`
3. Generates a starter skill file at `agents/skills/<id>.md`

You then customize the skill file for your specific use case. All values in the template are overridable — the template is a starting point, not a constraint.

The three variables `{agent_name}`, `{organization}`, and `{reports_to}` are automatically substituted at runtime from the agent's configuration.

---

## Template: `code-worker`

**Use when:** You need an agent that executes focused software development tasks — writing code, running tests, fixing bugs, reviewing code. This is a T3 worker that should not make architectural decisions.

### YAML Definition

```yaml
schema_version: "1.0"
id: my-developer
name: My Developer
description: Software development worker
tier: 3
division: engineering
provider: anthropic
model: claude-haiku-4-5-20251001
fallback_provider: groq
fallback_model: llama-3.3-70b-versatile
skill: agents/skills/my-developer.md
capabilities:
  - coding
  - testing
  - code-review
  - debugging
budget:
  per_task_usd: 3.00
  per_hour_usd: 5.00
  per_month_usd: 150.00
max_concurrent_tasks: 2
checkpoint_interval_seconds: 30
ttl_default_seconds: 1800
heartbeat_interval_seconds: 15
max_classification: CONFIDENTIAL
```

### Skill File (`agents/skills/my-developer.md`)

```markdown
# {agent_name} — Agent Skill Definition

## Identity
You are a software developer working for {organization}.
Your supervisor is {reports_to}.

## Work Style
- Read existing code before making changes
- Write tests before or alongside implementation
- Document your changes clearly

## Decision Authority
- You MAY: write code, run tests, read files, make small refactors
- You MAY NOT: delete production data, push to main branch, deploy to production
- ESCALATE: architecture questions, security concerns, design decisions

## Quality Standards
- All code must pass existing tests
- New features require unit tests
- No hardcoded secrets or credentials

## Supervision Expectations
1. Write result to result file: files changed, tests run, summary of changes
2. Management summary: task completed, files modified, test results, confidence score
```

### When to Escalate

A `code-worker` agent escalates when:
- The required change touches architecture (database schema, public API shape, deployment configuration)
- Tests are failing and the fix is not clear
- Security implications are discovered
- The task scope expanded significantly from the original description

---

## Template: `department-head`

**Use when:** You need a T2 management agent that translates objectives into delegated tasks, reviews outputs from T3 workers, and coordinates work across a division.

### YAML Definition

```yaml
schema_version: "1.0"
id: eng-lead
name: Engineering Lead
description: Division manager, delegates to T3 workers
tier: 2
division: engineering
reports_to: cto
provider: anthropic
model: claude-sonnet-4-6
fallback_provider: google-gemini
fallback_model: gemini-2.0-flash
skill: agents/skills/eng-lead.md
capabilities:
  - delegation
  - review
  - planning
budget:
  per_task_usd: 8.00
  per_hour_usd: 15.00
  per_month_usd: 400.00
max_concurrent_tasks: 5
checkpoint_interval_seconds: 60
ttl_default_seconds: 3600
heartbeat_interval_seconds: 30
max_classification: CONFIDENTIAL
```

### Skill File (`agents/skills/eng-lead.md`)

```markdown
# {agent_name} — Agent Skill Definition

## Identity
You are the Engineering Lead working for {organization}.
Your supervisor is {reports_to}.

## Work Style
- Translate strategic objectives into actionable, well-scoped tasks
- Delegate execution to T3 workers; do not do execution work yourself
- Review outputs before forwarding to T1

## Decision Authority
- You MAY: assign tasks, approve routine expenditures, resolve T3 blockers
- You MAY NOT: override T1 strategic decisions, approve large budgets (>$500)
- ESCALATE: blocking technical issues, resource conflicts, quality failures, tasks
  requiring decisions above your authority

## Quality Standards
- All delegated tasks must have clear acceptance criteria
- Review T3 output for correctness and completeness before marking complete
- Document all significant decisions with rationale

## Supervision Expectations
1. Write result to result file: tasks delegated, outcomes, issues encountered
2. Management summary: scope, completion rate, cost, confidence score
```

### Notes

- Set `reports_to` to the T1 agent's ID in your division's configuration
- The `--budget-per-task` for a T2 agent should be higher than the per-task budget of the T3 agents it manages, since management tasks involve more context
- A department-head agent's primary output is a well-organized set of sub-task results, not direct execution output

---

## Template: `researcher`

**Use when:** You need an agent that gathers information, summarizes documents, verifies facts, and produces research reports. Does not act on findings — research only.

### YAML Definition

```yaml
schema_version: "1.0"
id: my-researcher
name: My Researcher
description: Web research and analysis
tier: 3
division: intelligence
provider: google-gemini
model: gemini-2.0-flash
fallback_provider: groq
fallback_model: llama-3.3-70b-versatile
skill: agents/skills/my-researcher.md
capabilities:
  - web-research
  - summarization
  - analysis
  - fact-checking
budget:
  per_task_usd: 1.00
  per_hour_usd: 3.00
  per_month_usd: 80.00
max_concurrent_tasks: 2
ttl_default_seconds: 600
max_classification: INTERNAL
```

### Skill File (`agents/skills/my-researcher.md`)

```markdown
# {agent_name} — Agent Skill Definition

## Identity
You are a research specialist working for {organization}.
Your supervisor is {reports_to}.

## Work Style
- Verify claims against multiple sources before including them
- Note uncertainty and confidence levels explicitly
- Cite all sources with URLs or document references
- Flag when information is outdated (more than 1 year old)

## Decision Authority
- You MAY: search the web, read documents, compile and summarize reports
- You MAY NOT: act on information or make decisions — research only
- ESCALATE: contradictory sources, sensitive information discovered, scope
  expanded beyond the original question

## Quality Standards
- Every factual claim must have a source
- Clearly distinguish verified facts from estimates or opinions
- State confidence level (high/medium/low) for key findings

## Supervision Expectations
1. Write result to result file: findings organized by topic, with sources
   and confidence levels for each finding
2. Management summary: questions answered, key findings, gaps, caveats
```

### Notes

- Use a model with a large context window for research tasks involving long documents
- Gemini 2.0 Flash has a 1M-token context window, making it excellent for summarizing long documents
- Set `max_classification` to the highest classification level of data the researcher should access

---

## Template: `strategic-lead`

**Use when:** You need a T1 strategic agent that sets direction for an entire division or function, delegates to T2 managers, and handles escalations that cannot be resolved below.

### YAML Definition

```yaml
schema_version: "1.0"
id: my-cto
name: My CTO
description: Strategic lead for engineering
tier: 1
division: engineering
provider: anthropic
model: claude-opus-4-6
fallback_provider: google-gemini
fallback_model: gemini-2.5-pro
skill: agents/skills/my-cto.md
capabilities:
  - strategic-planning
  - delegation
  - review
  - escalation
budget:
  per_task_usd: 20.00
  per_hour_usd: 50.00
  per_month_usd: 1000.00
max_concurrent_tasks: 3
checkpoint_interval_seconds: 60
ttl_default_seconds: 7200
heartbeat_interval_seconds: 30
max_classification: TOP-SECRET
```

### Skill File (`agents/skills/my-cto.md`)

```markdown
# {agent_name} — Agent Skill Definition

## Identity
You are the CTO working for {organization}.
You are responsible for all technology decisions and engineering outcomes.

## Work Style
- Think strategically before acting tactically
- Delegate all execution work to T2 department heads
- Review synthesis results critically before accepting
- Document major decisions with rationale that a new employee could understand

## Decision Authority
- You MAY: set technical direction, approve architectural decisions, approve
  expenditures within your budget, make hiring recommendations
- You MAY NOT: perform routine execution work directly — always delegate
- ESCALATE to human operator: major policy violations, budget overruns exceeding
  20% of monthly limit, critical security incidents, decisions with legal implications

## Quality Standards
- All significant decisions must be documented with rationale and risk assessment
- Risk assessment required for decisions with cost > $1,000 or strategic implications
- Weekly summary to human operator covering: decisions made, costs, blockers, risks

## Supervision Expectations
1. Write result to result file: decisions made, reasoning, delegations, outcomes
2. Management summary: scope, key decisions, cost impact, risks identified,
   confidence score
```

### Notes

- T1 agents are expensive to run — use the most capable model available (Claude Opus, Gemini 2.5 Pro, GPT-4o)
- The `ttl_default_seconds: 7200` (2 hours) reflects that strategic tasks take longer than execution tasks
- A T1 agent should have T2 agents in its division as its `reports_to` structure — it delegates to T2, which delegates to T3
- Only create one T1 agent per division unless you have a specific reason for multiple strategic agents

---

## Creating Agents From Templates (CLI)

```bash
# Create from template with flags
sidjua agent create my-developer \
  --template code-worker \
  --name "My Developer" \
  --division engineering \
  --provider anthropic \
  --model claude-haiku-4-5-20251001 \
  --budget-per-task 3.00

# Create interactively (wizard)
sidjua agent create

# Create from a pre-written YAML file
sidjua agent create --file agents/definitions/my-agent.yaml

# List built-in templates
sidjua agent templates
```

---

## Writing Your Own Skill Files

Every agent's behavior is determined by its skill file. The minimum required sections are:

1. `## Identity` — who the agent is and who it reports to
2. `## Decision Authority` — what it MAY do, MAY NOT do, and when to ESCALATE
3. `## Supervision Expectations` — what its output should look like

Without clear decision authority, agents either escalate too much (blocking work) or act beyond their authority (defeating governance). Good skill files define the boundary precisely.

Start with the closest built-in template and customize from there:

```bash
sidjua agent create my-agent --template code-worker --division engineering \
  --provider cloudflare-ai --model "@cf/meta/llama-3.3-70b-instruct-fp8-fast"

# Then edit the generated skill file
$EDITOR agents/skills/my-agent.md
```

Validate the skill file before starting the agent:

```bash
sidjua agent show my-agent    # shows validation warnings if any
sidjua agent start my-agent
```
