/**
 * Tests for src/tasks/output-embedder.ts — Phase 14
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { TaskOutputEmbedder } from "../../src/tasks/output-embedder.js";
import { TaskOutputStore }    from "../../src/tasks/output-store.js";
import type { Embedder }      from "../../src/knowledge-pipeline/types.js";

type Db = InstanceType<typeof BetterSqlite3>;

// Mock embedder that returns deterministic 4-dim vectors
function makeMockEmbedder(): Embedder {
  return {
    dimensions: 4,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((t) => {
        const v = new Float32Array(4);
        // Stable hash-like values based on text content
        for (let i = 0; i < 4; i++) v[i] = (t.charCodeAt(i % t.length) % 10) / 10;
        return v;
      });
    },
  };
}

function makeDb(): Db {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

let db: Db;
let outputStore: TaskOutputStore;
let embedder: TaskOutputEmbedder;
let mockEmb: Embedder;

beforeEach(() => {
  db          = makeDb();
  mockEmb     = makeMockEmbedder();
  outputStore = new TaskOutputStore(db);
  embedder    = new TaskOutputEmbedder(db, mockEmb);
  outputStore.initialize();
  embedder.initialize();
});

afterEach(() => {
  vi.clearAllMocks();
  db.close();
});

// ---------------------------------------------------------------------------
// embedOutput
// ---------------------------------------------------------------------------

describe("embedOutput()", () => {
  it("creates a vector row with correct payload (pg_id, task_id, summary_snippet)", async () => {
    const output = outputStore.create({
      task_id:      "task-embed-001",
      agent_id:     "agent-001",
      output_type:  "report",
      content_text: "This is a financial analysis of Q1 2026.",
    });

    const vectorId = await embedder.embedOutput(output);
    expect(vectorId).not.toBe("");

    // Verify row exists in DB
    const row = db
      .prepare<[string], { output_id: string; task_id: string; summary_snippet: string }>(
        "SELECT output_id, task_id, summary_snippet FROM task_output_vectors WHERE id = ?",
      )
      .get(vectorId);

    expect(row).toBeDefined();
    expect(row!.output_id).toBe(output.id);
    expect(row!.task_id).toBe("task-embed-001");
    expect(row!.summary_snippet).toContain("financial analysis");
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("search()", () => {
  it("returns results with scores, filtered by task_id", async () => {
    // Create two outputs in different tasks
    const o1 = outputStore.create({
      task_id: "t-search-1", agent_id: "a", output_type: "report",
      content_text: "budget analysis results",
    });
    const o2 = outputStore.create({
      task_id: "t-search-2", agent_id: "a", output_type: "code",
      content_text: "python script for data processing",
    });

    await embedder.embedOutput(o1);
    await embedder.embedOutput(o2);

    const results = await embedder.search("budget", { task_id: "t-search-1" });
    expect(results.length).toBe(1);
    expect(results[0]!.pg_id).toBe(o1.id);
    expect(results[0]!.task_id).toBe("t-search-1");
    expect(typeof results[0]!.score).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation — no embedder
// ---------------------------------------------------------------------------

describe("search() with no embedder", () => {
  it("logs warning and returns empty array", async () => {
    const nullEmbedder = new TaskOutputEmbedder(db, null);
    nullEmbedder.initialize();

    const results = await nullEmbedder.search("anything");
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deleteByTaskId
// ---------------------------------------------------------------------------

describe("deleteByTaskId()", () => {
  it("removes all vectors for a task", async () => {
    const o = outputStore.create({
      task_id: "t-del", agent_id: "a", output_type: "data",
      content_text: "some data",
    });
    await embedder.embedOutput(o);

    const before = db
      .prepare<[string], { n: number }>("SELECT COUNT(*) as n FROM task_output_vectors WHERE task_id = ?")
      .get("t-del");
    expect(before!.n).toBe(1);

    embedder.deleteByTaskId("t-del");

    const after = db
      .prepare<[string], { n: number }>("SELECT COUNT(*) as n FROM task_output_vectors WHERE task_id = ?")
      .get("t-del");
    expect(after!.n).toBe(0);
  });
});
