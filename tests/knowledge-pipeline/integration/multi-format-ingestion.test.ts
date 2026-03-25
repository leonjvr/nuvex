/**
 * Integration tests: Multi-format ingestion
 * Ingest markdown and code content into the same collection.
 */

import { describe, it, expect, beforeEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runKnowledgeMigrations } from "../../../src/knowledge-pipeline/migration.js";
import { CollectionManager } from "../../../src/knowledge-pipeline/collection-manager.js";
import { EmbeddingPipeline } from "../../../src/knowledge-pipeline/embedding/embedding-pipeline.js";
import { MarkdownParser } from "../../../src/knowledge-pipeline/parsers/markdown-parser.js";
import { CodeParser } from "../../../src/knowledge-pipeline/parsers/code-parser.js";
import { SemanticChunker } from "../../../src/knowledge-pipeline/chunkers/semantic-chunker.js";
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
# API Documentation

This document describes the REST API endpoints for SIDJUA.

## Authentication

All requests must include a Bearer token in the Authorization header.
The token is issued by the SIDJUA identity service.
Tokens expire after 24 hours and must be refreshed.

## Endpoints

### GET /api/agents

Returns a list of all active agents in the current division.
Requires INTERNAL classification clearance or above.
Response is paginated with a default page size of 20.

### POST /api/tasks

Creates a new task and assigns it to an available agent.
The task goes through the pre-action pipeline before assignment.
Budget checks are performed before any task is accepted.
`;

const SAMPLE_CODE = `
import { randomUUID } from "node:crypto";

/**
 * Creates a new task and assigns it to an agent.
 */
export async function createTask(
  taskInput: TaskInput,
  agentId: string,
): Promise<Task> {
  const id = randomUUID();
  const now = new Date().toISOString();
  return { id, ...taskInput, agent_id: agentId, created_at: now };
}

export class TaskRouter {
  route(task: Task): string {
    if (task.priority === "CRITICAL") return "primary-queue";
    if (task.priority === "HIGH") return "standard-queue";
    return "background-queue";
  }
}

// ---------------------------------------------------------------------------
// Budget enforcement helpers
// ---------------------------------------------------------------------------

export const checkBudget = async (agentId: string, estimatedCost: number): Promise<boolean> => {
  const monthlyBudget = await getAgentBudget(agentId);
  return estimatedCost <= monthlyBudget.remaining;
};
`;

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runKnowledgeMigrations(db);
  return db;
}

describe("Multi-format ingestion — integration", () => {
  let db: Database;
  let collectionManager: CollectionManager;
  let embedder: MockEmbedder;
  let collectionId: string;

  beforeEach(() => {
    db = makeDb();
    embedder = new MockEmbedder();
    collectionManager = new CollectionManager(db);

    collectionId = "col-multi-format";
    collectionManager.create({
      id: collectionId,
      name: "Multi-Format Test Collection",
      scope: { classification: "INTERNAL" },
    });
  });

  it("markdown and code content both ingested into same collection", async () => {
    const markdownPipeline = new EmbeddingPipeline(
      db,
      new MarkdownParser(),
      new SemanticChunker(),
      embedder,
    );

    const codePipeline = new EmbeddingPipeline(
      db,
      new CodeParser(),
      new SemanticChunker(),
      embedder,
    );

    const mdResult = await markdownPipeline.ingest(SAMPLE_MARKDOWN, {
      collection_id: collectionId,
      source_file: "api-docs.md",
    });

    const codeResult = await codePipeline.ingest(SAMPLE_CODE, {
      collection_id: collectionId,
      source_file: "task-router.ts",
    });

    expect(mdResult.chunks_written).toBeGreaterThan(0);
    expect(codeResult.chunks_written).toBeGreaterThan(0);

    // Verify both source files present in same collection
    const sources = db
      .prepare<[string], { source_file: string }>(
        "SELECT DISTINCT source_file FROM knowledge_chunks WHERE collection_id = ?",
      )
      .all(collectionId)
      .map((r) => r.source_file);

    expect(sources).toContain("api-docs.md");
    expect(sources).toContain("task-router.ts");

    // Total chunks = sum of both
    const totalInDb = db
      .prepare<[string], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM knowledge_chunks WHERE collection_id = ?",
      )
      .get(collectionId)!.cnt;

    expect(totalInDb).toBe(mdResult.chunks_written + codeResult.chunks_written);
  });

  it("total chunk_count increases after each ingestion", async () => {
    const markdownPipeline = new EmbeddingPipeline(
      db,
      new MarkdownParser(),
      new SemanticChunker(),
      embedder,
    );

    const codePipeline = new EmbeddingPipeline(
      db,
      new CodeParser(),
      new SemanticChunker(),
      embedder,
    );

    const initialCollection = collectionManager.getById(collectionId)!;
    expect(initialCollection.chunk_count).toBe(0);

    const mdResult = await markdownPipeline.ingest(SAMPLE_MARKDOWN, {
      collection_id: collectionId,
      source_file: "api-docs.md",
    });

    const afterMarkdown = collectionManager.getById(collectionId)!;
    expect(afterMarkdown.chunk_count).toBe(mdResult.chunks_written);
    expect(afterMarkdown.chunk_count).toBeGreaterThan(0);

    const codeResult = await codePipeline.ingest(SAMPLE_CODE, {
      collection_id: collectionId,
      source_file: "task-router.ts",
    });

    const afterCode = collectionManager.getById(collectionId)!;
    expect(afterCode.chunk_count).toBe(mdResult.chunks_written + codeResult.chunks_written);
    expect(afterCode.chunk_count).toBeGreaterThan(afterMarkdown.chunk_count);
  });

  it("embeddings are stored for all ingested chunks regardless of format", async () => {
    const markdownPipeline = new EmbeddingPipeline(
      db,
      new MarkdownParser(),
      new SemanticChunker(),
      embedder,
    );

    const codePipeline = new EmbeddingPipeline(
      db,
      new CodeParser(),
      new SemanticChunker(),
      embedder,
    );

    await markdownPipeline.ingest(SAMPLE_MARKDOWN, {
      collection_id: collectionId,
      source_file: "api-docs.md",
    });

    await codePipeline.ingest(SAMPLE_CODE, {
      collection_id: collectionId,
      source_file: "task-router.ts",
    });

    const totalChunks = db
      .prepare<[string], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM knowledge_chunks WHERE collection_id = ?",
      )
      .get(collectionId)!.cnt;

    const totalVectors = db
      .prepare<[string], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM knowledge_vectors WHERE collection_id = ?",
      )
      .get(collectionId)!.cnt;

    expect(totalVectors).toBe(totalChunks);
    expect(totalVectors).toBeGreaterThan(0);
  });
});
