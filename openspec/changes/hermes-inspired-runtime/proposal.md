## Why

Competitive analysis of Hermes Agent (a production single-user agentic runtime with 50+ tools, 18 gateway adapters, RL fine-tuning pipeline, and multi-provider LLM support) revealed nine runtime patterns that NUVEX does not yet implement. These are battle-tested behaviours running in a system with comparable complexity. Each addresses a distinct cost, throughput, security, or self-improvement gap.

Additionally, NUVEX runs all tool subprocesses as the same OS user inside the brain container. A compromised or malicious tool call can read any other agent's workspace, write to shared state, or kill sibling processes. Per-agent Linux user isolation is the minimum viable privilege separation for a multi-agent platform.

**Gaps ranked by ROI:**

1. **Sequential tool execution** — When an LLM returns multiple tool calls in a single turn (e.g., `read_file` + `web_fetch` + `shell ls`), NUVEX serializes them. Hermes classifies tools as `parallel_safe` and runs batches concurrently in a thread pool. For 3-tool batches, this halves latency.

2. **No tool result budget** — Tool outputs (especially `shell` and `web_fetch`) flow directly into the message list at full size. A single `shell` call dumping 50KB of logs fills the context window. Hermes has a 3-layer budget: per-tool char cap → overflow to file reference → per-turn aggregate cap with automatic pruning.

3. **Single-credential fragility** — A rate-limited API key is a hard stop. Hermes implements multi-credential pools with cooldown, round-robin, and failover strategies per provider. Critical for production deployments with burst traffic.

4. **Compaction wastes tokens summarizing tool noise** — NUVEX's compaction pipeline passes everything to the LLM summarizer, including verbose tool outputs that could be cheaply stripped. Hermes prunes tool results first (no LLM cost), then summarizes only meaningful content. The summary also uses a "different assistant handoff" framing that prevents the model from treating compressed history as active instructions.

5. **Expensive background tasks** — Memory consolidation, thread compaction, and title generation use the agent's primary model. NUVEX's `divisions.yaml` already defines a `fast` model tier per agent, but the implementation doesn't route background tasks to it. Hermes uses a separate cheap auxiliary client for all side-tasks.

6. **No complexity-aware routing** — NUVEX's `route_model` classifies by task type but can't detect that "what time is it?" is trivially answerable by the cheapest model. Hermes auto-routes short, non-complex messages (≤160 chars, no code, no URLs) to the fast model.

7. **No programmatic tool calling** — An agent that needs to read 10 files burns 10 LLM turns. Hermes's `execute_code` tool lets the LLM write a Python script that calls tool stubs via RPC — up to 50 tool calls in a single inference turn with zero intermediate context cost.

8. **No trajectory capture** — Every NUVEX conversation is stored in PostgreSQL but never exported as training data. Hermes captures every session in ShareGPT format, quality-gates by reasoning presence, and compresses for token budget. This is the foundation for any future fine-tuning or evaluation pipeline.

9. **Agents cannot author their own skills** — `skill-architecture-refactor` built shared skill infrastructure, but agents can only *use* skills — they cannot create, edit, or improve them. Hermes agents write their own `SKILL.md` files during conversations, building procedural memory that persists across sessions.

10. **Shared OS user for all agents** — Every subprocess tool call runs as the brain container's user. Agent A can `cat /data/agents/B/workspace/SOUL.md`. Per-agent Linux users with restricted home directories are the minimum privilege separation for multi-agent isolation.

## What Changes

### Section 1: Parallel Tool Execution

Classify tools as `parallel_safe` (read-only, no side effects) vs sequential. When an LLM turn returns multiple tool calls, execute the parallel-safe subset concurrently via `asyncio.gather()`. Fall back to sequential for any tool not classified as safe.

- Amends `src/brain/nodes/execute_tools.py`
- New `src/brain/tools/parallel.py` — classification registry and batch executor
- Default parallel-safe: `read_file`, `web_fetch`, `web_search`, `session_search`, any MCP tool tagged `readOnly`
- Configurable via `nuvex.yaml` global setting
- Max concurrency: 8 (configurable)

### Section 2: Tool Result Budget & Reference Handles

Cap tool output size at three levels: per-tool, per-turn aggregate, and overflow to file references.

- New `src/brain/tools/result_budget.py` — `enforce_tool_budget()` and `enforce_turn_budget()`
- Per-tool default cap: 30,000 chars (configurable per tool in registry)
- Per-turn aggregate cap: 200,000 chars
- Overflow storage: `data/threads/<thread_id>/tool_results/<uuid>.txt`
- LLM receives: `[Tool output stored as reference: <handle>. Use read_tool_result(<handle>) to retrieve.]`
- New `read_tool_result` built-in tool for on-demand retrieval
- Cleanup: reference files deleted on thread archive

### Section 3: Multi-Credential Failover Pool

Multiple API credentials per LLM provider with cooldown and rotation strategies.

- New `src/brain/llm/credential_pool.py` — `CredentialPool` class
- Strategies: `fill_first` (drain one key before rotating), `round_robin`, `random`
- On HTTP 429/402: cooldown that credential for configurable duration (default 60 min), try next
- Credentials stored in `nuvex.yaml` or env vars (`ANTHROPIC_API_KEY_1`, `ANTHROPIC_API_KEY_2`, etc.)
- Falls through to `CredentialExhausted` error → recovery recipe `switch_fallback_model`
- Amends `src/brain/nodes/call_llm.py`

### Section 4: Compaction Improvements

Two-pass compaction: prune tool results first (zero LLM cost), then summarize with handoff framing.

- Amends `src/brain/compaction.py`
- Pass 1 (prune): replace all tool result messages older than `preserve_recent` with `[Tool output cleared]` placeholder — no LLM call, pure string replacement
- Pass 2 (summarize): existing LLM summarization, but with improved prompt that frames the summary as a "handoff to a different assistant" to prevent the model from treating compressed history as active instructions
- Summary template includes structured sections: `Resolved`, `Pending`, `Remaining Work`
- Iterative updates: subsequent compactions update the existing summary rather than nesting summaries

### Section 5: Auxiliary Model Routing

Route all background/side tasks to the agent's `fast` model tier, and add a `trivial_reply` category for very simple user inputs.

- Amends `src/brain/nodes/call_llm.py` — background task calls (compaction summarizer, memory consolidation, title generation) use `agent.model.fast` instead of primary
- Amends `src/brain/routing/classifier.py` — add `trivial_reply` task type: input ≤ 160 chars, ≤ 28 words, no code blocks, no URLs, no complex keywords → forces `fast` model tier
- Amends `src/brain/memory/consolidator.py` — use fast model
- Configurable: `routing.trivial_reply.enabled: bool = true`, `routing.trivial_reply.max_chars: int = 160`, `routing.trivial_reply.max_words: int = 28`

### Section 6: Programmatic Tool Calling

A `run_plan` tool that accepts a Python script and executes it against a sandbox of available tool stubs, collapsing multi-step chains into a single LLM turn.

- New `src/brain/tools/run_plan.py` — `run_plan(script: str) -> str` tool
- Generates stub functions matching the agent's active tool set (e.g., `read_file(path)`, `web_fetch(url)`)
- Script executes in a restricted Python subprocess with tool stubs available
- Stubs communicate back to the parent via a temp file protocol (write JSON request → read JSON response)
- Max 50 tool calls per script; exceeding raises an error
- Only stdout returned to LLM; intermediate tool calls logged to audit but not to context
- T1/T2 agents only (governance: `run_plan` classified as `RESTRICTED` data class)
- Iteration budget: `run_plan` turns are refunded (do not count toward `max_iterations`)

### Section 7: Trajectory Capture Pipeline

Export completed threads as ShareGPT-format training data with quality gating and compression.

- New `src/brain/trajectories/` package
- `capture.py` — `save_trajectory(thread_id) -> Path`: exports thread messages to ShareGPT JSONL format with `<tool_call>` / `<tool_response>` XML wrapping
- `quality_gate.py` — `passes_quality_gate(trajectory) -> bool`: minimum viable filter — at least one assistant turn must contain reasoning tokens (thinking blocks or `<reasoning>` tags)
- `compressor.py` — `compress_trajectory(path, target_tokens) -> Path`: protects first system message, first human message, first response, last 4 turns; LLM-summarizes middle using fast model
- `export.py` — `GET /api/v1/trajectories/export` endpoint: query by date range, agent, quality gate status
- Background job: after each `lifecycle_end`, optionally capture trajectory (configurable per agent: `trajectory.capture: bool = false`)
- Storage: `data/trajectories/<agent_id>/<date>/` directory

### Section 8: Agent Skill Authoring

Agents can create, edit, and delete their own skills during conversations, building persistent procedural memory.

- New tool: `skill_manage(action, name, content?, patch_old?, patch_new?)` — T1/T2 agents only
- Actions: `create` (new skill), `edit` (full rewrite), `patch` (targeted find-replace), `delete`
- Skills stored at `data/orgs/<org_id>/agents/<agent_id>/skills/<name>/SKILL.md`
- New skills are security-scanned via prompt injection detection (reuse `workspace.py` scanner) before activation
- Content limit: 50,000 chars per SKILL.md
- Agent-authored skills have lower precedence than admin-installed skills (global library > agent-authored > workspace defaults)
- Amends `src/brain/skills/resolver.py` — add agent-authored skill path to resolution chain
- Dashboard: agent-authored skills visible in skill management UI with "agent-created" badge

### Section 9: Per-Agent Linux User Isolation

Each agent gets a dedicated Linux user inside the brain container. Tool subprocess execution runs under that user, not root or the container's default user.

- New `src/brain/sandbox/user_isolation.py` — `ensure_agent_user(agent_id) -> AgentUser` creates a Linux user `nuvex_<agent_id_hash[:8]>` with a restricted home directory at `/home/nuvex_<hash>/`
- On brain startup, `create_agent_users()` iterates all known agents and ensures OS users exist (`useradd` with `--no-login`, `--home-dir`, restricted shell)
- Tool subprocess execution (in `executor.py` or `SandboxExecutor`) runs as the agent's OS user via `subprocess` with `user=` parameter (Python 3.9+) or `su -s /bin/sh <user> -c`
- Agent workspace bind-mounted read-write under agent's home; other agent workspaces not accessible
- Shared read-only directories (`/usr/`, `/lib/`, global skills) accessible to all agent users
- Scratch directory (`NUVEX_SCRATCH_DIR`) owned by agent user with 0700 permissions
- Fallback: on non-Linux or when user creation fails, log warning and run as container default user
- Dockerfile.brain: create `nuvex` group; agent users added to this group; brain process runs as root only for user management, drops to `nuvex` group for normal operation
- Amends `tool-execution-sandboxing` Section 1: nsjail `--user` flag set to agent's UID
- Amends `Dockerfile.brain`

## Capabilities

### New Capabilities

- `parallel-tool-execution`: Concurrent execution of read-only tools within a single LLM turn batch
- `tool-result-budget`: 3-layer output budget with per-tool caps, per-turn aggregate, and file reference overflow
- `credential-pool`: Multi-credential failover with rotation strategies and cooldown
- `prune-before-compress`: Zero-cost tool result pruning pass before LLM summarization in compaction
- `handoff-framing`: "Different assistant" framing in compaction summaries to prevent instruction leakage
- `auxiliary-model-routing`: Background tasks (compaction, consolidation, titles) routed to fast model
- `trivial-reply-routing`: Short non-complex inputs auto-routed to fast model
- `programmatic-tool-calling`: `run_plan` tool for multi-tool Python script execution in a single LLM turn
- `trajectory-capture`: ShareGPT-format thread export with quality gating and compression
- `agent-skill-authoring`: Agents can create, edit, delete their own SKILL.md files
- `per-agent-os-user`: Each agent gets a dedicated Linux user for subprocess isolation

### Modified Capabilities

- `tool-execution`: execute_tools node gains parallel dispatch and result budgeting
- `compaction`: flat compaction gains prune pass and handoff framing
- `model-routing`: route_model gains trivial_reply classification
- `skill-system`: skill resolution gains agent-authored skill path
- `tool-sandbox-runtime`: nsjail gains per-agent UID assignment

## Impact

- **`execute_tools.py`** — parallel dispatch, result budgeting
- **`call_llm.py`** — credential pool integration, auxiliary model for side-tasks
- **`compaction.py`** — prune pass, handoff framing, iterative summary
- **`routing/classifier.py`** — trivial_reply category
- **`memory/consolidator.py`** — fast model routing
- **`skills/resolver.py`** — agent-authored skill path
- **`Dockerfile.brain`** — agent user creation, group setup
- **`docker-compose.local.yml`** — no changes (user management is internal)
- **New DB tables**: none (trajectories are filesystem; credential config is YAML)
- **New env vars**: `ANTHROPIC_API_KEY_1..N`, `OPENAI_API_KEY_1..N` (optional multi-key)
- **Config**: new blocks in `nuvex.yaml` for parallel execution, result budget, credential pools, trajectory capture

## Constraints

- Parallel tool execution must not change the order of tool result messages appended to state — results are gathered concurrently but appended in the original call order
- Tool result reference handles must be compatible with snip compaction (references in snipped turns are still resolvable)
- Credential pool must not log or expose API keys in error messages or audit trail
- Compaction prune pass must not delete tool results from the most recent `preserve_recent` turns
- `run_plan` must never execute arbitrary Python outside the sandbox — it uses the same `SandboxExecutor` from `tool-execution-sandboxing`
- Trajectory capture must strip PII (contact names, phone numbers) before writing JSONL — reuse PiiMaskHook patterns
- Agent-authored skills must pass the same security scan as community-installed skills
- Per-agent OS users must not require root access at runtime for normal graph execution — user creation happens at startup only
- Per-agent users are Linux-only; macOS/Windows dev environments fall back gracefully
