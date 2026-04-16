## 1. Priority Queue

> Spec: `specs/priority-scheduler/spec.md`
>
> Replace FIFO invocation queue with priority heap.
>
> **Priority: MEDIUM** — Important for multi-agent production. No impact on single-agent setups.

- [ ] 1.1 Create `src/brain/scheduling/__init__.py` — exports `PriorityQueue`, `InvocationPriority`, `Scheduler`
- [ ] 1.2 Create `src/brain/scheduling/priority.py` — `InvocationPriority` enum: P0_CRITICAL, P1_HIGH, P2_NORMAL, P3_LOW; `assign_priority(request: InvokeRequest) -> InvocationPriority` function implementing source-based defaults
- [ ] 1.3 Add `priority: str | None` field to `InvokeRequest` in `src/shared/models.py` — explicit override; validated against P0-P3
- [ ] 1.4 Create `src/brain/scheduling/queue.py` — `PriorityQueue` class using `heapq`; entries are `(priority_value, sequence_number, invocation_future)`; methods: `push(priority, coro)`, `pop() -> coro`, `peek() -> priority`, `size() -> int`
- [ ] 1.5 Refactor `src/brain/lifecycle.py` — replace internal `list` queue with `PriorityQueue`; dequeue highest priority first
- [ ] 1.6 Update `src/brain/routers/invoke.py` — call `assign_priority()` on incoming request; pass priority to lifecycle manager
- [ ] 1.7 Update `src/brain/cron.py` — cron invocations use P3 by default; manual trigger uses P0
- [ ] 1.8 Emit `scheduler.queued` and `scheduler.dequeued` events to event bus with priority and wait_time_ms

## 2. Cooperative Preemption

> Spec: `specs/priority-scheduler/spec.md` (preemption section)
>
> Allow high-priority invocations to pause running low-priority tasks.
>
> **Priority: MEDIUM** — Depends on §1.

- [ ] 2.1 Add `yield_requested: bool = False` and `preempted_by: str | None = None` fields to `AgentState` in `src/brain/state.py`
- [ ] 2.2 Create `src/brain/scheduling/preemption.py` — `PreemptionCoordinator`: check if incoming priority > running priority; if so, set `yield_requested=True` on the running state
- [ ] 2.3 Add yield check in `src/brain/graph.py` — after every node (conditional edge), if `state.yield_requested`: save state to checkpointer, return "yield" edge → lifecycle_end with `Yielded` state
- [ ] 2.4 Implement resume logic — after preempting invocation finishes, `PreemptionCoordinator` loads yielded checkpoint, resets `yield_requested=False`, resumes graph from saved node
- [ ] 2.5 Integrate with `AgentLifecycleManager` — `yield_agent(agent_id, preempting_invocation_id)` and `resume_agent(agent_id)` methods
- [ ] 2.6 Emit `scheduler.preempted` and `scheduler.resumed` events to event bus

## 3. Lifecycle States Amendment

> Spec: `specs/agent-lifecycle/spec.md`
>
> Add Yielded and Resuming states to lifecycle state machine.
>
> **Priority: MEDIUM** — Depends on §2.

- [ ] 3.1 Add `Yielded` and `Resuming` to lifecycle states enum in `src/brain/lifecycle.py`
- [ ] 3.2 Add valid transitions: Running→Yielded, Yielded→Resuming, Resuming→Running, Yielded→Failed
- [ ] 3.3 Persist Yielded/Resuming transitions to `agent_lifecycle` table with preemption context
- [ ] 3.4 Update `GET /api/v1/agents/{id}/status` to include `yielded_since`, `preempted_by` when in Yielded state
- [ ] 3.5 Update dashboard agent lifecycle timeline to show Yielded/Resuming markers

## 4. Fair-Share Token Budget

> Spec: `specs/fair-share/spec.md`
>
> Optional per-agent token budget with automatic deprioritization.
>
> **Priority: LOW** — Nice-to-have. Only relevant for deployments with contention.

- [ ] 4.1 Create `src/brain/scheduling/fair_share.py` — `FairShareTracker`: per-agent rolling 60-second token counter using `budget_ledger` queries
- [ ] 4.2 Add `scheduling.fair_share_tokens_per_minute: int = 0` to `AgentDefinition` in `src/shared/config.py` (0 = disabled)
- [ ] 4.3 Integrate with `assign_priority()` — if agent exceeded fair-share, override priority to P3; log the override
- [ ] 4.4 Implement window reset — token count derived from rolling 60s window of `budget_ledger` entries; no running state to reset

## 5. Testing

> **Priority: MEDIUM** — Must validate preemption correctness.

- [ ] 5.1 Write unit test: `PriorityQueue` — P1 dequeued before P3; FIFO within same priority
- [ ] 5.2 Write unit test: `assign_priority()` — cron → P3, principal message → P1, approval resume → P0, explicit override respected
- [ ] 5.3 Write unit test: preemption signal — P1 arrives while P3 running → yield_requested=True; P2 while P2 → no preemption
- [ ] 5.4 Write unit test: lifecycle transitions — Running→Yielded→Resuming→Running valid; Running→Resuming invalid
- [ ] 5.5 Write unit test: fair-share — 55000 tokens in 60s with 50000 limit → all new invocations P3; under limit → normal priority
- [ ] 5.6 Write integration test: two invocations (P3 then P1) — P1 preempts P3; P3 resumes after P1 completes; both produce correct results
- [ ] 5.7 Write integration test: fair-share deprioritization — agent exceeds token budget, subsequent invocation scheduled as P3
