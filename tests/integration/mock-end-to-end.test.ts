/**
 * Phase 13c: Mock End-to-End Integration Tests
 *
 * Uses real TaskStore + TaskEventBus + ExecutionBridge + SynthesisHandler.
 * No real LLM calls — simulates agent behavior directly on the DB.
 *
 * These tests verify the full data-flow wiring across Phase 7-13c components.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync }  from "node:fs";
import { tmpdir }               from "node:os";
import { join }                 from "node:path";
import { openDatabase }         from "../../src/utils/db.js";
import { TaskStore }            from "../../src/tasks/store.js";
import { TaskEventBus }         from "../../src/tasks/event-bus.js";
import { ExecutionBridge }      from "../../src/orchestrator/execution-bridge.js";
import { SynthesisHandler }     from "../../src/orchestrator/synthesis-handler.js";
import type { SynthesisReadyEvent } from "../../src/orchestrator/synthesis-handler.js";
import { PHASE9_SCHEMA_SQL }    from "../../src/orchestrator/types.js";
import type { Database }        from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let bus: TaskEventBus;
let bridge: ExecutionBridge;
let synth: SynthesisHandler;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-e2e-mock-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  store  = new TaskStore(db);
  store.initialize();
  bus    = new TaskEventBus(db);
  bus.initialize();
  bridge = new ExecutionBridge(db);
  synth  = new SynthesisHandler(db, bus);
  synth.start();
});

afterEach(() => {
  synth.stop();
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Simulate agent behavior helpers
// ---------------------------------------------------------------------------

/** Simulate T1 agent decomposing a task into N sub-tasks */
function simulateDecompose(taskId: string, subTasks: { title: string; tier: 2 | 3 }[]) {
  const task = store.get(taskId)!;
  store.update(taskId, { status: "WAITING", sub_tasks_expected: subTasks.length });

  const created = subTasks.map(({ title, tier }) =>
    store.create({
      title,
      description:  `Sub-task: ${title}`,
      division:     task.division,
      type:         "delegation",
      tier,
      parent_id:    taskId,
      root_id:      task.root_id,
      token_budget: Math.floor(task.token_budget / 2),
      cost_budget:  task.cost_budget / 4,
    }),
  );

  bus.emit("agent.task.decomposed", { task_id: taskId, sub_task_count: subTasks.length });
  return created;
}

/** Simulate agent completing a task */
async function simulateComplete(taskId: string, summary: string, tokens = 200, cost = 0.02) {
  store.update(taskId, {
    status:         "DONE",
    result_summary: summary,
    confidence:     0.9,
    token_used:     tokens,
    cost_used:      cost,
    completed_at:   new Date().toISOString(),
  });

  await bus.emitTask({
    event_type:     "RESULT_READY",
    task_id:        taskId,
    parent_task_id: store.get(taskId)?.parent_id ?? null,
    agent_from:     "mock-agent",
    agent_to:       null,
    division:       store.get(taskId)?.division ?? "eng",
    data:           { summary },
  });
}

/** Simulate agent failing a task */
async function simulateFail(taskId: string) {
  store.update(taskId, {
    status:         "FAILED",
    result_summary: "Task failed during execution",
  });

  await bus.emitTask({
    event_type:     "TASK_FAILED",
    task_id:        taskId,
    parent_task_id: store.get(taskId)?.parent_id ?? null,
    agent_from:     "mock-agent",
    agent_to:       null,
    division:       store.get(taskId)?.division ?? "eng",
    data:           { reason: "execution_error" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Mock E2E: Full delegation flow", () => {
  it("T1 → decompose → T2 execute → T1 synthesize → DONE", async () => {
    // 1. Submit task
    const handle = await bridge.submitTask({
      description:   "Build a complete REST API",
      division:      "engineering",
      budget_tokens: 50_000,
      budget_usd:    2.0,
    });

    expect(handle.status).toBe("CREATED");

    // 2. T1 agent decomposes the task
    const children = simulateDecompose(handle.task_id, [
      { title: "Design API schema",    tier: 2 },
      { title: "Implement endpoints",  tier: 2 },
    ]);

    expect(children).toHaveLength(2);

    const parent = store.get(handle.task_id);
    expect(parent!.status).toBe("WAITING");
    expect(parent!.sub_tasks_expected).toBe(2);

    // 3. T2 agents complete their sub-tasks — synthesis driven by event bus (synth.start())
    let capturedSynth: SynthesisReadyEvent | null = null;
    const synthReadyP = new Promise<SynthesisReadyEvent>((resolve) => {
      synth.onSynthesisReady((ev) => { resolve(ev); });
    });

    await simulateComplete(children[0]!.id, "Schema designed");
    // Allow async event handler to settle — first child: not all done yet
    await new Promise((r) => setTimeout(r, 0));
    expect(store.get(handle.task_id)!.status).toBe("WAITING");

    await simulateComplete(children[1]!.id, "Endpoints implemented");
    capturedSynth = await synthReadyP; // event bus triggers synthesis
    expect(capturedSynth).not.toBeNull();
    expect(capturedSynth!.all_succeeded).toBe(true);
    expect(capturedSynth!.child_summaries).toHaveLength(2);

    // 4. Parent task should be in REVIEW (waiting for synthesis)
    const afterSynth = store.get(handle.task_id);
    expect(afterSynth!.status).toBe("REVIEW");

    // 5. T1 agent completes synthesis
    store.update(handle.task_id, {
      status:         "DONE",
      result_summary: "Complete REST API delivered with schema and endpoints",
      confidence:     0.92,
      token_used:     600,
      cost_used:      0.06,
      completed_at:   new Date().toISOString(),
    });

    const result = await bridge.waitForCompletion(handle.task_id, 1_000);
    expect(result.status).toBe("DONE");
    expect(result.result_summary).toContain("REST API");
    expect(result.total_tokens).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });

  it("T1 → T2 decompose → T3 execute → T2 synthesize → T1 synthesize", async () => {
    // 1. Submit root task
    const handle = await bridge.submitTask({
      description:   "Build a complex microservices platform",
      division:      "engineering",
      budget_tokens: 100_000,
      budget_usd:    5.0,
    });

    // 2. T1 creates a T2 child
    const [t2Task] = simulateDecompose(handle.task_id, [
      { title: "Implement user service", tier: 2 },
    ]);

    // 3. T2 decomposes into T3 tasks
    const t3Tasks = simulateDecompose(t2Task!.id, [
      { title: "User model",      tier: 3 },
      { title: "User controller", tier: 3 },
    ]);

    // 4. T3 agents complete
    await simulateComplete(t3Tasks[0]!.id, "User model implemented");
    await synth.handleChildComplete(t3Tasks[0]!.id);

    await simulateComplete(t3Tasks[1]!.id, "User controller implemented");
    const t2SynthResult = await synth.handleChildComplete(t3Tasks[1]!.id);

    expect(t2SynthResult).not.toBeNull();
    expect(t2SynthResult!.parent_task_id).toBe(t2Task!.id);

    // 5. T2 synthesizes and completes
    store.update(t2Task!.id, {
      status:         "DONE",
      result_summary: "User service fully implemented",
      confidence:     0.88,
      token_used:     400,
      cost_used:      0.04,
      completed_at:   new Date().toISOString(),
    });

    // 6. T1 synthesis triggers
    const t1SynthResult = await synth.handleChildComplete(t2Task!.id);
    expect(t1SynthResult).not.toBeNull();
    expect(t1SynthResult!.parent_task_id).toBe(handle.task_id);

    // Root task should be in REVIEW
    expect(store.get(handle.task_id)!.status).toBe("REVIEW");
  });

  it("handles task with tool use — agent calls tool, gets result, completes", async () => {
    // Simulate the reasoning loop completing a task after tool use
    const handle = await bridge.submitTask({
      description: "Read configuration file and summarize",
      division:    "operations",
    });

    // Simulate: agent runs, uses a tool (read_file), then completes
    store.update(handle.task_id, {
      status:     "RUNNING",
      started_at: new Date().toISOString(),
      token_used: 150, // from LLM call that decided to use tool
      cost_used:  0.015,
    });

    // Tool call happened (tracked in metadata)
    store.update(handle.task_id, { token_used: 200, cost_used: 0.02 });

    // Agent completes after tool result
    await simulateComplete(handle.task_id, "Config file read: key=value pairs loaded", 350, 0.035);

    const result = await bridge.waitForCompletion(handle.task_id, 1_000);
    expect(result.status).toBe("DONE");
    expect(result.result_summary).toContain("Config file");
    expect(result.total_tokens).toBe(350);
  });

  it("escalation: T3 can't do task → marks as ESCALATED", async () => {
    const handle = await bridge.submitTask({
      description: "Make critical architecture decision",
      division:    "engineering",
    });

    // T3 agent escalates
    store.update(handle.task_id, {
      status: "ESCALATED",
      result_summary: "Task requires higher tier authority",
    });

    const result = await bridge.waitForCompletion(handle.task_id, 1_000);
    expect(result.status).toBe("ESCALATED");
    expect(result.error).toContain("ESCALATED");
  });

  it("budget enforcement: task tree stops when budget_usd exceeded", async () => {
    const handle = await bridge.submitTask({
      description: "Expensive task",
      budget_usd:  0.10, // very small budget
    });

    // Simulate agents spending beyond budget
    const children = simulateDecompose(handle.task_id, [
      { title: "Subtask A", tier: 2 },
      { title: "Subtask B", tier: 2 },
    ]);

    // Mark children as RUNNING with high cost
    store.update(children[0]!.id, { status: "RUNNING", cost_used: 0.07 });
    store.update(children[1]!.id, { status: "RUNNING", cost_used: 0.05 });
    store.update(handle.task_id,   { cost_used: 0.01 });

    // Total cost: 0.07 + 0.05 + 0.01 = 0.13 > 0.10 budget
    const exhausted = await bridge.enforceBudget(handle.task_id, 0.10);
    expect(exhausted).toBe(true);

    // All non-terminal tasks should be CANCELLED
    const updatedChildren = children.map((c) => store.get(c.id)!);
    expect(updatedChildren[0]!.status).toBe("CANCELLED");
    expect(updatedChildren[1]!.status).toBe("CANCELLED");
  });
});
