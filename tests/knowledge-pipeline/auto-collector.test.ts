/**
 * Unit tests: AutoCollector
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { AutoCollector } from "../../src/knowledge-pipeline/auto-collector.js";
import { CollectionManager } from "../../src/knowledge-pipeline/collection-manager.js";
import { runKnowledgeMigrations } from "../../src/knowledge-pipeline/migration.js";
import { Logger } from "../../src/utils/logger.js";
import type { EmbeddingPipeline } from "../../src/knowledge-pipeline/embedding/embedding-pipeline.js";
import type { TaskResultEvent } from "../../src/knowledge-pipeline/auto-collector.js";

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runKnowledgeMigrations(db);
  return db;
}

function makeMockPipeline(
  ingestFn?: (content: string | Buffer, opts: unknown) => Promise<{ chunks_written: number; tokens_total: number }>,
): EmbeddingPipeline {
  return {
    ingest: ingestFn ?? vi.fn().mockResolvedValue({ chunks_written: 3, tokens_total: 150 }),
  } as unknown as EmbeddingPipeline;
}

function makeEvent(overrides: Partial<TaskResultEvent> & { task_id: string; division: string }): TaskResultEvent {
  return {
    result_content: "# Task Result\nSome output from the task.",
    completed_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("AutoCollector", () => {
  let db: Database;
  let collectionManager: CollectionManager;
  const silentLogger = Logger.silent();

  beforeEach(() => {
    db = makeDb();
    collectionManager = new CollectionManager(db, silentLogger);
  });

  it("onTaskCompleted() auto-creates collection if it does not exist", async () => {
    const pipeline = makeMockPipeline();
    const collector = new AutoCollector(db, pipeline, collectionManager, { enabled: true }, silentLogger);

    const event = makeEvent({ task_id: "task-001", division: "engineering" });

    // Collection should not exist yet
    expect(collectionManager.getById("auto-results-engineering")).toBeUndefined();

    await collector.onTaskCompleted(event);

    const col = collectionManager.getById("auto-results-engineering");
    expect(col).toBeDefined();
    expect(col!.id).toBe("auto-results-engineering");
    expect(col!.name).toBe("Auto Results — engineering");
  });

  it("onTaskCompleted() creates collection with division name in the ID", async () => {
    const pipeline = makeMockPipeline();
    const collector = new AutoCollector(db, pipeline, collectionManager, { enabled: true }, silentLogger);

    const event = makeEvent({ task_id: "task-002", division: "legal" });

    await collector.onTaskCompleted(event);

    const col = collectionManager.getById("auto-results-legal");
    expect(col).toBeDefined();
    expect(col!.scope.divisions).toEqual(["legal"]);
    expect(col!.scope.classification).toBe("INTERNAL");
  });

  it("onTaskCompleted() uses existing collection if already present (does not re-create)", async () => {
    const pipeline = makeMockPipeline();
    const collector = new AutoCollector(db, pipeline, collectionManager, { enabled: true }, silentLogger);

    // Pre-create the collection
    collectionManager.create({
      id: "auto-results-finance",
      name: "Auto Results — finance",
      scope: { divisions: ["finance"], classification: "INTERNAL" },
    });

    const createSpy = vi.spyOn(collectionManager, "create");

    const event = makeEvent({ task_id: "task-003", division: "finance" });
    await collector.onTaskCompleted(event);

    // create() should NOT have been called again
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("onTaskCompleted() calls pipeline.ingest() with correct collection_id and source_file", async () => {
    const ingestMock = vi.fn().mockResolvedValue({ chunks_written: 2, tokens_total: 80 });
    const pipeline = makeMockPipeline(ingestMock);
    const collector = new AutoCollector(db, pipeline, collectionManager, { enabled: true }, silentLogger);

    const event = makeEvent({
      task_id: "task-ingestion-check",
      division: "ops",
      result_content: "Task output here.",
    });

    await collector.onTaskCompleted(event);

    expect(ingestMock).toHaveBeenCalledOnce();
    const [content, opts] = ingestMock.mock.calls[0]! as [string, { collection_id: string; source_file: string }];
    expect(content).toBe("Task output here.");
    expect(opts.collection_id).toBe("auto-results-ops");
    expect(opts.source_file).toBe("task-result-task-ingestion-check.md");
  });

  it("handles error from EmbeddingPipeline gracefully — does not throw", async () => {
    const failingPipeline = makeMockPipeline(
      vi.fn().mockRejectedValue(new Error("Embedding service unavailable")),
    );
    const collector = new AutoCollector(
      db,
      failingPipeline,
      collectionManager,
      { enabled: true },
      silentLogger,
    );

    const event = makeEvent({ task_id: "task-error", division: "risk" });

    // Should not throw even when the pipeline fails
    await expect(collector.onTaskCompleted(event)).resolves.toBeUndefined();
  });

  it("does nothing when config.enabled is false", async () => {
    const ingestMock = vi.fn().mockResolvedValue({ chunks_written: 0, tokens_total: 0 });
    const pipeline = makeMockPipeline(ingestMock);
    const collector = new AutoCollector(
      db,
      pipeline,
      collectionManager,
      { enabled: false },
      silentLogger,
    );

    const event = makeEvent({ task_id: "task-disabled", division: "hr" });
    await collector.onTaskCompleted(event);

    // Pipeline should NOT have been called
    expect(ingestMock).not.toHaveBeenCalled();
    // Collection should NOT have been created
    expect(collectionManager.getById("auto-results-hr")).toBeUndefined();
  });

  it("onTaskCompleted() for two different divisions creates two separate collections", async () => {
    const pipeline = makeMockPipeline();
    const collector = new AutoCollector(db, pipeline, collectionManager, { enabled: true }, silentLogger);

    await collector.onTaskCompleted(makeEvent({ task_id: "task-a", division: "alpha" }));
    await collector.onTaskCompleted(makeEvent({ task_id: "task-b", division: "beta" }));

    const alpha = collectionManager.getById("auto-results-alpha");
    const beta = collectionManager.getById("auto-results-beta");

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect(alpha!.id).toBe("auto-results-alpha");
    expect(beta!.id).toBe("auto-results-beta");
  });

  it("collection created by auto-collector has INTERNAL classification and description", async () => {
    const pipeline = makeMockPipeline();
    const collector = new AutoCollector(db, pipeline, collectionManager, { enabled: true }, silentLogger);

    await collector.onTaskCompleted(makeEvent({ task_id: "task-desc", division: "product" }));

    const col = collectionManager.getById("auto-results-product");
    expect(col).toBeDefined();
    expect(col!.scope.classification).toBe("INTERNAL");
    expect(col!.description).toBe("Automatically populated from task results");
  });
});
