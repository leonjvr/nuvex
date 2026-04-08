## Why

NUVEX agents (Maya and future agents) are currently **stateless between invocations** and **unable to improve from outcomes**. Every task ends and disappears — the next invocation starts with the same static rules, the same confidence scores in memory, the same routing thresholds. All improvement requires a human to manually edit YAML files or SOUL.md.

By mapping NUVEX against human brain function (April 2026 analysis), two critical architectural gaps were identified that collectively limit the platform's long-term intelligence ceiling:

1. **No reward signal (brain rating: 1/10)** — the dopaminergic prediction-error loop that drives all learning in biological brains has no equivalent. Outcomes do not feed back into behavior. The system cannot learn which memories are useful, which tools are reliable, or which routing heuristics should be tightened.

2. **No continuous existence (brain rating: 3/10)** — the Reticular Activating System (RAS) maintains continuous arousal in biological brains. NUVEX ceases to exist between invocations. There is no resting state, no background vigilance, no mounting pressure from accumulated pending work.

These are not incremental polish items — they are the primary reasons NUVEX agents cannot improve by themselves over time, and why the system still requires constant human configuration maintenance.

## What Changes

### Priority 1: Outcome Feedback Loop (Synthetic Reward Signal)

An async closed loop that scores every thread on completion and propagates the outcome signal backward to adjust memory confidence and policy thresholds:

- **`outcomes` table** — persists a structured outcome record at every `lifecycle_end`: `{thread_id, agent_id, task_id, succeeded, user_confirmed, cost_usd, duration_s, tools_used[], denial_count, iteration_count}`
- **`outcome_scorer.py`** — binary scoring at `lifecycle_end`: `succeeded` = task completed + no unrecovered errors; `user_confirmed` = operator approved result (sourced from governance audit trail)
- **Memory confidence adjustment** — after scoring, walk back all memories retrieved during the thread (logged in a new `memory_retrievals` junction table) and adjust their confidence: `+0.05` on success, `-0.08` on failure (asymmetric — trust erodes faster than it builds, matching biological systems)
- **Weekly language gradient job** — a background APScheduler job reads failed threads from the past 7 days, runs a structured LLM reflection across the governance pipeline ("what policy rule would have prevented this?"), and writes candidate policy rule updates to a `policy_candidates` table for T1 agent review
- **Routing outcome tracking** — record per-task-type model success rates in `routing_outcomes`; a weekly job nudges `divisions.yaml` routing config toward proven model tiers

### Priority 2: Arousal State (Continuous Existence)

A persistent internal state struct per agent that accumulates between invocations, making the agent "aware" of its own condition before the LLM is even called:

- **`arousal_state` table** — one row per agent, updated at every `lifecycle_end` and by background cron: `{idle_seconds, pending_task_pressure, budget_burn_3day_avg, unread_channel_messages, recovery_event_count_24h, last_arousal_score}`
- **`arousal.py`** — computes a composite arousal score (0.0–1.0) from the state fields; high arousal modulates behavior at `lifecycle_start`: faster model tier selection, shorter responses, reduced memory retrieval depth, proactive check-in trigger
- **Arousal-modulated routing** — at `route_model` node, arousal score is a multiplicative weight on model selection: high-arousal (task pressure + unread messages) routes to `fast` model regardless of task type classification; zero-arousal (idle >72h, no pending tasks) defers to `primary`
- **Proactive wake trigger** — when `pending_task_pressure > threshold` AND `idle_seconds > 3600`, cron triggers an agent invocation with a synthetic "check your pending tasks" prompt rather than waiting for a user message

## Capabilities

### New Capabilities

- `outcome-feedback-loop`: Closed async loop from thread completion → binary outcome scoring → memory confidence adjustment → weekly policy reflection. Makes memory retrieval reinforce itself over time and lets failed patterns surface as policy candidates.
- `arousal-state`: Persistent per-agent internal state struct accumulating between invocations. Arousal score modulates model routing, response verbosity, memory depth, and proactive invocation triggers. Approximates biological RAS/hypothalamus homeostasis.

## Prior Art & References

### OpenClaw-RL ([github.com/Gen-Verse/OpenClaw-RL](https://github.com/Gen-Verse/OpenClaw-RL), ⭐4.7k)
**Paper:** arXiv:2603.10165 — "Train Any Agent Simply by Talking"
Fully async RL framework that intercepts live conversations and continuously optimizes agent policy in the background. Three learning paradigms: Binary RL (scalar good/bad), On-Policy Distillation (token-level textual corrections), and Combine (mixed). NUVEX cannot retrain weights (closed API), but the async 4-component loop pattern (scorer → updater → policy nudge → deploy) is directly applicable at the symbolic layer — replacing gradient descent on weights with confidence delta propagation on memory rows and policy threshold nudges.
**Key lesson:** Binary RL is the most compatible with NUVEX's architecture. Success/failure at task boundary = reward signal. No intermediate shaping needed.

### Agents 2.0 — Symbolic Learning ([github.com/aiwaves-cn/agents](https://github.com/aiwaves-cn/agents), ⭐5.9k)
**Paper:** arXiv:2406.18532 — "Symbolic Learning Enables Self-Evolving Agents"
Implements backpropagation in natural language: agent pipeline = neural net, prompts/policy rules = weights, LLM-based loss function = objective. "Language gradients" are textual reflections on what went wrong, computed per-node along the execution trajectory. No GPU, no fine-tuning. Works by updating symbolic representations (text, rules) rather than floating-point weights.
**Key lesson:** The weekly language gradient job in this spec directly adapts this approach. A structured reflection prompt applied to a batch of failed threads produces actionable policy rule candidates without any model training.

### mem0 ([github.com/mem0ai/mem0](https://github.com/mem0ai/mem0), ⭐52.3k)
**Paper:** arXiv:2504.19413 — "Building Production-Ready AI Agents with Scalable Long-Term Memory"
Production memory layer with +26% accuracy over OpenAI Memory on LOCOMO benchmark. Multi-level scoping (User/Session/Agent), vector search, LangGraph integration.
**Key gap:** mem0 adds memories but does not adjust retrieval weight based on outcome — every memory is equally trusted regardless of whether it contributed to a success or failure. NUVEX's outcome-weighted confidence adjustment is an architectural lead over mem0's approach.

### BabyAGI ([github.com/yoheinakajima/babyagi](https://github.com/yoheinakajima/babyagi), ⭐22.2k)
Trigger system: functions fire automatically in response to other functions completing. Comprehensive execution logging tracking function dependencies and relationships.
**Key lesson:** Continuous existence is best approximated not by a running loop (prohibitive at API costs) but by **persistent mutable state accumulation between invocations**. BabyAGI's trigger pattern is the closest published approximation. In NUVEX, `arousal_state` is a PostgreSQL row that accumulates passively — the agent "wakes up" already knowing its internal condition.

## Constraints

- Must not modify SOUL.md or IDENTITY.md — these are the agent's invariant self and must not be optimized away
- Memory confidence adjustment must be bounded: floor=0.1, ceiling=1.0 — memories never fully disappear from outcome scoring alone, only from the forgetter's explicit pruning policy
- The language gradient job must present candidates for T1 review — it does not auto-apply policy changes
- Arousal state must degrade gracefully: if `arousal_state` row is missing, `lifecycle_start` proceeds normally without arousal modulation
- All new tables must have Alembic migrations; no schema changes in source code without migrations
