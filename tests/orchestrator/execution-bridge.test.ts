/**
 * Phase 13c: ExecutionBridge unit tests
 *
 * Uses real TaskStore + TaskEventBus (in-memory SQLite).
 * No Orchestrator running — tests verify TaskStore state + EventBus events.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync }  from "node:fs";
import { tmpdir }               from "node:os";
import { join }                 from "node:path";
import { openDatabase }         from "../../src/utils/db.js";
import { TaskStore }            from "../../src/tasks/store.js";
import { TaskEventBus }         from "../../src/tasks/event-bus.js";
import { ExecutionBridge }      from "../../src/orchestrator/execution-bridge.js";
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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-bridge-test-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  store  = new TaskStore(db);
  store.initialize();
  bus    = new TaskEventBus(db);
  bus.initialize();
  bridge = new ExecutionBridge(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionBridge.submitTask", () => {
  it("creates a root task in TaskStore and returns a TaskHandle", async () => {
    const handle = await bridge.submitTask({
      description:   "Build a REST API for user management",
      division:      "engineering",
      budget_tokens: 50_000,
      budget_usd:    2.0,
    });

    expect(handle.task_id).toBeTruthy();
    expect(handle.status).toBe("CREATED");
    expect(handle.assigned_tier).toBe(1);

    // Verify task exists in store
    const task = store.get(handle.task_id);
    expect(task).not.toBeNull();
    expect(task!.description).toBe("Build a REST API for user management");
    expect(task!.division).toBe("engineering");
    expect(task!.token_budget).toBe(50_000);
    expect(task!.cost_budget).toBe(2.0);
    expect(task!.type).toBe("root");
  });

  it("rejects empty description with EXEC-003", async () => {
    await expect(bridge.submitTask({ description: "  " }))
      .rejects.toMatchObject({ code: "EXEC-003" });

    await expect(bridge.submitTask({ description: "" }))
      .rejects.toMatchObject({ code: "EXEC-003" });
  });
});

describe("ExecutionBridge.getTaskStatus", () => {
  it("returns correct depth and progress across delegation tree", async () => {
    // Create a root task
    const root = store.create({
      title:        "Root task",
      description:  "Root",
      division:     "engineering",
      type:         "root",
      tier:         1,
      token_budget: 10_000,
      cost_budget:  1.0,
    });

    // Manually update token/cost usage
    store.update(root.id, { token_used: 500, cost_used: 0.05, status: "RUNNING" });

    // Create two child tasks
    const child1 = store.create({
      title:        "Sub-task A",
      description:  "A",
      division:     "engineering",
      type:         "delegation",
      tier:         2,
      parent_id:    root.id,
      root_id:      root.id,
      token_budget: 4_000,
      cost_budget:  0.4,
    });
    store.update(child1.id, { status: "DONE", token_used: 200, cost_used: 0.02 });

    const child2 = store.create({
      title:        "Sub-task B",
      description:  "B",
      division:     "engineering",
      type:         "delegation",
      tier:         2,
      parent_id:    root.id,
      root_id:      root.id,
      token_budget: 4_000,
      cost_budget:  0.4,
    });
    store.update(child2.id, { status: "RUNNING", token_used: 100, cost_used: 0.01 });

    const status = await bridge.getTaskStatus(root.id);

    expect(status.task_id).toBe(root.id);
    expect(status.status).toBe("RUNNING");
    expect(status.total_sub_tasks).toBe(2);
    expect(status.completed_sub_tasks).toBe(1);   // child1 is DONE
    expect(status.total_tokens_used).toBe(800);    // 500 + 200 + 100
    expect(status.total_cost_usd).toBeCloseTo(0.08);
    expect(status.depth).toBe(1);
  });

  it("throws EXEC-004 for unknown task ID", async () => {
    await expect(bridge.getTaskStatus("non-existent-task-id"))
      .rejects.toMatchObject({ code: "EXEC-004" });
  });
});

describe("ExecutionBridge.waitForCompletion", () => {
  it("resolves immediately when task is already in terminal state", async () => {
    const task = store.create({
      title:        "Quick task",
      description:  "Test",
      division:     "engineering",
      type:         "root",
      tier:         1,
      token_budget: 1_000,
      cost_budget:  0.1,
    });
    store.update(task.id, {
      status:         "DONE",
      result_summary: "All done!",
      confidence:     0.95,
      token_used:     300,
      cost_used:      0.03,
    });

    const result = await bridge.waitForCompletion(task.id, 5_000);

    expect(result.task_id).toBe(task.id);
    expect(result.status).toBe("DONE");
    expect(result.result_summary).toBe("All done!");
    expect(result.total_tokens).toBe(300);
    expect(result.error).toBeUndefined();
  });

  it("returns timeout error when task does not complete within timeout", async () => {
    const task = store.create({
      title:        "Slow task",
      description:  "Runs forever",
      division:     "engineering",
      type:         "root",
      tier:         1,
      token_budget: 10_000,
      cost_budget:  1.0,
    });
    store.update(task.id, { status: "RUNNING" });

    // timeout_ms = 50ms (very short — task stays RUNNING)
    const result = await bridge.waitForCompletion(task.id, 50);

    expect(result.task_id).toBe(task.id);
    expect(result.status).toBe("RUNNING");
    expect(result.error).toMatch(/Timeout/);
  });
});

describe("ExecutionBridge.getTaskTree", () => {
  it("returns delegation tree with children recursively", async () => {
    const root = store.create({
      title:        "Root",
      description:  "Root task",
      division:     "engineering",
      type:         "root",
      tier:         1,
      token_budget: 10_000,
      cost_budget:  1.0,
    });

    const child = store.create({
      title:        "Child A",
      description:  "Child",
      division:     "engineering",
      type:         "delegation",
      tier:         2,
      parent_id:    root.id,
      root_id:      root.id,
      token_budget: 4_000,
      cost_budget:  0.4,
    });
    store.update(child.id, { status: "DONE", token_used: 150, cost_used: 0.015 });

    const tree = await bridge.getTaskTree(root.id);

    expect(tree.task_id).toBe(root.id);
    expect(tree.title).toBe("Root");
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]!.task_id).toBe(child.id);
    expect(tree.children[0]!.status).toBe("DONE");
    expect(tree.children[0]!.tokens_used).toBe(150);
    expect(tree.children[0]!.children).toHaveLength(0);
  });
});
