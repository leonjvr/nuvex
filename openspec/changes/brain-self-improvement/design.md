## Context

NUVEX already has a sophisticated memory stack (Section 28: Organisational Memory) and a recovery pipeline (Section 19: Recovery Recipes). Both are missing the feedback loop that would make them self-improving: outcomes do not flow back into the systems that produced them.

**Existing infrastructure we build on:**
- `memories` table with `confidence FLOAT` column — already exists (Section 28)
- `consolidator.py` — already extracts facts at thread end; already assigns `confidence`
- `forgetter.py` — already prunes on confidence threshold; already immunity for `retrieval_count >= 5`
- `cron.py` — APScheduler already running; adding a weekly job is trivial
- `lifecycle.py` — `lifecycle_end` node already fires; adding a hook there costs nothing
- `events` table — event bus already persists every event with `agent_id` and `invocation_id`
- `governance_audit` table — already tracks every tool call and governance decision per thread

**New infrastructure required (minimal):**
- `outcomes` table — one row per completed thread
- `memory_retrievals` table — junction: which memories were retrieved in which thread
- `policy_candidates` table — weekly language gradient output, pending T1 review
- `arousal_state` table — one row per agent, updated at lifecycle boundaries
- `routing_outcomes` table — model success rate accumulator per task-type

---

## Decisions

### 1. Binary outcome scoring, not continuous reward shaping

**Choice:** Binary success/failure (`succeeded: bool`) at thread boundary. No intermediate rewards.

**Alternatives considered:**
- Continuous reward shaping (reward per tool call) — requires defining a reward function for every tool, prohibitively overfit-prone without a ground truth signal
- User rating (1–5 stars) — requires UI and user engagement; most interactions don't get explicit ratings
- LLM-as-judge scoring — adds latency and cost to every thread; introduces model bias as a second-order effect

**Rationale:** `succeeded` is derivable from existing signals with zero user friction: task completed (`task_status = done`) + no unrecovered errors (`error IS NULL` at `lifecycle_end`) + no forced-halt recovery events. This binary signal is weak but consistent. Weak consistent signal outperforms strong noisy signal for long-horizon confidence adjustment (finding from OpenClaw-RL Binary RL experiments).

`user_confirmed` (sourced from governance audit: did the operator approve during the thread?) is a stronger signal when available. When present, it dominates: `confidence_delta = 2x` normal magnitude.

### 2. Confidence adjustment is asymmetric

**Choice:** Success → `+0.05`, failure → `-0.08`. Floor = 0.1, ceiling = 1.0.

**Alternatives considered:**
- Symmetric (±0.05) — treats trust erosion and trust building as equivalent; not what biological systems do
- Larger deltas (±0.2) — adapts too quickly; single bad run destroys useful memories

**Rationale:** Biological loss aversion: negative outcomes are weighted more heavily than equivalent positive outcomes (Kahneman & Tversky). A memory that contributes to 2 successes and 1 failure should end with net positive confidence (+0.10 - 0.08 = +0.02), not neutral. Asymmetry builds trust slowly and erodes it faster — conservative and appropriate for a governance-first system.

The `retrieval_count >= 5` immunity from `forgetter.py` naturally protects high-use memories from being pruned by a single failure cascade.

### 3. Language gradient job targets policy candidates, not auto-apply

**Choice:** Weekly job writes to `policy_candidates` table. T1 agent reviews and approves in dashboard (or via `approve_policy_candidate` tool). Does not modify `divisions.yaml` directly.

**Alternatives considered:**
- Auto-apply policy changes — dangerous; a bad LLM reflection could lock out tools that are necessary
- Require human (operator) review in dashboard — adds friction, breaks the autonomous loop intent

**Rationale:** Policy rules are governance-layer artifacts. The governance pipeline's defining property is that it cannot be overridden by the agent. Auto-applying LLM-generated policy changes would create a back-channel through which the agent effectively rewrites its own governance constraints — exactly what the system is designed to prevent. T1 review preserves the human-in-the-loop for governance changes while making the candidate generation autonomous.

### 4. Arousal state as PostgreSQL row, not a running process

**Choice:** `arousal_state` is a PostgreSQL row per agent, updated at `lifecycle_end` and by a 5-minute background cron. No always-running agent coroutine.

**Alternatives considered:**
- Always-running asyncio task per agent — expensive at API costs; NUVEX uses closed APIs (Claude/GPT) so "thinking" between messages is not free
- Redis pub/sub arousal signals — adds infrastructure; overkill for the 5-minute tick resolution needed
- File-based state — doesn't work across Docker restarts cleanly

**Rationale:** Continuous existence at the *reasoning* layer is economically infeasible with closed API models at current pricing. Continuous existence at the *state accumulation* layer is free — it's just a row being updated by a cron tick. The agent experiences the effect of continuous existence (it "wakes up" knowing how long it's been idle, how many tasks are pending, how much budget it burned) without any running compute cost. This is the pattern BabyAGI's trigger system converges toward in practice.

### 5. Arousal score modulates routing, not governance

**Choice:** Arousal score affects model tier selection and response verbosity. It does NOT affect governance decisions (forbidden, approval, budget, classification, policy).

**Rationale:** Governance must remain flat and deterministic. An "anxious" agent under high task pressure should not be able to bypass approval gates because of arousal state — that would be the ANS overriding the PFC, which is precisely what the NUVEX architecture is designed to prevent. The biological analog here is deliberate: SNS activation changes *how fast* you think, not *whether* you obey the law.

---

## Data Flow

### Outcome Feedback Loop

```
Thread ends (lifecycle_end node)
    │
    ▼
outcome_scorer.py
    ├── query governance_audit for thread_id → count denials, errors
    ├── query tasks table → task_status == done?
    └── write outcomes row {succeeded, user_confirmed, cost_usd, ...}
    │
    ▼
memory_confidence_updater.py (async, post-lifecycle)
    ├── query memory_retrievals WHERE thread_id = ?
    ├── for each retrieved memory_id:
    │       delta = +0.05 if succeeded else -0.08
    │       delta *= 2.0 if user_confirmed
    │       new_conf = clamp(old_conf + delta, 0.1, 1.0)
    │       UPDATE memories SET confidence = new_conf
    └── (no-op if memory_retrievals is empty)
    │
    ▼  [weekly APScheduler job]
language_gradient_job.py
    ├── SELECT failed threads from past 7 days (outcomes.succeeded = false)
    ├── for each failed thread: reconstruct trajectory from messages + governance_audit
    ├── LLM call: structured reflection → "what policy rule would have prevented this?"
    ├── parse → PolicyCandidate {condition_tree, action, rationale, source_thread_ids[]}
    └── INSERT policy_candidates (status='pending_review')
```

### Arousal State

```
Every lifecycle_end:
    UPDATE arousal_state SET
        idle_seconds = 0,
        last_invocation_at = NOW(),
        recovery_event_count_24h = <from events table>
    WHERE agent_id = ?

Every 5 min (cron):
    UPDATE arousal_state SET
        idle_seconds = EXTRACT(EPOCH FROM NOW() - last_invocation_at),
        pending_task_pressure = COUNT(*) FROM tasks WHERE assigned_agent = ? AND status IN ('pending','active'),
        budget_burn_3day_avg = <rolling average from outcomes>,
        unread_channel_messages = <from actions_queue backlog>
    WHERE agent_id = ?

lifecycle_start reads arousal_state:
    arousal_score = compute_arousal(idle_seconds, pending_task_pressure, ...)
    state.metadata['arousal_score'] = arousal_score

route_model node reads arousal_score:
    if arousal_score > 0.7: override model_tier = 'fast'
    if arousal_score < 0.1 and task_type == 'simple_reply': allow 'fast'
    else: normal routing logic

Proactive wake trigger (cron, every 30 min):
    for each agent:
        if arousal.pending_task_pressure > 3 AND arousal.idle_seconds > 3600:
            trigger synthetic invocation: "Review your pending tasks and provide a brief status."
```

---

## File Map

| New file | Purpose |
|---|---|
| `src/brain/outcomes.py` | Outcome scorer + memory confidence updater |
| `src/brain/arousal.py` | Arousal state reader/writer + score computation |
| `src/brain/jobs/language_gradient.py` | Weekly LLM reflection → policy candidates |
| `src/brain/jobs/routing_outcome_tracker.py` | Weekly routing success rate analysis |
| `src/brain/migrations/00XX_outcomes.py` | Alembic migration: outcomes, memory_retrievals, policy_candidates, arousal_state, routing_outcomes |

| Modified file | Change |
|---|---|
| `src/brain/nodes/call_llm.py` | Log retrieved memory IDs to `memory_retrievals` |
| `src/brain/lifecycle.py` | Call `outcome_scorer` at `lifecycle_end` |
| `src/brain/nodes/route_model.py` | Read `arousal_score` from state, modulate tier selection |
| `src/brain/cron.py` | Register language gradient + routing tracker + arousal update jobs |
| `src/brain/routers/policy.py` | Add `GET/POST /api/v1/policy-candidates` for T1 review |
