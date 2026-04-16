## 36. Budget Ledger

- [x] 36.1 Write Alembic migration: CREATE TABLE `budget_ledger` (id UUID PK, agent_id TEXT, division TEXT, model TEXT, provider TEXT, task_id UUID NULL, thread_id TEXT, input_tokens INT, output_tokens INT, cost_usd NUMERIC(12,8), routed_from TEXT NULL, primary_cost_usd NUMERIC(12,8) NULL, timestamp TIMESTAMPTZ DEFAULT NOW()) with indexes on (agent_id, timestamp) and (division, timestamp)
- [x] 36.2 Write Alembic migration: CREATE TABLE `budget_alerts` (id UUID PK, agent_id TEXT NULL, division TEXT NULL, threshold_pct NUMERIC(5,2), window TEXT, channels JSONB, last_fired_at TIMESTAMPTZ NULL, created_at TIMESTAMPTZ DEFAULT NOW())
- [x] 36.3 Write Alembic migration: ALTER TABLE `budgets` ADD COLUMNS hard_cap_usd NUMERIC(12,8) NULL, warn_at_pct NUMERIC(5,2) DEFAULT 80.0, period_start TIMESTAMPTZ DEFAULT NOW()
- [x] 36.4 Create SQLAlchemy model `src/brain/models/budget_ledger.py` — `BudgetLedger` ORM model with all columns
- [x] 36.5 Create SQLAlchemy model `src/brain/models/budget_alert.py` — `BudgetAlert` ORM model with all columns

## 37. Ledger Write — LLM Call Integration

- [x] 37.1 Create `src/brain/costs.py` — `record_llm_cost(agent_id, model, provider, input_tokens, output_tokens, cost_usd, task_id, thread_id, routed_from, primary_cost_usd)` async function that writes to `budget_ledger`
- [x] 37.2 Create `src/brain/costs.py` — `estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float` using a per-model price table dict (populate with Anthropic Claude + OpenAI GPT prices as of 2026)
- [x] 37.3 In `src/brain/nodes/call_llm.py`: after each LLM response, call `record_llm_cost()` with actual token counts from response metadata; pass `routed_from` if model differs from primary
- [x] 37.4 In `src/brain/nodes/call_llm.py`: compute `primary_cost_usd = estimate_cost(primary_model, ...)` and `actual_cost_usd = estimate_cost(routed_model, ...)` for savings tracking
- [x] 37.5 Write unit test: `estimate_cost()` returns expected values for known models; unknown model returns 0.0
- [x] 37.6 Write unit test: `record_llm_cost()` inserts a row with correct field values into `budget_ledger` (mock session)

## 38. Hard Cap & Soft Cap Enforcement

- [x] 38.1 Create `src/brain/costs.py` — `get_period_spend(agent_id: str, session) -> float` — SUM(cost_usd) from ledger since period_start
- [x] 38.2 In `src/brain/server.py` POST `/api/v1/invoke` handler: before graph invocation, query `get_period_spend()`; if `>= hard_cap_usd`, return HTTP 402 JSON `{"error": "budget_exceeded", "hard_cap": X, "spent": Y}`
- [x] 38.3 In `src/brain/governance/budget.py`: replace task-level accumulation check with `get_period_spend()` for the `warn_at_pct` soft-cap check; emit governance `warn` decision when threshold crossed
- [x] 38.4 Add `hard_cap_usd: float | None`, `warn_at_pct: float`, `period_start: datetime` to `BudgetConfig` in `src/shared/models/config.py`
- [x] 38.5 Write unit test: invoke handler returns 402 when `get_period_spend() >= hard_cap_usd`; returns normal when under cap
- [x] 38.6 Write unit test: budget governance node emits `warn` decision when spend crosses `warn_at_pct`; no warn below threshold

## 39. Alert Engine

- [x] 39.1 Create `src/brain/alert_engine.py` — `AlertEngine.check_all_alerts(session)`: aggregate per-agent spend, compare against each `budget_alerts` row, fire if threshold crossed and cooldown elapsed
- [x] 39.2 Implement alert notification: for each configured channel in `alert.channels`, call `actions_queue` insert or emit event to event bus
- [x] 39.3 Wire `AlertEngine.check_all_alerts()` into APScheduler as a 5-minute recurring job at brain startup
- [x] 39.4 Write unit test: `check_all_alerts()` fires notification when `(spend / budget) >= threshold_pct` and cooldown elapsed; does not fire within cooldown window

## 40. Cost Aggregation & Projection API

- [x] 40.1 Create `src/brain/routers/costs.py` — `GET /api/v1/costs/summary` — returns per-agent: daily_cost, monthly_cost, budget_limit, budget_remaining, projected_eom, routing_savings_mtd
- [x] 40.2 Add `GET /api/v1/costs/ledger` — paginated raw ledger entries with filters: agent_id, from, to, model
- [x] 40.3 Add `GET /api/v1/costs/breakdown` — aggregated by model or division with period filter
- [x] 40.4 Add `GET /api/v1/costs/savings` — routing savings per agent: primary_cost_sum, actual_cost_sum, savings_usd, savings_pct
- [x] 40.5 Add `GET /api/costs/alerts`, `POST /api/costs/alerts`, `DELETE /api/costs/alerts/{id}` in `src/dashboard/routers/costs.py`
- [x] 40.6 Implement cost projection in summary endpoint: `projected_eom = monthly_cost + (daily_burn * days_remaining)`
- [x] 40.7 Mount costs router in `src/brain/server.py`
- [x] 40.8 Write unit test: projection formula correct for mid-month, start-of-month edge cases
- [x] 40.9 Write unit test: savings endpoint returns correct savings_pct when primary_cost_sum > 0; returns 0.0 when no routing occurred

## 41. Dashboard Cost UI

- [x] 41.1 Update `src/dashboard/routers/costs.py` — replace placeholder implementation with proxy to brain `/api/v1/costs/*` endpoints (or direct raw SQL for ledger)
- [x] 41.2 Build cost summary cards in dashboard Costs page: spend gauge (% of budget), monthly total, projected EOM, routing savings chip
- [x] 41.3 Build daily spend bar chart: last 30 days of cost per agent (stacked by model)
- [x] 41.4 Build per-model breakdown table: model name, call count, total tokens, total cost, % of spend
- [x] 41.5 Build routing savings panel: primary cost vs actual cost, savings amount and percentage
- [x] 41.6 Build alert configuration panel: list existing alerts, form to add new alert (agent selector, threshold %, window, channels)
- [x] 41.7 Write unit test: summary card renders with correct spend percentage and projection values
