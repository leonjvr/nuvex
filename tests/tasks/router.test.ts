/**
 * Tests for src/tasks/router.ts
 *
 * Covers:
 * - routeResult writes file + emits event
 * - routeResult increments parent sub_tasks_received
 * - checkParentCompletion returns correct counts
 * - All sub-tasks received → complete=true
 * - Consultation response doesn't increment counter
 * - routeConsultation emits CONSULTATION_RESPONSE event
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskEventBus } from "../../src/tasks/event-bus.js";
import { ResultStore } from "../../src/tasks/result-store.js";
import { TaskRouter } from "../../src/tasks/router.js";
import type { Database } from "../../src/utils/db.js";
import type { Task, ManagementSummary } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParent(store: TaskStore, overrides: Partial<Task> = {}): Task {
  const t = store.create({
    title: "Parent", description: "Parent task",
    division: "engineering", type: "root", tier: 1,
    token_budget: 10000, cost_budget: 1.0,
    assigned_agent: "agent-parent",
    sub_tasks_expected: 2,
    ...overrides,
  });
  return store.update(t.id, { status: "WAITING" });
}

function makeChild(store: TaskStore, parent: Task, overrides: Partial<Task> = {}): Task {
  const t = store.create({
    title: "Child", description: "Child task",
    division: "engineering", type: "delegation", tier: 2,
    parent_id: parent.id, root_id: parent.root_id,
    token_budget: 2000, cost_budget: 0.2,
    assigned_agent: "agent-child",
    ...overrides,
  });
  return store.update(t.id, { status: "DONE" });
}

function makeSummary(task: Task, overrides: Partial<ManagementSummary> = {}): ManagementSummary {
  return {
    task_id:       task.id,
    parent_task_id: task.parent_id ?? "",
    agent_id:      "agent-child",
    confidence:    0.9,
    key_findings:  "The work is complete. All requirements met.",
    result_file:   "",
    tokens_used:   500,
    cost_usd:      0.005,
    completed_at:  new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let eventBus: TaskEventBus;
let resultStore: ResultStore;
let router: TaskRouter;

beforeEach(() => {
  tmpDir      = mkdtempSync(join(tmpdir(), "sidjua-router-test-"));
  db          = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  store       = new TaskStore(db);
  store.initialize();
  eventBus    = new TaskEventBus(db);
  resultStore = new ResultStore(tmpDir);
  router      = new TaskRouter(store, eventBus, resultStore);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// routeResult
// ---------------------------------------------------------------------------

describe("TaskRouter.routeResult", () => {
  it("writes result file for the completed task", async () => {
    const parent = makeParent(store);
    const child  = makeChild(store, parent);

    await router.routeResult(child, makeSummary(child));

    const result = await resultStore.readResult(child.id, "engineering");
    expect(result).not.toBeNull();
    expect(result?.frontmatter.task_id).toBe(child.id);
  });

  it("increments parent sub_tasks_received", async () => {
    const parent = makeParent(store);
    const child  = makeChild(store, parent);

    expect(store.get(parent.id)?.sub_tasks_received).toBe(0);
    await router.routeResult(child, makeSummary(child));
    expect(store.get(parent.id)?.sub_tasks_received).toBe(1);
  });

  it("emits RESULT_READY event targeting parent's agent", async () => {
    const parent = makeParent(store, { assigned_agent: "agent-parent" });
    const child  = makeChild(store, parent);

    await router.routeResult(child, makeSummary(child));

    const events = await eventBus.consume("agent-parent");
    const resultEvents = events.filter((e) => e.event_type === "RESULT_READY");
    expect(resultEvents).toHaveLength(1);
  });

  it("updates task with result_file path", async () => {
    const parent = makeParent(store);
    const child  = makeChild(store, parent);

    await router.routeResult(child, makeSummary(child));

    const updated = store.get(child.id);
    expect(updated?.result_file).not.toBeNull();
    expect(updated?.result_file).toContain("result.md");
  });

  it("does nothing for root tasks (no parent)", async () => {
    const root = store.create({
      title: "Root", description: "root", division: "engineering",
      type: "root", tier: 1, token_budget: 10000, cost_budget: 1.0,
    });
    store.update(root.id, { status: "DONE" });

    // Should not throw
    await expect(
      router.routeResult(root, makeSummary(root, { parent_task_id: "" })),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// checkParentCompletion
// ---------------------------------------------------------------------------

describe("TaskRouter.checkParentCompletion", () => {
  it("returns complete=false when fewer received than expected", async () => {
    const parent = makeParent(store, { sub_tasks_expected: 3 });
    const result = await router.checkParentCompletion(parent.id);
    expect(result.complete).toBe(false);
    expect(result.expected).toBe(3);
    expect(result.received).toBe(0);
  });

  it("returns complete=true when received >= expected", async () => {
    const parent = makeParent(store, { sub_tasks_expected: 2 });
    store.update(parent.id, { sub_tasks_received: 2 });

    const result = await router.checkParentCompletion(parent.id);
    expect(result.complete).toBe(true);
    expect(result.received).toBe(2);
    expect(result.expected).toBe(2);
  });

  it("returns complete=false when expected=0 (not yet set)", async () => {
    const parent = store.create({
      title: "P", description: "d", division: "engineering",
      type: "root", tier: 1, token_budget: 10000, cost_budget: 1.0,
      sub_tasks_expected: 0,
    });

    const result = await router.checkParentCompletion(parent.id);
    expect(result.complete).toBe(false);
  });

  it("pending list excludes DONE and CANCELLED children", async () => {
    const parent = makeParent(store, { sub_tasks_expected: 3 });
    makeChild(store, parent);           // DONE
    const pending = store.create({
      title: "Pending child", description: "d", division: "engineering",
      type: "delegation", tier: 2, parent_id: parent.id, root_id: parent.root_id,
      token_budget: 1000, cost_budget: 0.1, assigned_agent: "agent-x",
    });
    store.update(pending.id, { status: "RUNNING" });

    const result = await router.checkParentCompletion(parent.id);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]?.id).toBe(pending.id);
  });
});

// ---------------------------------------------------------------------------
// routeConsultation
// ---------------------------------------------------------------------------

describe("TaskRouter.routeConsultation", () => {
  it("emits CONSULTATION_RESPONSE event to parent agent", async () => {
    const parent = makeParent(store, { assigned_agent: "agent-requester" });
    const consultation = store.create({
      title: "Consult", description: "d", division: "engineering",
      type: "consultation", tier: 1,
      parent_id: parent.id, root_id: parent.root_id,
      token_budget: 500, cost_budget: 0.05,
      assigned_agent: "agent-peer",
    });
    store.update(consultation.id, { status: "DONE" });

    await router.routeConsultation(consultation, "Here is my advice.");

    const events = await eventBus.consume("agent-requester");
    const consultEvents = events.filter((e) => e.event_type === "CONSULTATION_RESPONSE");
    expect(consultEvents).toHaveLength(1);
    expect(consultEvents[0]?.data["response"]).toBe("Here is my advice.");
  });

  it("does NOT increment parent sub_tasks_received", async () => {
    const parent = makeParent(store, { sub_tasks_expected: 1 });
    const consultation = store.create({
      title: "Consult", description: "d", division: "engineering",
      type: "consultation", tier: 1,
      parent_id: parent.id, root_id: parent.root_id,
      token_budget: 500, cost_budget: 0.05,
      assigned_agent: "agent-peer",
    });

    await router.routeConsultation(consultation, "Advice.");

    expect(store.get(parent.id)?.sub_tasks_received).toBe(0);
  });

  it("emits correct consultation task ID in event data", async () => {
    const parent = makeParent(store);
    const consultation = store.create({
      title: "Consult", description: "d", division: "engineering",
      type: "consultation", tier: 1,
      parent_id: parent.id, root_id: parent.root_id,
      token_budget: 500, cost_budget: 0.05,
    });

    await router.routeConsultation(consultation, "Advice.");

    const allEvents = db
      .prepare<[], { data: string }>(
        "SELECT data FROM task_events WHERE event_type = 'CONSULTATION_RESPONSE'",
      )
      .all();
    expect(allEvents).toHaveLength(1);
    const data = JSON.parse(allEvents[0]?.data ?? "{}") as Record<string, unknown>;
    expect(data["consultation_task_id"]).toBe(consultation.id);
  });
});
