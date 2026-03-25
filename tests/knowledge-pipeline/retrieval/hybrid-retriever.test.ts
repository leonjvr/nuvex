/**
 * Unit tests: HybridRetriever
 * Uses an in-memory SQLite DB with runKnowledgeMigrations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runKnowledgeMigrations } from "../../../src/knowledge-pipeline/migration.js";
import { HybridRetriever } from "../../../src/knowledge-pipeline/retrieval/hybrid-retriever.js";
import type { Embedder, EmbedderOptions } from "../../../src/knowledge-pipeline/types.js";

// ---------------------------------------------------------------------------
// Mock embedder — always returns a fixed 1536-dim Float32Array
// ---------------------------------------------------------------------------

class MockEmbedder implements Embedder {
  readonly dimensions = 1536;
  readonly maxTokens  = 8191;

  async embed(texts: string[], _options?: EmbedderOptions): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array(1536).fill(0.5));
  }
}

/** Returns all-zero query vectors → cosine similarity with any stored chunk = 0 */
class ZeroQueryEmbedder implements Embedder {
  readonly dimensions = 1536;
  readonly maxTokens  = 8191;

  async embed(texts: string[], _options?: EmbedderOptions): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array(1536).fill(0));
  }
}

/** Always throws — simulates embedder unavailable (e.g. no API key) */
class FailingEmbedder implements Embedder {
  readonly dimensions = 1536;
  readonly maxTokens  = 8191;

  async embed(_texts: string[], _options?: EmbedderOptions): Promise<Float32Array[]> {
    throw new Error("No API key configured");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runKnowledgeMigrations(db);
  return db;
}

function insertCollection(db: Database, id: string, name = "Test Collection"): void {
  db.prepare<[string, string, string, string], void>(`
    INSERT INTO knowledge_collections
      (id, name, description, scope_json, classification, config_yaml,
       chunk_count, total_tokens, status, created_at, updated_at)
    VALUES (?, ?, '', '{}', 'INTERNAL', '', 0, 0, 'indexed', datetime('now'), datetime('now'))
  `).run(id, name);
}

function insertChunkAndVector(
  db: Database,
  chunkId: string,
  collectionId: string,
  content: string,
  embedding: Float32Array,
): void {
  db.prepare<[string, string, string, string, number, number, string, string, string, string], void>(`
    INSERT INTO knowledge_chunks
      (id, collection_id, source_file, content, token_count, position,
       section_path, preceding_context, metadata, created_at)
    VALUES (?, ?, 'test.md', ?, 10, 0, '[]', '', '{}', datetime('now'))
  `).run(chunkId, collectionId, content);

  const embBuf = Buffer.from(embedding.buffer);
  db.prepare<[string, string, Buffer], void>(`
    INSERT INTO knowledge_vectors (chunk_id, collection_id, embedding)
    VALUES (?, ?, ?)
  `).run(chunkId, collectionId, embBuf);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HybridRetriever", () => {
  let db: Database;
  let embedder: MockEmbedder;
  let retriever: HybridRetriever;

  beforeEach(() => {
    db = makeDb();
    embedder = new MockEmbedder();
    retriever = new HybridRetriever(db, embedder);
  });

  it("retrieve() returns results for a query when chunks and vectors exist", async () => {
    insertCollection(db, "col-1");
    const emb = new Float32Array(1536).fill(0.5);
    insertChunkAndVector(db, "chunk-1", "col-1", "artificial intelligence machine learning", emb);
    insertChunkAndVector(db, "chunk-2", "col-1", "deep learning neural networks", emb);

    const results = await retriever.retrieve("machine learning", { top_k: 5 });

    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.chunk.id);
    expect(ids).toContain("chunk-1");
    expect(ids).toContain("chunk-2");
  });

  it("returns empty array when collection has no vectors", async () => {
    insertCollection(db, "col-empty");
    // No chunks or vectors inserted

    const results = await retriever.retrieve("any query", { top_k: 5 });
    expect(results).toEqual([]);
  });

  it("RRF merge: results from both vector and BM25 have combined scores", async () => {
    insertCollection(db, "col-rrf");
    // Use a distinctive word so BM25 can find it
    const emb = new Float32Array(1536).fill(0.5);
    insertChunkAndVector(db, "chunk-rrf-1", "col-rrf", "quantum computing superposition entanglement", emb);
    insertChunkAndVector(db, "chunk-rrf-2", "col-rrf", "classical computing algorithms sorting", emb);

    // Rebuild FTS index
    db.exec(`INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts) VALUES('rebuild')`);

    const results = await retriever.retrieve("quantum", { top_k: 5 });

    // Should return results from both vector and BM25 paths
    expect(results.length).toBeGreaterThan(0);

    // All results should have a positive RRF score
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it("collection_ids filter restricts results to specified collection", async () => {
    insertCollection(db, "col-a");
    insertCollection(db, "col-b");

    const emb = new Float32Array(1536).fill(0.5);
    insertChunkAndVector(db, "chunk-a-1", "col-a", "content in collection alpha", emb);
    insertChunkAndVector(db, "chunk-b-1", "col-b", "content in collection beta", emb);

    const results = await retriever.retrieve("content", {
      top_k: 10,
      collection_ids: ["col-a"],
    });

    // Only col-a results should be returned
    for (const r of results) {
      expect(r.chunk.collection_id).toBe("col-a");
    }
    const ids = results.map((r) => r.chunk.id);
    expect(ids).toContain("chunk-a-1");
    expect(ids).not.toContain("chunk-b-1");
  });

  it("similarity_threshold filters out results whose cosine similarity is below threshold", async () => {
    insertCollection(db, "col-thresh");
    const emb = new Float32Array(1536).fill(0.5);
    insertChunkAndVector(db, "chunk-t-1", "col-thresh", "threshold test content", emb);

    // ZeroQueryEmbedder → query vector all-zeros → cosine similarity = 0 (denom=0 guard)
    // threshold = 0.5 → 0 < 0.5 → vector result excluded
    // FTS not rebuilt → no BM25 match → overall empty
    const zeroRetriever = new HybridRetriever(db, new ZeroQueryEmbedder());
    const results = await zeroRetriever.retrieve("threshold test", {
      top_k: 5,
      similarity_threshold: 0.5,
    });
    expect(results).toEqual([]);
  });

  it("falls back to BM25-only when embedder throws (e.g. no API key)", async () => {
    insertCollection(db, "col-fallback");
    const emb = new Float32Array(1536).fill(0.5);
    insertChunkAndVector(db, "chunk-fb-1", "col-fallback", "fallback bm25 keyword match", emb);

    // Rebuild FTS so BM25 can find the chunk
    db.exec(`INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts) VALUES('rebuild')`);

    const failRetriever = new HybridRetriever(db, new FailingEmbedder());
    // No vector search → only BM25; threshold=0 so BM25-matched results pass
    const results = await failRetriever.retrieve("fallback bm25 keyword", {
      top_k: 5,
      similarity_threshold: 0.0,
    });
    // BM25 should find chunk-fb-1 even without vector search
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((r) => r.chunk.id)).toContain("chunk-fb-1");
  });

  it("top_k option limits the number of returned results", async () => {
    insertCollection(db, "col-topk");
    const emb = new Float32Array(1536).fill(0.5);
    for (let i = 0; i < 6; i++) {
      insertChunkAndVector(db, `chunk-tk-${i}`, "col-topk", `content item number ${i} alpha beta`, emb);
    }

    const results = await retriever.retrieve("content item", { top_k: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("chunk fields are correctly populated in results", async () => {
    insertCollection(db, "col-fields");
    const emb = new Float32Array(1536).fill(0.5);
    insertChunkAndVector(db, "chunk-fields-1", "col-fields", "field verification content", emb);

    const results = await retriever.retrieve("field verification", { top_k: 1 });

    expect(results.length).toBeGreaterThan(0);
    const chunk = results[0]?.chunk;
    expect(chunk).toBeDefined();
    expect(chunk?.id).toBe("chunk-fields-1");
    expect(chunk?.collection_id).toBe("col-fields");
    expect(chunk?.content).toBe("field verification content");
    expect(Array.isArray(chunk?.section_path)).toBe(true);
    expect(typeof chunk?.metadata).toBe("object");
  });

  it("multiple collection_ids filter works for union of collections", async () => {
    insertCollection(db, "col-x");
    insertCollection(db, "col-y");
    insertCollection(db, "col-z");

    const emb = new Float32Array(1536).fill(0.5);
    insertChunkAndVector(db, "chunk-x", "col-x", "data science statistics regression", emb);
    insertChunkAndVector(db, "chunk-y", "col-y", "data science statistics regression", emb);
    insertChunkAndVector(db, "chunk-z", "col-z", "data science statistics regression", emb);

    const results = await retriever.retrieve("data science", {
      top_k: 10,
      collection_ids: ["col-x", "col-y"],
    });

    const ids = results.map((r) => r.chunk.id);
    expect(ids).not.toContain("chunk-z");
    // At least one of x or y should appear
    expect(ids.some((id) => id === "chunk-x" || id === "chunk-y")).toBe(true);
  });
});
