## Why

NUVEX currently schedules agent invocations on a first-come-first-served basis with invocation queuing (if an agent is `Running`, new invocations are queued). Arousal-based proactive wakes add a priority signal, but there is no actual preemption — a low-priority agent running a long multi-turn task cannot be interrupted by a high-priority incoming message. A real OS scheduler preempts lower-priority processes when higher-priority work arrives.

This change introduces priority-aware scheduling with cooperative preemption: high-priority invocations can pause a running low-priority agent, run to completion, then resume the paused agent. It also adds fair-share scheduling to prevent a single chatty agent from starving others.

**Priority: MEDIUM** — Important for production deployments with many agents. Not blocking for single-agent setups.

## What Changes

- **Priority levels on invocations** — Each invocation carries an explicit priority (P0-critical, P1-high, P2-normal, P3-low). Default: P2. Cron jobs default to P3. Operator/principal messages default to P1. Approval resumes default to P0.
- **Priority queue replacement** — The current FIFO invocation queue per agent is replaced with a priority heap queue. Higher priority invocations are dequeued first.
- **Cooperative preemption** — When a P0 or P1 invocation arrives for an agent currently running a P2 or P3 task, the scheduler signals the running graph to yield at the next safe checkpoint (after the current LLM call or tool call completes, not mid-call). The yielded state is saved to the checkpoint store. The high-priority invocation runs, and on completion the yielded task is resumed.
- **Fair-share token budget** — Each agent gets a per-minute token budget (default: no limit). When an agent exceeds its fair-share allocation, its subsequent invocations are deprioritized to P3 until the window resets.
- **Scheduling metrics** — Queue depth, wait time, preemption count, and fair-share utilisation exposed to the event bus and dashboard.

### Amendment to Existing Specs

- **Section 17 (Agent Lifecycle)** — New lifecycle states: `Yielded` (cooperative preemption), `Resuming`. Transition: Running → Yielded → Resuming → Running.
- **Section 4 (Brain Core)** — Graph invocation supports yield/resume via LangGraph checkpointing.
- **Arousal State (§30)** — Arousal score feeds into priority calculation as a secondary signal.

## Capabilities

### New Capabilities
- `priority-scheduler`: Priority-aware invocation scheduler with cooperative preemption
- `fair-share`: Per-agent token budget with automatic deprioritization

### Modified Capabilities
- `agent-lifecycle`: New Yielded/Resuming states; preemption transition
- `langgraph-brain`: Graph yield/resume at checkpoints for preemption
- `arousal-state`: Arousal feeds into invocation priority as secondary signal
- `event-bus`: Scheduling events (queue, dequeue, preempt, resume)

## Impact

- **Agent lifecycle** — Two new states (Yielded, Resuming) added to the state machine.
- **Invocation handler** — Queue becomes a priority heap; preemption check on every new invocation.
- **LangGraph** — Graph must support yield/resume at checkpoints (already supported via PostgresSaver).
- **Dashboard** — New metrics: queue depth per agent, avg wait time, preemption count.
