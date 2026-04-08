## Context

NUVEX's core platform (Sections 1–28) is deployed and operational. Maya runs on it. This
change addresses seven specific runtime gaps identified by analysing the Claude Code production
source — a large-scale agentic system that has shipped these patterns to millions of sessions. All
changes are additive or small amendments to existing modules. No container architecture changes,
no new gateway services, no breaking changes to divisions.yaml's existing fields.

The patterns are grouped by where they land in the NUVEX codebase:

| Pattern | Primary file | Amendment target |
|---|---|---|
| Diminishing returns stop | `src/brain/graph.py` | New conditional edge |
| Output style overlays | `src/brain/workspace.py` | System prompt assembly |
| Snip compaction | `src/brain/compaction.py` | New compaction mode |
| Permission denial learning | `src/brain/governance/*.py` + `state.py` | State + prompt builder |
| Tool schema locking | `src/brain/workspace.py` | Tool block assembly |
| Post-tool result masking | `src/brain/hooks.py` | HookResult type + pipeline |
| Agent coordination scratchpad | `src/brain/tools/executor.py` | Subprocess env |

**Constraints:**
- No new containers or docker-compose changes
- No breaking changes to existing `divisions.yaml` fields — all new fields are optional with
  safe defaults
- Changes must not touch governance pipeline internals (forbidden/approval/budget/classification
  nodes remain unchanged)
- All new DB objects must be Alembic migrations (no ad-hoc `CREATE TABLE`)

## Decisions

### 1. Token delta threshold: 500 tokens / 3 turns

**Choice:** Stop after 3+ consecutive turns where output token delta is < 500.

**Alternatives considered:**
- Fixed threshold only (current `max_turns`) — no adaptation to content quality
- 1-turn threshold — too aggressive; a tool call that returns a small result is not low-yield
- 5-turn threshold — too lenient; 5 wasted turns is 2,500+ wasted tokens

**Rationale:** Matches Claude Code's production value. 3 turns gives the model time to try a
different strategy before termination. 500 tokens is roughly one substantial paragraph; below
that is boilerplate or repetition.

### 2. Output styles: markdown overlay, not config object

**Choice:** Style files are plain markdown files (`workspace/styles/<name>.md` or inline in
`divisions.yaml` as a multi-line string reference). Loaded at session start and appended to
the system prompt after SOUL.md content.

**Alternatives considered:**
- Structured YAML style config — more rigid, harder for agents to edit
- Inline in SOUL.md — pollutes identity content with formatting instructions
- Per-message style injection — expensive, cache-busting

**Rationale:** Markdown files are consistent with the existing workspace file model. They can
be edited in the dashboard workspace editor without code changes. Appending after SOUL.md means
style instructions have higher effective priority (model pays more attention to later content).

### 3. Snip compaction: PostgreSQL for snip storage

**Choice:** Snip turn content stored in a new `thread_snips` table in PostgreSQL. The snip
selector is a small LLM call that reads the snip index and selects ≤3 snips to replay.

**Alternatives considered:**
- File-based snip storage — inconsistent with "all state in PostgreSQL" constraint
- In-memory snip cache — lost on brain restart
- Extend existing `messages` table — adds complexity to the messages schema

**Rationale:** A dedicated `thread_snips` table is narrow (thread_id, turn_index, token_count,
content, embedding) and cleanly separable from the main compaction path. The embedding column
enables semantic snip selection (rather than pure recency) — an upgrade path for Section 28's
retrieval model.

### 4. Denial learning: structured block injection, not tool blocklist

**Choice:** Denied actions written to `AgentState.denied_actions[]` as structured records
(`tool_name`, `reason`, `timestamp`, `governance_stage`). Injected as a `[DENIED]` markdown
block in the next system prompt build, above the tool list.

**Alternatives considered:**
- Tool blocklist — prevents the model from even generating the call. Too strong; the agent
  should be able to reason about why something was denied, not just be silently blocked.
- Error message only (current behaviour) — model sees "error: denied" but has no session-wide
  accumulation of what's off-limits.
- Per-turn re-injection — inject into user message turn rather than system prompt. Less
  reliable due to prompt cache sensitivity.

**Rationale:** System prompt injection is cache-friendly (the block only changes when denials
change). Structured records let the model distinguish "denied because budget" from "denied
because forbidden" — different adaptive strategies.

### 5. Tool schema locking: SHA-256 of sorted JSON

**Choice:** Serialize all tool schemas as sorted JSON (to ensure deterministic ordering),
SHA-256 hash the result, store in `AgentState.tool_schema_hash`. On each graph invocation,
recompute and compare; serve cached schema block if unchanged.

**Alternatives considered:**
- No locking (current behaviour) — regenerate every call, bust prompt cache unnecessarily
- Version counter — less robust to tool registration changes mid-session

**Rationale:** Direct match to Claude Code's approach. SHA-256 is fast and collision-resistant.
Storing in state means the hash survives restart if using PostgresSaver.

### 6. Result masking: PostToolUse hook fields, not a separate pipeline stage

**Choice:** Add `result_override: str | None` and `skip_model_feedback: bool` to `HookResult`.
The existing `HookRunner` in `hooks.py` checks these fields after each PostToolUse hook runs
and either replaces or suppresses the tool output before it enters the LLM message stream.

**Alternatives considered:**
- Separate "output sanitizer" pipeline stage — introduces a new graph node, touching graph.py
- Middleware on the LLM API call — harder to test, harder to audit
- Pre-governance filter — output sanitization should be after execution, not before

**Rationale:** Fits naturally into the existing hook model. The governance audit records the
*original* tool output (for integrity), while the result seen by the LLM is the masked version.
This is the safest design because it doesn't alter the audit chain.

### 7. Scratchpad: per-thread directory, auto-cleanup on archive

**Choice:** Create `data/threads/<thread_id>/scratch/` on first tool invocation in a thread.
Inject path as `NUVEX_SCRATCH_DIR` environment variable in subprocess tool environments. Delete
on thread archive (when `lifecycle` state reaches `Archived`).

**Alternatives considered:**
- Shared global scratch dir — agents from different threads would collide
- Agent-scoped scratch dir — two agents collaborating on the same thread need the same dir
- S3/object storage — too heavy for local scratch use case; violates single-VPS constraint

**Rationale:** Thread-scoped gives the natural isolation boundary (one task → one scratch space).
Env var injection is the most portable approach — any subprocess tool reads it without code
changes. Auto-cleanup prevents accumulation of stale scratch dirs.
