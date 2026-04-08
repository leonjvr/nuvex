# Organisation Isolation Audit

## Scope

This audit evaluates the current codebase against the OpenSpec change `organisation-isolation` under `openspec/changes/organisation-isolation`.

Artifacts reviewed:

- `proposal.md`
- `design.md`
- 19 capability specs under `specs/`
- `tasks.md`

Code areas sampled:

- brain models, routers, state, workspace loader, migrations, governance, config loader
- shared request models
- dashboard backend and frontend
- test directories `unit-tests/` and `tests/`

## Method

The audit uses a requirements-to-code comparison rather than task status alone. Each capability is marked as:

- `strong evidence`: the org-isolation amendment is substantially implemented
- `partial evidence`: the underlying subsystem exists, but the org-isolation amendment is missing or incomplete
- `no evidence`: the capability or required amendment is not present in code

## Summary

| Area | Result |
| --- | --- |
| OpenSpec tasks checked | 0 / 111 |
| Capabilities audited | 19 |
| Strong evidence | 0 |
| Partial evidence | 10 |
| No evidence | 9 |

Overall assessment: the `organisation-isolation` change is not implemented. The repository contains mature single-org subsystems, but the change-specific foundations are still missing: no `org_id` propagation, no organisation model, no org-scoped routing, no org-scoped migrations, no channel ownership model, and no inter-org work packet flow.

## Critical Findings

1. The database schema is still flat and single-org. Core tables in `0001_initial_schema.py` do not include `org_id`, and there are no migrations for `organisations`, `work_packets`, or `channel_bindings`.
2. Runtime state and request contracts are still single-org. `AgentState` and `InvokeRequest` have no `org_id`, and the invoke router still builds thread IDs without an org prefix.
3. Data access is not org-scoped. There is no `org_scope()` helper, and existing thread, cron, agent, audit, and event routes query globally.
4. No org lifecycle or policy merge behavior exists. The policy engine, governance pipeline, and lifecycle tables are not org-aware.
5. There is no verification coverage for the change. No org-isolation-specific tests were found in `unit-tests/` or `tests/`.

## Highest-Value Evidence

- `src/brain/migrations/versions/0001_initial_schema.py` defines flat `agents`, `threads`, `budgets`, `events`, `tasks`, `cron_entries`, and `governance_audit` tables with no `org_id`.
- `src/brain/models/agent.py`, `src/brain/models/thread.py`, `src/brain/models/events.py`, and `src/brain/models/lifecycle.py` remain single-org models.
- `src/brain/state.py` defines `AgentState` without `org_id`.
- `src/shared/models/requests.py` defines `InvokeRequest` without `org_id`.
- `src/brain/routers/invoke.py` exposes only `/invoke` and still constructs `thread_id` from `agent_id` only.
- `src/brain/routers/agents.py`, `src/brain/routers/threads.py`, and `src/brain/routers/cron.py` expose flat routes with no org prefix or org validation.
- `src/shared/config.py` still loads one flat YAML config file, not `/data/orgs/*/config.yaml`.
- `src/brain/workspace.py` still uses a single `workspace_path` string, not `(org_id, agent_id)` resolution.
- `src/dashboard/frontend/src/App.tsx` and `src/dashboard/frontend/src/pages/AgentsPage.tsx` show a single-org dashboard with no org selector or org-scoped API usage.

## Recommended Execution Order

1. Implement org foundations first: org model, Pydantic schemas, migrations, and model registration.
2. Add `org_id` to runtime contracts: `AgentState`, `InvokeRequest`, thread ID parsing, and central query scoping.
3. Refactor server routes and data access to org-prefixed APIs and validation middleware.
4. Add policy merge, lifecycle, audit, cron, and event-bus org context.
5. Implement gateway, workspace, dashboard, channel binding, and work packet layers.
6. Add unit and integration coverage only after the first four steps are in place.

## Detailed Findings

See `audit/organisation-isolation/capabilities.md` for the capability-by-capability audit.

See `audit/organisation-isolation/requirements-matrix.md` for the strict requirement-and-scenario matrix across the full change.