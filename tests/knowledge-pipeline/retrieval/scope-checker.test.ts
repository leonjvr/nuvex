/**
 * Unit tests: ScopeChecker
 */

import { describe, it, expect } from "vitest";
import { ScopeChecker } from "../../../src/knowledge-pipeline/retrieval/scope-checker.js";
import type { KnowledgeCollection, AgentAccessContext, CollectionScope } from "../../../src/knowledge-pipeline/types.js";

function makeCollection(scope: CollectionScope): KnowledgeCollection {
  return {
    id: "col-1",
    name: "Test Collection",
    description: "",
    scope,
    config: {
      id: "col-1",
      name: "Test Collection",
      scope,
      ingestion: {
        chunking_strategy: "fixed",
        chunk_size_tokens: 512,
        chunk_overlap_tokens: 64,
        embedding_model: "text-embedding-3-small",
        embedding_provider: "openai",
      },
      retrieval: {
        default_top_k: 5,
        similarity_threshold: 0.5,
        reranking: false,
        mmr_diversity: 0.7,
      },
    },
    chunk_count: 0,
    total_tokens: 0,
    status: "empty",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeAgent(overrides: Partial<AgentAccessContext> = {}): AgentAccessContext {
  return {
    agent_id: "agent-1",
    division: "engineering",
    tier: 2,
    max_classification: "INTERNAL",
    ...overrides,
  };
}

describe("ScopeChecker", () => {
  const checker = new ScopeChecker();

  it("allows agent with matching division", () => {
    const collection = makeCollection({
      divisions: ["engineering", "product"],
      classification: "INTERNAL",
    });
    const agent = makeAgent({ division: "engineering" });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("blocks agent with non-matching division", () => {
    const collection = makeCollection({
      divisions: ["engineering", "product"],
      classification: "INTERNAL",
    });
    const agent = makeAgent({ division: "finance" });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("finance");
    expect(result.reason).toContain("engineering");
  });

  it("blocks agent with tier not in allowed tiers", () => {
    const collection = makeCollection({
      tiers: [1],
      classification: "INTERNAL",
    });
    const agent = makeAgent({ tier: 2 });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("tier");
    expect(result.reason).toContain("2");
  });

  it("allows agent with tier in allowed tiers", () => {
    const collection = makeCollection({
      tiers: [1, 2, 3],
      classification: "INTERNAL",
    });
    const agent = makeAgent({ tier: 2 });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(true);
  });

  it("blocks agent with clearance below collection classification", () => {
    const collection = makeCollection({
      classification: "CONFIDENTIAL",
    });
    const agent = makeAgent({ max_classification: "INTERNAL" });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("INTERNAL");
    expect(result.reason).toContain("CONFIDENTIAL");
  });

  it("allows agent with clearance equal to collection classification", () => {
    const collection = makeCollection({
      classification: "CONFIDENTIAL",
    });
    const agent = makeAgent({ max_classification: "CONFIDENTIAL" });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(true);
  });

  it("allows agent with clearance above collection classification", () => {
    const collection = makeCollection({
      classification: "INTERNAL",
    });
    const agent = makeAgent({ max_classification: "SECRET" });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(true);
  });

  it("blocks agent not in the explicit agents list", () => {
    const collection = makeCollection({
      agents: ["agent-x", "agent-y"],
      classification: "PUBLIC",
    });
    const agent = makeAgent({ agent_id: "agent-1" });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("agent-1");
  });

  it("allows agent explicitly named in agents list", () => {
    const collection = makeCollection({
      agents: ["agent-1", "agent-2"],
      classification: "PUBLIC",
    });
    const agent = makeAgent({ agent_id: "agent-1" });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(true);
  });

  it("allows access when no scope restrictions are set (PUBLIC collection)", () => {
    const collection = makeCollection({
      classification: "PUBLIC",
    });
    const agent = makeAgent({ max_classification: "PUBLIC" });
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(true);
  });

  it("defaults agent max_classification to PUBLIC when not set", () => {
    const collection = makeCollection({
      classification: "PUBLIC",
    });
    const agent: AgentAccessContext = {
      agent_id: "agent-noclass",
      division: "engineering",
      tier: 1,
      // max_classification omitted
    };
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(true);
  });

  it("blocks agent with no classification against INTERNAL collection", () => {
    const collection = makeCollection({
      classification: "INTERNAL",
    });
    const agent: AgentAccessContext = {
      agent_id: "agent-noclass",
      division: "engineering",
      tier: 1,
      // max_classification omitted — defaults to PUBLIC
    };
    const result = checker.check(collection, agent);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("PUBLIC");
    expect(result.reason).toContain("INTERNAL");
  });

  it("filterAccessible returns only accessible collections", () => {
    const publicCol = makeCollection({ classification: "PUBLIC" });
    publicCol.id = "col-public";

    const secretCol = makeCollection({ classification: "SECRET" });
    secretCol.id = "col-secret";

    const internalCol = makeCollection({ classification: "INTERNAL" });
    internalCol.id = "col-internal";

    const agent = makeAgent({ max_classification: "INTERNAL" });
    const accessible = checker.filterAccessible([publicCol, secretCol, internalCol], agent);

    const ids = accessible.map((c) => c.id);
    expect(ids).toContain("col-public");
    expect(ids).toContain("col-internal");
    expect(ids).not.toContain("col-secret");
  });
});
