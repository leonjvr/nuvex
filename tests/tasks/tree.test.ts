/**
 * Tests for src/tasks/tree.ts
 *
 * Covers:
 * - getChildren returns direct children only
 * - getParent returns immediate parent
 * - getRoot always returns root task
 * - getSiblings returns tasks with same parent
 * - getAncestors returns path to root in order
 * - getFullTree returns complete hierarchy
 * - getDepth correctly calculates depth (root=0)
 * - getLeafTasks returns only childless tasks
 * - formatHierarchy produces correct ASCII tree
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskTree } from "../../src/tasks/tree.js";
import type { Database } from "../../src/utils/db.js";
import type { Task } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRoot(store: TaskStore): Task {
  return store.create({
    title: "Root", description: "root task", division: "eng",
    type: "root", tier: 1, token_budget: 10000, cost_budget: 1.0,
  });
}

function createChild(store: TaskStore, parent: Task, title = "Child"): Task {
  return store.create({
    title, description: "child task", division: "eng",
    type: "delegation", tier: (parent.tier + 1) as 2 | 3,
    parent_id: parent.id, root_id: parent.root_id,
    token_budget: 1000, cost_budget: 0.1,
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let tree: TaskTree;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-tree-test-"));
  db     = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  store  = new TaskStore(db);
  store.initialize();
  tree   = new TaskTree(store);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getChildren
// ---------------------------------------------------------------------------

describe("TaskTree.getChildren", () => {
  it("returns direct children only", () => {
    const root  = createRoot(store);
    const child = createChild(store, root);
    createChild(store, child); // grandchild

    const children = tree.getChildren(root.id);
    expect(children).toHaveLength(1);
    expect(children[0]?.id).toBe(child.id);
  });

  it("returns empty for leaf tasks", () => {
    const root = createRoot(store);
    expect(tree.getChildren(root.id)).toHaveLength(0);
  });

  it("returns multiple children", () => {
    const root = createRoot(store);
    createChild(store, root, "Child A");
    createChild(store, root, "Child B");
    createChild(store, root, "Child C");

    expect(tree.getChildren(root.id)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// getParent
// ---------------------------------------------------------------------------

describe("TaskTree.getParent", () => {
  it("returns immediate parent", () => {
    const root  = createRoot(store);
    const child = createChild(store, root);
    const parent = tree.getParent(child.id);
    expect(parent?.id).toBe(root.id);
  });

  it("returns null for root task", () => {
    const root = createRoot(store);
    expect(tree.getParent(root.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getRoot
// ---------------------------------------------------------------------------

describe("TaskTree.getRoot", () => {
  it("returns the root task for a leaf", () => {
    const root       = createRoot(store);
    const child      = createChild(store, root);
    const grandchild = createChild(store, child);

    expect(tree.getRoot(grandchild.id).id).toBe(root.id);
  });

  it("returns self for root task", () => {
    const root = createRoot(store);
    expect(tree.getRoot(root.id).id).toBe(root.id);
  });
});

// ---------------------------------------------------------------------------
// getSiblings
// ---------------------------------------------------------------------------

describe("TaskTree.getSiblings", () => {
  it("returns tasks with same parent, excluding self", () => {
    const root  = createRoot(store);
    const c1    = createChild(store, root, "C1");
    const c2    = createChild(store, root, "C2");
    const c3    = createChild(store, root, "C3");

    const siblings = tree.getSiblings(c1.id);
    const ids = siblings.map((t) => t.id);
    expect(ids).toContain(c2.id);
    expect(ids).toContain(c3.id);
    expect(ids).not.toContain(c1.id);
  });

  it("returns empty for root (no parent)", () => {
    const root = createRoot(store);
    expect(tree.getSiblings(root.id)).toHaveLength(0);
  });

  it("returns empty for only child", () => {
    const root  = createRoot(store);
    const child = createChild(store, root);
    expect(tree.getSiblings(child.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getAncestors
// ---------------------------------------------------------------------------

describe("TaskTree.getAncestors", () => {
  it("returns path from root to immediate parent (ordered parent-first)", () => {
    const root       = createRoot(store);
    const child      = createChild(store, root);
    const grandchild = createChild(store, child);

    const ancestors = tree.getAncestors(grandchild.id);
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0]?.id).toBe(root.id);  // root first
    expect(ancestors[1]?.id).toBe(child.id); // then parent
  });

  it("returns empty for root task", () => {
    const root = createRoot(store);
    expect(tree.getAncestors(root.id)).toHaveLength(0);
  });

  it("returns [root] for direct child", () => {
    const root  = createRoot(store);
    const child = createChild(store, root);
    const ancestors = tree.getAncestors(child.id);
    expect(ancestors).toHaveLength(1);
    expect(ancestors[0]?.id).toBe(root.id);
  });
});

// ---------------------------------------------------------------------------
// getFullTree / getSubTree
// ---------------------------------------------------------------------------

describe("TaskTree.getFullTree", () => {
  it("returns node with task and children", () => {
    const root  = createRoot(store);
    const child = createChild(store, root);

    const treeNode = tree.getFullTree(root.id);
    expect(treeNode.task.id).toBe(root.id);
    expect(treeNode.depth).toBe(0);
    expect(treeNode.children).toHaveLength(1);
    expect(treeNode.children[0]?.task.id).toBe(child.id);
    expect(treeNode.children[0]?.depth).toBe(1);
  });

  it("throws for unknown root", () => {
    expect(() => tree.getFullTree("ghost")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getDepth
// ---------------------------------------------------------------------------

describe("TaskTree.getDepth", () => {
  it("root has depth 0", () => {
    const root = createRoot(store);
    expect(tree.getDepth(root.id)).toBe(0);
  });

  it("direct child has depth 1", () => {
    const root  = createRoot(store);
    const child = createChild(store, root);
    expect(tree.getDepth(child.id)).toBe(1);
  });

  it("grandchild has depth 2", () => {
    const root       = createRoot(store);
    const child      = createChild(store, root);
    const grandchild = createChild(store, child);
    expect(tree.getDepth(grandchild.id)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getLeafTasks
// ---------------------------------------------------------------------------

describe("TaskTree.getLeafTasks", () => {
  it("returns only tasks with no children", () => {
    const root       = createRoot(store);
    const child      = createChild(store, root);
    const leaf1      = createChild(store, child);  // grandchild — leaf
    const leaf2      = createChild(store, child);  // grandchild — leaf

    const leaves = tree.getLeafTasks(root.id);
    const ids = leaves.map((t) => t.id);
    expect(ids).toContain(leaf1.id);
    expect(ids).toContain(leaf2.id);
    expect(ids).not.toContain(root.id);
    expect(ids).not.toContain(child.id);
  });

  it("returns root itself if it has no children", () => {
    const root = createRoot(store);
    const leaves = tree.getLeafTasks(root.id);
    expect(leaves).toHaveLength(1);
    expect(leaves[0]?.id).toBe(root.id);
  });
});

// ---------------------------------------------------------------------------
// formatHierarchy
// ---------------------------------------------------------------------------

describe("TaskTree.formatHierarchy", () => {
  it("produces non-empty ASCII output", () => {
    const root = createRoot(store);
    const out = tree.formatHierarchy(root.id);
    expect(out).toContain("[CREATED]");
    expect(out).toContain("Root");
    expect(out).toContain("T1");
  });

  it("includes ├── connector for non-last children", () => {
    const root = createRoot(store);
    createChild(store, root, "First");
    createChild(store, root, "Second");

    const out = tree.formatHierarchy(root.id);
    expect(out).toContain("├──");
    expect(out).toContain("└──");
  });

  it("indents grandchildren with │", () => {
    const root  = createRoot(store);
    const child = createChild(store, root, "Mid");
    createChild(store, child, "Leaf");

    const out = tree.formatHierarchy(root.id);
    // Grandchild line should be indented
    const lines = out.split("\n");
    const leafLine = lines.find((l) => l.includes("Leaf"));
    expect(leafLine).toBeDefined();
    expect(leafLine).toMatch(/^\s*[└├]/); // indented connector
  });

  it("shows confidence when present", () => {
    const root = createRoot(store);
    store.update(root.id, { confidence: 0.92 });

    const out = tree.formatHierarchy(root.id);
    expect(out).toContain("confidence: 0.92");
  });
});
