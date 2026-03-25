/**
 * Integration: Async delegation
 *
 * T2 delegates 3 tasks to T3.
 * T3 workers complete in different order.
 * Each result routed back to T2.
 * T2 resumes only when all 3 received.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore }        from "../../../src/tasks/store.js";
import { TaskEventBus }     from "../../../src/tasks/event-bus.js";
import { TaskStateMachine } from "../../../src/tasks/state-machine.js";
import { ResultStore }      from "../../../src/tasks/result-store.js";
import { TaskRouter }       from "../../../src/tasks/router.js";
import type { Database } from "../../../src/utils/db.js";
import type { Task, ManagementSummary } from "../../../src/tasks/types.js";

let tmpDir: string;
let db: Database;
let store: TaskStore;
let eventBus: TaskEventBus;
let sm: TaskStateMachine;
let resultStore: ResultStore;
let router: TaskRouter;

beforeEach(() => {
  tmpDir      = mkdtempSync(join(tmpdir(), "sidjua-async-test-"));
  db          = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  store       = new TaskStore(db);
  store.initialize();
  eventBus    = new TaskEventBus(db);
  sm          = new TaskStateMachine(store, eventBus);
  resultStore = new ResultStore(tmpDir);
  router      = new TaskRouter(store, eventBus, resultStore);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeSummary(task: Task): ManagementSummary {
  return {
    task_id: task.id,
    parent_task_id: task.parent_id ?? "",
    agent_id: task.assigned_agent ?? "agent",
    confidence: 0.9,
    key_findings: `Task ${task.title} completed`,
    result_file: "",
    tokens_used: 300,
    cost_usd: 0.003,
    completed_at: new Date().toISOString(),
  };
}

describe("Async delegation — T2 waits for 3 T3 workers", () => {
  it("T2 resumes only when all 3 sub-tasks are received", async () => {
    // Create T2 parent task
    const root = store.create({
      title: "Root", description: "d", division: "engineering",
      type: "root", tier: 1, token_budget: 50000, cost_budget: 5.0,
    });

    let t2 = store.create({
      title: "Data analysis", description: "Analyze data in parallel",
      division: "engineering", type: "delegation", tier: 2,
      parent_id: root.id, root_id: root.id,
      token_budget: 15000, cost_budget: 1.5,
      assigned_agent: "t2-agent",
    });

    t2 = await sm.transition(t2, "PENDING");
    t2 = await sm.transition(t2, "ASSIGNED", { agent_id: "t2-agent" });
    t2 = await sm.transition(t2, "RUNNING");

    // T2 decomposes into 3 T3 tasks
    const t3Tasks = await Promise.all([
      (async () => {
        const t = store.create({
          title: "Analyze Q1", description: "d", division: "engineering",
          type: "delegation", tier: 3,
          parent_id: t2.id, root_id: root.id,
          token_budget: 3000, cost_budget: 0.3,
          assigned_agent: "t3-worker-1",
        });
        return sm.transition(await sm.transition(await sm.transition(t, "PENDING"), "ASSIGNED", { agent_id: "t3-worker-1" }), "RUNNING");
      })(),
      (async () => {
        const t = store.create({
          title: "Analyze Q2", description: "d", division: "engineering",
          type: "delegation", tier: 3,
          parent_id: t2.id, root_id: root.id,
          token_budget: 3000, cost_budget: 0.3,
          assigned_agent: "t3-worker-2",
        });
        return sm.transition(await sm.transition(await sm.transition(t, "PENDING"), "ASSIGNED", { agent_id: "t3-worker-2" }), "RUNNING");
      })(),
      (async () => {
        const t = store.create({
          title: "Analyze Q3", description: "d", division: "engineering",
          type: "delegation", tier: 3,
          parent_id: t2.id, root_id: root.id,
          token_budget: 3000, cost_budget: 0.3,
          assigned_agent: "t3-worker-3",
        });
        return sm.transition(await sm.transition(await sm.transition(t, "PENDING"), "ASSIGNED", { agent_id: "t3-worker-3" }), "RUNNING");
      })(),
    ]);

    t2 = store.update(t2.id, { sub_tasks_expected: 3 });
    t2 = await sm.transition(t2, "WAITING");

    // Workers complete in reverse order (Q3, Q1, Q2)
    const [q1, q2, q3] = t3Tasks as [Task, Task, Task];

    // Q3 completes first
    const q3Done = await sm.transition(q3, "DONE", { result_summary: "Q3 analysis done" });
    await router.routeResult(q3Done, makeSummary(q3Done));

    // Check T2 still waiting (1/3)
    let t2State = store.get(t2.id)!;
    expect(t2State.sub_tasks_received).toBe(1);
    const check1 = await router.checkParentCompletion(t2.id);
    expect(check1.complete).toBe(false);

    // Q1 completes second
    const q1Done = await sm.transition(q1, "DONE", { result_summary: "Q1 analysis done" });
    await router.routeResult(q1Done, makeSummary(q1Done));

    t2State = store.get(t2.id)!;
    expect(t2State.sub_tasks_received).toBe(2);
    const check2 = await router.checkParentCompletion(t2.id);
    expect(check2.complete).toBe(false);

    // Q2 completes last — triggers parent ready signal
    const q2Done = await sm.transition(q2, "DONE", { result_summary: "Q2 analysis done" });
    await router.routeResult(q2Done, makeSummary(q2Done));

    t2State = store.get(t2.id)!;
    expect(t2State.sub_tasks_received).toBe(3);
    const check3 = await router.checkParentCompletion(t2.id);
    expect(check3.complete).toBe(true);
    expect(check3.received).toBe(3);
    expect(check3.expected).toBe(3);

    // TASK_PROGRESS event should have been emitted to t2 agent
    const events = await eventBus.consume("t2-agent");
    const progressEvents = events.filter((e) => e.event_type === "TASK_PROGRESS");
    expect(progressEvents.length).toBeGreaterThanOrEqual(1);

    // T2 can now synthesize
    t2 = store.get(t2.id)!;
    t2 = await sm.transition(t2, "RUNNING");
    t2 = await sm.transition(t2, "DONE", { confidence: 0.95 });
    expect(t2.status).toBe("DONE");

    // All 3 result files written
    const resultIds = await resultStore.listResults("engineering");
    expect(resultIds.length).toBeGreaterThanOrEqual(3);
  });
});
