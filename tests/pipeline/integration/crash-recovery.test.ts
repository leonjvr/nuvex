/**
 * Integration test: Crash Recovery
 *
 * Verifies that TaskPipeline.recover() correctly restores in-flight state
 * after a simulated process crash:
 *   - ACCEPTED tasks are requeued to QUEUED
 *   - RUNNING tasks remain RUNNING (orchestrator decides retry/escalation)
 *   - QUEUED tasks are untouched
 *   - Backpressure counts are reconstructed from DB
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { TaskEventBus } from "../../../src/tasks/event-bus.js";
import { TaskPipeline } from "../../../src/pipeline/task-pipeline.js";
import { AckState, TaskPriority } from "../../../src/pipeline/types.js";
import type { QueueEntry } from "../../../src/pipeline/types.js";
import type { Database } from "../../../src/utils/db.js";
import type { AgentInstance } from "../../../src/orchestrator/types.js";
import type { AgentDefinition } from "../../../src/agents/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db:     Database;
let store:  TaskStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-recovery-test-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store  = new TaskStore(db);
  store.initialize();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentInstance(id: string, capacity = 4): AgentInstance {
  const def: AgentDefinition = {
    id,
    name:                    `Agent ${id}`,
    tier:                    2,
    provider:                "anthropic",
    model:                   "claude-sonnet-4-6",
    skill_file:              "skills/t2.md",
    division:                "engineering",
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
    process:               { send: () => {} } as unknown as AgentInstance["process"],
    status:                "idle",
    active_task_count:     0,
    total_tasks_completed: 0,
    total_tokens_used:     0,
    total_cost_usd:        0,
    last_heartbeat:        "2026-01-01T00:00:00Z",
    started_at:            "2026-01-01T00:00:00Z",
  };
}

function makePipeline(agentMap: Map<string, AgentInstance>): TaskPipeline {
  const eventBus = new TaskEventBus(db);
  return new TaskPipeline(db, eventBus, agentMap);
}

function createTask(title = "T"): string {
  const task = store.create({
    title,
    description:  "recovery test",
    division:     "engineering",
    type:         "root",
    tier:         2,
    token_budget: 10_000,
    cost_budget:  1.0,
  });
  return task.id;
}

function makeRawEntry(
  taskId:    string,
  agentId:   string,
  ackState:  AckState,
  producer = "producer-1",
): QueueEntry {
  const now = new Date().toISOString();
  return {
    task_id:           taskId,
    producer_agent_id: producer,
    consumer_agent_id: agentId,
    priority:          TaskPriority.REGULAR,
    original_priority: TaskPriority.REGULAR,
    ack_state:         ackState,
    queued_at:         now,
    accepted_at:       ackState !== AckState.QUEUED ? now : null,
    started_at:        ackState === AckState.RUNNING ? now : null,
    completed_at:      null,
    ttl_expires_at:    new Date(Date.now() + 600_000).toISOString(),
    delivery_attempts: ackState !== AckState.QUEUED ? 1 : 0,
    last_delivery_at:  ackState !== AckState.QUEUED ? now : null,
    excluded_agents:   [],
    metadata:          {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskPipeline.recover — crash recovery", () => {
  it("requeues ACCEPTED tasks back to QUEUED", () => {
    const taskId   = createTask("accepted-task");
    const agentMap = new Map([["agent-1", makeAgentInstance("agent-1")]]);

    // Simulate: pipeline was running, task was ACCEPTED but crash happened
    const pipeline1 = makePipeline(agentMap);
    pipeline1.queue.enqueue(makeRawEntry(taskId, "agent-1", AckState.ACCEPTED));

    // Verify it's ACCEPTED in DB
    expect(pipeline1.queue.getEntry(taskId)?.ack_state).toBe(AckState.ACCEPTED);

    // Recover with a fresh pipeline instance (simulates restart)
    const pipeline2  = makePipeline(agentMap);
    const recovered  = pipeline2.recover();

    expect(recovered).toBeGreaterThanOrEqual(1);
    expect(pipeline2.queue.getEntry(taskId)?.ack_state).toBe(AckState.QUEUED);
  });

  it("leaves QUEUED tasks untouched during recovery", () => {
    const taskId   = createTask("queued-task");
    const agentMap = new Map([["agent-1", makeAgentInstance("agent-1")]]);

    const pipeline1 = makePipeline(agentMap);
    pipeline1.queue.enqueue(makeRawEntry(taskId, "agent-1", AckState.QUEUED));

    const pipeline2 = makePipeline(agentMap);
    pipeline2.recover();

    // Still QUEUED — nothing to requeue
    expect(pipeline2.queue.getEntry(taskId)?.ack_state).toBe(AckState.QUEUED);
  });

  it("leaves RUNNING tasks untouched during recovery (orchestrator handles those)", () => {
    const taskId   = createTask("running-task");
    const agentMap = new Map([["agent-1", makeAgentInstance("agent-1")]]);

    const pipeline1 = makePipeline(agentMap);
    pipeline1.queue.enqueue(makeRawEntry(taskId, "agent-1", AckState.RUNNING));

    const pipeline2 = makePipeline(agentMap);
    pipeline2.recover();

    // RUNNING tasks are not requeued by recovery
    expect(pipeline2.queue.getEntry(taskId)?.ack_state).toBe(AckState.RUNNING);
  });

  it("reconstructs backpressure counts for RUNNING tasks per agent", () => {
    const id1 = createTask("running-1");
    const id2 = createTask("running-2");
    const agentMap = new Map([["agent-1", makeAgentInstance("agent-1", 4)]]);

    const pipeline1 = makePipeline(agentMap);
    pipeline1.queue.enqueue(makeRawEntry(id1, "agent-1", AckState.RUNNING));
    pipeline1.queue.enqueue(makeRawEntry(id2, "agent-1", AckState.RUNNING));

    const pipeline2 = makePipeline(agentMap);
    pipeline2.recover();

    // 2 RUNNING tasks → backpressure should reflect active=2
    const status = pipeline2.backpressure.getStatus("agent-1");
    expect(status.active).toBe(2);
  });

  it("reconstructs backpressure queued count from QUEUED tasks per agent", () => {
    const id1 = createTask("queued-bp");
    const agentMap = new Map([["agent-1", makeAgentInstance("agent-1", 4)]]);

    const pipeline1 = makePipeline(agentMap);
    pipeline1.queue.enqueue(makeRawEntry(id1, "agent-1", AckState.QUEUED));

    const pipeline2 = makePipeline(agentMap);
    pipeline2.recover();

    const status = pipeline2.backpressure.getStatus("agent-1");
    expect(status.queued).toBe(1);
  });

  it("returns 0 when there is nothing to recover", () => {
    const agentMap  = new Map([["agent-1", makeAgentInstance("agent-1")]]);
    const pipeline  = makePipeline(agentMap);
    const recovered = pipeline.recover();
    expect(recovered).toBe(0);
  });

  it("ignores terminal entries (COMPLETED, CANCELLED, EXPIRED) during recovery", () => {
    const tid1 = createTask("terminal-1");
    const tid2 = createTask("terminal-2");
    const tid3 = createTask("terminal-3");
    const agentMap = new Map([["agent-1", makeAgentInstance("agent-1")]]);

    const pipeline1 = makePipeline(agentMap);
    pipeline1.queue.enqueue(makeRawEntry(tid1, "agent-1", AckState.QUEUED));
    pipeline1.queue.enqueue(makeRawEntry(tid2, "agent-1", AckState.QUEUED));
    pipeline1.queue.enqueue(makeRawEntry(tid3, "agent-1", AckState.QUEUED));

    // Mark as terminal
    pipeline1.queue.updateState(tid1, AckState.COMPLETED, { completed_at: new Date().toISOString() });
    pipeline1.queue.updateState(tid2, AckState.CANCELLED, { completed_at: new Date().toISOString() });
    pipeline1.queue.updateState(tid3, AckState.EXPIRED, {});

    const pipeline2 = makePipeline(agentMap);
    const recovered = pipeline2.recover();

    // Non-terminal count = 0 (all terminal)
    expect(recovered).toBe(0);
  });
});
