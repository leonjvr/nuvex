/**
 * Tests for src/tasks/store.ts
 *
 * Covers:
 * - Create task with all fields
 * - Create with defaults (priority, TTL, metadata)
 * - Get by ID, return null for missing
 * - Update individual fields
 * - Query by agent, division, status, parent, root
 * - Count by status
 * - Parent_id foreign key constraint (parent must exist)
 * - Root_id always set (equals id for root tasks)
 * - Tier constraint (1-3 only)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import type { Database } from "../../src/utils/db.js";
import type { CreateTaskInput } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title:        "Test task",
    description:  "Test description",
    division:     "engineering",
    type:         "root",
    tier:         1,
    token_budget: 10_000,
    cost_budget:  1.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-store-test-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  store  = new TaskStore(db);
  store.initialize();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe("TaskStore.create", () => {
  it("creates a task with all required fields", () => {
    const task = store.create(makeInput());
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(task.title).toBe("Test task");
    expect(task.status).toBe("CREATED");
    expect(task.tier).toBe(1);
    expect(task.type).toBe("root");
    expect(task.token_budget).toBe(10_000);
    expect(task.cost_budget).toBe(1.0);
    expect(task.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(task.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sets defaults: priority=3, max_retries=3, sub_tasks_expected=0", () => {
    const task = store.create(makeInput());
    expect(task.priority).toBe(3);
    expect(task.max_retries).toBe(3);
    expect(task.sub_tasks_expected).toBe(0);
    expect(task.sub_tasks_received).toBe(0);
    expect(task.retry_count).toBe(0);
    expect(task.token_used).toBe(0);
    expect(task.cost_used).toBe(0);
  });

  it("sets default classification to 'internal'", () => {
    const task = store.create(makeInput());
    expect(task.classification).toBe("internal");
  });

  it("sets TTL default based on tier (T1=3600, T2=1800, T3=600)", () => {
    expect(store.create(makeInput({ tier: 1 })).ttl_seconds).toBe(3600);
    expect(store.create(makeInput({ tier: 2 })).ttl_seconds).toBe(1800);
    expect(store.create(makeInput({ tier: 3 })).ttl_seconds).toBe(600);
  });

  it("overrides defaults when provided", () => {
    const task = store.create(makeInput({
      priority: 1,
      classification: "confidential",
      ttl_seconds: 120,
      max_retries: 5,
      sub_tasks_expected: 3,
    }));
    expect(task.priority).toBe(1);
    expect(task.classification).toBe("confidential");
    expect(task.ttl_seconds).toBe(120);
    expect(task.max_retries).toBe(5);
    expect(task.sub_tasks_expected).toBe(3);
  });

  it("root_id equals id for root tasks", () => {
    const task = store.create(makeInput());
    expect(task.root_id).toBe(task.id);
    expect(task.parent_id).toBeNull();
  });

  it("sets parent_id and root_id for delegated tasks", () => {
    const parent = store.create(makeInput());
    const child = store.create(makeInput({
      type: "delegation",
      tier: 2,
      parent_id: parent.id,
      root_id: parent.root_id,
    }));
    expect(child.parent_id).toBe(parent.id);
    expect(child.root_id).toBe(parent.root_id);
  });

  it("stores and retrieves metadata", () => {
    const task = store.create(makeInput({ metadata: { key: "value", num: 42 } }));
    expect(task.metadata["key"]).toBe("value");
    expect(task.metadata["num"]).toBe(42);
  });

  it("generates unique IDs", () => {
    const t1 = store.create(makeInput());
    const t2 = store.create(makeInput());
    expect(t1.id).not.toBe(t2.id);
  });

  it("enforces tier constraint (only 1, 2, 3 allowed)", () => {
    expect(() =>
      store.create(makeInput({ tier: 4 as 1 | 2 | 3 })),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

describe("TaskStore.get", () => {
  it("returns task by ID", () => {
    const created = store.create(makeInput());
    const found   = store.get(created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.title).toBe("Test task");
  });

  it("returns null for non-existent ID", () => {
    expect(store.get("non-existent-id")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe("TaskStore.update", () => {
  it("updates a single field", () => {
    const task = store.create(makeInput());
    const updated = store.update(task.id, { status: "PENDING" });
    expect(updated.status).toBe("PENDING");
  });

  it("preserves unchanged fields", () => {
    const task = store.create(makeInput());
    const updated = store.update(task.id, { status: "PENDING" });
    expect(updated.title).toBe("Test task");
    expect(updated.tier).toBe(1);
  });

  it("sets updated_at to a newer timestamp", async () => {
    const task = store.create(makeInput());
    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 5));
    const updated = store.update(task.id, { status: "PENDING" });
    expect(updated.updated_at >= task.updated_at).toBe(true);
  });

  it("can set assigned_agent to null", () => {
    const task = store.create(makeInput({ assigned_agent: "agent-1" }));
    const updated = store.update(task.id, { assigned_agent: null });
    expect(updated.assigned_agent).toBeNull();
  });

  it("can update metadata", () => {
    const task = store.create(makeInput());
    const updated = store.update(task.id, { metadata: { foo: "bar" } });
    expect(updated.metadata["foo"]).toBe("bar");
  });

  it("throws for non-existent task", () => {
    expect(() => store.update("ghost", { status: "PENDING" })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe("TaskStore queries", () => {
  it("getByAgent returns tasks for the given agent", () => {
    store.create(makeInput({ assigned_agent: "agent-A" }));
    store.create(makeInput({ assigned_agent: "agent-B" }));
    store.create(makeInput({ assigned_agent: "agent-A" }));

    const tasks = store.getByAgent("agent-A");
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.assigned_agent === "agent-A")).toBe(true);
  });

  it("getByDivision returns tasks for the given division", () => {
    store.create(makeInput({ division: "engineering" }));
    store.create(makeInput({ division: "sales" }));
    store.create(makeInput({ division: "engineering" }));

    const tasks = store.getByDivision("engineering");
    expect(tasks).toHaveLength(2);
  });

  it("getByStatus returns tasks with the given status", () => {
    const t1 = store.create(makeInput());
    const t2 = store.create(makeInput());
    store.update(t1.id, { status: "PENDING" });

    const created = store.getByStatus("CREATED");
    const pending = store.getByStatus("PENDING");
    expect(created.map((t) => t.id)).toContain(t2.id);
    expect(pending.map((t) => t.id)).toContain(t1.id);
  });

  it("getByParent returns direct children only", () => {
    const parent = store.create(makeInput());
    const child1 = store.create(makeInput({ parent_id: parent.id, tier: 2, type: "delegation", root_id: parent.id }));
    store.create(makeInput({ parent_id: child1.id, tier: 3, type: "delegation", root_id: parent.id }));

    const children = store.getByParent(parent.id);
    expect(children).toHaveLength(1);
    expect(children[0]?.id).toBe(child1.id);
  });

  it("getByRoot returns the entire task tree", () => {
    const root = store.create(makeInput());
    store.create(makeInput({ parent_id: root.id, tier: 2, type: "delegation", root_id: root.id }));
    store.create(makeInput({ parent_id: root.id, tier: 2, type: "delegation", root_id: root.id }));

    const all = store.getByRoot(root.id);
    expect(all).toHaveLength(3); // root + 2 children
  });

  it("getActiveForAgent returns ASSIGNED+RUNNING+WAITING", () => {
    const t1 = store.create(makeInput({ assigned_agent: "agent-1" }));
    const t2 = store.create(makeInput({ assigned_agent: "agent-1" }));
    const t3 = store.create(makeInput({ assigned_agent: "agent-1" }));
    store.update(t1.id, { status: "RUNNING" });
    store.update(t2.id, { status: "WAITING" });
    store.update(t3.id, { status: "PENDING" }); // should not appear

    const active = store.getActiveForAgent("agent-1");
    const ids = active.map((t) => t.id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2.id);
    expect(ids).not.toContain(t3.id);
  });

  it("getQueuedForAgent returns PENDING tasks ordered by priority", () => {
    const low  = store.create(makeInput({ assigned_agent: "agent-1", priority: 5 }));
    const high = store.create(makeInput({ assigned_agent: "agent-1", priority: 1 }));
    store.update(low.id, { status: "PENDING" });
    store.update(high.id, { status: "PENDING" });

    const queued = store.getQueuedForAgent("agent-1");
    expect(queued[0]?.id).toBe(high.id); // priority 1 first
    expect(queued[1]?.id).toBe(low.id);
  });
});

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

describe("TaskStore.countByStatus", () => {
  it("returns zero for all statuses when empty", () => {
    const counts = store.countByStatus();
    for (const count of Object.values(counts)) {
      expect(count).toBe(0);
    }
  });

  it("counts correctly after creates and updates", () => {
    store.create(makeInput());
    const t2 = store.create(makeInput());
    store.update(t2.id, { status: "PENDING" });

    const counts = store.countByStatus();
    expect(counts["CREATED"]).toBe(1);
    expect(counts["PENDING"]).toBe(1);
  });

  it("filters by division when provided", () => {
    store.create(makeInput({ division: "engineering" }));
    store.create(makeInput({ division: "sales" }));

    const engCounts = store.countByStatus("engineering");
    const allCounts = store.countByStatus();
    expect(engCounts["CREATED"]).toBe(1);
    expect(allCounts["CREATED"]).toBe(2);
  });
});

describe("TaskStore.countSubTasksReceived", () => {
  it("returns 0 when no children", () => {
    const task = store.create(makeInput());
    expect(store.countSubTasksReceived(task.id)).toBe(0);
  });

  it("counts only DONE children", () => {
    const parent = store.create(makeInput());
    const c1 = store.create(makeInput({ parent_id: parent.id, tier: 2, type: "delegation", root_id: parent.id }));
    const c2 = store.create(makeInput({ parent_id: parent.id, tier: 2, type: "delegation", root_id: parent.id }));
    store.update(c1.id, { status: "DONE" });
    store.update(c2.id, { status: "RUNNING" }); // not done yet

    expect(store.countSubTasksReceived(parent.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Foreign key constraint
// ---------------------------------------------------------------------------

describe("TaskStore FK constraint", () => {
  it("rejects child with non-existent parent_id", () => {
    expect(() =>
      store.create(makeInput({
        parent_id: "non-existent-parent",
        tier: 2,
        type: "delegation",
        root_id: "non-existent-parent",
      })),
    ).toThrow();
  });
});
