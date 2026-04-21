# Cost Tracking & Budget Enforcement — Design

## Data Model

### `budget_ledger` (append-only)
```
id            UUID PK
agent_id      TEXT
division      TEXT
model         TEXT
provider      TEXT
task_id       UUID | NULL  (FK tasks.task_id)
thread_id     TEXT
input_tokens  INT
output_tokens INT
cost_usd      NUMERIC(12, 8)
routed_from   TEXT | NULL  (primary model name when routing saved cost)
primary_cost_usd  NUMERIC(12, 8) | NULL  (cost if primary model had been used)
timestamp     TIMESTAMPTZ
```

### `budget_alerts` (config)
```
id            UUID PK
agent_id      TEXT | NULL  (NULL = division-wide or global)
division      TEXT | NULL
threshold_pct NUMERIC(5,2)  (e.g. 80.0 = alert at 80% of budget)
window        TEXT  ('daily' | 'monthly')
channels      JSONB  (list of channel targets to notify)
last_fired_at TIMESTAMPTZ | NULL
created_at    TIMESTAMPTZ
```

### Amendments to `budgets` table
- Add `hard_cap_usd NUMERIC(12, 8) | NULL` — if set, blocks new invocations when ledger total exceeds this
- Add `warn_at_pct NUMERIC(5,2) DEFAULT 80.0` — governance soft-cap percentage
- Add `period_start TIMESTAMPTZ` — start of the current billing period (resets aggregation baseline)

## Aggregation Strategy

All real-time aggregations are computed from `budget_ledger` with SQL window functions:
```sql
SELECT
  agent_id,
  SUM(cost_usd) FILTER (WHERE timestamp >= NOW() - INTERVAL '1 day') AS daily_cost,
  SUM(cost_usd) FILTER (WHERE timestamp >= date_trunc('month', NOW()))  AS monthly_cost
FROM budget_ledger
GROUP BY agent_id
```

No separate aggregate tables — the ledger is the source of truth. Indexes on `(agent_id, timestamp)` and `(division, timestamp)`.

## Hard Cap Flow

```
POST /api/v1/invoke
  → load agent config + budgets row
  → query ledger: SUM(cost_usd) for agent this period
  → if sum >= hard_cap_usd: return HTTP 402 {"error": "budget_exceeded", "cap": X, "spent": Y}
  → continue normal invoke flow
```

The governance budget node (§6.3) remains as the **per-tool** budget check. The invoke endpoint check is the **per-agent-session** hard cap.

## Routing Savings Calculation

After each LLM call:
```python
primary_cost = estimate_cost(primary_model, input_tokens, output_tokens)
actual_cost  = estimate_cost(routed_model,  input_tokens, output_tokens)
savings      = primary_cost - actual_cost  # positive when routing saved money
```
Written to `budget_ledger.routed_from` and `primary_cost_usd`.

## Cost Projection

```python
days_elapsed   = (now - period_start).days or 1
daily_burn     = monthly_cost / days_elapsed
days_remaining = days_in_month - days_elapsed
projected_eom  = monthly_cost + (daily_burn * days_remaining)
```

## Alert Flow

Background job runs every 5 minutes:
1. Aggregate current spend per agent
2. For each budget_alerts row, check `(current_spend / budget_limit) >= threshold_pct`
3. If triggered and `last_fired_at` is NULL or older than cooldown (4h), fire notification to channels, update `last_fired_at`

## Dashboard Endpoints

- `GET /api/costs/summary?period=monthly&agent_id=X` — aggregate + budget remaining + projection
- `GET /api/costs/ledger?agent_id=X&from=&to=&limit=100` — raw ledger entries (paginated)
- `GET /api/costs/breakdown?period=monthly&group_by=model` — model/division breakdown
- `GET /api/costs/savings?period=monthly` — routing savings by agent
- `GET /api/costs/alerts` — alert rules
- `POST /api/costs/alerts` — create alert rule
- `DELETE /api/costs/alerts/{id}` — remove alert rule
