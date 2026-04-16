# hermes-inspired-runtime — Task List

## Prerequisites

- [x] 0.1 Read all spec files in `specs/` before implementing any section
- [x] 0.2 Verify `tool-execution-sandboxing` §1 status (required for Sections 6 and 9)
- [ ] 0.3 Verify `skill-architecture-refactor` §3 status (required for Section 8)

---

## Section 1 — Parallel Tool Execution

> Spec: `specs/parallel-tool-execution/spec.md`
>
> Concurrent execution of read-only tools within a single LLM turn batch.
> No external dependencies — can start immediately.
>
> **Priority: HIGH** — Direct latency reduction on every multi-tool turn.

- [x] 1.1 Create `src/brain/tools/parallel.py` — define `ToolClassification` enum (`PARALLEL_SAFE`, `SEQUENTIAL`); implement `classify_tool(tool_name, tool_schema) -> ToolClassification` using a default safelist + MCP `readOnly` tag check
- [x] 1.2 Implement `execute_parallel_batch(tool_calls, classify_fn, max_concurrency) -> list[ToolResult]` using `asyncio.gather()` with `asyncio.Semaphore(max_concurrency)` for the parallel-safe subset; sequential tools run after parallel batch completes
- [x] 1.3 Ensure results are re-ordered to match original tool call order regardless of completion time
- [x] 1.4 Add `ParallelConfig` to `src/shared/models/config.py` — `enabled: bool = True`, `max_concurrency: int = 8`, `safe_tools: list[str]` with defaults
- [x] 1.5 Amend `src/brain/nodes/execute_tools.py` — replace sequential tool execution loop with `execute_parallel_batch()` call; pass config from nuvex.yaml
- [x] 1.6 Handle exceptions in parallel tools: capture as `ToolMessage(content=error_str)`, do not cancel sibling tasks
- [x] 1.7 Add `tools.parallel` config block to `config/nuvex.yaml` with documented defaults
- [x] 1.8 Write unit test: 3 parallel-safe tools complete in ~max(durations), not sum
- [x] 1.9 Write unit test: mixed batch — parallel tools run first, sequential tools run after
- [x] 1.10 Write unit test: result order matches original call order even when tool B finishes before tool A
- [x] 1.11 Write unit test: exception in one parallel tool does not affect others
- [x] 1.12 Write unit test: `enabled: false` falls back to fully sequential execution

---

## Section 2 — Tool Result Budget & Reference Handles

> Spec: `specs/tool-result-budget/spec.md`
>
> 3-layer output budget to prevent context window blowout.
> No external dependencies — can start immediately.
>
> **Priority: HIGH** — Prevents the #1 cause of wasted context tokens.

- [x] 2.1 Create `src/brain/tools/result_budget.py` — `enforce_tool_budget(tool_name, output, config) -> tuple[str, ToolResultReference | None]` that truncates at `max_result_chars` and writes overflow to file
- [x] 2.2 Implement `enforce_turn_budget(tool_results, config) -> list[str]` that replaces oldest results with reference handles until aggregate chars < `turn_budget_chars`
- [x] 2.3 Implement `save_overflow(thread_id, tool_name, content) -> ToolResultReference` — writes to `data/threads/<thread_id>/tool_results/<uuid>.txt`, returns reference
- [x] 2.4 Implement `read_overflow(handle) -> str` — validates handle is UUID (no path traversal), reads file, returns content truncated to `max_result_chars`
- [x] 2.5 Create `src/brain/tools/read_tool_result.py` — `read_tool_result(handle: str, offset: int = 0) -> str` built-in tool; reads from overflow file with offset support
- [x] 2.6 Add `ResultBudgetConfig` to `src/shared/models/config.py` — `enabled: bool = True`, `default_max_chars: int = 30000`, `turn_budget_chars: int = 200000`, `per_tool: dict[str, int]`
- [x] 2.7 Add `max_result_chars: int | None` field to tool registration in `src/brain/tools_registry.py`
- [x] 2.8 Amend `src/brain/nodes/execute_tools.py` — wrap each tool result through `enforce_tool_budget()` after execution; call `enforce_turn_budget()` after all tools in a turn
- [ ] 2.9 Amend `src/brain/nodes/lifecycle.py` — delete `data/threads/<thread_id>/tool_results/` directory on thread archive
- [x] 2.10 Write unit test: output > max_result_chars is truncated and reference created
- [x] 2.11 Write unit test: output ≤ max_result_chars passes through unchanged
- [x] 2.12 Write unit test: turn budget enforcement replaces oldest result first
- [x] 2.13 Write unit test: `read_tool_result` with valid handle returns content
- [x] 2.14 Write unit test: `read_tool_result` with invalid handle (path traversal attempt) returns error
- [x] 2.15 Write unit test: reference file cleanup on thread archive

---

## Section 3 — Multi-Credential Failover Pool

> Spec: `specs/multi-credential-failover/spec.md`
>
> Multiple API keys per provider with automatic rotation and cooldown.
> No external dependencies — can start immediately.
>
> **Priority: HIGH** — Production resilience for burst traffic.

- [x] 3.1 Create `src/brain/llm/credential_pool.py` — `CredentialPool` class with `__init__(provider, keys, strategy, cooldown_minutes)`, `get_key() -> str`, `report_failure(key, status_code)`, `report_success(key)`, `all_exhausted() -> bool`
- [x] 3.2 Implement `fill_first` strategy: use first non-cooldown key; only advance on failure
- [x] 3.3 Implement `round_robin` strategy: cycle through non-cooldown keys on each `get_key()` call
- [x] 3.4 Implement `random` strategy: random selection among non-cooldown keys
- [x] 3.5 Implement cooldown tracking: `report_failure()` with HTTP 429 or 402 puts key on cooldown for `cooldown_minutes`; key auto-reactivates after cooldown expires
- [x] 3.6 Add `CredentialPoolConfig` to `src/shared/models/config.py` — per-provider config block
- [x] 3.7 Create `src/brain/llm/__init__.py` — pool registry that loads pools from `nuvex.yaml` at startup
- [ ] 3.8 Amend `src/brain/nodes/call_llm.py` — resolve API key via `CredentialPool.get_key()` instead of direct `os.environ.get()`; on LLM API error with 429/402, call `report_failure()` and retry with next key
- [x] 3.9 Add `CredentialExhausted` to failure taxonomy in `src/brain/recovery.py`; map to `switch_fallback_model` recipe
- [x] 3.10 Emit `credential.cooldown` event to event bus on each cooldown event (provider, key_index — NOT the key itself)
- [x] 3.11 Ensure API keys are never logged: audit all log statements in credential_pool.py and call_llm.py
- [x] 3.12 Write unit test: single-key config works transparently (pool with 1 key)
- [x] 3.13 Write unit test: 429 on key A → automatic retry with key B succeeds
- [x] 3.14 Write unit test: all keys exhausted → `CredentialExhausted` raised
- [x] 3.15 Write unit test: cooldown expiry → key becomes available again
- [x] 3.16 Write unit test: round_robin cycles through keys in order
- [x] 3.17 Write unit test: API key is never present in any log message or event payload

---

## Section 4 — Compaction Improvements

> Spec: `specs/compaction-improvements/spec.md`
>
> Prune-before-compress and handoff framing for flat compaction.
> No external dependencies — can start immediately.
>
> **Priority: MEDIUM** — Cost reduction on every compaction event.

- [x] 4.1 Implement `_prune_tool_results(messages, preserve_recent) -> list[BaseMessage]` in `src/brain/compaction.py`: replace tool result messages older than `preserve_recent` with `[Tool output cleared to save context space]`; skip human and system messages
- [x] 4.2 Call `_prune_tool_results()` before the existing LLM summarization call in `CompactionEngine.compact()`
- [x] 4.3 Update the summarization prompt to use the structured template (Resolved / Pending / Remaining Work sections) with handoff framing prefix
- [x] 4.4 Implement iterative summary update: if the thread already has a `[CONTEXT COMPACTION]` system message, update it in-place rather than creating a new one
- [x] 4.5 Ensure prune pass does not touch messages within `preserve_recent` window
- [x] 4.6 Write unit test: tool result messages older than `preserve_recent` are replaced with placeholder
- [x] 4.7 Write unit test: human and system messages are never pruned
- [x] 4.8 Write unit test: compaction summary includes handoff framing prefix
- [x] 4.9 Write unit test: second compaction updates existing summary rather than creating nested summary
- [x] 4.10 Write unit test: prune pass reduces token count (compare before/after)

---

## Section 5 — Auxiliary Model Routing

> Spec: `specs/auxiliary-model-routing/spec.md`
>
> Route background tasks to fast model; add trivial_reply classification.
> No external dependencies — can start immediately.
>
> **Priority: MEDIUM** — Ongoing cost reduction on every thread.

- [x] 5.1 Create helper `get_auxiliary_model(agent_config) -> str` in `src/brain/nodes/call_llm.py`: returns `agent.model.fast` if configured, else `agent.model.primary`
- [x] 5.2 Amend `src/brain/memory/consolidator.py` — use `get_auxiliary_model()` for the consolidation LLM call
- [x] 5.3 Amend `src/brain/compaction.py` — use `get_auxiliary_model()` for the summarization LLM call
- [x] 5.4 Amend `src/brain/jobs/language_gradient.py` — use `get_auxiliary_model()` for the reflection LLM call
- [x] 5.5 Add `trivial_reply` to task type enum in `src/brain/routing/classifier.py`
- [x] 5.6 Implement trivial_reply classifier: deterministic rules (≤160 chars, ≤28 words, no code fences, no URLs, no complex keywords)
- [x] 5.7 Add `TrivialReplyConfig` to `src/shared/models/config.py` — `enabled: bool = True`, `max_chars: int = 160`, `max_words: int = 28`, `complex_keywords: list[str]`
- [x] 5.8 Amend `src/brain/routing/router.py` — `trivial_reply` classification forces `model.fast` tier
- [x] 5.9 Add arousal override: if arousal > 0.75, bypass trivial routing
- [x] 5.10 Write unit test: "hello" classified as `trivial_reply`; "explain the governance pipeline in detail" is not
- [x] 5.11 Write unit test: message with URL is not trivial; message with code fence is not trivial
- [x] 5.12 Write unit test: consolidator uses fast model when configured
- [x] 5.13 Write unit test: arousal > 0.75 bypasses trivial routing

---

## Section 6 — Programmatic Tool Calling

> Spec: `specs/programmatic-tool-calling/spec.md`
>
> `run_plan` tool for multi-tool Python scripts in a single LLM turn.
> **Depends on:** `tool-execution-sandboxing` §1 (SandboxExecutor)
>
> **Priority: MEDIUM** — High impact for complex multi-step agent workflows.

- [ ] 6.1 Create `src/brain/tools/run_plan_stubs.py.template` — Jinja2 template that generates Python stub functions from a list of tool schemas; each stub writes `.req.json`, polls for `.res.json`
- [ ] 6.2 Create `src/brain/tools/run_plan.py` — `run_plan(script: str) -> str` tool:
  - Generate stub module from template using agent's active tool set
  - Create temp IPC directory
  - Launch script in sandbox with stub module on PYTHONPATH
  - Parent process watches for `.req.json` files, executes tools through governance, writes `.res.json`
  - Collect stdout after script completes
  - Return stdout as tool result
- [ ] 6.3 Implement IPC watcher: async loop polling temp directory at 10ms; routes each request through full governance pipeline; enforces 50-call budget
- [ ] 6.4 Implement 120-second script timeout (configurable)
- [ ] 6.5 Amend `src/brain/nodes/execute_tools.py` — refund iteration budget when tool is `run_plan`
- [ ] 6.6 Amend `src/brain/governance/classification.py` — classify `run_plan` as `DataClass.RESTRICTED`
- [ ] 6.7 Log all intermediate tool calls from within the script to governance audit trail
- [ ] 6.8 Write unit test: script with 3 `read_file` stubs completes in 1 LLM turn; all 3 files read
- [ ] 6.9 Write unit test: governance denial inside script returns error string to stub; script continues
- [ ] 6.10 Write unit test: 51st tool call raises `PlanBudgetExceeded`
- [ ] 6.11 Write unit test: script syntax error returns traceback as tool result
- [ ] 6.12 Write unit test: iteration budget is refunded for `run_plan` turns

---

## Section 7 — Trajectory Capture Pipeline

> Spec: `specs/trajectory-capture/spec.md`
>
> ShareGPT-format training data export with quality gating.
> **Depends on:** Section 2 (result budget — for clean exports without overflow handles)
>
> **Priority: LOW** — Foundation for future fine-tuning, not blocking runtime.

- [ ] 7.1 Create `src/brain/trajectories/__init__.py` package
- [ ] 7.2 Create `src/brain/trajectories/capture.py` — `save_trajectory(thread_id, agent_id, state) -> Path`:
  - Load thread messages from DB
  - Format as ShareGPT JSONL with `<tool_call>` / `<tool_response>` XML wrapping
  - Compute `tool_stats` per-tool counts
  - Apply PII masking (email, phone, agent pii_patterns)
  - Write to `data/trajectories/<agent_id>/<YYYY-MM-DD>/<thread_id>.jsonl`
- [ ] 7.3 Create `src/brain/trajectories/quality_gate.py` — `passes_quality_gate(conversations) -> bool`: returns True if any `gpt` turn contains reasoning tokens
- [ ] 7.4 Route rejected trajectories to `data/trajectories/<agent_id>/rejected/`
- [ ] 7.5 Create `src/brain/trajectories/compressor.py` — `compress_trajectory(path, target_tokens, model) -> Path`:
  - Tokenize with tiktoken
  - Protect first system, first human, first gpt, last 4 turns
  - Summarize middle with fast model
  - Write `_compressed.jsonl`
- [ ] 7.6 Add `TrajectoryConfig` to `src/shared/models/config.py`
- [ ] 7.7 Amend `src/brain/nodes/lifecycle.py` — if `trajectory.capture: true`, spawn background task `save_trajectory()` after lifecycle_end
- [ ] 7.8 Create `src/brain/routers/trajectories.py` — `GET /api/v1/trajectories/export` with query params: `agent_id`, `date_from`, `date_to`, `quality` (passed/rejected)
- [ ] 7.9 Write unit test: trajectory written in correct ShareGPT format
- [ ] 7.10 Write unit test: tool calls wrapped in `<tool_call>` XML
- [ ] 7.11 Write unit test: PII masking redacts email and phone patterns
- [ ] 7.12 Write unit test: quality gate passes trajectory with reasoning; rejects trajectory without
- [ ] 7.13 Write unit test: compression protects head and tail, summarizes middle
- [ ] 7.14 Write unit test: capture disabled → no trajectory file written (zero overhead)

---

## Section 8 — Agent Skill Authoring

> Spec: `specs/agent-skill-authoring/spec.md`
>
> Agents can create, edit, delete their own SKILL.md files.
> **Depends on:** `skill-architecture-refactor` §3 (skill parser)
>
> **Priority: MEDIUM** — Enables agent self-improvement through procedural memory.

- [ ] 8.1 Create `src/brain/skills/security.py` — extract prompt injection scanner from `workspace.py` into standalone `scan_content(content) -> tuple[bool, str | None]` function; return (safe, reason)
- [ ] 8.2 Create `src/brain/tools/skill_manage.py` — `skill_manage(action, name, content?, patch_old?, patch_new?) -> str` tool:
  - `create`: validate name (kebab-case, 3–50 chars), scan content, create directory + SKILL.md
  - `edit`: verify skill exists and is agent-authored, scan content, overwrite SKILL.md
  - `patch`: verify skill exists, find-and-replace in SKILL.md, scan result
  - `delete`: verify skill is agent-authored, remove directory
- [ ] 8.3 Enforce 50,000 char content limit
- [ ] 8.4 Enforce agent can only modify skills in its own `data/orgs/<org_id>/agents/<agent_id>/skills/` directory — reject attempts to modify global or other-agent skills
- [ ] 8.5 Amend `src/brain/skills/resolver.py` — add agent-authored path (`data/orgs/<org_id>/agents/<agent_id>/skills/`) to resolution chain between global library and workspace defaults
- [ ] 8.6 Register `skill_manage` in `src/brain/tools_registry.py` for T1 and T2 agents only
- [ ] 8.7 Write unit test: create skill → SKILL.md exists with correct content
- [ ] 8.8 Write unit test: edit overwrites existing content
- [ ] 8.9 Write unit test: patch performs find-and-replace
- [ ] 8.10 Write unit test: delete removes directory
- [ ] 8.11 Write unit test: content with prompt injection patterns is rejected
- [ ] 8.12 Write unit test: T3 agent cannot invoke skill_manage
- [ ] 8.13 Write unit test: agent cannot modify another agent's skills (path traversal protection)
- [ ] 8.14 Write unit test: skill resolution picks agent-authored skill with correct precedence

---

## Section 9 — Per-Agent Linux User Isolation

> Spec: `specs/per-agent-linux-user/spec.md`
>
> Each agent gets a dedicated Linux user for subprocess isolation.
> **Depends on:** `tool-execution-sandboxing` §1 (SandboxExecutor for nsjail integration)
>
> **Priority: HIGH** — Minimum viable privilege separation for multi-agent.

- [ ] 9.1 Create `src/brain/sandbox/user_isolation.py`:
  - `compute_username(agent_id) -> str` — `nuvex_<sha256(agent_id)[:8]>`
  - `ensure_agent_user(agent_id, base_uid=2000) -> AgentUser` — creates Linux user if not exists
  - `create_agent_users(agent_ids) -> dict[str, AgentUser]` — batch creation at startup
  - `get_agent_user(agent_id) -> AgentUser | None` — lookup from in-memory cache
- [ ] 9.2 Define `AgentUser` dataclass: `agent_id`, `username`, `uid`, `gid`, `home_dir`, `workspace_path`
- [ ] 9.3 Implement user creation: `useradd --system --no-create-home --shell /usr/sbin/nologin --gid nuvex <username>` via `subprocess.run()`
- [ ] 9.4 Implement home directory setup: create `/home/<username>/`, symlink workspace, set ownership and permissions (0750)
- [ ] 9.5 Make user creation idempotent: check `pwd.getpwnam()` before calling `useradd`
- [ ] 9.6 Amend `src/brain/server.py` — call `create_agent_users()` during startup, before graph compilation
- [ ] 9.7 Amend `src/brain/sandbox/executor.py` (or `src/brain/tools/executor.py`) — set `user=agent_user.uid` on subprocess calls
- [ ] 9.8 Amend `src/brain/sandbox/nsjail.py` — set `--user` flag to agent UID
- [ ] 9.9 Amend scratch directory creation — set ownership to agent UID, permissions 0700
- [ ] 9.10 Amend `docker-entrypoint.sh`:
  - Add `groupadd -f nuvex` at start
  - Add user creation loop reading agent IDs from divisions.yaml (use `yq` or Python one-liner)
  - Add privilege drop: `exec gosu nuvex python -m brain.server`
- [ ] 9.11 Amend `Dockerfile.brain` — `RUN apt-get install -y gosu` and `RUN groupadd nuvex`
- [ ] 9.12 Implement platform detection: skip user isolation on non-Linux with warning log
- [ ] 9.13 Emit `agent.user_pending` event when a new agent is detected without an OS user
- [ ] 9.14 Write unit test: `compute_username()` produces valid Linux username (≤32 chars, alphanumeric + underscore)
- [ ] 9.15 Write unit test: `compute_username()` is deterministic — same agent_id always produces same username
- [ ] 9.16 Write unit test: user creation is idempotent — second call is a no-op
- [ ] 9.17 Write unit test (Linux only): subprocess runs as agent UID — `whoami` returns agent username
- [ ] 9.18 Write unit test (Linux only): agent user cannot read another agent's workspace
- [ ] 9.19 Write unit test: non-Linux platform falls back gracefully with warning

---

## Section 10 — Full Suite Validation

- [ ] 10.1 `python -m pytest unit-tests/parallel-tool-execution/ --tb=short -q` — all pass
- [ ] 10.2 `python -m pytest unit-tests/tool-result-budget/ --tb=short -q` — all pass
- [ ] 10.3 `python -m pytest unit-tests/multi-credential-failover/ --tb=short -q` — all pass
- [ ] 10.4 `python -m pytest unit-tests/compaction-improvements/ --tb=short -q` — all pass
- [ ] 10.5 `python -m pytest unit-tests/auxiliary-model-routing/ --tb=short -q` — all pass
- [ ] 10.6 `python -m pytest unit-tests/programmatic-tool-calling/ --tb=short -q` — all pass
- [ ] 10.7 `python -m pytest unit-tests/trajectory-capture/ --tb=short -q` — all pass
- [ ] 10.8 `python -m pytest unit-tests/agent-skill-authoring/ --tb=short -q` — all pass
- [ ] 10.9 `python -m pytest unit-tests/per-agent-linux-user/ --tb=short -q` — all pass
- [ ] 10.10 `python -m pytest unit-tests/ --tb=short -q` — workspace green
