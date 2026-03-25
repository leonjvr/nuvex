/**
 * Integration: Full task lifecycle
 *
 * Create root task → decompose → assign → run → complete → synthesize
 * Full 3-tier flow: T1 → T2 → T3 → results flow back up
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore }          from "../../../src/tasks/store.js";
import { TaskEventBus }       from "../../../src/tasks/event-bus.js";
import { TaskStateMachine }   from "../../../src/tasks/state-machine.js";
import { TaskQueue }          from "../../../src/tasks/queue.js";
import { TaskTree }           from "../../../src/tasks/tree.js";
import { ResultStore }        from "../../../src/tasks/result-store.js";
import { TaskRouter }         from "../../../src/tasks/router.js";
import { DecompositionValidator } from "../../../src/tasks/decomposition.js";
import type { Database } from "../../../src/utils/db.js";

let tmpDir: string;
let db: Database;
let store: TaskStore;
let eventBus: TaskEventBus;
let sm: TaskStateMachine;
let queue: TaskQueue;
let tree: TaskTree;
let resultStore: ResultStore;
let router: TaskRouter;

beforeEach(() => {
  tmpDir      = mkdtempSync(join(tmpdir(), "sidjua-lifecycle-test-"));
  db          = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  store       = new TaskStore(db);
  store.initialize();
  eventBus    = new TaskEventBus(db);
  sm          = new TaskStateMachine(store, eventBus);
  queue       = new TaskQueue(store);
  tree        = new TaskTree(store);
  resultStore = new ResultStore(tmpDir);
  router      = new TaskRouter(store, eventBus, resultStore);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Full task lifecycle — T1→T2→T3", () => {
  it("creates, decomposes, executes, and completes a 3-tier task tree", async () => {
    const validator = new DecompositionValidator();

    // 1. T1 creates root task
    let rootTask = store.create({
      title: "Implement auth system",
      description: "Build full authentication system",
      division: "engineering",
      type: "root",
      tier: 1,
      token_budget: 50_000,
      cost_budget: 5.0,
      assigned_agent: "t1-agent",
    });

    // 2. T1 agent takes ownership: CREATED → PENDING → ASSIGNED → RUNNING
    rootTask = await sm.transition(rootTask, "PENDING");
    rootTask = await sm.transition(rootTask, "ASSIGNED", { agent_id: "t1-agent" });
    rootTask = await sm.transition(rootTask, "RUNNING");
    expect(rootTask.status).toBe("RUNNING");
    expect(rootTask.started_at).not.toBeNull();

    // 3. T1 decomposes into 2 T2 tasks
    const childInputs = [
      { title: "Design auth API",   description: "d", division: "engineering",
        type: "delegation" as const, tier: 2 as const,
        parent_id: rootTask.id, root_id: rootTask.root_id,
        token_budget: 10_000, cost_budget: 1.0 },
      { title: "Write auth tests",  description: "d", division: "engineering",
        type: "delegation" as const, tier: 2 as const,
        parent_id: rootTask.id, root_id: rootTask.root_id,
        token_budget: 10_000, cost_budget: 1.0 },
    ];

    const validationResult = validator.validate(rootTask, childInputs);
    expect(validationResult.valid).toBe(true);

    const t2a = store.create(childInputs[0]!);
    const t2b = store.create(childInputs[1]!);

    // Update root: waiting for 2 sub-tasks
    rootTask = store.update(rootTask.id, { sub_tasks_expected: 2 });
    rootTask = await sm.transition(rootTask, "WAITING");
    expect(rootTask.status).toBe("WAITING");

    // 4. T2a executes: design phase
    let t2aTask = await sm.transition(t2a, "PENDING");
    t2aTask = await sm.transition(t2aTask, "ASSIGNED", { agent_id: "t2a-agent" });
    t2aTask = await sm.transition(t2aTask, "RUNNING");

    // T2a decomposes into 1 T3 task
    const t3Input = {
      title: "Write JWT middleware", description: "d", division: "engineering",
      type: "delegation" as const, tier: 3 as const,
      parent_id: t2aTask.id, root_id: rootTask.id,
      token_budget: 3000, cost_budget: 0.3,
    };

    const t3ValidationResult = validator.validate(t2aTask, [t3Input]);
    expect(t3ValidationResult.valid).toBe(true);

    const t3 = store.create(t3Input);
    t2aTask = store.update(t2aTask.id, { sub_tasks_expected: 1 });
    t2aTask = await sm.transition(t2aTask, "WAITING");

    // 5. T3 executes and completes
    let t3Task = await sm.transition(t3, "PENDING");
    t3Task = await sm.transition(t3Task, "ASSIGNED", { agent_id: "t3-agent" });
    t3Task = await sm.transition(t3Task, "RUNNING");
    t3Task = await sm.transition(t3Task, "DONE", {
      result_summary: "JWT middleware implemented with RS256",
      confidence: 0.98,
    });
    expect(t3Task.status).toBe("DONE");
    expect(t3Task.completed_at).not.toBeNull();

    // 6. T3 result routes to T2a
    await router.routeResult(t3Task, {
      task_id: t3Task.id,
      parent_task_id: t2aTask.id,
      agent_id: "t3-agent",
      confidence: 0.98,
      key_findings: "JWT middleware complete with RS256 signing",
      result_file: "",
      tokens_used: 800,
      cost_usd: 0.008,
      completed_at: new Date().toISOString(),
    });

    // T2a now has 1/1 received
    const t2aUpdated = store.get(t2aTask.id);
    expect(t2aUpdated?.sub_tasks_received).toBe(1);

    // T2a completes synthesis
    t2aTask = store.get(t2aTask.id)!;
    t2aTask = await sm.transition(t2aTask, "RUNNING");
    t2aTask = await sm.transition(t2aTask, "DONE", {
      result_summary: "Auth API designed and implemented",
      confidence: 0.95,
    });

    // 7. T2b also executes and completes (simplified)
    let t2bTask = await sm.transition(t2b, "PENDING");
    t2bTask = await sm.transition(t2bTask, "ASSIGNED", { agent_id: "t2b-agent" });
    t2bTask = await sm.transition(t2bTask, "RUNNING");
    t2bTask = await sm.transition(t2bTask, "DONE", {
      result_summary: "Auth tests written — 100% coverage",
      confidence: 0.92,
    });

    // 8. Route T2a and T2b results to T1
    await router.routeResult(t2aTask, {
      task_id: t2aTask.id,
      parent_task_id: rootTask.id,
      agent_id: "t2a-agent",
      confidence: 0.95,
      key_findings: "Auth API complete",
      result_file: "",
      tokens_used: 4000,
      cost_usd: 0.04,
      completed_at: new Date().toISOString(),
    });
    await router.routeResult(t2bTask, {
      task_id: t2bTask.id,
      parent_task_id: rootTask.id,
      agent_id: "t2b-agent",
      confidence: 0.92,
      key_findings: "Tests complete",
      result_file: "",
      tokens_used: 3000,
      cost_usd: 0.03,
      completed_at: new Date().toISOString(),
    });

    // T1 now has 2/2 received
    const rootUpdated = store.get(rootTask.id);
    expect(rootUpdated?.sub_tasks_received).toBe(2);

    // 9. T1 synthesizes and completes
    rootTask = store.get(rootTask.id)!;
    rootTask = await sm.transition(rootTask, "RUNNING");
    rootTask = await sm.transition(rootTask, "DONE", {
      result_summary: "Auth system complete",
      confidence: 0.93,
    });
    expect(rootTask.status).toBe("DONE");

    // 10. Verify full tree state
    const treeStr = tree.formatHierarchy(rootTask.id);
    expect(treeStr).toContain("DONE");
    expect(treeStr).toContain("Implement auth system");

    // All tasks done
    const allTasks = store.getByRoot(rootTask.id);
    const notDone = allTasks.filter((t) => t.status !== "DONE");
    expect(notDone).toHaveLength(0);
  });
});
