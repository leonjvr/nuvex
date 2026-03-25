/**
 * Integration: Full Delegation Flow
 *
 * Tests the end-to-end flow of a 3-tier task cascade:
 *   1. Root (T1) task created  → assigned to T1 agent
 *   2. T2 child task created   → assigned to T2 agent
 *   3. T2 child reports DONE   → synthesis check → parent T1 moves to REVIEW
 *   4. T1 parent reports DONE  → root task marked complete
 *
 * Also tests:
 *   - Task failure → retry → eventual success path
 *   - Peer consultation routing
 *   - Agent crash → task reset → reassignment
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { TaskEventBus } from "../../../src/tasks/event-bus.js";
import { OrchestratorProcess } from "../../../src/orchestrator/orchestrator.js";
import { DEFAULT_DELEGATION_RULES } from "../../../src/orchestrator/types.js";
import type { OrchestratorConfig, AgentInstance } from "../../../src/orchestrator/types.js";
import type { Database } from "../../../src/utils/db.js";
import type { CreateTaskInput, TaskEvent } from "../../../src/tasks/types.js";
import type { AgentDefinition } from "../../../src/agents/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let bus: TaskEventBus;
let orch: OrchestratorProcess;

// Private handler access (test-only pattern)
type PrivateOrch = {
  handleNewTask(event: TaskEvent): Promise<void>;
  handleResultReady(event: TaskEvent): Promise<void>;
  handleTaskFailed(event: TaskEvent): Promise<void>;
  handleAgentCrash(event: TaskEvent): Promise<void>;
  handleAgentRecovery(event: TaskEvent): Promise<void>;
  handleConsultation(event: TaskEvent): Promise<void>;
};

function makeConfig(): OrchestratorConfig {
  return {
    max_agents:             10,
    max_agents_per_tier:    { 1: 2, 2: 4, 3: 8 },
    event_poll_interval_ms: 10,
    delegation_timeout_ms:  5_000,
    synthesis_timeout_ms:   30_000,
    max_tree_depth:         3,
    max_tree_breadth:       5,
    default_division:       "engineering",
    agent_definitions:      [],
    governance_root:        "/tmp/governance",
    delegation_rules:       DEFAULT_DELEGATION_RULES,
  };
}

function makeAgentDef(id: string, tier: 1 | 2 | 3 = 2): AgentDefinition {
  return {
    id,
    name:                   `Agent ${id}`,
    tier,
    provider:               "anthropic",
    model:                  "claude-sonnet-4-6",
    skill_file:             "skills/t2.md",
    division:               "engineering",
    capabilities:           ["code", "analysis"],
    max_concurrent_tasks:   4,
    token_budget_per_task:  10_000,
    cost_limit_per_hour:    1.0,
    checkpoint_interval_ms: 30_000,
    ttl_default_seconds:    600,
    heartbeat_interval_ms:  10_000,
    max_retries:            3,
    metadata:               {},
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
    tier:         1,
    token_budget: 100_000,
    cost_budget:  10.0,
    ...overrides,
  };
}

function stubEvent(type: string, taskId: string, extra: Partial<TaskEvent> = {}): TaskEvent {
  return {
    id:             `evt-${Math.random().toString(36).slice(2)}`,
    event_type:     type,
    task_id:        taskId,
    parent_task_id: null,
    agent_from:     null,
    agent_to:       "orchestrator",
    division:       "engineering",
    data:           {},
    created_at:     new Date().toISOString(),
    acknowledged_at: null,
    ...extra,
  };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-integ-flow-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store  = new TaskStore(db);
  store.initialize();
  bus    = new TaskEventBus(db);
  bus.initialize();
  orch   = new OrchestratorProcess(db, bus, makeConfig());
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// Helpers to call private handlers
function handleNewTask(event: TaskEvent)    { return (orch as unknown as PrivateOrch).handleNewTask(event); }
function handleResultReady(event: TaskEvent) { return (orch as unknown as PrivateOrch).handleResultReady(event); }
function handleTaskFailed(event: TaskEvent)  { return (orch as unknown as PrivateOrch).handleTaskFailed(event); }
function handleAgentCrash(event: TaskEvent)  { return (orch as unknown as PrivateOrch).handleAgentCrash(event); }
function handleAgentRecovery(event: TaskEvent) { return (orch as unknown as PrivateOrch).handleAgentRecovery(event); }
function handleConsultation(event: TaskEvent) { return (orch as unknown as PrivateOrch).handleConsultation(event); }

// ---------------------------------------------------------------------------
// Full T1 → T2 delegation + synthesis flow
// ---------------------------------------------------------------------------

describe("Full delegation: T1 root → T2 child → synthesis", () => {
  it("assigns T1 task to T1 agent on TASK_CREATED", async () => {
    const t1Agent = makeAgent("ceo-1", 1);
    orch.registerAgent(t1Agent);

    const root = store.create(makeInput({ tier: 1 }));
    await handleNewTask(stubEvent("TASK_CREATED", root.id));

    expect(store.get(root.id)!.status).toBe("ASSIGNED");
    expect(store.get(root.id)!.assigned_agent).toBe("ceo-1");
    const sendMock = t1Agent.process.send as ReturnType<typeof vi.fn>;
    expect(sendMock).toHaveBeenCalledWith({ type: "TASK_ASSIGNED", task_id: root.id });
  });

  it("assigns T2 child to T2 agent on TASK_CREATED", async () => {
    const t2Agent = makeAgent("dev-1", 2);
    orch.registerAgent(t2Agent);

    const root  = store.create(makeInput({ tier: 1 }));
    const child = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));
    await handleNewTask(stubEvent("TASK_CREATED", child.id));

    expect(store.get(child.id)!.status).toBe("ASSIGNED");
    expect(store.get(child.id)!.assigned_agent).toBe("dev-1");
  });

  it("child DONE triggers synthesis and moves parent to REVIEW", async () => {
    const t1Agent = makeAgent("ceo-1", 1);
    orch.registerAgent(t1Agent);

    // Root in WAITING (expecting 1 sub-task)
    const parent = store.create(makeInput({ tier: 1, sub_tasks_expected: 1, assigned_agent: "ceo-1" }));
    store.update(parent.id, { status: "WAITING" });

    const child = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
    }));
    store.update(child.id, {
      status:         "DONE",
      result_summary: "Child result",
      confidence:     0.9,
    });

    await handleResultReady(stubEvent("RESULT_READY", child.id));

    // Parent should now be in REVIEW (ready for synthesis)
    expect(store.get(parent.id)!.status).toBe("REVIEW");
  });

  it("root task DONE when all children complete and no parent exists", async () => {
    const t1Agent = makeAgent("ceo-1", 1);
    orch.registerAgent(t1Agent);

    // Single root task, no parent
    const root = store.create(makeInput({ tier: 1 }));
    store.update(root.id, {
      status:         "RUNNING",
      assigned_agent: "ceo-1",
      result_summary: "Root done",
    });

    await handleResultReady(stubEvent("RESULT_READY", root.id));

    // Root task should be DONE; no synthesis triggered (no parent)
    expect(store.get(root.id)!.status).toBe("DONE");
  });

  it("two children complete before synthesis fires", async () => {
    const parent = store.create(makeInput({ tier: 1, sub_tasks_expected: 2, assigned_agent: "ceo-1" }));
    store.update(parent.id, { status: "WAITING" });

    const c1 = store.create(makeInput({ tier: 2, type: "delegation", parent_id: parent.id, root_id: parent.id }));
    const c2 = store.create(makeInput({ tier: 2, type: "delegation", parent_id: parent.id, root_id: parent.id }));
    store.update(c1.id, { status: "DONE", result_summary: "c1 result", confidence: 0.9 });
    store.update(c2.id, { status: "DONE", result_summary: "c2 result", confidence: 0.8 });

    // First result — not yet ready
    await handleResultReady(stubEvent("RESULT_READY", c1.id));
    expect(store.get(parent.id)!.status).toBe("WAITING"); // still waiting

    // Second result — now ready
    await handleResultReady(stubEvent("RESULT_READY", c2.id));
    expect(store.get(parent.id)!.status).toBe("REVIEW");
  });
});

// ---------------------------------------------------------------------------
// Full T1 → T2 → T3 three-tier cascade
// ---------------------------------------------------------------------------

describe("Three-tier cascade: T1 → T2 → T3", () => {
  it("T3 leaf completes → T2 synthesis → T2 result → T1 synthesis", async () => {
    const t1Agent = makeAgent("ceo-1", 1);
    const t2Agent = makeAgent("dev-1", 2);
    orch.registerAgent(t1Agent);
    orch.registerAgent(t2Agent);

    // Build tree
    const root  = store.create(makeInput({ tier: 1, sub_tasks_expected: 1, assigned_agent: "ceo-1" }));
    const mid   = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id,  root_id: root.id, sub_tasks_expected: 1, assigned_agent: "dev-1" }));
    const leaf  = store.create(makeInput({ tier: 3, type: "delegation", parent_id: mid.id,   root_id: root.id }));
    store.update(root.id, { status: "WAITING" });
    store.update(mid.id,  { status: "WAITING" });
    store.update(leaf.id, { status: "DONE", result_summary: "leaf done", confidence: 0.95 });

    // Step 1: leaf DONE → mid should go to REVIEW
    await handleResultReady(stubEvent("RESULT_READY", leaf.id));
    expect(store.get(mid.id)!.status).toBe("REVIEW");

    // Step 2: mid reports DONE → root should go to REVIEW
    store.update(mid.id, { status: "DONE", result_summary: "mid done", confidence: 0.9 });
    await handleResultReady(stubEvent("RESULT_READY", mid.id));
    expect(store.get(root.id)!.status).toBe("REVIEW");
  });
});

// ---------------------------------------------------------------------------
// Failure + retry flow
// ---------------------------------------------------------------------------

describe("Task failure and retry flow", () => {
  it("failed task with retries remaining → reset to PENDING", async () => {
    const task = store.create(makeInput({ tier: 2, max_retries: 3 }));
    store.update(task.id, { status: "RUNNING", retry_count: 0 });

    await handleTaskFailed(stubEvent("TASK_FAILED", task.id));

    const updated = store.get(task.id)!;
    expect(updated.status).toBe("PENDING");
    expect(updated.retry_count).toBe(1);
    expect(updated.assigned_agent).toBeNull();
  });

  it("retried task → assigned to agent on next TASK_CREATED", async () => {
    const agent = makeAgent("dev-1", 2);
    orch.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2, max_retries: 3 }));
    store.update(task.id, { status: "PENDING", retry_count: 1 });

    await handleNewTask(stubEvent("TASK_CREATED", task.id));
    expect(store.get(task.id)!.status).toBe("ASSIGNED");
  });

  it("failed task with retries exhausted → escalated (FAILED status)", async () => {
    const t1Agent = makeAgent("ceo-1", 1);
    orch.registerAgent(t1Agent);

    const task = store.create(makeInput({ tier: 1, max_retries: 2 }));
    store.update(task.id, { status: "RUNNING", retry_count: 2 }); // exhausted

    await handleTaskFailed(stubEvent("TASK_FAILED", task.id));

    // Retries exhausted → FAILED first, then escalation manager sets to ESCALATED
    // (T1 task with no parent → requireHuman → ESCALATED status)
    expect(store.get(task.id)!.status).toBe("ESCALATED");
  });
});

// ---------------------------------------------------------------------------
// Agent crash and recovery
// ---------------------------------------------------------------------------

describe("Agent crash and recovery flow", () => {
  it("agent crash resets assigned tasks without checkpoint to PENDING", async () => {
    const agent = makeAgent("dev-1", 2);
    orch.registerAgent(agent);

    // Two tasks assigned to this agent
    const t1 = store.create(makeInput({ tier: 2 }));
    const t2 = store.create(makeInput({ tier: 2 }));
    store.update(t1.id, { status: "RUNNING", assigned_agent: "dev-1" });
    store.update(t2.id, { status: "RUNNING", assigned_agent: "dev-1" }); // has no checkpoint

    await handleAgentCrash(stubEvent("AGENT_CRASHED", t1.id, { agent_from: "dev-1" }));

    // Both tasks should be reset (no checkpoints)
    expect(store.get(t1.id)!.status).toBe("PENDING");
    expect(store.get(t2.id)!.status).toBe("PENDING");
    expect(orch.agents.get("dev-1")!.status).toBe("crashed");
  });

  it("task with checkpoint preserved after agent crash", async () => {
    const agent = makeAgent("dev-1", 2);
    orch.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2 }));
    store.update(task.id, {
      status:         "RUNNING",
      assigned_agent: "dev-1",
      checkpoint:     JSON.stringify({ step: 3, progress: 0.6 }),
    });

    await handleAgentCrash(stubEvent("AGENT_CRASHED", task.id, { agent_from: "dev-1" }));

    // Task with checkpoint: NOT reset (agent will resume)
    expect(store.get(task.id)!.status).toBe("RUNNING");
  });

  it("agent recovery → status restored to idle", async () => {
    const agent = makeAgent("dev-1", 2);
    agent.status = "crashed";
    orch.registerAgent(agent);

    await handleAgentRecovery(stubEvent("AGENT_RECOVERED", "any", { agent_from: "dev-1" }));

    expect(orch.agents.get("dev-1")!.status).toBe("idle");
  });

  it("full crash-recovery cycle: crash → reset → recovery → reassign", async () => {
    const agent = makeAgent("dev-1", 2);
    orch.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2 }));
    store.update(task.id, { status: "RUNNING", assigned_agent: "dev-1" });

    // 1. Crash
    await handleAgentCrash(stubEvent("AGENT_CRASHED", task.id, { agent_from: "dev-1" }));
    expect(store.get(task.id)!.status).toBe("PENDING");

    // 2. Recovery
    await handleAgentRecovery(stubEvent("AGENT_RECOVERED", task.id, { agent_from: "dev-1" }));
    const inst = orch.agents.get("dev-1")!;
    inst.status = "idle";

    // 3. Reassign
    await handleNewTask(stubEvent("TASK_CREATED", task.id));
    expect(store.get(task.id)!.status).toBe("ASSIGNED");
  });
});

// ---------------------------------------------------------------------------
// Peer consultation routing
// ---------------------------------------------------------------------------

describe("Peer consultation routing", () => {
  it("consultation task is routed to a same-tier peer", async () => {
    const agent1 = makeAgent("dev-1", 2);
    const agent2 = makeAgent("dev-2", 2);
    orch.registerAgent(agent1);
    orch.registerAgent(agent2);

    // Create a consultation task assigned to dev-1 (agent1)
    const task = store.create(makeInput({ tier: 2, type: "consultation", assigned_agent: "dev-1" }));

    await handleConsultation(stubEvent("CONSULTATION_REQUEST", task.id));

    // Should have been routed to dev-2 (the peer)
    const updated = store.get(task.id)!;
    expect(updated.assigned_agent).toBe("dev-2");
    expect(updated.status).toBe("ASSIGNED");
  });

  it("consultation with no available peer leaves task unrouted", async () => {
    // Only one agent of that tier — no peer available
    const agent = makeAgent("dev-1", 2);
    orch.registerAgent(agent);

    const task = store.create(makeInput({ tier: 2, type: "consultation", assigned_agent: "dev-1" }));

    // Should not throw
    await expect(handleConsultation(stubEvent("CONSULTATION_REQUEST", task.id))).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getStatus aggregation
// ---------------------------------------------------------------------------

describe("getStatus reflects real state", () => {
  it("counts tasks and agents correctly", async () => {
    const agent1 = makeAgent("dev-1", 2);
    const agent2 = makeAgent("dev-2", 2);
    orch.registerAgent(agent1);
    orch.registerAgent(agent2);

    // Create tasks in various states
    const t1 = store.create(makeInput({ tier: 2 }));
    const t2 = store.create(makeInput({ tier: 2 }));
    store.update(t1.id, { status: "RUNNING" });
    store.update(t2.id, { status: "DONE" });

    const status = orch.getStatus();
    expect(status.agents.total).toBe(2);
    expect(status.tasks.total).toBeGreaterThanOrEqual(2);
    expect(status.tasks.by_status["RUNNING"]).toBe(1);
    expect(status.tasks.by_status["DONE"]).toBe(1);
  });
});
