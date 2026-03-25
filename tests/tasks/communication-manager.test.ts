/**
 * Tests for src/tasks/communication-manager.ts — Phase 14
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { TaskOutputStore }      from "../../src/tasks/output-store.js";
import { TaskSummaryStore }     from "../../src/tasks/summary-store.js";
import { TaskOutputEmbedder }   from "../../src/tasks/output-embedder.js";
import { CommunicationManager } from "../../src/tasks/communication-manager.js";
import { isSidjuaError }        from "../../src/core/error-codes.js";
import type { Embedder }        from "../../src/knowledge-pipeline/types.js";

type Db = InstanceType<typeof BetterSqlite3>;

function makeMockEmbedder(): Embedder {
  return {
    dimensions: 4,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]));
    },
  };
}

function makeDb(): Db {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

function makeCm(db: Db, withEmbedder = false): CommunicationManager {
  const outputStore  = new TaskOutputStore(db);
  const summaryStore = new TaskSummaryStore(db);
  const emb          = withEmbedder ? makeMockEmbedder() : null;
  const embedder     = new TaskOutputEmbedder(db, emb);
  outputStore.initialize();
  summaryStore.initialize();
  embedder.initialize();
  return new CommunicationManager(outputStore, summaryStore, embedder);
}

let db: Db;

beforeEach(() => {
  db = makeDb();
});

afterEach(() => {
  vi.clearAllMocks();
  db.close();
});

// ---------------------------------------------------------------------------
// storeOutput + embed
// ---------------------------------------------------------------------------

describe("storeOutput()", () => {
  it("creates output and embeds in SQLite vector store (Path 1)", async () => {
    const cm = makeCm(db, true);
    const output = await cm.storeOutput({
      task_id:      "t1",
      agent_id:     "a1",
      output_type:  "report",
      content_text: "Q1 budget report",
    });

    expect(output.id).toBeDefined();
    expect(output.task_id).toBe("t1");

    // Give embedder time to fire-and-forget
    await new Promise((r) => setTimeout(r, 20));

    // Verify vector row exists
    const row = db
      .prepare<[string], { n: number }>("SELECT COUNT(*) as n FROM task_output_vectors WHERE task_id = ?")
      .get("t1");
    expect(row!.n).toBe(1);
  });

  it("succeeds even when embedding fails (warning only)", async () => {
    const failingEmbedder: Embedder = {
      dimensions: 4,
      async embed(): Promise<Float32Array[]> { throw new Error("network error"); },
    };
    const os = new TaskOutputStore(db);
    const ss = new TaskSummaryStore(db);
    const emb = new TaskOutputEmbedder(db, failingEmbedder);
    os.initialize(); ss.initialize(); emb.initialize();
    const cm = new CommunicationManager(os, ss, emb);

    const output = await cm.storeOutput({
      task_id: "t-fail", agent_id: "a", output_type: "data", content_text: "test",
    });

    expect(output.id).toBeDefined(); // output persisted
  });
});

// ---------------------------------------------------------------------------
// storeSummary validation
// ---------------------------------------------------------------------------

describe("storeSummary()", () => {
  it("validates against governance policy before storing", async () => {
    const cm = makeCm(db);
    const s = await cm.storeSummary({
      task_id:      "t2",
      agent_id:     "a2",
      summary_text: "All done.",
      key_facts:    ["Fact A"],
      status:       "completed",
    });

    expect(s.task_id).toBe("t2");
    expect(s.key_facts).toEqual(["Fact A"]);
  });

  it("throws SUMMARY-001 for invalid input (empty key_facts)", async () => {
    const cm = makeCm(db);
    await expect(
      cm.storeSummary({
        task_id: "t3", agent_id: "a", summary_text: "x", key_facts: [], status: "completed",
      }),
    ).rejects.toSatisfy((err: unknown) => isSidjuaError(err) && err.code === "SUMMARY-001");
  });
});

// ---------------------------------------------------------------------------
// searchOutputs — Path 1 (with embedder)
// ---------------------------------------------------------------------------

describe("searchOutputs() Path 1 — with embedder", () => {
  it("with include_full_content drills down to full output", async () => {
    const cm = makeCm(db, true);
    const o = await cm.storeOutput({
      task_id: "t4", agent_id: "a", output_type: "analysis",
      content_text: "detailed analysis here",
    });

    await new Promise((r) => setTimeout(r, 20));

    const results = await cm.searchOutputs("analysis", { include_full_content: true });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.full_output).toBeDefined();
    expect(results[0]!.full_output?.id).toBe(o.id);
  });
});

// ---------------------------------------------------------------------------
// searchOutputs — Path 2 fallback (no embedder)
// ---------------------------------------------------------------------------

describe("searchOutputs() — fallback without embedder", () => {
  it("falls back to direct DB text query", async () => {
    const cm = makeCm(db, false);
    await cm.storeOutput({
      task_id: "t5", agent_id: "a", output_type: "report",
      content_text: "budget calculations for Q2",
    });

    const results = await cm.searchOutputs("budget calculations");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.task_id).toBe("t5");
  });
});

// ---------------------------------------------------------------------------
// getTaskOutputs — Path 2 (direct)
// ---------------------------------------------------------------------------

describe("getTaskOutputs()", () => {
  it("returns all outputs for a task", async () => {
    const cm = makeCm(db);
    await cm.storeOutput({ task_id: "t6", agent_id: "a", output_type: "file",   content_text: "f1" });
    await cm.storeOutput({ task_id: "t6", agent_id: "a", output_type: "report", content_text: "r1" });
    await cm.storeOutput({ task_id: "t7", agent_id: "a", output_type: "code",   content_text: "c1" });

    const outputs = cm.getTaskOutputs("t6");
    expect(outputs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getTaskSummary — Path 3
// ---------------------------------------------------------------------------

describe("getTaskSummary()", () => {
  it("returns latest summary for a task (Path 3)", async () => {
    const cm = makeCm(db);
    await cm.storeSummary({
      task_id: "t8", agent_id: "a", summary_text: "done",
      key_facts: ["fact"], status: "completed",
    });

    const s = cm.getTaskSummary("t8");
    expect(s).not.toBeNull();
    expect(s!.task_id).toBe("t8");
  });

  it("returns null when no summary exists", () => {
    const cm = makeCm(db);
    expect(cm.getTaskSummary("nonexistent")).toBeNull();
  });
});
