/**
 * Phase 13c: SynthesisHandler unit tests
 *
 * Uses real TaskStore + TaskEventBus (in-memory SQLite).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync }  from "node:fs";
import { tmpdir }               from "node:os";
import { join }                 from "node:path";
import { openDatabase }         from "../../src/utils/db.js";
import { TaskStore }            from "../../src/tasks/store.js";
import { TaskEventBus }         from "../../src/tasks/event-bus.js";
import { SynthesisHandler }     from "../../src/orchestrator/synthesis-handler.js";
import { PHASE9_SCHEMA_SQL }    from "../../src/orchestrator/types.js";
import type { Database }        from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let store: TaskStore;
let bus: TaskEventBus;
let handler: SynthesisHandler;

beforeEach(() => {
  tmpDir  = mkdtempSync(join(tmpdir(), "sidjua-synth-handler-"));
  db      = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  store   = new TaskStore(db);
  store.initialize();
  bus     = new TaskEventBus(db);
  bus.initialize();
  handler = new SynthesisHandler(db, bus);
});

afterEach(() => {
  handler.stop();
  db.close();
  rmSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParentTask() {
  return store.create({
    title:        "Parent task",
    description:  "Do something complex",
    division:     "engineering",
    type:         "root",
    tier:         1,
    token_budget: 10_000,
    cost_budget:  1.0,
  });
}

function makeChildTask(parentId: string, rootId: string, overrides: { title?: string } = {}) {
  return store.create({
    title:        overrides.title ?? "Child task",
    description:  "A sub-task",
    division:     "engineering",
    type:         "delegation",
    tier:         2,
    parent_id:    parentId,
    root_id:      rootId,
    token_budget: 3_000,
    cost_budget:  0.3,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SynthesisHandler.handleChildComplete", () => {
  it("re-queues parent when all sub-tasks complete successfully", async () => {
    const parent = makeParentTask();
    store.update(parent.id, { sub_tasks_expected: 2, status: "WAITING" });

    const child1 = makeChildTask(parent.id, parent.id, { title: "Design API" });
    const child2 = makeChildTask(parent.id, parent.id, { title: "Write tests" });

    store.update(child1.id, { status: "DONE", result_summary: "API designed", confidence: 0.9 });
    store.update(child2.id, { status: "DONE", result_summary: "Tests written", confidence: 0.85 });

    let synthEvent: ReturnType<typeof handler.handleChildComplete> extends Promise<infer T> ? T : never = null;
    handler.onSynthesisReady((ev) => { synthEvent = ev as typeof synthEvent; });

    // Trigger on first child
    const result1 = await handler.handleChildComplete(child1.id);
    expect(result1).toBeNull(); // only 1 of 2 done

    // Trigger on second child — should fire synthesis
    const result2 = await handler.handleChildComplete(child2.id);
    expect(result2).not.toBeNull();
    expect(result2!.parent_task_id).toBe(parent.id);
    expect(result2!.all_succeeded).toBe(true);
    expect(result2!.failed_count).toBe(0);
    expect(result2!.child_summaries).toHaveLength(2);

    // Parent should be in REVIEW state (set by SynthesisCollector.triggerParentSynthesis)
    const updatedParent = store.get(parent.id);
    expect(updatedParent!.status).toBe("REVIEW");
  });

  it("triggers partial synthesis when some sub-tasks fail", async () => {
    const parent = makeParentTask();
    store.update(parent.id, { sub_tasks_expected: 2, status: "WAITING" });

    const child1 = makeChildTask(parent.id, parent.id, { title: "Design API" });
    const child2 = makeChildTask(parent.id, parent.id, { title: "Write tests" });

    store.update(child1.id, { status: "DONE",   result_summary: "API designed",  confidence: 0.9 });
    store.update(child2.id, { status: "FAILED",  result_summary: "Tests failed",  confidence: 0.0 });

    await handler.handleChildComplete(child1.id);
    const result = await handler.handleChildComplete(child2.id);

    expect(result).not.toBeNull();
    expect(result!.all_succeeded).toBe(false);
    expect(result!.failed_count).toBe(1);
    expect(result!.child_summaries).toHaveLength(2);

    const failedSummary = result!.child_summaries.find((s) => s.status === "FAILED");
    expect(failedSummary).toBeDefined();
    expect(failedSummary!.title).toBe("Write tests");
  });

  it("builds synthesis prompt with management summaries from sub-tasks", () => {
    const summaries = [
      { task_id: "t1", title: "Design API",   summary: "REST API schema defined",  confidence: 0.9,  result_file: "", status: "DONE" as const },
      { task_id: "t2", title: "Write tests",  summary: "Test suite created",       confidence: 0.8,  result_file: "", status: "DONE" as const },
      { task_id: "t3", title: "Deploy",       summary: "Deployment failed",        confidence: 0.0,  result_file: "", status: "FAILED" as const },
    ];

    const prompt = handler.buildSynthesisPrompt("Build REST API Platform", summaries);

    expect(prompt).toContain("Build REST API Platform");
    expect(prompt).toContain("Design API");
    expect(prompt).toContain("REST API schema defined");
    expect(prompt).toContain("Write tests");
    expect(prompt).toContain("Test suite created");
    expect(prompt).toContain("Failed sub-tasks");
    expect(prompt).toContain("Deploy");
    expect(prompt).toContain("execute_result");
  });
});
