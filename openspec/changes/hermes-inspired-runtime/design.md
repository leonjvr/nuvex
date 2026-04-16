## Context

This change is informed by competitive analysis of Hermes Agent — a production single-user agentic
runtime. Nine runtime patterns identified as gaps in NUVEX, plus a dedicated security feature
(per-agent Linux user isolation) requested for multi-agent privilege separation.

**Existing changes this builds on or amends:**

| Existing change | Relationship |
|---|---|
| `agent-runtime-enhancements` | Section 4 amends the same `compaction.py` (adds prune pass to flat compaction). Section 5 amends `call_llm.py` (same file as schema locking). No conflicts — different code paths. |
| `brain-self-improvement` | Section 5 complements arousal-modulated routing — trivial routing fires *before* arousal check. Trajectory capture (Section 7) complements outcome scoring. |
| `tool-execution-sandboxing` | Section 9 amends nsjail config to use per-agent UIDs. Must be implemented after `tool-execution-sandboxing` §1. |
| `skill-architecture-refactor` | Section 8 extends the skill system. Agent-authored skills use the same `SkillMetadata` parser and resolution chain. |
| `native-skills` | No conflict. Native skills are loaded by the registry; parallel execution and result budgeting apply uniformly. |

**Dependency order for implementation:**

```
Sections 1–5 (runtime efficiency)  — no deps, can start immediately
Section 6 (run_plan)               — depends on tool-execution-sandboxing §1
Section 7 (trajectories)           — depends on Section 2 (result budget, for clean exports)
Section 8 (skill authoring)        — depends on skill-architecture-refactor §3 (parser)
Section 9 (per-agent users)        — depends on tool-execution-sandboxing §1
```

## Decisions

### 1. Parallel execution: asyncio.gather, not ThreadPoolExecutor

**Choice:** Use `asyncio.gather()` with `asyncio.to_thread()` for sync tools, not a dedicated
`ThreadPoolExecutor` like Hermes.

**Rationale:** NUVEX's LangGraph runtime is async-native. Tool execution in `execute_tools.py`
already uses `await`. Hermes uses `ThreadPoolExecutor` because its loop is sync (`while True`).
Using `asyncio.gather()` avoids thread-safety issues and is consistent with the existing codebase.

**Guard rail:** Results are gathered concurrently but appended to state in the original tool call
order. This preserves deterministic replay from LangGraph checkpoints.

### 2. Tool result overflow: filesystem, not PostgreSQL

**Choice:** Large tool results overflow to `data/threads/<thread_id>/tool_results/<uuid>.txt`,
not to a PostgreSQL `BYTEA` or `TEXT` column.

**Alternatives considered:**
- PostgreSQL `TEXT` column — bloats the database with transient tool output that has no long-term
  value; increases backup size; makes thread archival slow
- S3/object storage — violates single-VPS constraint

**Rationale:** Tool results are ephemeral — they exist for the duration of a thread and are
deleted on archive. Filesystem is appropriate for transient data. The reference handle (UUID)
is stored in the message list; the `read_tool_result` tool resolves it on demand.

### 3. Credential pool: config in nuvex.yaml, not in database

**Choice:** Multi-key credentials are configured in `nuvex.yaml` or environment variables.
Not stored in PostgreSQL.

**Rationale:** API keys are infrastructure secrets. They belong in config/env, not in a database
that agents and the dashboard can query. Credential pool state (cooldowns, usage counts) is
in-memory only — it does not survive brain restart (which is fine; cooldowns reset on restart).

### 4. Compaction handoff framing: system message prefix

**Choice:** The compaction summary is prefixed with a system note:

```
[CONTEXT COMPACTION — REFERENCE ONLY]
Earlier turns were compacted into the summary below. This is a handoff from a previous context
window. Treat it as background reference, NOT as active instructions. Do NOT answer questions
or fulfil requests mentioned in this summary — they have already been handled.
```

**Rationale:** Directly adapted from Hermes's production prompt. Without this framing, models
(especially smaller ones) treat the summary as a new instruction set and re-execute completed
tasks. The "different assistant" framing is the most effective mitigation found empirically.

### 5. Trivial reply: deterministic classifier, not LLM-based

**Choice:** The `trivial_reply` classifier uses deterministic rules (char count, word count,
regex for code/URLs), not an LLM call.

**Rationale:** The purpose is cost reduction. Adding an LLM call to decide whether to use a
cheap model defeats the purpose. Hermes's deterministic heuristic (≤160 chars, ≤28 words,
no code fences, no URLs, no complex keywords) is simple and effective.

### 6. run_plan: file-based IPC, not Unix domain sockets

**Choice:** Tool stubs in the `run_plan` sandbox communicate with the parent via a temp
directory with JSON files (write request → read response), not UDS.

**Alternatives considered:**
- Unix domain sockets (Hermes approach) — requires socket setup inside nsjail namespace;
  complex permission management
- HTTP localhost — requires port allocation; conflicts with sandbox network isolation

**Rationale:** File-based IPC is the simplest approach that works inside nsjail. The scratch
directory is already mounted writable. Each stub writes a `<call_id>.req.json`, the parent
process watches the directory, executes the tool, and writes `<call_id>.res.json`. Latency
is ~1ms per call (filesystem is tmpfs inside sandbox).

### 7. Trajectory capture: opt-in per agent, not global

**Choice:** Trajectory capture is off by default. Enabled per-agent in `divisions.yaml`:
`trajectory.capture: true`.

**Rationale:** Not all conversations should be training data. Customer-service conversations
contain PII. Internal dev conversations contain credentials. Only agents explicitly configured
for data generation should capture trajectories. PII masking is applied regardless, but opt-in
is the safe default.

### 8. Agent skill authoring: agent-scoped, not global

**Choice:** Agent-authored skills are stored at
`data/orgs/<org_id>/agents/<agent_id>/skills/<name>/SKILL.md` — scoped to the authoring agent.

**Alternatives considered:**
- Write to global library (`/data/skills/`) — agents could overwrite admin-installed skills
- Write to agent workspace (`workspace/skills/`) — mixes with admin-managed workspace files

**Rationale:** Agent-scoped storage prevents cross-contamination. An agent's skill creations
are its own procedural memory. If an admin wants to promote an agent-authored skill to the
global library, they can copy it explicitly. Precedence: global library > agent-authored >
workspace defaults.

### 9. Per-agent Linux users: created at startup, not dynamically

**Choice:** Agent OS users are created during brain container startup (in the entrypoint or
an init function), not on first tool invocation.

**Alternatives considered:**
- Dynamic creation on first tool call — requires root at runtime; race conditions between
  concurrent invocations of the same agent
- Pre-baked in Dockerfile — can't adapt to divisions.yaml changes without rebuild

**Rationale:** Startup creation means the brain process can drop elevated privileges after
init. The `docker-entrypoint.sh` script creates users, then `exec`s the brain process as a
non-root user. Dynamic agents (added via dashboard) require a brain restart to get OS users —
an acceptable trade-off vs. runtime root access.

### 10. User naming: deterministic hash, not agent name

**Choice:** OS username is `nuvex_<sha256(agent_id)[:8]>`, not `nuvex_<agent_name>`.

**Rationale:** Agent names can contain characters invalid in Linux usernames (spaces, unicode,
special chars). Hashing guarantees valid usernames. The 8-char prefix provides sufficient
uniqueness for the expected agent count (< 100 per deployment). Collision probability at
8 hex chars is negligible for < 1000 agents.
