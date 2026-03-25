/**
 * Unit tests: CollectionManager
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { CollectionManager } from "../../src/knowledge-pipeline/collection-manager.js";
import { runKnowledgeMigrations } from "../../src/knowledge-pipeline/migration.js";
import { Logger } from "../../src/utils/logger.js";
import type { CreateCollectionInput } from "../../src/knowledge-pipeline/types.js";

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runKnowledgeMigrations(db);
  return db;
}

function makeInput(overrides: Partial<CreateCollectionInput> & { id: string; name: string }): CreateCollectionInput {
  return {
    scope: {
      divisions: ["eng"],
      classification: "INTERNAL",
    },
    ...overrides,
  };
}

describe("CollectionManager", () => {
  let db: Database;
  let manager: CollectionManager;
  const silentLogger = Logger.silent();

  beforeEach(() => {
    db = makeDb();
    manager = new CollectionManager(db, silentLogger);
  });

  it("create() inserts a collection and getById() returns it", () => {
    const input = makeInput({ id: "col-001", name: "Engineering Docs" });
    const created = manager.create(input);

    expect(created.id).toBe("col-001");
    expect(created.name).toBe("Engineering Docs");
    expect(created.status).toBe("empty");
    expect(created.chunk_count).toBe(0);
    expect(created.total_tokens).toBe(0);

    const fetched = manager.getById("col-001");
    expect(fetched).toBeDefined();
    expect(fetched!.id).toBe("col-001");
    expect(fetched!.name).toBe("Engineering Docs");
  });

  it("getById() returns undefined for a non-existent id", () => {
    const result = manager.getById("does-not-exist");
    expect(result).toBeUndefined();
  });

  it("list() returns all collections sorted by created_at DESC", async () => {
    manager.create(makeInput({ id: "col-a", name: "Alpha" }));

    // Small delay to ensure different created_at timestamps
    await new Promise((resolve) => setTimeout(resolve, 5));

    manager.create(makeInput({ id: "col-b", name: "Beta" }));
    manager.create(makeInput({ id: "col-c", name: "Gamma" }));

    const results = manager.list();
    expect(results.length).toBeGreaterThanOrEqual(3);

    // Most recent should come first — col-c and col-b were created after col-a
    const ids = results.map((r) => r.id);
    const idxA = ids.indexOf("col-a");
    const idxB = ids.indexOf("col-b");
    const idxC = ids.indexOf("col-c");
    expect(idxC).toBeLessThanOrEqual(idxB);
    expect(idxB).toBeLessThanOrEqual(idxA);
  });

  it("updateStatus() changes the status field", () => {
    manager.create(makeInput({ id: "col-status", name: "Status Test" }));

    manager.updateStatus("col-status", "indexing");
    let col = manager.getById("col-status");
    expect(col!.status).toBe("indexing");

    manager.updateStatus("col-status", "indexed");
    col = manager.getById("col-status");
    expect(col!.status).toBe("indexed");
  });

  it("markForReindex() sets status to needs_reindex", () => {
    manager.create(makeInput({ id: "col-reindex", name: "Reindex Test" }));
    manager.updateStatus("col-reindex", "indexed");

    manager.markForReindex("col-reindex");

    const col = manager.getById("col-reindex");
    expect(col!.status).toBe("needs_reindex");
  });

  it("delete() removes the collection", () => {
    manager.create(makeInput({ id: "col-delete", name: "Delete Me" }));
    expect(manager.getById("col-delete")).toBeDefined();

    manager.delete("col-delete");

    expect(manager.getById("col-delete")).toBeUndefined();
  });

  it("delete() cascades to remove chunks and vectors", () => {
    manager.create(makeInput({ id: "col-cascade", name: "Cascade Test" }));

    // Manually insert a chunk and a vector to test cascade
    const now = new Date().toISOString();
    const chunkId = "chunk-cascade-1";
    db.prepare(`
      INSERT INTO knowledge_chunks
        (id, collection_id, source_file, content, token_count, position, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(chunkId, "col-cascade", "test.md", "Some content", 10, 0, now);

    db.prepare(`
      INSERT INTO knowledge_vectors (chunk_id, collection_id, embedding)
      VALUES (?, ?, ?)
    `).run(chunkId, "col-cascade", Buffer.alloc(16));

    // Verify they exist
    const chunkBefore = db.prepare("SELECT * FROM knowledge_chunks WHERE id = ?").get(chunkId);
    expect(chunkBefore).toBeDefined();
    const vectorBefore = db.prepare("SELECT * FROM knowledge_vectors WHERE chunk_id = ?").get(chunkId);
    expect(vectorBefore).toBeDefined();

    // Delete the collection
    manager.delete("col-cascade");

    // Both chunk and vector should be gone
    const chunkAfter = db.prepare("SELECT * FROM knowledge_chunks WHERE id = ?").get(chunkId);
    expect(chunkAfter).toBeUndefined();
    const vectorAfter = db.prepare("SELECT * FROM knowledge_vectors WHERE chunk_id = ?").get(chunkId);
    expect(vectorAfter).toBeUndefined();
  });

  it("list() returns empty array when no collections exist", () => {
    const results = manager.list();
    expect(results).toEqual([]);
  });

  it("create() stores the scope correctly including classification", () => {
    const input = makeInput({
      id: "col-scope",
      name: "Scope Test",
      scope: {
        divisions: ["legal", "finance"],
        agents: ["agent-001"],
        tiers: [1, 2],
        classification: "CONFIDENTIAL",
      },
    });

    const created = manager.create(input);
    expect(created.scope.classification).toBe("CONFIDENTIAL");
    expect(created.scope.divisions).toEqual(["legal", "finance"]);
    expect(created.scope.agents).toEqual(["agent-001"]);
    expect(created.scope.tiers).toEqual([1, 2]);
  });

  it("create() stores default ingestion config when not provided", () => {
    const input = makeInput({ id: "col-defaults", name: "Defaults Test" });
    const created = manager.create(input);

    expect(created.config.ingestion.chunking_strategy).toBe("semantic");
    expect(created.config.ingestion.chunk_size_tokens).toBe(500);
    expect(created.config.ingestion.chunk_overlap_tokens).toBe(50);
    expect(created.config.ingestion.embedding_model).toBe("text-embedding-3-small");
    expect(created.config.retrieval.default_top_k).toBe(5);
    expect(created.config.retrieval.similarity_threshold).toBe(0.7);
    expect(created.config.retrieval.reranking).toBe(true);
  });

  it("create() persists custom ingestion config", () => {
    const input = makeInput({
      id: "col-custom",
      name: "Custom Config",
      ingestion: {
        chunking_strategy: "fixed",
        chunk_size_tokens: 1000,
        chunk_overlap_tokens: 100,
        embedding_model: "text-embedding-3-large",
        embedding_provider: "openai",
      },
      retrieval: {
        default_top_k: 10,
        similarity_threshold: 0.85,
        reranking: false,
        mmr_diversity: 0.5,
      },
    });

    const created = manager.create(input);
    expect(created.config.ingestion.chunking_strategy).toBe("fixed");
    expect(created.config.ingestion.chunk_size_tokens).toBe(1000);
    expect(created.config.retrieval.default_top_k).toBe(10);
    expect(created.config.retrieval.reranking).toBe(false);
  });
});
