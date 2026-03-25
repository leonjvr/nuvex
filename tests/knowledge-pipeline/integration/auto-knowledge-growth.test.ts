/**
 * Integration tests: AutoCollector — automatic knowledge growth from task completions.
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runKnowledgeMigrations } from "../../../src/knowledge-pipeline/migration.js";
import { CollectionManager } from "../../../src/knowledge-pipeline/collection-manager.js";
import { EmbeddingPipeline } from "../../../src/knowledge-pipeline/embedding/embedding-pipeline.js";
import { MarkdownParser } from "../../../src/knowledge-pipeline/parsers/markdown-parser.js";
import { SemanticChunker } from "../../../src/knowledge-pipeline/chunkers/semantic-chunker.js";
import { AutoCollector } from "../../../src/knowledge-pipeline/auto-collector.js";
import type { Embedder, EmbedderOptions } from "../../../src/knowledge-pipeline/types.js";

class MockEmbedder implements Embedder {
  readonly dimensions = 1536;
  readonly maxTokens  = 8191;

  async embed(texts: string[], _options?: EmbedderOptions): Promise<Float32Array[]> {
    return texts.map((_text, i) =>
      new Float32Array(1536).fill(0.1 + i * 0.01),
    );
  }
}

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runKnowledgeMigrations(db);
  return db;
}

function makeAutoCollector(db: Database, embedder: MockEmbedder): {
  autoCollector: AutoCollector;
  collectionManager: CollectionManager;
} {
  const collectionManager = new CollectionManager(db);
  const pipeline = new EmbeddingPipeline(
    db,
    new MarkdownParser(),
    new SemanticChunker(),
    embedder,
  );
  const autoCollector = new AutoCollector(db, pipeline, collectionManager);
  return { autoCollector, collectionManager };
}

describe("AutoCollector — auto knowledge growth", () => {
  let db: Database;
  let embedder: MockEmbedder;

  beforeEach(() => {
    db = makeDb();
    embedder = new MockEmbedder();
  });

  it("task completion triggers auto-collection with MockEmbedder", async () => {
    const { autoCollector } = makeAutoCollector(db, embedder);

    await autoCollector.onTaskCompleted({
      task_id: "task-001",
      division: "engineering",
      result_content: `
# Task Result

The deployment was completed successfully.
All services are running at nominal capacity.
Integration tests passed with zero failures.
`,
      completed_at: new Date().toISOString(),
    });

    // Verify chunks were written
    const chunkCount = db
      .prepare<[string], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM knowledge_chunks WHERE collection_id = ?",
      )
      .get("auto-results-engineering")!.cnt;

    expect(chunkCount).toBeGreaterThan(0);
  });

  it("auto-collector creates collection if it doesn't exist", async () => {
    const { autoCollector, collectionManager } = makeAutoCollector(db, embedder);

    // Collection should not exist yet
    const beforeCollection = collectionManager.getById("auto-results-product");
    expect(beforeCollection).toBeUndefined();

    await autoCollector.onTaskCompleted({
      task_id: "task-002",
      division: "product",
      result_content: "Product roadmap analysis completed. Three new features were prioritized.",
      completed_at: new Date().toISOString(),
    });

    // Collection should now exist
    const afterCollection = collectionManager.getById("auto-results-product");
    expect(afterCollection).toBeDefined();
    expect(afterCollection!.id).toBe("auto-results-product");
    expect(afterCollection!.name).toBe("Auto Results — product");
    expect(afterCollection!.scope.divisions).toContain("product");
    expect(afterCollection!.scope.classification).toBe("INTERNAL");
  });

  it("auto-collector appends to existing collection", async () => {
    const { autoCollector, collectionManager } = makeAutoCollector(db, embedder);

    // First task completion
    await autoCollector.onTaskCompleted({
      task_id: "task-003",
      division: "engineering",
      result_content: `
# Sprint Review

Completed velocity: 42 story points.
All sprint goals achieved.
Technical debt reduced by removing legacy code.
`,
      completed_at: new Date().toISOString(),
    });

    const afterFirst = collectionManager.getById("auto-results-engineering")!;
    const chunkCountAfterFirst = afterFirst.chunk_count;
    expect(chunkCountAfterFirst).toBeGreaterThan(0);

    // Second task completion — appended to same collection
    await autoCollector.onTaskCompleted({
      task_id: "task-004",
      division: "engineering",
      result_content: `
# Incident Post-mortem

Root cause identified as a misconfigured load balancer.
Runbook updated to prevent recurrence.
MTTR was 45 minutes which meets SLA requirements.
`,
      completed_at: new Date().toISOString(),
    });

    const afterSecond = collectionManager.getById("auto-results-engineering")!;
    expect(afterSecond.chunk_count).toBeGreaterThan(chunkCountAfterFirst);

    // Source files should be distinct
    const sourceFiles = db
      .prepare<[string], { source_file: string }>(
        "SELECT DISTINCT source_file FROM knowledge_chunks WHERE collection_id = ?",
      )
      .all("auto-results-engineering")
      .map((r) => r.source_file);

    expect(sourceFiles).toContain("task-result-task-003.md");
    expect(sourceFiles).toContain("task-result-task-004.md");
  });

  it("auto-collector is disabled when config.enabled is false", async () => {
    const collectionManager = new CollectionManager(db);
    const pipeline = new EmbeddingPipeline(
      db,
      new MarkdownParser(),
      new SemanticChunker(),
      embedder,
    );
    const disabledCollector = new AutoCollector(
      db,
      pipeline,
      collectionManager,
      { enabled: false },
    );

    await disabledCollector.onTaskCompleted({
      task_id: "task-005",
      division: "finance",
      result_content: "Budget analysis complete. Q1 projections are on track.",
      completed_at: new Date().toISOString(),
    });

    // No collection should be created
    const collection = collectionManager.getById("auto-results-finance");
    expect(collection).toBeUndefined();

    // No chunks should exist
    const chunkCount = db
      .prepare<[string], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM knowledge_chunks WHERE collection_id = ?",
      )
      .get("auto-results-finance")!.cnt;
    expect(chunkCount).toBe(0);
  });
});
