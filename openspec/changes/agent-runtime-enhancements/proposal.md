## Why

Analysis of the Claude Code source (yasasbanukaofficial-claude-code) — a production agentic
runtime — revealed seven runtime patterns that NUVEX does not yet implement. These are not
experimental ideas: they are battle-tested behaviours that Claude Code ships to millions of
sessions. Each addresses a distinct failure mode or operational gap in NUVEX's current runtime:

1. **Spinning agents**: NUVEX has a fixed `max_turns` cap but no detection of *low-yield* turns.
   An agent that produces 10 turns of boilerplate or "I am working on it…" responses before
   hitting the cap wastes tokens and budget with no signal. Claude Code stops after 3
   consecutive turns that each produce fewer than 500 new output tokens — a much cheaper
   signal than a hard turn limit.

2. **No communication style variation**: SOUL.md and IDENTITY.md give agents personality, but
   every agent of every type responds with the same verbosity and communication pattern. A
   customer-service agent and an internal dev agent should communicate very differently. Claude
   Code solves this with named Output Style overlays — separate from capability rules, applied
   as system-prompt additions per agent type.

3. **Flat compaction loses replay fidelity**: Section 18's compaction collapses old turns into
   a single summary. When an agent needs to recall a specific tool result from 3 hours ago, the
   summary may have compressed it into "deployed to staging". Claude Code's snip compaction
   keeps recent turns verbatim and replays *selective snapshots* of older turns from DB on
   demand — much higher fidelity at comparable token cost.

4. **Governance blocks but does not adapt the model**: When governance denies a tool action,
   the agent receives a generic error. It has no structured record of what was denied in this
   session, so it may attempt the same action 2–3 more times before giving up. Claude Code
   collects permission denials in session state and feeds them back on the next turn so the
   model reads the denial record and selects a different strategy immediately.

5. **Tool schema regeneration on every invocation**: NUVEX regenerates the full tool schema
   block on every graph invocation. For agents with many tools, this busts Anthropic's prompt
   cache on every turn when the schema hasn't changed. Claude Code locks the schema hash at
   session start and skips regeneration if the hash is unchanged — a direct cost and latency
   reduction.

6. **Post-tool outputs are never masked**: Tool outputs flow directly from the executor back into
   the LLM context. If a tool returns API keys, PII, or internal credentials (e.g. from an
   environment dump or a DB query), those tokens enter the model's context window and potentially
   the audit log verbatim. Claude Code's PostToolUse hooks can rewrite (`resultOverride`) or
   suppress (`skipModelFeedback`) tool outputs before they reach the model — an OWASP-relevant
   control.

7. **No per-thread shared workspace for multi-agent tasks**: When multiple agents collaborate
   on a task, they exchange everything through the messages channel. A shared scratch directory
   per thread — automatically mounted in tool contexts — allows workers to read/write
   intermediate artefacts (plans, partial outputs, structured data) without protocol overhead.
   Claude Code injects a coordinator scratchpad path into every worker context at spawn time.

## What Changes

- **NEW**: Diminishing returns stop logic — track output token deltas per turn; after 3+
  consecutive low-yield turns (< 500 output tokens), terminate the graph and emit a
  `halted.diminishing_returns` lifecycle event
- **NEW**: Output style overlays — named communication persona files loaded from
  `workspace/styles/*.md` or `divisions.yaml` `response_style` field, appended to system prompt
  after SOUL.md content
- **NEW**: Snip compaction — alternative to flat summary compaction; keeps recent N turns
  verbatim in context, stores full turn text in PostgreSQL, replays selector-chosen snippets on
  query. Additive to Section 18 (new `mode: "snip"` option)
- **NEW**: Permission denial learning — denied governance actions appended to
  `AgentState.denied_actions[]` and injected as a structured `[DENIED]` block in the next
  prompt turn; cleared on thread end
- **NEW**: Tool schema locking — compute a SHA-256 hash of the active tool schema set at
  thread start; cache the serialized schema in session state; skip regeneration when hash
  unchanged
- **NEW**: Post-tool result masking — `resultOverride` and `skipModelFeedback` return fields
  for PostToolUse hooks; built-in `PiiMaskHook` applies configurable regex/pattern redaction
  before tool output enters the LLM context
- **NEW**: Agent coordination scratchpad — per-thread temp directory
  (`data/threads/<thread_id>/scratch/`) auto-created on first invocation, path injected into
  tool execution context as `NUVEX_SCRATCH_DIR`; cleaned up on thread close

## Capabilities

### New Capabilities
- `diminishing-returns-stop`: Graph terminates on 3+ consecutive low-yield turns (< 500 tokens)
  before `max_turns` is reached; event emitted for observability
- `output-style-overlays`: Named `.md` style files define communication persona; loaded per-agent
  from workspace or divisions config; appended to system prompt at session build time
- `snip-compaction`: `mode: "snip"` in compaction config; recent N turns verbatim; older turns
  stored in DB with selector-driven snippet injection at query time
- `permission-denial-learning`: Denied governance decisions written to `AgentState.denied_actions`;
  injected as structured `[DENIED]` block in subsequent prompt turns
- `tool-schema-locking`: SHA-256 hash of tool schema set stored in thread state; schema block
  served from cache when hash unchanged
- `post-tool-result-masking`: `resultOverride` / `skipModelFeedback` semantics on PostToolUse
  hooks; built-in `PiiMaskHook` with configurable patterns per agent
- `agent-coordination-scratchpad`: Per-thread scratch dir auto-created; path injected as
  `NUVEX_SCRATCH_DIR` into all tool subprocess environments; cleaned on thread archive

### Modified Capabilities
- `session-compaction`: **AMENDMENT** — new `mode: "snip"` option alongside existing `safeguard`
  / `manual` / `disabled`; snip mode stores full turn history in `thread_snips` table
- `tool-hooks`: **AMENDMENT** — PostToolUse `HookResult` gains `result_override: str | None`
  and `skip_model_feedback: bool` fields; hook pipeline respects these before inserting tool
  output into LLM message stream
- `brain-state`: **AMENDMENT** — `AgentState` gains `denied_actions: list[DeniedAction]`,
  `low_yield_turns: int`, and `tool_schema_hash: str | None` fields

## Impact

- **Brain service**: `src/brain/state.py` gains 3 new fields; `src/brain/graph.py` gains
  diminishing-returns conditional edge; `src/brain/compaction.py` gains snip mode;
  `src/brain/hooks.py` gains result masking fields; `src/brain/workspace.py` gains style overlay
  injection; `src/brain/tools/executor.py` gains `NUVEX_SCRATCH_DIR` env injection
- **Governance**: `src/brain/governance/*.py` — each denial writes a `DeniedAction` record into
  state; no structural pipeline change
- **Config**: `AgentDefinition` gains `response_style: str | None` and `pii_patterns: list[str]`
  fields in `divisions.yaml`
- **Database**: New table `thread_snips` for snip compaction; no other schema changes
- **Dashboard**: No immediate dashboard changes; `denied_actions` visible in existing audit log;
  snip compaction stats visible in existing thread view
- **Governance guarantee**: Unaffected — result masking runs AFTER governance, AFTER execution.
  It controls what the LLM sees, not what gets audited.
