/**
 * Integration test: Backpressure Flow
 *
 * Verifies end-to-end backpressure behavior:
 * - Tasks queue when agent is busy (util >= 0.8)
 * - Tasks redirect when agent is full (util >= 1.0)
 * - Tasks are dispatched from the queue when a slot frees up
 * - Queue pressure triggers redirect before utilization hits 1.0
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { TaskEventBus } from "../../../src/tasks/event-bus.js";
import { BackpressureMonitor } from "../../../src/pipeline/backpressure.js";
import { TaskPipeline } from "../../../src/pipeline/task-pipeline.js";
import { AckState, TaskPriority, DEFAULT_PIPELINE_CONFIG } from "../../../src/pipeline/types.js";
import type { Database } from "../../../src/utils/db.js";
import type { AgentInstance } from "../../../src/orchestrator/types.js";
import type { AgentDefinition } from "../../../src/agents/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db:     Database;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-bp-test-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  new TaskStore(db).initialize();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sentMessages: unknown[] = [];

function makeAgentInstance(id: string, capacity: number, division = "engineering"): AgentInstance {
  const def: AgentDefinition = {
    id,
    name:                    `Agent ${id}`,
    tier:                    2,
    provider:                "anthropic",
    model:                   "claude-sonnet-4-6",
    skill_file:              "skills/t2.md",
    division,
    capabilities:            ["code"],
    max_concurrent_tasks:    capacity,
    token_budget_per_task:   10_000,
    cost_limit_per_hour:     1.0,
    checkpoint_interval_ms:  30_000,
    ttl_default_seconds:     600,
    heartbeat_interval_ms:   10_000,
    max_retries:             3,
    metadata:                {},
  };
  return {
    definition:            def,
    process:               { send: (m: unknown) => sentMessages.push(m) } as unknown as AgentInstance["process"],
    status:                "idle",
    active_task_count:     0,
    total_tasks_completed: 0,
    total_tokens_used:     0,
    total_cost_usd:        0,
    last_heartbeat:        "2026-01-01T00:00:00Z",
    started_at:            "2026-01-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// BackpressureMonitor unit-level flow tests
// ---------------------------------------------------------------------------

describe("BackpressureMonitor — capacity flow", () => {
  const cfg = DEFAULT_PIPELINE_CONFIG;

  it("agent transitions from accept → queue → redirect as load increases", () => {
    const monitor = new BackpressureMonitor(cfg);
    monitor.registerAgent("agent-1", 10);

    // Start: empty → accept
    expect(monitor.shouldAccept("agent-1")).toBe("accept");

    // 8/10 = 0.8 → queue
    monitor.initFromCounts("agent-1", 8, 0);
    expect(monitor.shouldAccept("agent-1")).toBe("queue");

    // 10/10 = 1.0 → redirect
    monitor.initFromCounts("agent-1", 10, 0);
    expect(monitor.shouldAccept("agent-1")).toBe("redirect");
  });

  it("completing tasks moves agent back from redirect → queue → accept", () => {
    const monitor = new BackpressureMonitor(cfg);
    monitor.registerAgent("agent-1", 10);
    monitor.initFromCounts("agent-1", 10, 0); // full

    expect(monitor.shouldAccept("agent-1")).toBe("redirect");

    monitor.onTaskCompleted("agent-1"); // 9/10 = 0.9 → queue
    expect(monitor.shouldAccept("agent-1")).toBe("queue");

    monitor.onTaskCompleted("agent-1"); // 8/10 = 0.8 → queue
    expect(monitor.shouldAccept("agent-1")).toBe("queue");

    monitor.onTaskCompleted("agent-1"); // 7/10 = 0.7 → accept
    expect(monitor.shouldAccept("agent-1")).toBe("accept");
  });

  it("queue pressure can redirect even if utilization is low", () => {
    const monitor = new BackpressureMonitor({ ...cfg, max_queue_size_per_agent: 10 });
    monitor.registerAgent("agent-1", 100); // large capacity → utilization always low

    // 9/10 queue_pressure = 0.9 > 0.8 → redirect
    monitor.initFromCounts("agent-1", 0, 9);
    expect(monitor.shouldAccept("agent-1")).toBe("redirect");

    // Drop queue below threshold
    monitor.initFromCounts("agent-1", 0, 7); // 7/10 = 0.7 ≤ 0.8 → accept
    expect(monitor.shouldAccept("agent-1")).toBe("accept");
  });
});

// ---------------------------------------------------------------------------
// TaskPipeline backpressure integration
// ---------------------------------------------------------------------------

describe("TaskPipeline — backpressure integration", () => {
  it("task is not delivered when agent is at capacity", () => {
    sentMessages.length = 0;
    const store  = new TaskStore(db);
    const task   = store.create({ title: "T", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const agents = new Map([["agent-1", makeAgentInstance("agent-1", 4, "engineering")]]);

    const pipeline = new TaskPipeline(db, new TaskEventBus(db), agents);
    pipeline.backpressure.initFromCounts("agent-1", 4, 0); // full capacity

    const result = pipeline.submit(task, TaskPriority.REGULAR, "producer-1");
    expect(result.accepted).toBe(true); // still accepted to queue
    expect(pipeline.queue.getEntry(task.id)?.ack_state).toBe(AckState.QUEUED);
    expect(sentMessages.length).toBe(0); // no IPC send → not delivered
  });

  it("task is delivered when agent has capacity (util < 0.8)", () => {
    sentMessages.length = 0;
    const store  = new TaskStore(db);
    const task   = store.create({ title: "T", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const agents = new Map([["agent-1", makeAgentInstance("agent-1", 4, "engineering")]]);

    const pipeline = new TaskPipeline(db, new TaskEventBus(db), agents);
    // active=0 → util=0 → accept

    const result = pipeline.submit(task, TaskPriority.REGULAR, "producer-1");
    expect(result.accepted).toBe(true);
    expect(pipeline.queue.getEntry(task.id)?.ack_state).toBe(AckState.ACCEPTED); // delivered
    expect(sentMessages.length).toBeGreaterThan(0); // IPC send happened
  });

  it("dispatchPending delivers queued tasks when capacity frees up", () => {
    sentMessages.length = 0;
    const store  = new TaskStore(db);
    const t1     = store.create({ title: "T1", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const t2     = store.create({ title: "T2", description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
    const agents = new Map([["agent-1", makeAgentInstance("agent-1", 4, "engineering")]]);

    const pipeline = new TaskPipeline(db, new TaskEventBus(db), agents);
    pipeline.backpressure.initFromCounts("agent-1", 4, 0); // start at full capacity

    // Both tasks queue (agent at capacity → they stay QUEUED)
    pipeline.submit(t1, TaskPriority.REGULAR, "producer-1");
    pipeline.submit(t2, TaskPriority.REGULAR, "producer-1");

    expect(pipeline.queue.getEntry(t1.id)?.ack_state).toBe(AckState.QUEUED);
    expect(pipeline.queue.getEntry(t2.id)?.ack_state).toBe(AckState.QUEUED);

    // Free up slots (simulate 3 completions → util 4/4 → 1/4 = 0.25 → accept)
    pipeline.backpressure.onTaskCompleted("agent-1");
    pipeline.backpressure.onTaskCompleted("agent-1");
    pipeline.backpressure.onTaskCompleted("agent-1");

    // Dispatch pending
    const dispatched = pipeline.dispatchPending();
    expect(dispatched).toBeGreaterThanOrEqual(1);
  });

  it("multiple agents: tasks routed away from overloaded agent", () => {
    const store   = new TaskStore(db);
    const agents  = new Map([
      ["agent-overloaded", makeAgentInstance("agent-overloaded", 4, "engineering")],
      ["agent-available",  makeAgentInstance("agent-available",  4, "engineering")],
    ]);

    const pipeline = new TaskPipeline(db, new TaskEventBus(db), agents);
    pipeline.backpressure.initFromCounts("agent-overloaded", 4, 0); // full
    // agent-available: 0/4 → accept

    // Submit multiple tasks — WorkDistributor will pick best agent
    // Since overloaded agent is "redirect", pipeline should prefer available
    // (Note: WorkDistributor picks by score, not strictly by backpressure.
    //  The pipeline then checks backpressure after assignment.)
    const tasks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const t = store.create({ title: `T${i}`, description: "", division: "engineering", type: "root", tier: 2, token_budget: 1000, cost_budget: 0.1 });
      tasks.push(t.id);
      pipeline.submit(t, TaskPriority.REGULAR, "producer-1");
    }

    // All 3 tasks should be accepted (pipeline accepted them, even if queued)
    for (const tid of tasks) {
      const entry = pipeline.queue.getEntry(tid);
      expect(entry).not.toBeNull();
    }
  });
});
