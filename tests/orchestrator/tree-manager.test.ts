/**
 * Tests for src/orchestrator/tree-manager.ts
 *
 * Covers:
 * - getTree: correct nested structure, depth
 * - cancelTree: cascades to all descendants, skips terminal
 * - cancelSubTree: cancels branch only
 * - getPath: root-to-task breadcrumb
 * - getDepth: correct for all levels
 * - getSiblings: same-parent tasks
 * - getLeafTasks: only tasks with no children
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskEventBus } from "../../src/tasks/event-bus.js";
import { TaskTreeManager } from "../../src/orchestrator/tree-manager.js";
import type { Database } from "../../src/utils/db.js";
import type { CreateTaskInput } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let bus: TaskEventBus;
let treeManager: TaskTreeManager;

beforeEach(() => {
  tmpDir      = mkdtempSync(join(tmpdir(), "sidjua-tree-test-"));
  db          = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store       = new TaskStore(db);
  store.initialize();
  bus         = new TaskEventBus(db);
  bus.initialize();
  treeManager = new TaskTreeManager(db, bus);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    title:        "Task",
    description:  "Test",
    division:     "engineering",
    type:         "root",
    tier:         1,
    token_budget: 10_000,
    cost_budget:  1.0,
    ...overrides,
  };
}

/** Creates a 3-level tree: root → [child1 → [grandchild]], child2 */
function makeTree() {
  const root       = store.create(makeInput({ tier: 1 }));
  const child1     = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));
  const child2     = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));
  const grandchild = store.create(makeInput({ tier: 3, type: "delegation", parent_id: child1.id, root_id: root.id }));
  return { root, child1, child2, grandchild };
}

// ---------------------------------------------------------------------------
// getTree
// ---------------------------------------------------------------------------

describe("TaskTreeManager.getTree", () => {
  it("returns correct nested structure", () => {
    const { root, child1, child2 } = makeTree();

    const tree = treeManager.getTree(root.id);
    expect(tree.task.id).toBe(root.id);
    expect(tree.depth).toBe(0);
    expect(tree.children).toHaveLength(2);

    const ids = tree.children.map((c) => c.task.id);
    expect(ids).toContain(child1.id);
    expect(ids).toContain(child2.id);
  });

  it("includes grandchildren at correct depth", () => {
    const { root, child1, grandchild } = makeTree();

    const tree = treeManager.getTree(root.id);
    const child1Node = tree.children.find((c) => c.task.id === child1.id)!;
    expect(child1Node.depth).toBe(1);
    expect(child1Node.children).toHaveLength(1);
    expect(child1Node.children[0]!.task.id).toBe(grandchild.id);
    expect(child1Node.children[0]!.depth).toBe(2);
  });

  it("throws for unknown root task", () => {
    expect(() => treeManager.getTree("nonexistent")).toThrow("Task not found");
  });
});

// ---------------------------------------------------------------------------
// cancelTree
// ---------------------------------------------------------------------------

describe("TaskTreeManager.cancelTree", () => {
  it("cancels all descendants including root", () => {
    const { root, child1, child2, grandchild } = makeTree();
    store.update(child1.id,     { status: "RUNNING" });
    store.update(child2.id,     { status: "ASSIGNED" });
    store.update(grandchild.id, { status: "RUNNING" });

    const result = treeManager.cancelTree(root.id, "test cancel");

    expect(store.get(root.id)!.status).toBe("CANCELLED");
    expect(store.get(child1.id)!.status).toBe("CANCELLED");
    expect(store.get(child2.id)!.status).toBe("CANCELLED");
    expect(store.get(grandchild.id)!.status).toBe("CANCELLED");
    expect(result.cancelled_count).toBe(4);
    expect(result.tasks_cancelled).toContain(root.id);
  });

  it("skips already-terminal tasks", () => {
    const { root, child1, child2 } = makeTree();
    store.update(child1.id, { status: "DONE" });
    store.update(child2.id, { status: "FAILED" });

    const result = treeManager.cancelTree(root.id, "test");
    // root and grandchild (CREATED) cancelled; child1/child2 already terminal
    expect(result.already_terminal).toBe(2);
    expect(store.get(child1.id)!.status).toBe("DONE");   // unchanged
    expect(store.get(child2.id)!.status).toBe("FAILED");  // unchanged
  });

  it("throws for unknown root", () => {
    expect(() => treeManager.cancelTree("nonexistent", "test")).toThrow("Task not found");
  });
});

// ---------------------------------------------------------------------------
// cancelSubTree
// ---------------------------------------------------------------------------

describe("TaskTreeManager.cancelSubTree", () => {
  it("cancels branch without affecting other branches", () => {
    const { root, child1, child2, grandchild } = makeTree();

    // Cancel only child1's branch
    const result = treeManager.cancelSubTree(child1.id, "branch cancel");

    expect(store.get(child1.id)!.status).toBe("CANCELLED");
    expect(store.get(grandchild.id)!.status).toBe("CANCELLED");
    // Root and child2 untouched
    expect(store.get(root.id)!.status).not.toBe("CANCELLED");
    expect(store.get(child2.id)!.status).not.toBe("CANCELLED");
    expect(result.cancelled_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getPath
// ---------------------------------------------------------------------------

describe("TaskTreeManager.getPath", () => {
  it("returns root-to-task breadcrumb", () => {
    const { root, child1, grandchild } = makeTree();

    const path = treeManager.getPath(grandchild.id);
    expect(path).toHaveLength(3);
    expect(path[0]!.id).toBe(root.id);
    expect(path[1]!.id).toBe(child1.id);
    expect(path[2]!.id).toBe(grandchild.id);
  });

  it("returns single-element path for root task", () => {
    const { root } = makeTree();
    const path = treeManager.getPath(root.id);
    expect(path).toHaveLength(1);
    expect(path[0]!.id).toBe(root.id);
  });
});

// ---------------------------------------------------------------------------
// getDepth
// ---------------------------------------------------------------------------

describe("TaskTreeManager.getDepth", () => {
  it("returns 0 for root task", () => {
    const { root } = makeTree();
    expect(treeManager.getDepth(root.id)).toBe(0);
  });

  it("returns 1 for direct children of root", () => {
    const { child1 } = makeTree();
    expect(treeManager.getDepth(child1.id)).toBe(1);
  });

  it("returns 2 for grandchildren", () => {
    const { grandchild } = makeTree();
    expect(treeManager.getDepth(grandchild.id)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getSiblings
// ---------------------------------------------------------------------------

describe("TaskTreeManager.getSiblings", () => {
  it("returns all tasks with same parent (including self)", () => {
    const { child1, child2 } = makeTree();

    const siblings = treeManager.getSiblings(child1.id);
    const ids = siblings.map((t) => t.id);
    expect(ids).toContain(child1.id);
    expect(ids).toContain(child2.id);
    expect(siblings).toHaveLength(2);
  });

  it("returns empty array for root tasks (no parent)", () => {
    const { root } = makeTree();
    // Root tasks have no parent_id — no siblings
    const siblings = treeManager.getSiblings(root.id);
    expect(siblings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getLeafTasks
// ---------------------------------------------------------------------------

describe("TaskTreeManager.getLeafTasks", () => {
  it("returns only tasks with no children", () => {
    const { root, child2, grandchild } = makeTree();

    const leaves = treeManager.getLeafTasks(root.id);
    const ids    = leaves.map((t) => t.id);

    // child2 and grandchild are leaves; root and child1 have children
    expect(ids).toContain(child2.id);
    expect(ids).toContain(grandchild.id);
    expect(ids).not.toContain(root.id);
  });

  it("returns root when tree has only root", () => {
    const root   = store.create(makeInput({ tier: 1 }));
    const leaves = treeManager.getLeafTasks(root.id);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]!.id).toBe(root.id);
  });
});
