## 29. Diminishing Returns Stop Logic

> Spec: `specs/diminishing-returns-stop/spec.md`
>
> Prevents agents from spinning indefinitely on low-yield turns. After 3 consecutive turns
> that each produce fewer than 500 output tokens, the graph halts and emits a lifecycle event.

- [x] 29.1 Add `low_yield_turns: int` and `tool_schema_hash: str | None` fields to `AgentState` in `src/brain/state.py` with defaults 0 and None
- [x] 29.2 Add `denied_actions: list[DeniedAction]` field to `AgentState`; define `DeniedAction` Pydantic model in `src/brain/models/denied_action.py` (tool_name, reason, governance_stage, timestamp, invocation_id)
- [x] 29.3 In `src/brain/nodes/call_llm.py`, after each LLM response: if the response has no tool calls AND output token count < `diminishing_returns.min_tokens_per_turn` (default 500), increment `state.low_yield_turns`; else reset to 0
- [x] 29.4 Add conditional edge in `src/brain/graph.py` after `call_llm` node: if `state.low_yield_turns >= diminishing_returns.consecutive_threshold` (default 3), route to a `halt_diminishing_returns` terminal node
- [x] 29.5 Implement `src/brain/nodes/halt_diminishing_returns.py` — emits `halted.diminishing_returns` event to event bus with payload `{"low_yield_turns": N, "last_delta": N}` and transitions lifecycle to `Finished`
- [x] 29.6 Add `diminishing_returns` config block to `AgentDefinition` Pydantic model in `src/shared/config.py` with fields `enabled: bool = True`, `min_tokens_per_turn: int = 500`, `consecutive_threshold: int = 3`
- [x] 29.7 Write unit test: 3 consecutive turns < 500 tokens triggers halt; 2 + 1 reset + 2 does not
- [x] 29.8 Write unit test: tool-call turns do not increment counter

## 30. Output Style Overlays

> Spec: `specs/output-style-overlays/spec.md`
>
> Named markdown overlay files that control agent communication style. Appended after SOUL.md/IDENTITY.md
> content in the system prompt. Configurable per-agent without code changes.

- [x] 30.1 Add `response_style: str | None` field to `AgentDefinition` in `src/shared/config.py`
- [x] 30.2 Implement style file resolution in `src/brain/workspace.py`: if `response_style` is a short identifier (no newlines), look up `defaults/styles/<name>.md` then `data/agents/<id>/workspace/styles/<name>.md`; if it contains newlines, treat as inline content
- [x] 30.3 Append resolved style content to system prompt after SOUL.md/IDENTITY.md content (before governance preamble boundary, after identity block)
- [x] 30.4 Log warning (not error) if `response_style` names a file that does not exist; continue without overlay
- [x] 30.5 Create `defaults/styles/` directory with three starter styles: `concise.md`, `detailed.md`, `professional.md`
- [x] 30.6 Write unit test: agent with `response_style: "concise"` includes style file content in system prompt; agent without `response_style` does not

## 31. Snip Compaction

> Spec: `specs/snip-compaction/spec.md`
>
> Alternative compaction mode that archives older turns to PostgreSQL and injects selective
> snippets by relevance, rather than collapsing them into a flat summary.

- [x] 31.1 Write Alembic migration: create `thread_snips` table (id UUID PK, thread_id TEXT, agent_id TEXT, turn_index INT, role TEXT, content TEXT, token_count INT, embedding vector(1536), created_at TIMESTAMPTZ)
- [x] 31.2 Implement `SnipCompactor` class in `src/brain/compaction.py` (alongside existing `CompactionEngine`): on trigger, archive messages older than `preserve_recent` to `thread_snips`, remove from active message list
- [x] 31.3 Implement snip selector: build snip index (id, turn_index, first 50 chars, token_count), call fast model to select ≤ `snip_max_replay` turn indices relevant to the current message
- [x] 31.4 Implement snip injection in `src/brain/workspace.py`: fetch selected snips from DB, format as `[HISTORICAL CONTEXT]` block, place above active messages in prompt; enforce `snip_max_tokens` cap
- [x] 31.5 Add `mode: "snip"` branch to compaction config handling in `src/brain/compaction.py`; add snip config fields (`snip_max_replay`, `snip_max_tokens`, `snip_relevance_threshold`) to `AgentDefinition` compaction schema
- [x] 31.6 Write unit test: snip mode archives correct messages to DB and retains `preserve_recent` verbatim
- [x] 31.7 Write unit test: snip selector enforces token cap — drops snips until within budget
- [ ] 31.8 Write integration test: thread compacts in snip mode; follow-up turn injects relevant historical snip; irrelevant snip not injected

## 32. Permission Denial Learning

> Spec: `specs/permission-denial-learning/spec.md`
>
> Denied governance actions are recorded in session state and injected as a structured [DENIED]
> block in subsequent prompts so the model adapts strategy rather than retrying blocked actions.

- [x] 32.1 After 29.2 (DeniedAction model), ensure it is importable from `src/brain/models/denied_action.py`
- [x] 32.2 In each governance node (`forbidden.py`, `approval.py`, `budget.py`, `classification.py`, `policy.py`): when issuing a denial, append a `DeniedAction` record to `state.denied_actions` alongside the existing `governance_audit` write
- [x] 32.3 In `src/brain/workspace.py` system prompt assembly: if `state.denied_actions` is non-empty, build a `[DENIED ACTIONS THIS SESSION]` markdown block and inject it above the tool list; cap at 10 most recent entries with overflow note
- [x] 32.4 Initialise `denied_actions: []` at the start of each new invocation (in `src/brain/graph.py` or the invoke handler)
- [x] 32.5 Write unit test: forbidden denial appends DeniedAction with `governance_stage: "forbidden"`; budget denial with `governance_stage: "budget"`
- [x] 32.6 Write unit test: `[DENIED]` block present in prompt when list non-empty; absent when empty; capped at 10 with overflow note when 12 denials accumulated

## 33. Tool Schema Locking

> Spec: `specs/tool-schema-locking/spec.md`
>
> SHA-256 hash of the tool schema set stored in AgentState. Schema block served from cache
> when hash unchanged, preventing unnecessary prompt cache invalidation.

- [x] 33.1 After 29.1 (`tool_schema_hash` added to AgentState), implement schema hashing in `src/brain/workspace.py`: serialize active tool schemas as sorted JSON, compute SHA-256, compare to stored hash
- [x] 33.2 Cache the fully serialized tool schema block (list of tool dicts) in `AgentState.tool_schema_cache: list | None`; set to None initially
- [x] 33.3 In `call_llm` node: if `tool_schema_hash` matches, pass `state.tool_schema_cache` to the API call; if differs, regenerate, update hash and cache in state
- [x] 33.4 Ensure schema serialisation uses `json.dumps(schema, sort_keys=True)` at all nesting levels for deterministic output
- [x] 33.5 Write unit test: same tools loaded in different order produce the same hash and cache hit; adding one tool produces a cache miss and updates hash

## 34. Post-Tool Result Masking

> Spec: `specs/post-tool-result-masking/spec.md`
>
> AMENDMENT to Section 21. Adds result_override and skip_model_feedback to HookResult.
> Built-in PiiMaskHook applies configurable regex/pattern redaction.

- [x] 34.1 Add `result_override: str | None = None` and `skip_model_feedback: bool = False` to `HookResult` in `src/brain/hooks.py`
- [x] 34.2 Update `HookRunner.run_post_tool_hooks()`: after running each hook, if `skip_model_feedback` is True, stop hook chain and return None (suppress output); if `result_override` is set, pass override to next hook as `tool_output` and accumulate
- [x] 34.3 In `GovernedToolNode` (`src/brain/nodes/execute_tools.py`): after `HookRunner.run_post_tool_hooks()`, if result is None (`skip_model_feedback`), do not append tool result message; if result differs from original, use result for LLM message but log original to audit
- [x] 34.4 Implement `PiiMaskHook` in `src/brain/hooks/pii_mask.py`: load `pii_patterns` from agent config, compile regexes, on PostToolUse replace all matches in `tool_output` with `[REDACTED]`, return `result_override` with redacted text (or None if no matches)
- [x] 34.5 Register `PiiMaskHook` as a built-in hook in `HookRunner`; only active when agent config includes `pii_mask` in `hooks.post_tool`
- [x] 34.6 Add `pii_patterns: list[str]` to `AgentDefinition` in `src/shared/config.py`
- [x] 34.7 Write unit test: hook returning `result_override` — LLM receives override, audit receives original
- [x] 34.8 Write unit test: hook returning `skip_model_feedback=True` — no tool result message appended to LLM stream
- [x] 34.9 Write unit test: `PiiMaskHook` with email pattern redacts matches; output with no match passes through unchanged
- [x] 34.10 Write unit test: chained hooks — first hook masks, second hook receives masked text as `tool_output`

## 35. Agent Coordination Scratchpad

> Spec: `specs/agent-coordination-scratchpad/spec.md`
>
> Per-thread scratch directory auto-created on first tool call, injected as NUVEX_SCRATCH_DIR
> into all subprocess environments, cleaned up on thread archive.

- [x] 35.1 In `src/brain/tools/executor.py`: before launching each tool subprocess, resolve `scratch_dir = data/threads/<thread_id>/scratch/`; create it if it does not exist; inject `NUVEX_SCRATCH_DIR=<absolute_path>` into subprocess env
- [x] 35.2 Add `scratch.quota_mb: int = 100` and `scratch.cleanup: str = "on_archive"` to `AgentDefinition` config schema
- [x] 35.3 Implement quota check in executor: before subprocess launch, compute current scratch dir size; if writing would push total above `quota_mb`, return `SCRATCH_QUOTA_EXCEEDED` error to agent without launching subprocess
- [x] 35.4 Wire scratch dir cleanup into lifecycle: in `AgentLifecycleManager`, on transition to `Archived`, delete `data/threads/<thread_id>/scratch/` recursively and emit a debug-level log event
- [x] 35.5 If the scratch dir is missing when a subsequent tool call runs (e.g., manual deletion), recreate it silently before subprocess launch
- [x] 35.6 Write unit test: first tool call creates scratch dir; second call in same thread reuses same dir; different thread_id → different dir
- [x] 35.7 Write unit test: quota exceeded → returns error, does not launch subprocess; under quota → launches normally
- [ ] 35.8 Write integration test: coordinator writes file to scratch dir; worker subprocess reads it via `$NUVEX_SCRATCH_DIR`
