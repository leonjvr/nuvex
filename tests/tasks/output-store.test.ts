/**
 * Tests for src/tasks/output-store.ts — Phase 14
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { TaskOutputStore } from "../../src/tasks/output-store.js";
import { isSidjuaError }  from "../../src/core/error-codes.js";
import { createHash }      from "node:crypto";

type Db = InstanceType<typeof BetterSqlite3>;

function makeDb(): Db {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

let db: Db;
let store: TaskOutputStore;

beforeEach(() => {
  db    = makeDb();
  store = new TaskOutputStore(db);
  store.initialize();
});

afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// create with text content
// ---------------------------------------------------------------------------

describe("create() with text content", () => {
  it("stores text output and returns TaskOutput with SHA-256 hash", () => {
    const output = store.create({
      task_id:      "task-001",
      agent_id:     "agent-001",
      output_type:  "report",
      content_text: "Hello world",
    });

    expect(output.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(output.task_id).toBe("task-001");
    expect(output.agent_id).toBe("agent-001");
    expect(output.output_type).toBe("report");
    expect(output.content_text).toBe("Hello world");
    expect(output.content_hash).toBe(
      createHash("sha256").update("Hello world", "utf-8").digest("hex"),
    );
    expect(output.classification).toBe("INTERNAL");
    expect(output.metadata).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// create with binary content
// ---------------------------------------------------------------------------

describe("create() with binary content", () => {
  it("stores BLOB and computes hash from Buffer", () => {
    const bin    = Buffer.from("binary-data");
    const output = store.create({
      task_id:       "task-002",
      agent_id:      "agent-002",
      output_type:   "file",
      content_binary: bin,
      filename:      "report.pdf",
    });

    expect(output.content_binary).not.toBeNull();
    expect(output.content_text).toBeNull();
    expect(output.filename).toBe("report.pdf");
    expect(output.content_hash).toBe(
      createHash("sha256").update(bin).digest("hex"),
    );
  });
});

// ---------------------------------------------------------------------------
// create with neither content → OUTPUT-001
// ---------------------------------------------------------------------------

describe("create() with neither content_text nor content_binary", () => {
  it("throws OUTPUT-001", () => {
    expect(() =>
      store.create({ task_id: "t", agent_id: "a", output_type: "data" }),
    ).toSatisfy((fn: () => void) => {
      try { fn(); return false; }
      catch (err) { return isSidjuaError(err) && err.code === "OUTPUT-001"; }
    });
  });
});

// ---------------------------------------------------------------------------
// getByTaskId
// ---------------------------------------------------------------------------

describe("getByTaskId()", () => {
  it("returns all outputs for a task ordered by created_at", () => {
    store.create({ task_id: "t1", agent_id: "a", output_type: "report", content_text: "R1" });
    store.create({ task_id: "t1", agent_id: "a", output_type: "code",   content_text: "C1" });
    store.create({ task_id: "t2", agent_id: "a", output_type: "data",   content_text: "D1" });

    const t1 = store.getByTaskId("t1");
    expect(t1).toHaveLength(2);
    expect(t1[0]!.output_type).toBe("report");
    expect(t1[1]!.output_type).toBe("code");
  });
});

// ---------------------------------------------------------------------------
// verifyHash
// ---------------------------------------------------------------------------

describe("verifyHash()", () => {
  it("returns true for intact content", () => {
    const o = store.create({ task_id: "t", agent_id: "a", output_type: "analysis", content_text: "ok" });
    expect(store.verifyHash(o.id)).toBe(true);
  });

  it("returns false after content is tampered via direct SQL", () => {
    const o = store.create({ task_id: "t", agent_id: "a", output_type: "analysis", content_text: "original" });
    // Tamper with content_text without updating hash
    db.prepare("UPDATE task_outputs SET content_text = 'tampered' WHERE id = ?").run(o.id);
    expect(store.verifyHash(o.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// query with filters
// ---------------------------------------------------------------------------

describe("query() with filters", () => {
  beforeEach(() => {
    store.create({ task_id: "t1", agent_id: "a1", output_type: "report",   content_text: "R", classification: "INTERNAL" });
    store.create({ task_id: "t1", agent_id: "a1", output_type: "code",     content_text: "C", classification: "CONFIDENTIAL" });
    store.create({ task_id: "t2", agent_id: "a2", output_type: "analysis", content_text: "A", classification: "INTERNAL" });
  });

  it("filters by output_type", () => {
    const results = store.query({ output_type: "report" });
    expect(results).toHaveLength(1);
    expect(results[0]!.output_type).toBe("report");
  });

  it("filters by classification", () => {
    const results = store.query({ classification: "CONFIDENTIAL" });
    expect(results).toHaveLength(1);
    expect(results[0]!.classification).toBe("CONFIDENTIAL");
  });

  it("count() returns correct total", () => {
    expect(store.count()).toBe(3);
    expect(store.count({ output_type: "report" })).toBe(1);
  });
});
