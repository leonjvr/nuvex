# Active OpenSpec Audit

## Scope

This audit re-checks the active OpenSpec changes against the current repository, with explicit skepticism toward placeholder code, stub behavior, compatibility shims, and mock-only validation.

Active changes audited:

- `nuvex-core-platform`
- `organisation-isolation`
- `governed-plugin-architecture`
- `skill-architecture-refactor`

## Overall Assessment

- `nuvex-core-platform`: substantial baseline implementation exists, but several checked tasks are only partially complete. The repo is runnable and testable, but it is not fully aligned with the checked task list.
- `organisation-isolation`: still effectively unstarted as a change. The system remains single-org.
- `governed-plugin-architecture`: still effectively unstarted as a change. There is adjacent groundwork in hooks and skills, but no real plugin architecture.
- `skill-architecture-refactor`: partial groundwork only. Baseline skill loading exists, but the refactor itself is mostly absent.

## Critical Findings

1. A number of `nuvex-core-platform` tasks are checked even though the runtime path only implements a narrower slice of the requirement.
2. Several “green” tests are mock-driven and do not prove the full OpenSpec contract claimed by the checked task.
3. Placeholder and shim behavior exists in important runtime areas such as embeddings, compaction, and some integration surfaces; these should not be counted as fully complete.

## Pending And Outstanding By Change

### nuvex-core-platform

Still clearly outstanding:

- `27.9` Run OpenClaw migration import for Maya's configuration
- `27.10` Deploy NUVEX alongside OpenClaw on Hetzner VPS
- `27.11` Run 48-hour parallel monitoring before cutover
- `27.12` Cut port bindings from OpenClaw to NUVEX and verify channels operational

Checked but only partially complete or suspiciously narrow:

- Brain graph and governance integration: `4.2`, `4.4`, `4.5`, `6.2`, `6.3`, `6.4`, `6.6`, `6.9`
- API surface and approval flow: `4.7`, `4.8`, `4.9`, `4.10`, `10.4`
- Tool registry and built-in tool exposure: `8.3`, `8.4`, `23.6`
- Task packet lifecycle and schema fidelity: `23.1` to `23.5`
- Verification / green contract wiring: `24.2` to `24.6`
- Policy engine completeness: `25.1` to `25.7`
- Cron runtime behavior: `22.2` to `22.9`
- Session compaction quality: `18.2` to `18.8`
- Dashboard frontend fidelity: `13.6`, `13.8`, `13.9`
- End-to-end / smoke claims: `27.5` to `27.8`

### organisation-isolation

Outstanding:

- Entire change remains outstanding in practice.
- Current code still reflects single-org baseline behavior only.

Half completed:

- None in change-specific terms. What exists is pre-change baseline, not partial organisation isolation.

### governed-plugin-architecture

Outstanding:

- Entire plugin SDK, loader, registry, config, API, dashboard, and integration stack.

Half completed:

- Generic hooks infrastructure exists.
- Basic skill loading exists.
- These are adjacent foundations, not partial fulfillment of the plugin change itself.

### skill-architecture-refactor

Outstanding:

- Skill config storage, encryption, precedence resolution, progressive disclosure, skill APIs, dashboard management, and hook approval semantics.

Half completed:

- Baseline `skills` config and eager `SKILL.md` loading exist.
- This is enough to call the refactor grounded, but not implemented.

## Checked Tasks That Should Be Treated As Partial

### 1. Governance Graph Integration Is Narrower Than Claimed

Evidence:

- `src/brain/graph.py`
- `src/brain/governance/approval.py`
- `src/brain/governance/budget.py`
- `src/brain/governance/classification.py`
- `src/brain/nodes/execute_tools.py`

Why partial:

- The graph wires `route_model -> check_forbidden -> call_llm -> check_policy -> execute_tools`.
- Approval, budget, and classification modules exist but are not integrated as first-class graph gates in the actual runtime path.
- That means several governance tasks are represented in code as modules, not as end-to-end enforced runtime behavior.

Affected checked tasks:

- `4.2`, `4.4`, `4.5`
- `6.2`, `6.3`, `6.4`, `6.6`, `6.9`

### 2. Tool Registry Does Not Expose The Claimed Built-ins

Evidence:

- `src/brain/tools_registry.py`
- `src/brain/tools/builtin.py`
- `src/brain/tasks.py`

Why partial:

- The runtime registry currently returns only `ShellTool`.
- Built-ins such as `read_file`, `write_file`, `web_fetch`, `send_message`, `create_task`, and `complete_task` may exist as definitions, but they are not actually exposed through the active lookup path used by `execute_tools`.

Affected checked tasks:

- `8.3`, `8.4`, `23.6`

### 3. Task Packet Contract Diverges From The Spec

Evidence:

- `src/brain/tasks.py`
- `src/brain/models/tasks.py`
- `src/brain/migrations/versions/0001_initial_schema.py`

Why partial:

- Statuses are `pending/active/done/failed/cancelled`, not the spec’s lifecycle.
- Important fields such as `delegated_by`, `deadline`, and `context` are not present in the persisted schema.
- Parent-child handling exists, but the full task packet contract is narrower than what the checked tasks claim.

Affected checked tasks:

- `23.1` to `23.5`

### 4. Verification Exists But Is Not Fully Wired Into Task Completion

Evidence:

- `src/brain/verification.py`
- `src/brain/tasks.py`

Why partial:

- Verification supports a small acceptance-criteria DSL.
- Task completion code does not enforce the verification engine before marking work complete.
- Peer review routing is not present in the actual task lifecycle.

Affected checked tasks:

- `24.2` to `24.6`

### 5. Policy Engine Exists, But The OpenSpec Contract Is Broader

Evidence:

- `src/brain/governance/policy_engine.py`
- `src/brain/governance/check_policy.py`

Why partial:

- A generic policy engine is implemented.
- Scoped loading and precedence are not implemented as specified.
- `warn`, `throttle`, and `escalate` behavior is not fully enforced end-to-end in the runtime path.

Affected checked tasks:

- `25.1` to `25.7`

### 6. Cron Emits Events But Does Not Fulfill The Full Spec Runtime

Evidence:

- `src/brain/cron.py`
- `src/brain/models/cron.py`

Why partial:

- Cron jobs are persisted and scheduled.
- Firing a cron job currently publishes a `cron.execution` event and updates `last_run_at`, but does not invoke the agent end-to-end as the richer task wording implies.
- Tracking fields such as `run_count` and `last_status` are not part of the persisted model.

Affected checked tasks:

- `22.2` to `22.9`

### 7. Compaction Uses Stub Summaries

Evidence:

- `src/brain/compaction.py`
- `unit-tests/compaction/test_compaction.py`

Why partial:

- Compaction is present, but the summarization path uses a stub/placeholder summary rather than a model-generated summary with the full priority-retention behavior described in the tasks.
- Tests validate that stub behavior rather than the richer OpenSpec behavior.

Affected checked tasks:

- `18.2` to `18.8`

### 8. Frontend Coverage Overstates Some UI Task Completion

Evidence:

- `src/dashboard/frontend/src/pages/WorkspacePage.tsx`
- `src/dashboard/frontend/src/pages/TasksPage.tsx`
- `src/dashboard/frontend/src/pages/EventsPage.tsx`
- `src/dashboard/routers/tasks.py`

Why partial:

- Workspace editing is present, but not via Monaco/CodeMirror.
- The task board does not appear aligned with the backend contract in all fields.
- The event view is a polling list, not a real-time grouped stream viewer.

Affected checked tasks:

- `13.6`, `13.8`, `13.9`

### 9. End-to-End Claims Are Too Strong For The Tests Present

Evidence:

- `unit-tests/integration/test_integration.py`
- `unit-tests/conftest.py`

Why partial:

- The test suite is green, but it relies heavily on mocks and stubs.
- Several checked smoke or end-to-end tasks validate control flow and route shape, not real gateway-to-brain or recovery-to-retry production behavior.

Affected checked tasks:

- `27.5` to `27.8`

## Placeholder And Shim Findings

These are not necessarily bugs, but they are audit signals that should downgrade confidence:

- `src/agents/skill-loader.ts` uses placeholder zero vectors for Qdrant search and compaction support.
- `src/cli/commands/migrate-embeddings.ts` still constructs a stub embedder returning zero vectors and then fails fast if it is used.
- `src/integration-gateway/executors/mcp-bridge.ts` explicitly documents an unimplemented Phase 3 integration path.
- `src/tool-integration/adapters/database-adapter.ts` explicitly states PostgreSQL is not supported in V1 for that adapter.
- `src/brain/checkpointer.py` falls back to in-memory persistence when the Postgres path is unavailable.

## Change-by-Change Reality Check

### nuvex-core-platform

Reality:

- Broad baseline exists.
- Many sections are materially implemented.
- Several checked tasks should be downgraded to `partial` when audited against the full task wording.

### organisation-isolation

Reality:

- Still outstanding.
- No meaningful change-specific implementation is present.

### governed-plugin-architecture

Reality:

- Still outstanding.
- Existing hooks and skills are foundations, not plugin-architecture fulfillment.

### skill-architecture-refactor

Reality:

- Partially grounded by existing skill loading.
- The refactor itself is still outstanding.

## Recommended Next Step

1. Re-open and reclassify the checked `nuvex-core-platform` tasks listed above as `partial` rather than complete.
2. Treat `organisation-isolation` and `governed-plugin-architecture` as not yet started for planning purposes.
3. Use this audit as the gate before marking more OpenSpec tasks complete.