## Context

NUVEX agent invocations are dispatched in `src/brain/routers/invoke.py`. The `AgentLifecycleManager` tracks running state and queues invocations when an agent is busy. The queue is FIFO — no priority ordering. Arousal state provides a proactive wake signal but does not affect queuing order.

Existing infrastructure:
- `src/brain/lifecycle.py` — AgentLifecycleManager with states: Spawning, TrustRequired, ReadyForPrompt, Running, Finished, Failed
- `src/brain/routers/invoke.py` — POST /api/v1/invoke handler that checks lifecycle before graph invocation
- `src/brain/graph.py` — LangGraph StateGraph with PostgresSaver checkpointing
- `src/brain/checkpointer.py` — PostgresSaver with MemorySaver fallback
- `src/brain/arousal.py` — weighted arousal score [0,1] with proactive wake conditions
- `src/brain/cron.py` — CronRegistry invoking agents on schedule

Constraints:
- Preemption must be cooperative — cannot kill an in-flight LLM API call
- LangGraph checkpoints already persist full state — yield/resume is a state save/load
- Must not break single-agent setups (no overhead when only one invocation at a time)
- Fair-share must be opt-in (disabled by default for backward compat)

## Goals / Non-Goals

**Goals:**
- Priority-ordered invocation queue (P0-P3)
- Cooperative preemption at graph checkpoints
- Fair-share deprioritization for token-heavy agents
- Lifecycle states for yield/resume
- Scheduling metrics on event bus and dashboard

**Non-Goals:**
- True preemption (killing mid-LLM-call) — too expensive and unreliable
- Cross-agent priority (Agent A preempts Agent B) — each agent has its own queue
- Global token budget across all agents — that's org-level budget, already specced
- Real-time scheduling guarantees — this is cooperative, not hard-realtime

## Decisions

### 1. Priority Levels

| Level | Name | Default Sources | Use Case |
|---|---|---|---|
| P0 | Critical | Approval resumes, operator manual trigger | Must run immediately |
| P1 | High | Owner/admin messages (principal), arousal.proactive_wake | Important, preempts normal |
| P2 | Normal | Regular user messages, task packet triggers | Default for most work |
| P3 | Low | Cron jobs, background tasks, deprioritized agents | Run when idle |

Priority is set at invocation time and is immutable for that invocation.

### 2. Queue Implementation

Replace the current `list[asyncio.Future]` queue in `AgentLifecycleManager` with a `heapq`-based priority queue. Each entry: `(priority, sequence_number, invocation_coroutine)`. The sequence number breaks ties (FIFO within same priority).

### 3. Cooperative Preemption Protocol

```
1. P1 invocation arrives for agent "maya" while a P3 cron job is running
2. Scheduler sets `state.yield_requested = True` on the running graph
3. After current node completes (call_llm or execute_tools), graph checks yield_requested
4. If True: save state to checkpointer, transition lifecycle Running → Yielded, dequeue P1
5. P1 invocation runs to completion, transitions to Finished
6. Scheduler resumes yielded state: load from checkpointer, transition Yielded → Resuming → Running
7. Graph continues from where it yielded
```

Yield points are after every graph node (the conditional edge check). No mid-node interruption.

### 4. Fair-Share Token Budget

Optional per-agent setting in divisions.yaml:

```yaml
agents:
  maya:
    scheduling:
      fair_share_tokens_per_minute: 50000  # 0 = unlimited (default)
```

When an agent exceeds its fair-share allocation in a rolling 60-second window, all new invocations for that agent are set to P3 until the window resets. Existing running invocations are not affected.

### 5. Lifecycle State Transitions (Amendment)

```
Spawning → TrustRequired → ReadyForPrompt → Running ⟷ Yielded
                                              ↓ ↗           
                                          Resuming          
                                              ↓
                                    Finished / Failed
```

New transitions:
- Running → Yielded (preemption yield)
- Yielded → Resuming (preempting invocation finished)
- Resuming → Running (checkpoint loaded, graph continues)
- Yielded → Failed (preempting invocation caused irrecoverable error)

## Module Structure

```
src/brain/scheduling/
├── __init__.py
├── priority.py        # Priority enum, priority assignment logic
├── queue.py           # PriorityQueue with heapq
├── preemption.py      # Preemption protocol, yield/resume coordination
└── fair_share.py      # Token budget tracker, deprioritization logic
```

## Testing Strategy

- **Unit tests**: priority queue ordering, preemption signal, fair-share deprioritization
- **Integration tests**: two invocations at different priorities — higher runs first; preemption yield/resume preserves state
