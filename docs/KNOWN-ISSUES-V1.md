# Known Issues in V1.0.0

These issues are confirmed and tracked for V1.0.1 (target: March 31, 2026). None of them prevent basic usage of SIDJUA.

## GUI & UX

### Audit Events Not Populated

After chat interactions with tool calls, the audit_events table may remain empty. This means the audit log page shows no data even though tools were executed successfully.

**Workaround:** Tool calls are visible in real-time during chat via the SSE stream.
**Fix:** V1.0.1 — Debug and fix audit event persistence (#656).

### Agent Table Shows "auto" Instead of Active Provider

The agent list table displays `auto` in the MODEL column instead of the resolved provider/model name. The agent cards above the table correctly show the active provider.

**Workaround:** Check the agent cards for the correct provider information.
**Fix:** V1.0.1 — Resolve and display actual provider in table view.

### Agent Status Inconsistency

Agent cards may show "active" while the table shows "Stopped" for the same agent. Both components read from different data sources.

**Workaround:** Agent cards reflect the actual runtime state.
**Fix:** V1.0.1 — Unified status source for all agent display components.

### Starter Team Banner Stays Visible

The blue "configure an LLM provider" banner remains visible even when all agents have a provider configured and are operational (#652, #655).

**Workaround:** Ignore the banner — your agents are working correctly if the cards show a green status.
**Fix:** V1.0.1 — Banner checks actual provider state.

### No Apply Button in GUI

When asked how to run `sidjua apply`, the agent gives generic terminal instructions instead of offering a GUI button. There is no Apply button in the chat interface (#658).

**Workaround:** Run `sidjua apply` from the terminal inside the Docker container.
**Fix:** V1.0.1 — Apply button in GUI with POST /api/v1/apply endpoint.

### Clear Button Deletes Chat Without Confirmation

The Clear button in chat removes all history without a safety prompt.

**Workaround:** Do not click the Clear button if you want to keep chat history.
**Fix:** V1.0.1 — Clear button will be removed, replaced by Apply button.

### Advanced Provider Mode Not Persistent

Per-agent provider changes in Advanced mode are not saved. No API key field appears for new providers (#646).

**Workaround:** Use Simple mode for provider configuration — it works correctly.
**Fix:** V1.0.1 — Full Advanced mode persistence.

### Agent Detail View Missing LLM Model Selection

Clicking on an agent card in "Your Team" shows details but no way to change the LLM provider or model directly (#659).

**Workaround:** Change providers via Settings page.
**Fix:** V1.0.1 — Provider/model dropdown in agent detail view.

## Tools & Features

### create_agent_role Requires Description

When creating an agent and leaving the description empty, the tool returns an error. The agent may then fabricate a description instead of communicating the error (#657).

**Workaround:** Always provide a description when creating agents.
**Fix:** V1.0.1 — Description becomes optional; agent reports errors instead of inventing values.

### Division Management Tools Missing

HR Agent can create agents but cannot create or rename divisions. No create_division or update_division tools exist (#660).

**Workaround:** Edit division YAML files manually in the workspace directory.
**Fix:** V1.0.1 — create_division + update_division tools for HR Agent.

### Missing update_agent_role Tool

HR Agent can create agents but cannot edit existing ones. No update or delete capability (#651).

**Workaround:** Edit agent YAML files manually in agents/definitions/.
**Fix:** V1.0.1 — update_agent_role tool for HR Agent.

### HR Agent Uses Numeric Tier Labels

HR Agent shows tiers as "1/2/3" instead of the intended labels (Worker/Team Lead/Department Head) (#650).

**Workaround:** Tier 1 = Worker, Tier 2 = Team Lead, Tier 3 = Department Head.
**Fix:** V1.0.1 — Human-readable tier labels in all agent interactions.

## Infrastructure

### Division Sync Incomplete

`sidjua apply` syncs only the root divisions.yaml, not the individual files in defaults/divisions/. The GUI shows all divisions correctly from YAML, but the database may only have "default" active (#641).

**Workaround:** Divisions display correctly in the GUI from YAML files.
**Fix:** V1.0.1 — Apply syncs all division sources to database.

### Error Log May Be Empty

sidjua-error.log may only contain the startup initialization message with no runtime errors logged, even when tool-call failures occur during operation (#661).

**Workaround:** Check Docker container logs (`docker logs sidjua`) for runtime output.
**Fix:** V1.0.1 — Runtime error capture in error log.

### Backup Button Disabled

The "Save SIDJUA Backup" button in Settings is permanently inactive despite the database being properly initialized (#662).

**Workaround:** Use `sidjua backup` from the CLI inside the container.
**Fix:** V1.0.1 — Enable backup button when database is ready.

### Routing Default References Non-Existent Agent

The default routing table references "opus-t1" which does not exist in the starter agent set.

**Workaround:** Routing falls back correctly to the Guide agent.
**Fix:** V1.0.1 — Default route points to Guide or resolves dynamically.

## Planned for V1.0.1 (March 31, 2026)

All issues listed above are tracked in our internal issue tracker and will be addressed in V1.0.1. For the latest status, see [GitHub Issues](https://github.com/goetzkohlberg/sidjua/issues).

