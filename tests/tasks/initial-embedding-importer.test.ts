// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/tasks/initial-embedding-importer.ts — Amendment 001 #395
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { InitialEmbeddingImporter } from "../../src/tasks/initial-embedding-importer.js";
import { TaskOutputEmbedder }       from "../../src/tasks/output-embedder.js";
import { TaskOutputStore }          from "../../src/tasks/output-store.js";
import type { Embedder }            from "../../src/knowledge-pipeline/types.js";

type Db = InstanceType<typeof BetterSqlite3>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockEmbedder(dims = 4): Embedder {
  return {
    dimensions: dims,
    embed: vi.fn(async (texts: string[]) =>
      texts.map(() => new Float32Array(dims).fill(0.5)),
    ),
  };
}

function makeDb(): Db {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

function makeOutput(i: number) {
  return {
    task_id:       `task-${i}`,
    agent_id:      `agent-${i}`,
    output_type:   "report" as const,
    classification: "INTERNAL" as const,
    content_text:  `Output content ${i}`,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: Db;
let outputStore: TaskOutputStore;
let taskOutputEmbedder: TaskOutputEmbedder;
let mockEmbedder: Embedder;
let importer: InitialEmbeddingImporter;

beforeEach(() => {
  db               = makeDb();
  mockEmbedder     = makeMockEmbedder();
  outputStore      = new TaskOutputStore(db);
  taskOutputEmbedder = new TaskOutputEmbedder(db, mockEmbedder);
  outputStore.initialize();
  taskOutputEmbedder.initialize();
  importer = new InitialEmbeddingImporter(db, taskOutputEmbedder);
});

afterEach(() => {
  vi.clearAllMocks();
  db.close();
});

// ---------------------------------------------------------------------------
// countPending / countTotal
// ---------------------------------------------------------------------------

describe("countPending", () => {
  it("returns 0 when no outputs exist", () => {
    expect(importer.countPending()).toBe(0);
  });

  it("returns total when nothing is embedded", () => {
    outputStore.create(makeOutput(1));
    outputStore.create(makeOutput(2));
    outputStore.create(makeOutput(3));
    expect(importer.countPending()).toBe(3);
  });

  it("excludes already-embedded outputs", async () => {
    const o1 = outputStore.create(makeOutput(1));
    const o2 = outputStore.create(makeOutput(2));
    outputStore.create(makeOutput(3));

    await taskOutputEmbedder.embedOutput(o1);
    await taskOutputEmbedder.embedOutput(o2);

    expect(importer.countPending()).toBe(1);
  });
});

describe("countTotal", () => {
  it("returns 0 when empty", () => {
    expect(importer.countTotal()).toBe(0);
  });

  it("counts all outputs regardless of embed status", async () => {
    const o = outputStore.create(makeOutput(1));
    await taskOutputEmbedder.embedOutput(o);
    outputStore.create(makeOutput(2));
    expect(importer.countTotal()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// runImport
// ---------------------------------------------------------------------------

describe("runImport", () => {
  it("returns zeros when no pending outputs", async () => {
    const result = await importer.runImport();
    expect(result).toEqual({ total: 0, embedded: 0, failed: 0, elapsed_ms: expect.any(Number) });
  });

  it("embeds all pending outputs", async () => {
    outputStore.create(makeOutput(1));
    outputStore.create(makeOutput(2));
    outputStore.create(makeOutput(3));

    const result = await importer.runImport();

    expect(result.total).toBe(3);
    expect(result.embedded).toBe(3);
    expect(result.failed).toBe(0);
    expect(importer.countPending()).toBe(0);
  });

  it("skips already-embedded outputs (resumable)", async () => {
    const o1 = outputStore.create(makeOutput(1));
    outputStore.create(makeOutput(2));

    // Pre-embed first output
    await taskOutputEmbedder.embedOutput(o1);

    const result = await importer.runImport();

    expect(result.total).toBe(1);   // only 1 pending
    expect(result.embedded).toBe(1);
    expect(importer.countPending()).toBe(0);
  });

  it("reports progress via onProgress callback", async () => {
    outputStore.create(makeOutput(1));
    outputStore.create(makeOutput(2));
    outputStore.create(makeOutput(3));

    const progressCalls: { total: number; completed: number }[] = [];

    await importer.runImport({
      batchSize:   2,
      onProgress:  (p) => progressCalls.push({ total: p.total, completed: p.completed }),
    });

    // Two batches: 2 + 1
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
    expect(progressCalls.at(-1)!.completed).toBe(3);
  });

  it("continues after individual embed failure — fails count incremented", async () => {
    outputStore.create(makeOutput(1));
    outputStore.create(makeOutput(2));
    outputStore.create(makeOutput(3));

    // Make second embed call fail
    let calls = 0;
    const flakyEmbedder: Embedder = {
      dimensions: 4,
      embed: vi.fn(async (texts: string[]) => {
        calls++;
        if (calls === 2) throw new Error("transient error");
        return texts.map(() => new Float32Array(4).fill(0.5));
      }),
    };
    const flakyTaskEmbedder = new TaskOutputEmbedder(db, flakyEmbedder);
    flakyTaskEmbedder.initialize();
    const flakyImporter = new InitialEmbeddingImporter(db, flakyTaskEmbedder);

    const result = await flakyImporter.runImport({ batchSize: 1 });

    expect(result.total).toBe(3);
    expect(result.embedded).toBe(2);
    expect(result.failed).toBe(1);
    // Successful ones are in DB; failed one remains pending
    expect(flakyImporter.countPending()).toBe(1);
  });

  it("respects batchSize — embeds in multiple batches", async () => {
    for (let i = 0; i < 5; i++) outputStore.create(makeOutput(i));

    await importer.runImport({ batchSize: 2 });

    expect(importer.countPending()).toBe(0);
    // embedder.embed is called once per item (TaskOutputEmbedder calls embed([text]))
    expect(vi.mocked(mockEmbedder.embed)).toHaveBeenCalledTimes(5);
  });

  it("elapsed_ms is a non-negative number", async () => {
    outputStore.create(makeOutput(1));
    const result = await importer.runImport();
    expect(result.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it("is fully resumable: re-running after interrupt only processes remaining rows", async () => {
    for (let i = 0; i < 6; i++) outputStore.create(makeOutput(i));

    // First run: only process 3 by using a mock that stops after 3
    let embedCount = 0;
    const limitedEmbedder: Embedder = {
      dimensions: 4,
      embed: vi.fn(async (texts: string[]) => {
        embedCount++;
        if (embedCount > 3) throw new Error("interrupted");
        return texts.map(() => new Float32Array(4).fill(0.1));
      }),
    };
    const limitedTaskEmbedder = new TaskOutputEmbedder(db, limitedEmbedder);
    limitedTaskEmbedder.initialize();
    const firstImporter = new InitialEmbeddingImporter(db, limitedTaskEmbedder);

    const firstResult = await firstImporter.runImport({ batchSize: 1 });
    expect(firstResult.embedded).toBe(3);
    expect(firstResult.failed).toBe(3);

    // Second run with working embedder: only the 3 remaining should be processed
    const secondResult = await importer.runImport({ batchSize: 10 });
    expect(secondResult.total).toBe(3);
    expect(secondResult.embedded).toBe(3);
    expect(importer.countPending()).toBe(0);
  });
});
