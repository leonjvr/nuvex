## Why

NUVEX has a basic budget table and per-task cost accumulation, but lacks real-time spend dashboards, configurable spend alerts, hard spending caps that halt agents (not just log), and cross-agent/cross-division budget aggregation. Finance and operations teams cannot answer "how much did agent X cost this month?" from the dashboard, there are no automated alerts when agents approach limits, and the budget enforcement in governance blocks at the task level but does not stop runaway multi-task agents. As NUVEX moves into production deployments, uncontrolled LLM spend becomes a critical risk.

## What Changes

- Introduce a `budget_ledger` table — an append-only, time-series record of every LLM call cost (agent, model, input_tokens, output_tokens, cost_usd, task_id, thread_id, timestamp). The existing `budgets` table becomes the limit/quota store only.
- Introduce a `budget_alerts` table and configurable alert rules (threshold_pct, window, channels to notify).
- Implement real-time budget aggregation views: per-agent daily/monthly, per-division, per-model, with period-over-period deltas.
- Add hard-cap enforcement: when an agent's daily or monthly cost crosses `hard_cap_usd`, halt new invocations at the gateway layer (not just tool level) — return structured error to the channel.
- Add soft-cap warning: when spend exceeds `warn_at_pct` of budget, emit a governance `warn` decision so the agent self-reports in its next message.
- Add routing savings tracking: record predicted cost (primary model) vs actual cost (routed model) per call so operators can see the savings dashboard.
- Add cost projection: linear extrapolation of spend to end of billing period per agent, surfaced in dashboard.
- Dashboard cost page: real spend vs budget gauges, daily/monthly bar charts, per-model breakdown, routing savings, projection lines, alert configuration.

## Capabilities

### New Capabilities
- `budget-ledger`: Append-only cost ledger — every LLM call recorded with full metadata; foundation for all reporting
- `budget-aggregation`: Real-time aggregated views — daily, monthly, per-agent, per-division, per-model with deltas
- `hard-cap-enforcement`: Agent-level hard spending cap that blocks new invocations at the invoke endpoint
- `soft-cap-warning`: Configurable warn threshold injects governance `warn` decision before hard cap is reached
- `spend-alerts`: Configurable alert rules (threshold_pct + window) with notification to configured channels
- `routing-savings`: Per-call record of primary-vs-routed cost delta, aggregated for savings dashboard
- `cost-projection`: Linear spend extrapolation to end of billing period, surfaced per agent in dashboard

### Modified Capabilities
- `cost-analytics`: **AMENDMENT** — `/api/costs` dashboard endpoint now returns ledger-based data with period filters, per-model breakdown, routing savings, and projections (replaces placeholder implementation)
- `budget-enforcement`: **AMENDMENT** — governance budget node uses ledger aggregates (not just task-level accumulation) for hard cap decisions; adds pre-invoke hard-cap check at the invoke endpoint
