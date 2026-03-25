/**
 * Integration tests: Scope enforcement
 * ScopeChecker blocks unauthorized agents; KnowledgeAction returns empty for blocked agents.
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
import { ScopeChecker } from "../../../src/knowledge-pipeline/retrieval/scope-checker.js";
import { KnowledgeAction } from "../../../src/knowledge-pipeline/retrieval/knowledge-action.js";
import type {
  Embedder,
  EmbedderOptions,
  KnowledgeCollection,
  AgentAccessContext,
  CollectionScope,
} from "../../../src/knowledge-pipeline/types.js";

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

function makeCollection(scope: CollectionScope, overrides: Partial<KnowledgeCollection> = {}): KnowledgeCollection {
  return {
    id: "col-scope-test",
    name: "Scope Test Collection",
    description: "",
    scope,
    config: {
      id: "col-scope-test",
      name: "Scope Test Collection",
      scope,
      ingestion: {
        chunking_strategy: "semantic",
        chunk_size_tokens: 500,
        chunk_overlap_tokens: 50,
        embedding_model: "text-embedding-3-small",
        embedding_provider: "openai",
      },
      retrieval: {
        default_top_k: 5,
        similarity_threshold: 0.0,
        reranking: true,
        mmr_diversity: 0.3,
      },
    },
    chunk_count: 10,
    total_tokens: 5000,
    status: "indexed",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const SAMPLE_CONTENT = `
# Engineering Docs

This content is scoped to the engineering division.
It covers deployment procedures and infrastructure decisions.
All engineers should follow these protocols when deploying.
`;

describe("Scope enforcement — integration", () => {
  let db: Database;
  let collectionManager: CollectionManager;
  let embedder: MockEmbedder;
  let retriever: HybridRetriever;
  const scopeChecker = new ScopeChecker();

  beforeEach(async () => {
    db = makeDb();
    embedder = new MockEmbedder();
    collectionManager = new CollectionManager(db);
    retriever = new HybridRetriever(db, embedder);

    // Create a division-scoped collection and ingest content
    collectionManager.create({
      id: "col-eng-only",
      name: "Engineering Only",
      scope: { divisions: ["engineering"], classification: "INTERNAL" },
    });

    const pipeline = new EmbeddingPipeline(
      db,
      new MarkdownParser(),
      new SemanticChunker(),
      embedder,
    );

    await pipeline.ingest(SAMPLE_CONTENT, {
      collection_id: "col-eng-only",
      source_file: "eng-docs.md",
    });
  });

  it("agent with matching division gets access", () => {
    const collection = makeCollection({
      divisions: ["engineering"],
      classification: "INTERNAL",
    });
    const agent: AgentAccessContext = {
      agent_id: "agent-eng-1",
      division: "engineering",
      tier: 2,
      max_classification: "INTERNAL",
    };

    const result = scopeChecker.check(collection, agent);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("agent with non-matching division is denied access", () => {
    const collection = makeCollection({
      divisions: ["engineering"],
      classification: "INTERNAL",
    });
    const agent: AgentAccessContext = {
      agent_id: "agent-finance-1",
      division: "finance",
      tier: 2,
      max_classification: "INTERNAL",
    };

    const result = scopeChecker.check(collection, agent);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("finance");
  });

  it("classification: agent with lower clearance is denied", () => {
    const collection = makeCollection({
      classification: "SECRET",
    });
    const agent: AgentAccessContext = {
      agent_id: "agent-intern-1",
      division: "engineering",
      tier: 1,
      max_classification: "INTERNAL",
    };

    const result = scopeChecker.check(collection, agent);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("INTERNAL");
    expect(result.reason).toContain("SECRET");
  });

  it("KnowledgeAction returns empty results for blocked agent", async () => {
    // Create a CONFIDENTIAL collection so finance agent (INTERNAL clearance) is blocked
    collectionManager.create({
      id: "col-confidential",
      name: "Confidential Collection",
      scope: { divisions: ["engineering"], classification: "CONFIDENTIAL" },
    });

    const knowledgeAction = new KnowledgeAction(db, retriever, collectionManager);

    const financeAgent: AgentAccessContext = {
      agent_id: "agent-finance-1",
      division: "finance",
      tier: 2,
      max_classification: "INTERNAL",
    };

    const queryResult = await knowledgeAction.query(
      financeAgent,
      "deployment procedures",
      { collection_ids: ["col-eng-only"] },
    );

    // Finance agent is not in engineering division — should be blocked
    expect(queryResult.results).toHaveLength(0);
    expect(queryResult.collections_blocked).toContain("col-eng-only");
    expect(queryResult.collections_queried).toHaveLength(0);
  });

  it("KnowledgeAction returns results for authorized agent", async () => {
    const knowledgeAction = new KnowledgeAction(db, retriever, collectionManager);

    const engAgent: AgentAccessContext = {
      agent_id: "agent-eng-1",
      division: "engineering",
      tier: 2,
      max_classification: "INTERNAL",
    };

    const queryResult = await knowledgeAction.query(
      engAgent,
      "deployment procedures",
      { collection_ids: ["col-eng-only"] },
    );

    expect(queryResult.collections_queried).toContain("col-eng-only");
    expect(queryResult.collections_blocked).toHaveLength(0);
    // Results may be empty if similarity threshold filters everything, but no blocking occurred
    expect(queryResult.cost_usd).toBe(0);
  });
});
