/**
 * Tests for src/orchestrator/synthesis.ts
 *
 * Covers:
 * - registerResult: increments counter, detects all-complete, remaining count
 * - triggerParentSynthesis: emits correct event, updates parent to REVIEW
 * - getTreeStatus: correct totals, per-tier breakdown
 * - handlePartialFailure: WAIT with retries, SYNTHESIZE_PARTIAL without
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskStore } from "../../src/tasks/store.js";
import { TaskEventBus } from "../../src/tasks/event-bus.js";
import { SynthesisCollector } from "../../src/orchestrator/synthesis.js";
import type { Database } from "../../src/utils/db.js";
import type { CreateTaskInput } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let bus: TaskEventBus;
let collector: SynthesisCollector;

beforeEach(() => {
  tmpDir    = mkdtempSync(join(tmpdir(), "sidjua-synth-test-"));
  db        = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  store     = new TaskStore(db);
  store.initialize();
  bus       = new TaskEventBus(db);
  bus.initialize();
  collector = new SynthesisCollector(db, bus);
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
    description:  "Description",
    division:     "engineering",
    type:         "root",
    tier:         1,
    token_budget: 10_000,
    cost_budget:  1.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// registerResult
// ---------------------------------------------------------------------------

describe("SynthesisCollector.registerResult", () => {
  it("returns ready=false for root tasks (no parent)", () => {
    const root = store.create(makeInput({ tier: 1 }));
    const result = collector.registerResult(root);
    expect(result.ready).toBe(false);
    expect(result.parent_task_id).toBe(root.id);
    expect(result.child_summaries).toHaveLength(0);
  });

  it("increments sub_tasks_received on parent", () => {
    const parent = store.create(makeInput({ tier: 1, sub_tasks_expected: 2 }));
    const child  = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
    }));
    store.update(child.id, { status: "DONE", result_summary: "done" });

    collector.registerResult(store.get(child.id)!);

    const updatedParent = store.get(parent.id)!;
    expect(updatedParent.sub_tasks_received).toBe(1);
  });

  it("returns remaining count when not all done", () => {
    const parent = store.create(makeInput({ tier: 1, sub_tasks_expected: 3 }));
    const child  = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
    }));
    store.update(child.id, { status: "DONE" });

    const status = collector.registerResult(store.get(child.id)!);
    expect(status.ready).toBe(false);
    expect(status.remaining).toBe(2);
    expect(status.completed_children).toBe(1);
    expect(status.total_children).toBe(3);
  });

  it("returns ready=true when all children complete", () => {
    const parent = store.create(makeInput({ tier: 1, sub_tasks_expected: 2 }));
    const c1 = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
    }));
    const c2 = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
    }));
    store.update(c1.id, { status: "DONE", result_summary: "c1 done", confidence: 0.9 });
    store.update(c2.id, { status: "DONE", result_summary: "c2 done", confidence: 0.8 });

    // First child — not ready yet
    collector.registerResult(store.get(c1.id)!);

    // Second child — all done
    const status = collector.registerResult(store.get(c2.id)!);
    expect(status.ready).toBe(true);
    expect(status.child_summaries).toHaveLength(2);
    expect(status.remaining).toBe(0);
  });

  it("includes child summaries with correct fields", () => {
    const parent = store.create(makeInput({ tier: 1, sub_tasks_expected: 1 }));
    const child  = store.create(makeInput({
      tier: 2, title: "Child task", type: "delegation",
      parent_id: parent.id, root_id: parent.id,
    }));
    store.update(child.id, {
      status:         "DONE",
      result_summary: "My summary",
      confidence:     0.85,
      result_file:    "/results/child.md",
    });

    const status = collector.registerResult(store.get(child.id)!);
    expect(status.ready).toBe(true);
    const summary = status.child_summaries[0]!;
    expect(summary.task_id).toBe(child.id);
    expect(summary.title).toBe("Child task");
    expect(summary.summary).toBe("My summary");
    expect(summary.confidence).toBe(0.85);
    expect(summary.status).toBe("DONE");
  });

  it("handles parent not found gracefully", () => {
    const orphan = store.create(makeInput({ tier: 2 }));
    // Temporarily disable FK to set a non-existent parent_id
    db.pragma("foreign_keys = OFF");
    db.prepare("UPDATE tasks SET parent_id = 'nonexistent' WHERE id = ?").run(orphan.id);
    db.pragma("foreign_keys = ON");
    const orphanWithParent = store.get(orphan.id)!;

    const result = collector.registerResult(orphanWithParent);
    expect(result.ready).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// triggerParentSynthesis
// ---------------------------------------------------------------------------

describe("SynthesisCollector.triggerParentSynthesis", () => {
  it("updates parent status to REVIEW", async () => {
    const parent = store.create(makeInput({ tier: 1, assigned_agent: "opus-ceo" }));
    const child  = store.create(makeInput({ tier: 2, type: "delegation", parent_id: parent.id, root_id: parent.id }));
    store.update(child.id, { status: "DONE", result_summary: "done" });

    await collector.triggerParentSynthesis(parent.id, [
      { task_id: child.id, title: "t", summary: "done", confidence: 1, result_file: "", status: "DONE" },
    ]);

    const updatedParent = store.get(parent.id)!;
    expect(updatedParent.status).toBe("REVIEW");
  });

  it("emits SYNTHESIS_READY event with child summaries", async () => {
    const parent = store.create(makeInput({ tier: 1, assigned_agent: "opus-ceo" }));
    const events: string[] = [];

    // Subscribe to watch emitted events
    bus.subscribe("opus-ceo", (event) => {
      events.push(event.event_type);
    });

    await collector.triggerParentSynthesis(parent.id, [
      { task_id: "c1", title: "t1", summary: "s1", confidence: 0.9, result_file: "", status: "DONE" },
    ]);

    expect(events).toContain("SYNTHESIS_READY");
  });

  it("handles parent not found gracefully", async () => {
    // Should not throw
    await expect(
      collector.triggerParentSynthesis("nonexistent-parent", []),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getTreeStatus
// ---------------------------------------------------------------------------

describe("SynthesisCollector.getTreeStatus", () => {
  it("returns correct totals for a tree", () => {
    const root = store.create(makeInput({ tier: 1 }));
    const c1   = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));
    const c2   = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));
    store.update(c1.id, { status: "DONE" });
    store.update(c2.id, { status: "RUNNING" });

    const status = collector.getTreeStatus(root.id);
    expect(status.root_task_id).toBe(root.id);
    expect(status.total_tasks).toBe(3); // root + 2 children
    expect(status.by_status["CREATED"]).toBe(1);   // root
    expect(status.by_status["DONE"]).toBe(1);
    expect(status.by_status["RUNNING"]).toBe(1);
  });

  it("calculates estimated completion (terminal / total)", () => {
    const root = store.create(makeInput({ tier: 1 }));
    const c1   = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));
    const c2   = store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));
    store.update(c1.id, { status: "DONE" });
    // c2 stays CREATED, root stays CREATED
    // terminal = 1 (c1). total = 3. completion = 1/3 ≈ 0.33

    const status = collector.getTreeStatus(root.id);
    expect(status.estimated_completion).toBeCloseTo(1 / 3, 5);
  });

  it("groups by tier", () => {
    const root = store.create(makeInput({ tier: 1 }));
    store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));
    store.create(makeInput({ tier: 2, type: "delegation", parent_id: root.id, root_id: root.id }));

    const status = collector.getTreeStatus(root.id);
    expect(status.by_tier[1]!.total).toBe(1);
    expect(status.by_tier[2]!.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// handlePartialFailure
// ---------------------------------------------------------------------------

describe("SynthesisCollector.handlePartialFailure", () => {
  it("returns WAIT when failed child has retries remaining", () => {
    const parent     = store.create(makeInput({ tier: 1 }));
    const failedChild = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
      max_retries: 3,
    }));
    store.update(failedChild.id, { status: "FAILED", retry_count: 1 });

    const action = collector.handlePartialFailure(parent.id, failedChild.id);
    expect(action).toBe("WAIT");
  });

  it("returns SYNTHESIZE_PARTIAL when retries exhausted", () => {
    const parent      = store.create(makeInput({ tier: 1 }));
    const failedChild  = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
      max_retries: 2,
    }));
    store.update(failedChild.id, { status: "FAILED", retry_count: 2 });

    const action = collector.handlePartialFailure(parent.id, failedChild.id);
    expect(action).toBe("SYNTHESIZE_PARTIAL");
  });

  it("returns SYNTHESIZE_PARTIAL when failed child not found", () => {
    const parent = store.create(makeInput({ tier: 1 }));
    const action  = collector.handlePartialFailure(parent.id, "nonexistent-child");
    expect(action).toBe("SYNTHESIZE_PARTIAL");
  });

  it("respects partial_failure_tolerance=cancel", () => {
    const parent      = store.create(makeInput({
      tier: 1, metadata: { partial_failure_tolerance: "cancel" },
    }));
    const failedChild  = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
      max_retries: 3,
    }));
    store.update(failedChild.id, { status: "FAILED", retry_count: 0 });

    const action = collector.handlePartialFailure(parent.id, failedChild.id);
    expect(action).toBe("CANCEL_ALL");
  });

  it("respects partial_failure_tolerance=synthesize", () => {
    const parent     = store.create(makeInput({
      tier: 1, metadata: { partial_failure_tolerance: "synthesize" },
    }));
    const failedChild = store.create(makeInput({
      tier: 2, type: "delegation",
      parent_id: parent.id, root_id: parent.id,
      max_retries: 3,
    }));
    store.update(failedChild.id, { status: "FAILED", retry_count: 0 });

    const action = collector.handlePartialFailure(parent.id, failedChild.id);
    expect(action).toBe("SYNTHESIZE_PARTIAL");
  });
});
