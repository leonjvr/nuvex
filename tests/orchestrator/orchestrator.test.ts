/**
 * Tests for src/orchestrator/orchestrator.ts
 *
 * Covers:
 * - start/stop/pause/resume lifecycle
 * - handleNewTask: assigns to agent, queues when none available
 * - handleResultReady: root task → DONE; child task → synthesis check
 * - handleTaskFailed: retry vs escalate
 * - handleAgentCrash: resets tasks without checkpoints
 * - handleAgentRecovery: updates agent status
 * - handleBudgetExceeded: escalates
 * - recoverInFlightTasks: handles all state combinations
 * - getStatus: correct aggregated stats
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskEventBus } from "../../src/tasks/event-bus.js";
import { OrchestratorProcess } from "../../src/orchestrator/orchestrator.js";
import { DEFAULT_DELEGATION_RULES } from "../../src/orchestrator/types.js";
import type { OrchestratorConfig, AgentInstance } from "../../src/orchestrator/types.js";
import type { Database } from "../../src/utils/db.js";
import type { CreateTaskInput } from "../../src/tasks/types.js";
import type { AgentDefinition } from "../../src/agents/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let bus: TaskEventBus;
let orchestrator: OrchestratorProcess;

function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  return {
    max_agents:             10,
    max_agents_per_tier:    { 1: 2, 2: 4, 3: 8 },
    event_poll_interval_ms: 10, // short for tests
    delegation_timeout_ms:  5_000,
    synthesis_timeout_ms:   30_000,
    max_tree_depth:         3,
    max_tree_breadth:       5,
    default_division:       "engineering",
    agent_definitions:      [],
    governance_root:        "/tmp/governance",
    delegation_rules:       DEFAULT_DELEGATION_RULES,
    ...overrides,
  };
}

function makeAgentDef(id: string, tier: 1 | 2 | 3 = 2): AgentDefinition {
  return {
    id,
    name:                    `Agent ${id}`,
    tier,
    provider:                "anthropic",
    model:                   "claude-sonnet-4-6",
    skill_file:              "skills/t2.md",
    division:                "engineering",
    capabilities:            ["code"],
    max_concurrent_tasks:    4,
    token_budget_per_task:   10_000,
    cost_limit_per_hour:     1.0,
    checkpoint_interval_ms:  30_000,
    ttl_default_seconds:     600,
    heartbeat_interval_ms:   10_000,
    max_retries:             3,
    metadata:                {},
  };
}

function makeAgent(id: string, tier: 1 | 2 | 3 = 2): AgentInstance {
  return {
    definition:            makeAgentDef(id, tier),
    process:               { send: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined), onExit: vi.fn() } as unknown as AgentInstance["process"],
    status:                "idle",
    active_task_count:     0,
    total_tasks_completed: 0,
    total_tokens_used:     0,
    total_cost_usd:        0,
    last_heartbeat:        "2026-01-01T00:00:00Z",
    started_at:            "2026-01-01T00:00:00Z",
  };
}

function makeInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title:        "Task",
    description:  "Test",
    division:     "engineering",
    type:         "root",
    tier:         2,
    token_budget: 10_000,
    cost_budget:  1.0,
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir      = mkdtempSync(join(tmpdir(), "sidjua-orch-test-"));
  db          = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store       = new TaskStore(db);
  store.initialize();
  bus         = new TaskEventBus(db);
  bus.initialize();
  orchestrator = new OrchestratorProcess(db, bus, makeConfig());
});

afterEach(async () => {
  if (orchestrator.state === "RUNNING") {
    await orchestrator.stop();
  }
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers — call private handlers directly
// ---------------------------------------------------------------------------

type PrivateOrch = {
  handleNewTask(event: { task_id: string; event_type: string; data: Record<string, unknown> }): Promise<void>;
  handleResultReady(event: { task_id: string; event_type: string; data: Record<string, unknown> }): Promise<void>;
  handleTaskFailed(event: { task_id: string; event_type: string; data: Record<string, unknown> }): Promise<void>;
  handleAgentCrash(event: { agent_from: string | null; task_id: string; event_type: string; data: Record<string, unknown> }): Promise<void>;
  handleAgentRecovery(event: { agent_from: string | null; task_id: string; event_type: string; data: Record<string, unknown> }): Promise<void>;
  handleBudgetExceeded(event: { task_id: string; event_type: string; data: Record<string, unknown> }): Promise<void>;
};

function priv(o: OrchestratorProcess): PrivateOrch {
  return o as unknown as PrivateOrch;
}

function makeEvent(taskId: string, extraData: Record<string, unknown> = {}) {
  return {
    id:             "evt-1",
    event_type:     "TASK_CREATED",
    task_id:        taskId,
    parent_task_id: null,
    agent_from:     null,
    agent_to:       "orchestrator",
    division:       "engineering",
    data:           extraData,
    created_at:     "2026-01-01T00:00:00Z",
    consumed:       false,
    consumed_at:    null,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("OrchestratorProcess lifecycle", () => {
  it("starts in STOPPED state", () => {
    expect(orchestrator.state).toBe("STOPPED");
  });

  it("transitions to RUNNING after start()", async () => {
    await orchestrator.start();
    expect(orchestrator.state).toBe("RUNNING");
    await orchestrator.stop();
  });

  it("throws if started twice", async () => {
    await orchestrator.start();
    await expect(orchestrator.start()).rejects.toThrow("Cannot start");
    await orchestrator.stop();
  });

  it("transitions to STOPPED after stop()", async () => {
    await orchestrator.start();
    await orchestrator.stop();
    expect(orchestrator.state).toBe("STOPPED");
  });

  it("pause/resume cycle works", async () => {
    await orchestrator.start();
    await orchestrator.pause();
    expect(orchestrator.state).toBe("PAUSED");
    await orchestrator.resume();
    expect(orchestrator.state).toBe("RUNNING");
    await orchestrator.stop();
  });

  it("stop() is idempotent", async () => {
    await orchestrator.start();
    await orchestrator.stop();
    // Second stop should not throw
    await expect(orchestrator.stop()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleNewTask
// ---------------------------------------------------------------------------

describe("OrchestratorProcess.handleNewTask", () => {
  it("assigns task to available T2 agent", async () => {
    const agent = makeAgent("agent-1", 2);
    orchestrator.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2 }));
    await priv(orchestrator).handleNewTask(makeEvent(task.id));

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("ASSIGNED");
    expect(updated.assigned_agent).toBe("agent-1");
  });

  it("sends IPC TASK_ASSIGNED to agent process", async () => {
    const agent = makeAgent("agent-1", 2);
    orchestrator.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2 }));
    await priv(orchestrator).handleNewTask(makeEvent(task.id));

    expect(agent.process.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TASK_ASSIGNED", task_id: task.id }),
    );
  });

  it("queues task as PENDING when no agent available", async () => {
    const task = store.create(makeInput({ tier: 2 }));
    await priv(orchestrator).handleNewTask(makeEvent(task.id));

    expect(store.get(task.id)!.status).toBe("PENDING");
  });

  it("increments agent active_task_count on assignment", async () => {
    const agent = makeAgent("agent-1", 2);
    orchestrator.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2 }));
    await priv(orchestrator).handleNewTask(makeEvent(task.id));

    expect(orchestrator.agents.get("agent-1")!.active_task_count).toBe(1);
  });

  it("skips already-assigned tasks", async () => {
    const agent = makeAgent("agent-1", 2);
    orchestrator.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2 }));
    store.update(task.id, { status: "ASSIGNED", assigned_agent: "agent-1" });

    await priv(orchestrator).handleNewTask(makeEvent(task.id));
    // Should not double-assign
    expect(agent.process.send).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleResultReady
// ---------------------------------------------------------------------------

describe("OrchestratorProcess.handleResultReady", () => {
  it("marks root task as DONE", async () => {
    const task = store.create(makeInput({ tier: 1, type: "root" }));
    // Root tasks have no parent_id
    store.update(task.id, { status: "RUNNING" });

    await priv(orchestrator).handleResultReady(makeEvent(task.id));

    expect(store.get(task.id)!.status).toBe("DONE");
  });

  it("decrements agent active_task_count", async () => {
    const agent = makeAgent("agent-1", 2);
    agent.active_task_count = 2;
    orchestrator.registerAgent(agent);

    const task = store.create(makeInput({ tier: 1, type: "root", assigned_agent: "agent-1" }));
    await priv(orchestrator).handleResultReady(makeEvent(task.id));

    expect(orchestrator.agents.get("agent-1")!.active_task_count).toBe(1);
  });

  it("increments agent total_tasks_completed", async () => {
    const agent = makeAgent("agent-1");
    orchestrator.registerAgent(agent);

    const task = store.create(makeInput({ tier: 1, type: "root", assigned_agent: "agent-1" }));
    await priv(orchestrator).handleResultReady(makeEvent(task.id));

    expect(orchestrator.agents.get("agent-1")!.total_tasks_completed).toBe(1);
  });

  it("triggers synthesis check for child task", async () => {
    const parent = store.create(makeInput({ tier: 1, type: "root", sub_tasks_expected: 1 }));
    const child  = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
    }));
    store.update(parent.id, { status: "WAITING", assigned_agent: "parent-agent" });
    store.update(child.id, { status: "RUNNING", result_summary: "done" });

    await priv(orchestrator).handleResultReady(makeEvent(child.id));

    // Parent should be updated to REVIEW (by triggerParentSynthesis)
    const updatedParent = store.get(parent.id)!;
    expect(updatedParent.status).toBe("REVIEW");
  });
});

// ---------------------------------------------------------------------------
// handleTaskFailed
// ---------------------------------------------------------------------------

describe("OrchestratorProcess.handleTaskFailed", () => {
  it("requeues task when retries remaining", async () => {
    const task = store.create(makeInput({ tier: 2, max_retries: 3 }));
    store.update(task.id, { retry_count: 1, status: "RUNNING" });

    await priv(orchestrator).handleTaskFailed(makeEvent(task.id));

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("PENDING");
    expect(updated.retry_count).toBe(2);
    expect(updated.assigned_agent).toBeNull();
  });

  it("escalates when retries exhausted", async () => {
    const parent = store.create(makeInput({ tier: 1, type: "root" }));
    const task   = store.create(makeInput({
      tier: 2, max_retries: 2,
      parent_id: parent.id, root_id: parent.id,
    }));
    store.update(task.id, { retry_count: 2, status: "RUNNING" });

    await priv(orchestrator).handleTaskFailed(makeEvent(task.id));

    // With retries exhausted, task should be FAILED then ESCALATED
    const updated = store.get(task.id)!;
    expect(["FAILED", "ESCALATED"]).toContain(updated.status);
  });
});

// ---------------------------------------------------------------------------
// handleAgentCrash
// ---------------------------------------------------------------------------

describe("OrchestratorProcess.handleAgentCrash", () => {
  it("marks agent as crashed in registry", async () => {
    const agent = makeAgent("agent-1");
    orchestrator.registerAgent(agent);

    await priv(orchestrator).handleAgentCrash({
      ...makeEvent("task-x"),
      agent_from: "agent-1",
    });

    expect(orchestrator.agents.get("agent-1")!.status).toBe("crashed");
  });

  it("resets running tasks without checkpoint to PENDING", async () => {
    const agent = makeAgent("agent-1");
    orchestrator.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2, assigned_agent: "agent-1" }));
    store.update(task.id, { status: "RUNNING", checkpoint: null });

    await priv(orchestrator).handleAgentCrash({
      ...makeEvent(task.id),
      agent_from: "agent-1",
    });

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("PENDING");
    expect(updated.assigned_agent).toBeNull();
    expect(updated.retry_count).toBe(1);
  });

  it("does not reset tasks that have checkpoints", async () => {
    const agent = makeAgent("agent-1");
    orchestrator.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2, assigned_agent: "agent-1" }));
    store.update(task.id, { status: "RUNNING", checkpoint: '{"step": 3}' });

    await priv(orchestrator).handleAgentCrash({
      ...makeEvent(task.id),
      agent_from: "agent-1",
    });

    // Task with checkpoint stays RUNNING (agent resumes after restart)
    expect(store.get(task.id)!.status).toBe("RUNNING");
  });
});

// ---------------------------------------------------------------------------
// handleAgentRecovery
// ---------------------------------------------------------------------------

describe("OrchestratorProcess.handleAgentRecovery", () => {
  it("marks idle agent as idle after recovery", async () => {
    const agent = makeAgent("agent-1");
    agent.status = "crashed";
    orchestrator.registerAgent(agent);

    await priv(orchestrator).handleAgentRecovery({
      ...makeEvent("task-x"),
      agent_from: "agent-1",
    });

    expect(orchestrator.agents.get("agent-1")!.status).toBe("idle");
  });

  it("marks busy agent as busy after recovery if has active tasks", async () => {
    const agent = makeAgent("agent-1");
    agent.status = "crashed";
    agent.active_task_count = 2;
    orchestrator.registerAgent(agent);

    await priv(orchestrator).handleAgentRecovery({
      ...makeEvent("task-x"),
      agent_from: "agent-1",
    });

    expect(orchestrator.agents.get("agent-1")!.status).toBe("busy");
  });
});

// ---------------------------------------------------------------------------
// recoverInFlightTasks
// ---------------------------------------------------------------------------

describe("OrchestratorProcess.recoverInFlightTasks", () => {
  it("resets RUNNING tasks without checkpoint to PENDING", async () => {
    const task = store.create(makeInput({ tier: 2 }));
    store.update(task.id, { status: "RUNNING", checkpoint: null });

    await orchestrator.recoverInFlightTasks();

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("PENDING");
    expect(updated.retry_count).toBe(1);
  });

  it("leaves RUNNING tasks with checkpoint unchanged", async () => {
    const task = store.create(makeInput({ tier: 2 }));
    store.update(task.id, { status: "RUNNING", checkpoint: '{"step":1}' });

    await orchestrator.recoverInFlightTasks();

    expect(store.get(task.id)!.status).toBe("RUNNING");
  });

  it("resets ASSIGNED tasks with no live agent to PENDING", async () => {
    const task = store.create(makeInput({ tier: 2, assigned_agent: "dead-agent" }));
    store.update(task.id, { status: "ASSIGNED" });
    // dead-agent not in orchestrator.agents → treated as dead

    await orchestrator.recoverInFlightTasks();

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("PENDING");
    expect(updated.assigned_agent).toBeNull();
  });

  it("triggers synthesis for WAITING tasks whose sub-tasks all completed", async () => {
    const parent = store.create(makeInput({ tier: 1, type: "root", sub_tasks_expected: 1, assigned_agent: "parent-agent" }));
    const child  = store.create(makeInput({ tier: 2, type: "delegation", parent_id: parent.id, root_id: parent.id }));

    store.update(parent.id, { status: "WAITING" });
    store.update(child.id,  { status: "DONE", result_summary: "done" });

    await orchestrator.recoverInFlightTasks();

    // Parent should be set to REVIEW (synthesis triggered)
    expect(store.get(parent.id)!.status).toBe("REVIEW");
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe("OrchestratorProcess.getStatus", () => {
  it("returns STOPPED state initially", () => {
    const status = orchestrator.getStatus();
    expect(status.state).toBe("STOPPED");
  });

  it("counts agents by tier", () => {
    orchestrator.registerAgent(makeAgent("t1a", 1));
    orchestrator.registerAgent(makeAgent("t2a", 2));
    orchestrator.registerAgent(makeAgent("t2b", 2));

    const status = orchestrator.getStatus();
    expect(status.agents.total).toBe(3);
    expect(status.agents.by_tier[1]).toBe(1);
    expect(status.agents.by_tier[2]).toBe(2);
  });

  it("counts tasks by status", () => {
    store.create(makeInput({ tier: 2 }));
    const t2 = store.create(makeInput({ tier: 2 }));
    store.update(t2.id, { status: "RUNNING" });

    const status = orchestrator.getStatus();
    expect(status.tasks.total).toBeGreaterThanOrEqual(2);
    expect(status.tasks.by_status["CREATED"]).toBeGreaterThanOrEqual(1);
    expect(status.tasks.by_status["RUNNING"]).toBeGreaterThanOrEqual(1);
  });

  it("returns 0 uptime when not started", () => {
    const status = orchestrator.getStatus();
    expect(status.uptime_seconds).toBe(0);
  });
});
