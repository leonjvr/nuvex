# Known Issues in V1.0.0

These issues are confirmed and tracked for V1.0.1 (target: March 31, 2026). None of them prevent basic usage of SIDJUA.

## GUI & UX

### Audit Events Not Populated

After chat interactions with tool calls, the audit_events table may remain empty. This means the audit log page shows no data even though tools were executed successfully.

**Workaround:** Tool calls are visible in real-time during chat via the SSE stream.
**Fix:** V1.0.1 — Debug and fix audit event persistence.

### Agent Table Shows "auto" Instead of Active Provider

The agent list table displays `auto` in the MODEL column instead of the resolved provider/model name. The agent cards above the table correctly show the active provider.

**Workaround:** Check the agent cards for the correct provider information.
**Fix:** V1.0.1 — Resolve and display actual provider in table view.

### Agent Status Inconsistency

Agent cards may show "active" while the table shows "Stopped" for the same agent. Both components read from different data sources.

**Workaround:** Agent cards reflect the actual runtime state.
**Fix:** V1.0.1 — Unified status source for all agent display components.

### Starter Team Banner Stays Visible

The blue "configure an LLM provider" banner remains visible even when all agents have a provider configured and are operational.

**Workaround:** Ignore the banner — your agents are working correctly if the cards show a green status.
**Fix:** V1.0.1 — Banner checks actual provider state.

### Advanced Provider Mode Not Persistent

Per-agent provider changes in Advanced mode are not saved. No API key field appears for new providers.

**Workaround:** Use Simple mode for provider configuration — it works correctly.
**Fix:** V1.0.1 — Full Advanced mode persistence.

### Agent Detail View Missing LLM Model Selection

Clicking on an agent card in "Your Team" shows details but no way to change the LLM provider or model directly.

**Workaround:** Change providers via Settings page.
**Fix:** V1.0.1 — Provider/model dropdown in agent detail view.

## Tools & Features

### create_agent_role Requires Description

When creating an agent and leaving the description empty, the tool returns an error. The agent may then fabricate a description instead of communicating the error.

**Workaround:** Always provide a description when creating agents.
**Fix:** V1.0.1 — Description becomes optional; agent reports errors instead of inventing values.

### HR Agent Uses Numeric Tier Labels

HR Agent shows tiers as "1/2/3" instead of the intended labels (Worker/Team Lead/Department Head).

**Workaround:** Tier 1 = Worker, Tier 2 = Team Lead, Tier 3 = Department Head.
**Fix:** V1.0.1 — Human-readable tier labels in all agent interactions.

## Infrastructure

### Division Sync Incomplete

`sidjua apply` syncs only the root divisions.yaml, not the individual files in defaults/divisions/. The GUI shows all divisions correctly from YAML, but the database may only have "default" active.

**Workaround:** Divisions display correctly in the GUI from YAML files.
**Fix:** V1.0.1 — Apply syncs all division sources to database.

## Planned for V1.0.1 (March 31, 2026)

All issues listed above will be addressed in V1.0.1. For the latest status, see [GitHub Issues](https://github.com/goetzkohlberg/sidjua/issues).
