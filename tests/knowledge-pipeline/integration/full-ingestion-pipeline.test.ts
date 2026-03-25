/**
 * Integration tests: Full ingestion pipeline
 * parse → chunk → embed → store → retrieve
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runKnowledgeMigrations } from "../../../src/knowledge-pipeline/migration.js";
import { CollectionManager } from "../../../src/knowledge-pipeline/collection-manager.js";
import { EmbeddingPipeline } from "../../../src/knowledge-pipeline/embedding/embedding-pipeline.js";
import { MarkdownParser } from "../../../src/knowledge-pipeline/parsers/markdown-parser.js";
import { SemanticChunker } from "../../../src/knowledge-pipeline/chunkers/semantic-chunker.js";
import { HybridRetriever } from "../../../src/knowledge-pipeline/retrieval/hybrid-retriever.js";
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

const SAMPLE_MARKDOWN = `
# Introduction

This document covers the basics of SIDJUA governance.
SIDJUA is an AI governance platform for enterprise agents.
It provisions agent roles, budgets, and access controls.

## Core Concepts

The core command is sidjua apply which reads divisions.yaml.
Each division has agents with defined tiers and budgets.
Policies are evaluated before every agent action.

## Pre-Action Pipeline

Every action passes through five stages of governance.
Stage one checks forbidden actions against a blocklist.
Stage two requires approval for sensitive operations.
Stage three enforces budget constraints per agent.
Stage four classifies data and checks access rights.
Stage five applies policy rules from governance YAML files.

## Configuration

Divisions are defined in the divisions.yaml configuration file.
Each division can have multiple agents with different skill sets.
Budget limits cascade from org to division to agent to task level.
`;

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runKnowledgeMigrations(db);
  return db;
}

describe("Full ingestion pipeline — integration", () => {
  let db: Database;
  let collectionManager: CollectionManager;
  let pipeline: EmbeddingPipeline;
  let embedder: MockEmbedder;
  let collectionId: string;

  beforeEach(() => {
    db = makeDb();
    embedder = new MockEmbedder();
    collectionManager = new CollectionManager(db);
    pipeline = new EmbeddingPipeline(
      db,
      new MarkdownParser(),
      new SemanticChunker(),
      embedder,
    );

    collectionId = "test-col-ingestion";
    collectionManager.create({
      id: collectionId,
      name: "Ingestion Test Collection",
      scope: { classification: "INTERNAL" },
    });
  });

  it("end-to-end: markdown ingestion and retrieval", async () => {
    // Ingest the document
    const result = await pipeline.ingest(SAMPLE_MARKDOWN, {
      collection_id: collectionId,
      source_file: "sidjua-overview.md",
    });

    expect(result.chunks_written).toBeGreaterThan(0);

    // Verify chunks were written to knowledge_chunks table
    const rows = db
      .prepare<[string], { id: string; content: string; source_file: string }>(
        "SELECT id, content, source_file FROM knowledge_chunks WHERE collection_id = ?",
      )
      .all(collectionId);

    expect(rows.length).toBeGreaterThan(0);

    // Verify embeddings were stored
    const vectors = db
      .prepare<[string], { chunk_id: string }>(
        "SELECT chunk_id FROM knowledge_vectors WHERE collection_id = ?",
      )
      .all(collectionId);
    expect(vectors.length).toBe(rows.length);

    // Run retrieval
    const retriever = new HybridRetriever(db, embedder);
    const results = await retriever.retrieve("governance pipeline stages", {
      collection_ids: [collectionId],
    });

    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(typeof r.chunk.content).toBe("string");
      expect(r.chunk.content.length).toBeGreaterThan(0);
      expect(typeof r.chunk.source_file).toBe("string");
      expect(r.chunk.source_file).toBe("sidjua-overview.md");
    }
  });

  it("ingestion returns correct chunks_written count", async () => {
    const result = await pipeline.ingest(SAMPLE_MARKDOWN, {
      collection_id: collectionId,
      source_file: "doc.md",
    });

    // chunks_written should equal actual rows in DB
    const dbCount = db
      .prepare<[string], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM knowledge_chunks WHERE collection_id = ?",
      )
      .get(collectionId)!.cnt;

    expect(result.chunks_written).toBe(dbCount);
    expect(result.chunks_written).toBeGreaterThan(0);
  });

  it("ingestion updates collection chunk_count in DB", async () => {
    // Verify initial state
    const before = collectionManager.getById(collectionId)!;
    expect(before.chunk_count).toBe(0);

    const result = await pipeline.ingest(SAMPLE_MARKDOWN, {
      collection_id: collectionId,
      source_file: "doc.md",
    });

    const after = collectionManager.getById(collectionId)!;
    expect(after.chunk_count).toBe(result.chunks_written);
    expect(after.status).toBe("indexed");
  });
});
