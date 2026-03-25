/**
 * Tests for src/tasks/output-bridge.ts — Phase 14
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { TaskOutputStore }      from "../../src/tasks/output-store.js";
import { TaskSummaryStore }     from "../../src/tasks/summary-store.js";
import { TaskOutputEmbedder }   from "../../src/tasks/output-embedder.js";
import { CommunicationManager } from "../../src/tasks/communication-manager.js";
import { OutputBridge }         from "../../src/tasks/output-bridge.js";

type Db = InstanceType<typeof BetterSqlite3>;

function makeDb(): Db {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

function makeBridge(db: Db): OutputBridge {
  const outputStore  = new TaskOutputStore(db);
  const summaryStore = new TaskSummaryStore(db);
  const embedder     = new TaskOutputEmbedder(db, null);
  outputStore.initialize();
  summaryStore.initialize();
  embedder.initialize();
  const cm = new CommunicationManager(outputStore, summaryStore, embedder);
  return new OutputBridge(cm);
}

let db: Db;
let bridge: OutputBridge;

beforeEach(() => {
  db     = makeDb();
  bridge = makeBridge(db);
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// onTaskComplete
// ---------------------------------------------------------------------------

describe("onTaskComplete()", () => {
  it("stores output + summary in single call", async () => {
    const result = await bridge.onTaskComplete({
      task_id:     "task-bridge-001",
      agent_id:    "agent-001",
      output_text: "Completed analysis of quarterly data.",
      output_type: "analysis",
      key_facts:   ["Q1 revenue up 12%", "Costs stable"],
      status:      "completed",
    });

    expect(result.output.task_id).toBe("task-bridge-001");
    expect(result.summary.task_id).toBe("task-bridge-001");
    expect(result.summary.key_facts).toContain("Q1 revenue up 12%");
    expect(result.summary.output_refs).toContain(result.output.id);
    expect(result.summary.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// getChildResults — summaries only
// ---------------------------------------------------------------------------

describe("getChildResults()", () => {
  it("returns summaries for child tasks", async () => {
    await bridge.onTaskComplete({
      task_id: "child-1", agent_id: "a", output_text: "C1 done",
      output_type: "report", key_facts: ["c1 fact"], status: "completed",
    });
    await bridge.onTaskComplete({
      task_id: "child-2", agent_id: "a", output_text: "C2 done",
      output_type: "report", key_facts: ["c2 fact"], status: "failed",
    });

    const results = await bridge.getChildResults(["child-1", "child-2"]);
    expect(results.summaries).toHaveLength(2);
    expect(results.outputs).toBeUndefined();
  });

  it("returns full outputs when include_outputs is true", async () => {
    await bridge.onTaskComplete({
      task_id: "child-3", agent_id: "a", output_text: "content",
      output_type: "code", key_facts: ["compiled"], status: "completed",
    });

    const results = await bridge.getChildResults(["child-3"], { include_outputs: true });
    expect(results.summaries).toHaveLength(1);
    expect(results.outputs).toBeDefined();
    expect(results.outputs!.length).toBeGreaterThan(0);
    expect(results.outputs![0]!.task_id).toBe("child-3");
  });
});
