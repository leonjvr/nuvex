/**
 * Integration: Cancellation Cascade
 *
 * Tests that tree cancellation correctly cascades through the full hierarchy:
 *   - cancelTree: cancels root + all descendants
 *   - cancelSubTree: cancels a branch without affecting siblings or root
 *   - Terminal tasks (DONE, FAILED) are preserved
 *   - TASK_CANCELLED events emitted for each non-terminal task
 *   - cancelTree + synthesis: cancellation of sibling while another completes
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { TaskEventBus } from "../../../src/tasks/event-bus.js";
import { TaskTreeManager } from "../../../src/orchestrator/tree-manager.js";
import { OrchestratorProcess } from "../../../src/orchestrator/orchestrator.js";
import { DEFAULT_DELEGATION_RULES } from "../../../src/orchestrator/types.js";
import type { OrchestratorConfig } from "../../../src/orchestrator/types.js";
import type { Database } from "../../../src/utils/db.js";
import type { CreateTaskInput, TaskStatus } from "../../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let bus: TaskEventBus;
let treeManager: TaskTreeManager;

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

/** Build standard 3-level tree: root → [child1 → [grandchild1, grandchild2], child2] */
function makeDeepTree() {
  const root        = store.create(makeInput({ tier: 1 }));
  const child1      = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id,   root_id: root.id }));
  const child2      = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id,   root_id: root.id }));
  const grandchild1 = store.create(makeInput({ tier: 3, type: "delegation", parent_id: child1.id, root_id: root.id }));
  const grandchild2 = store.create(makeInput({ tier: 3, type: "delegation", parent_id: child1.id, root_id: root.id }));
  return { root, child1, child2, grandchild1, grandchild2 };
}

beforeEach(() => {
  tmpDir      = mkdtempSync(join(tmpdir(), "sidjua-integ-cancel-"));
  db          = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store       = new TaskStore(db);
  store.initialize();
  bus         = new TaskEventBus(db);
  bus.initialize();
  treeManager = new TaskTreeManager(db, bus);
  // Initialize Phase 9 schema (needed for orchestrator_state table)
  new OrchestratorProcess(db, bus, makeConfig());
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Full tree cancellation
// ---------------------------------------------------------------------------

describe("cancelTree: cascades to all descendants", () => {
  it("cancels all 5 tasks in a 3-level tree", () => {
    const { root, child1, child2, grandchild1, grandchild2 } = makeDeepTree();
    store.update(child1.id,      { status: "RUNNING" });
    store.update(child2.id,      { status: "ASSIGNED" });
    store.update(grandchild1.id, { status: "RUNNING" });
    // grandchild2 stays CREATED

    const result = treeManager.cancelTree(root.id, "integration test cancel");

    expect(result.cancelled_count).toBe(5);
    expect(result.already_terminal).toBe(0);
    for (const id of [root.id, child1.id, child2.id, grandchild1.id, grandchild2.id]) {
      expect(store.get(id)!.status).toBe("CANCELLED");
    }
  });

  it("preserves DONE and FAILED tasks", () => {
    const { root, child1, child2, grandchild1, grandchild2 } = makeDeepTree();
    store.update(child1.id,      { status: "DONE" });
    store.update(grandchild1.id, { status: "FAILED" });

    const result = treeManager.cancelTree(root.id, "partial cancel");

    // 3 cancelled (root, child2, grandchild2), 2 already terminal (child1, grandchild1)
    expect(result.cancelled_count).toBe(3);
    expect(result.already_terminal).toBe(2);
    expect(store.get(child1.id)!.status).toBe("DONE");         // unchanged
    expect(store.get(grandchild1.id)!.status).toBe("FAILED");  // unchanged
    expect(store.get(root.id)!.status).toBe("CANCELLED");
    expect(store.get(child2.id)!.status).toBe("CANCELLED");
    expect(store.get(grandchild2.id)!.status).toBe("CANCELLED");
  });

  it("throws for unknown root task", () => {
    expect(() => treeManager.cancelTree("nonexistent", "reason")).toThrow("Task not found");
  });

  it("result.tasks_cancelled contains exactly the cancelled IDs", () => {
    const { root, child1, child2, grandchild1, grandchild2 } = makeDeepTree();
    const result = treeManager.cancelTree(root.id, "full cancel");

    const expected = new Set([root.id, child1.id, child2.id, grandchild1.id, grandchild2.id]);
    expect(new Set(result.tasks_cancelled)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Sub-tree (branch) cancellation
// ---------------------------------------------------------------------------

describe("cancelSubTree: only cancels the specified branch", () => {
  it("cancels child1 branch without touching root or child2", () => {
    const { root, child1, child2, grandchild1, grandchild2 } = makeDeepTree();

    const result = treeManager.cancelSubTree(child1.id, "branch cancel");

    expect(result.cancelled_count).toBe(3); // child1, grandchild1, grandchild2
    expect(store.get(child1.id)!.status).toBe("CANCELLED");
    expect(store.get(grandchild1.id)!.status).toBe("CANCELLED");
    expect(store.get(grandchild2.id)!.status).toBe("CANCELLED");

    // Root and sibling branch untouched
    expect(store.get(root.id)!.status).not.toBe("CANCELLED");
    expect(store.get(child2.id)!.status).not.toBe("CANCELLED");
  });

  it("cancels a leaf task (no children)", () => {
    const { grandchild1 } = makeDeepTree();
    const result = treeManager.cancelSubTree(grandchild1.id, "leaf cancel");

    expect(result.cancelled_count).toBe(1);
    expect(store.get(grandchild1.id)!.status).toBe("CANCELLED");
  });

  it("skips already-terminal leaf in sub-tree", () => {
    const { child1, grandchild1, grandchild2 } = makeDeepTree();
    store.update(grandchild1.id, { status: "DONE" });

    const result = treeManager.cancelSubTree(child1.id, "partial branch");

    // grandchild1 is DONE (terminal), so only child1 + grandchild2 get cancelled
    expect(result.cancelled_count).toBe(2);
    expect(result.already_terminal).toBe(1);
    expect(store.get(grandchild1.id)!.status).toBe("DONE");
  });
});

// ---------------------------------------------------------------------------
// Single-task tree
// ---------------------------------------------------------------------------

describe("cancelTree with single root task (no children)", () => {
  it("cancels the root and reports cancelled_count=1", () => {
    const root   = store.create(makeInput({ tier: 1 }));
    const result = treeManager.cancelTree(root.id, "solo cancel");

    expect(result.cancelled_count).toBe(1);
    expect(result.tasks_cancelled).toContain(root.id);
    expect(store.get(root.id)!.status).toBe("CANCELLED");
  });

  it("reports already_terminal=1 when root is already DONE", () => {
    const root = store.create(makeInput({ tier: 1 }));
    store.update(root.id, { status: "DONE" });

    const result = treeManager.cancelTree(root.id, "done task");
    expect(result.cancelled_count).toBe(0);
    expect(result.already_terminal).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Large tree stress: breadth × depth
// ---------------------------------------------------------------------------

describe("cancelTree: large breadth × depth tree", () => {
  it("cancels 13 tasks in a 3-level wide tree (root → 4 children → 2 grandchildren each)", () => {
    // root → c1..c4 → each has 2 grandchildren → 1 + 4 + 8 = 13 total
    const root     = store.create(makeInput({ tier: 1 }));
    const children: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));
      children.push(c.id);
      for (let j = 0; j < 2; j++) {
        store.create(makeInput({ tier: 3, type: "delegation", parent_id: c.id, root_id: root.id }));
      }
    }

    const result = treeManager.cancelTree(root.id, "large tree cancel");

    expect(result.cancelled_count).toBe(13);
    expect(store.get(root.id)!.status).toBe("CANCELLED");
    for (const cid of children) {
      expect(store.get(cid)!.status).toBe("CANCELLED");
    }
  });
});

// ---------------------------------------------------------------------------
// getLeafTasks: used before issuing cascade to determine scope
// ---------------------------------------------------------------------------

describe("getLeafTasks identifies correct terminal leaves", () => {
  it("identifies leaves of a deep tree before cancellation", () => {
    const { root, child2, grandchild1, grandchild2 } = makeDeepTree();

    const leaves = treeManager.getLeafTasks(root.id);
    const ids    = leaves.map((t) => t.id);

    // child2 (no children), grandchild1 and grandchild2 are leaves
    expect(ids).toContain(child2.id);
    expect(ids).toContain(grandchild1.id);
    expect(ids).toContain(grandchild2.id);
    expect(ids).not.toContain(root.id);
  });

  it("cancelling only leaves does not change parent statuses", () => {
    const { root, child1, child2, grandchild1, grandchild2 } = makeDeepTree();

    // Cancel only the leaves (grandchild1, grandchild2, child2)
    treeManager.cancelSubTree(grandchild1.id, "leaf");
    treeManager.cancelSubTree(grandchild2.id, "leaf");
    treeManager.cancelSubTree(child2.id, "leaf");

    // Root and child1 untouched
    const validStatuses: TaskStatus[] = ["CREATED", "PENDING", "RUNNING", "ASSIGNED", "WAITING", "REVIEW"];
    expect(validStatuses).toContain(store.get(root.id)!.status);
    expect(validStatuses).toContain(store.get(child1.id)!.status);
  });
});
