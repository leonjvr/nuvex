/**
 * Unit tests: EmbeddingPipeline
 * Uses an in-memory SQLite DB with runKnowledgeMigrations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runKnowledgeMigrations } from "../../../src/knowledge-pipeline/migration.js";
import { EmbeddingPipeline } from "../../../src/knowledge-pipeline/embedding/embedding-pipeline.js";
import type {
  Parser,
  Chunker,
  Embedder,
  ParsedDocument,
  Chunk,
  EmbedProgress,
  ChunkOptions,
  EmbedderOptions,
} from "../../../src/knowledge-pipeline/types.js";

// ---------------------------------------------------------------------------
// Mock implementations
// ---------------------------------------------------------------------------

const FIXED_PARSED_DOC: ParsedDocument = {
  source_file: "test-doc.md",
  total_tokens: 30,
  sections: [
    { content: "Introduction to machine learning and neural networks.", heading: "Intro", level: 1 },
    { content: "Deep learning is a subset of machine learning.", heading: "Section 2", level: 2 },
    { content: "Convolutional networks excel at image recognition tasks.", heading: "Section 3", level: 2 },
  ],
};

function makeFixedChunks(collectionId: string, sourceFile: string): Chunk[] {
  return [
    {
      id: "chunk-mock-1",
      collection_id: collectionId,
      source_file: sourceFile,
      content: "Introduction to machine learning and neural networks.",
      token_count: 8,
      position: 0,
      section_path: ["Intro"],
      preceding_context: "",
      metadata: {},
      created_at: new Date().toISOString(),
    },
    {
      id: "chunk-mock-2",
      collection_id: collectionId,
      source_file: sourceFile,
      content: "Deep learning is a subset of machine learning.",
      token_count: 9,
      position: 1,
      section_path: ["Section 2"],
      preceding_context: "",
      metadata: {},
      created_at: new Date().toISOString(),
    },
    {
      id: "chunk-mock-3",
      collection_id: collectionId,
      source_file: sourceFile,
      content: "Convolutional networks excel at image recognition tasks.",
      token_count: 8,
      position: 2,
      section_path: ["Section 3"],
      preceding_context: "",
      metadata: {},
      created_at: new Date().toISOString(),
    },
  ];
}

class MockParser implements Parser {
  async parse(_content: Buffer | string, _filename: string): Promise<ParsedDocument> {
    return FIXED_PARSED_DOC;
  }
}

class MockChunker implements Chunker {
  chunk(_doc: ParsedDocument, options: ChunkOptions): Chunk[] {
    return makeFixedChunks(options.collection_id, options.source_file);
  }
}

class MockEmbedder implements Embedder {
  readonly dimensions = 1536;
  readonly maxTokens  = 8191;

  async embed(texts: string[], _options?: EmbedderOptions): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array(1536).fill(0.1));
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

function insertCollection(db: Database, id: string): void {
  db.prepare<[string, string], void>(`
    INSERT INTO knowledge_collections
      (id, name, description, scope_json, classification, config_yaml,
       chunk_count, total_tokens, status, created_at, updated_at)
    VALUES (?, 'Test Collection', '', '{}', 'INTERNAL', '', 0, 0, 'empty', datetime('now'), datetime('now'))
  `).run(id);
}

function getChunkCount(db: Database, collectionId: string): number {
  const row = db
    .prepare<[string], { cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM knowledge_chunks WHERE collection_id = ?",
    )
    .get(collectionId);
  return row?.cnt ?? 0;
}

function getVectorCount(db: Database, collectionId: string): number {
  const row = db
    .prepare<[string], { cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM knowledge_vectors WHERE collection_id = ?",
    )
    .get(collectionId);
  return row?.cnt ?? 0;
}

function getCollectionChunkCount(db: Database, collectionId: string): number {
  const row = db
    .prepare<[string], { chunk_count: number }>(
      "SELECT chunk_count FROM knowledge_collections WHERE id = ?",
    )
    .get(collectionId);
  return row?.chunk_count ?? 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EmbeddingPipeline", () => {
  let db: Database;
  let pipeline: EmbeddingPipeline;
  const collectionId = "col-embed-test";

  beforeEach(() => {
    db = makeDb();
    insertCollection(db, collectionId);
    pipeline = new EmbeddingPipeline(db, new MockParser(), new MockChunker(), new MockEmbedder());
  });

  it("ingest() writes chunks to knowledge_chunks table", async () => {
    await pipeline.ingest("# Test Document", {
      collection_id: collectionId,
      source_file: "test-doc.md",
    });

    const count = getChunkCount(db, collectionId);
    expect(count).toBe(3); // MockChunker always returns 3 chunks
  });

  it("ingest() writes embeddings to knowledge_vectors table", async () => {
    await pipeline.ingest("# Test Document", {
      collection_id: collectionId,
      source_file: "test-doc.md",
    });

    const count = getVectorCount(db, collectionId);
    expect(count).toBe(3); // One vector per chunk
  });

  it("onProgress callback is called during processing", async () => {
    const progressSnapshots: EmbedProgress[] = [];

    await pipeline.ingest("# Test Document", {
      collection_id: collectionId,
      source_file: "test-doc.md",
      onProgress: (p) => {
        progressSnapshots.push({ ...p });
      },
    });

    // onProgress is called at least twice: once before embedding (completed=0)
    // and once after each batch completes
    expect(progressSnapshots.length).toBeGreaterThanOrEqual(2);

    // First call: total is set, completed = 0
    expect(progressSnapshots[0]?.total).toBe(3);
    expect(progressSnapshots[0]?.completed).toBe(0);

    // Last call: all completed
    const last = progressSnapshots[progressSnapshots.length - 1]!;
    expect(last.completed).toBe(3);
    expect(last.failed).toBe(0);
  });

  it("returns correct chunks_written count", async () => {
    const result = await pipeline.ingest("# Test Document", {
      collection_id: collectionId,
      source_file: "test-doc.md",
    });

    expect(result.chunks_written).toBe(3);
  });

  it("returns correct tokens_total count", async () => {
    const result = await pipeline.ingest("# Test Document", {
      collection_id: collectionId,
      source_file: "test-doc.md",
    });

    // chunks have token_counts: 8 + 9 + 8 = 25
    expect(result.tokens_total).toBe(25);
  });

  it("updates knowledge_collections.chunk_count after ingestion", async () => {
    const beforeCount = getCollectionChunkCount(db, collectionId);
    expect(beforeCount).toBe(0);

    await pipeline.ingest("# Test Document", {
      collection_id: collectionId,
      source_file: "test-doc.md",
    });

    const afterCount = getCollectionChunkCount(db, collectionId);
    expect(afterCount).toBe(3);
  });

  it("updates knowledge_collections status to 'indexed' after ingestion", async () => {
    await pipeline.ingest("# Test Document", {
      collection_id: collectionId,
      source_file: "test-doc.md",
    });

    const row = db
      .prepare<[string], { status: string }>(
        "SELECT status FROM knowledge_collections WHERE id = ?",
      )
      .get(collectionId);
    expect(row?.status).toBe("indexed");
  });

  it("returns chunks_written=0 and tokens_total=0 when chunker produces no chunks", async () => {
    class EmptyChunker implements Chunker {
      chunk(_doc: ParsedDocument, _options: ChunkOptions): Chunk[] {
        return [];
      }
    }

    const emptyPipeline = new EmbeddingPipeline(
      db,
      new MockParser(),
      new EmptyChunker(),
      new MockEmbedder(),
    );

    const result = await emptyPipeline.ingest("empty document", {
      collection_id: collectionId,
      source_file: "empty.md",
    });

    expect(result.chunks_written).toBe(0);
    expect(result.tokens_total).toBe(0);
    expect(getChunkCount(db, collectionId)).toBe(0);
  });

  it("chunk content is correctly stored in the database", async () => {
    await pipeline.ingest("# Test Document", {
      collection_id: collectionId,
      source_file: "test-doc.md",
    });

    const rows = db
      .prepare<[string], { id: string; content: string }>(
        "SELECT id, content FROM knowledge_chunks WHERE collection_id = ? ORDER BY position",
      )
      .all(collectionId);

    expect(rows).toHaveLength(3);
    expect(rows[0]?.id).toBe("chunk-mock-1");
    expect(rows[0]?.content).toBe("Introduction to machine learning and neural networks.");
    expect(rows[1]?.id).toBe("chunk-mock-2");
    expect(rows[2]?.id).toBe("chunk-mock-3");
  });

  it("embedding blob is stored in knowledge_vectors and has correct byte length", async () => {
    await pipeline.ingest("# Test Document", {
      collection_id: collectionId,
      source_file: "test-doc.md",
    });

    const row = db
      .prepare<[string], { embedding: Buffer }>(
        "SELECT embedding FROM knowledge_vectors WHERE chunk_id = ?",
      )
      .get("chunk-mock-1");

    expect(row).toBeDefined();
    // Float32Array(1536) = 1536 * 4 bytes = 6144 bytes
    expect(row?.embedding.byteLength).toBe(1536 * 4);

    // Verify the values match (all 0.1)
    const floats = new Float32Array(
      row!.embedding.buffer,
      row!.embedding.byteOffset,
      row!.embedding.byteLength / 4,
    );
    expect(floats[0]).toBeCloseTo(0.1, 5);
  });

  it("accumulates chunk_count across multiple ingest calls", async () => {
    await pipeline.ingest("First document", {
      collection_id: collectionId,
      source_file: "doc1.md",
    });
    await pipeline.ingest("Second document", {
      collection_id: collectionId,
      source_file: "doc2.md",
    });

    // Each ingest produces 3 chunks, so total should be 6
    const totalChunks = getCollectionChunkCount(db, collectionId);
    expect(totalChunks).toBe(6);
  });
});
