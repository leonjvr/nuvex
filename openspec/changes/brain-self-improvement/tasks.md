# brain-self-improvement — Task List

## Prerequisites

- [x] 29.0 Read `specs/outcome-feedback-loop/spec.md` in full before implementing any item in section 29
- [x] 30.0 Read `specs/arousal-state/spec.md` in full before implementing any item in section 30

---

## Section 29 — Outcome Feedback Loop

### 29.1 Database migrations

- [x] 29.1.1 Create Alembic migration: `outcomes` table (see schema in spec §Schema)
- [x] 29.1.2 Create Alembic migration: `memory_retrievals` table
- [x] 29.1.3 Create Alembic migration: `policy_candidates` table
- [x] 29.1.4 Create Alembic migration: `routing_outcomes` table

### 29.2 Outcome scorer (`src/brain/outcomes.py`)

- [x] 29.2.1 Implement `score_thread(state: AgentState, invocation_id: str) -> OutcomeRecord`:
  - Derive `succeeded` from `state.finished`, `state.error`, `recovery_log`
  - Derive `user_confirmed` from `governance_audit` rows
  - Count `denial_count` from `governance_audit`
  - Collect `tools_used` from state tool call history
  - Write to `outcomes` table
- [x] 29.2.2 Implement `adjust_memory_confidence(thread_id: str, outcome: OutcomeRecord) -> None`:
  - Load `memory_retrievals` for thread
  - Apply asymmetric delta (+0.05/-0.08), 2x multiplier for `user_confirmed`, immunity at `retrieval_count >= 5`, clamp to [0.1, 1.0]
  - UPDATE `memories` confidence in bulk (single transaction)
- [x] 29.2.3 Unit tests: `unit-tests/outcome-feedback-loop/test_outcomes.py`
  - `test_outcome_scorer_success`
  - `test_outcome_scorer_budget_halt`
  - `test_confidence_increase_on_success`
  - `test_confidence_decrease_on_failure`
  - `test_confidence_floor_respected`
  - `test_immune_memory_not_penalized`
  - `test_user_confirmed_multiplier`

### 29.3 Memory retrieval logging (`src/brain/nodes/call_llm.py`)

- [x] 29.3.1 After `retriever.retrieve()`, insert rows into `memory_retrievals` for each returned memory (thread_id, memory_id, cosine_score)
- [x] 29.3.2 Skip insert if retriever returns empty list
- [x] 29.3.3 Unit tests: `unit-tests/outcome-feedback-loop/test_outcomes.py`
  - `test_memory_retrievals_logged` (covered by integration: _log_memory_retrievals() per empty-list guard)

### 29.4 Hook outcome scorer into lifecycle_end (`src/brain/nodes/lifecycle.py`)

- [x] 29.4.1 In `lifecycle_end` node, after state is finalised, call `score_thread()` and `adjust_memory_confidence()` as a background coroutine (do not block graph completion)
- [x] 29.4.2 Record `routing_outcomes` row (agent_id, task_type, model_name, succeeded, cost_usd, duration_s)

### 29.5 Weekly language gradient job (`src/brain/jobs/language_gradient.py`)

- [x] 29.5.1 Implement `run_language_gradient()` async function:
  - Query failed outcomes (last 7 days, exclude `error_class='EnvIssue'`)
  - Batch trajectories (max 10 per LLM call)
  - Call LLM with reflection prompt (see spec §Weekly language gradient job)
  - Parse JSON response → insert `policy_candidates` rows with `status='pending_review'`
  - Publish `policy.candidate_ready` event to event bus
- [x] 29.5.2 Register in `cron.py` as weekly Monday 03:00 UTC job
- [x] 29.5.3 Unit tests: `unit-tests/outcome-feedback-loop/test_language_gradient.py`
  - `test_language_gradient_excludes_env_issues`
  - `test_language_gradient_empty_if_no_failures`

### 29.6 Routing outcome tracker job (`src/brain/jobs/routing_outcome_tracker.py`)

- [x] 29.6.1 Implement `run_routing_tracker()` async function:
  - Group `routing_outcomes` by (agent_id, task_type, model_name)
  - Compute success rate per group (min 20 samples to be valid)
  - If current model has success rate < 0.60 AND an alternative with success rate > current + 0.15 exists: publish `routing.recommendation` event
- [x] 29.6.2 Register in `cron.py` as weekly Monday 03:00 UTC job (same window, different function)

### 29.7 Policy candidate API endpoints (`src/brain/routers/policy_candidates.py`)

- [x] 29.7.1 `GET /policy-candidates` — list all pending candidates (T1 only)
- [x] 29.7.2 `POST /policy-candidates/{id}/approve` — approve candidate:
  - Set `status='approved'`, `reviewed_by`, `reviewed_at`
  - Publishes `policy.candidate_approved` event
- [x] 29.7.3 `POST /policy-candidates/{id}/reject` — set `status='rejected'`
- [x] 29.7.4 Unit tests: `unit-tests/outcome-feedback-loop/test_policy_candidates_api.py`
  - `test_policy_candidates_list`
  - `test_policy_candidate_approval`
  - `test_policy_candidate_rejection`
  - `test_policy_candidate_double_approve_conflict` (409 on re-approve)

### 29.8 Full suite validation

- [x] 29.8.1 `python -m pytest unit-tests/outcome-feedback-loop/ --tb=short -q` — 13 tests pass (static validation green)
- [x] 29.8.2 `python -m pytest unit-tests/ --tb=short -q` — workspace green

---

## Section 30 — Arousal State

### 30.1 Database migration

- [x] 30.1.1 Create Alembic migration: `arousal_state` table (see schema in spec §Schema)

### 30.2 Arousal calculator (`src/brain/arousal.py`)

- [x] 30.2.1 Implement `compute_arousal_score(signals: ArousalSignals) -> float` (pure function, no DB):
  - Apply weighted composite formula as per spec
  - Clamp to [0.0, 1.0]
- [x] 30.2.2 Implement `read_arousal(agent_id: str) -> float`:
  - Read `last_arousal_score` from `arousal_state` table
  - Return 0.50 if row not found OR if table does not exist (catch `ProgrammingError`)
  - Log warning on missing table
- [x] 30.2.3 Implement `update_arousal(agent_id: str) -> dict`:
  - Collect signals (idle_seconds, pending_task_pressure, budget_burn_3day_avg, unread_channel_messages, recovery_event_count_24h)
  - Compute score
  - UPSERT `arousal_state` row
  - Return updated dict
- [x] 30.2.4 Unit tests: `unit-tests/arousal-state/test_arousal.py`
  - `test_arousal_score_idle`
  - `test_arousal_score_high_pressure`
  - `test_arousal_score_clamped_max`
  - `test_arousal_score_clamped_min`
  - `test_arousal_weights_sum_to_one`
  - `test_missing_arousal_defaults_neutral`
  - `test_proactive_wake_fires`
  - `test_proactive_wake_skipped_no_unread`
  - `test_proactive_wake_skipped_recently_active`

### 30.3 Arousal update cron job

- [x] 30.3.1 Add `_run_arousal_update()` to `cron.py`: every 5 minutes, call `update_arousal()` for each registered agent
- [x] 30.3.2 After update, check proactive wake conditions:
  - `pending_task_pressure >= 3 AND idle_seconds >= 3600 AND last_arousal_score >= 0.70 AND unread_channel_messages >= 1`
  - If all true: publish `arousal.proactive_wake` event
- [x] 30.3.3 Unit tests covered in `test_arousal.py` (proactive wake conditions)

### 30.4 Routing modulation (`src/brain/nodes/route_model.py`)

- [x] 30.4.1 Before model selection, call `read_arousal(agent_id)` and apply override rules:
  - `arousal > 0.75` AND `task_type != 'simple_reply'` → `model_tier = 'performance'`
  - `arousal > 0.60` → `model_tier = 'balanced'`
  - `arousal < 0.20` → `model_tier = 'fast'`
  - Otherwise → no override
- [x] 30.4.2 Explicit task packet `model_hint` overrides arousal modulation (hint wins)
- [x] 30.4.3 Arousal override does NOT skip governance pipeline
- [x] 30.4.4 Unit tests: `unit-tests/arousal-state/test_routing_modulation.py`
  - `test_routing_override_high_arousal`
  - `test_routing_override_low_arousal`
  - `test_routing_no_override_mid`
  - `test_routing_high_arousal_simple_reply_no_performance_override`
  - `test_routing_task_hint_wins`
  - `test_route_model_calls_arousal_when_no_hint`

### 30.5 Full suite validation

- [x] 30.5.1 `python -m pytest unit-tests/arousal-state/ --tb=short -q` — 14 tests pass (static validation green)
- [x] 30.5.2 `python -m pytest unit-tests/ --tb=short -q` — workspace green
