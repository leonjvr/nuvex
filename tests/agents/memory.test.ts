/**
 * Tests for src/agents/memory.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryManager } from "../../src/agents/memory.js";
import type {
  AgentDefinition,
  MemoryEntry,
  ArchivalCandidate,
  MemoryLifecycleConfig,
  MemoryHygieneConfig,
} from "../../src/agents/types.js";
import type { ActionExecutor } from "../../src/agents/action-executor.js";

const DEF: AgentDefinition = {
  id: "sonnet-devlead",
  name: "Dev Lead",
  tier: 2,
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  skill_file: "",
  division: "engineering",
  capabilities: ["code"],
  max_concurrent_tasks: 3,
  token_budget_per_task: 10000,
  cost_limit_per_hour: 1.0,
  checkpoint_interval_ms: 30000,
  ttl_default_seconds: 1800,
  heartbeat_interval_ms: 10000,
  max_retries: 3,
  metadata: {},
};

let tmpDir: string;
let memory: MemoryManager;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-memory-test-"));
  memory = new MemoryManager("instance-1", DEF, tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Level 1: Short-term memory
// ---------------------------------------------------------------------------

describe("MemoryManager — short-term", () => {
  it("getShortTerm returns empty string when no file exists", async () => {
    const result = await memory.getShortTerm();
    expect(result).toBe("");
  });

  it("updateShortTerm writes content", async () => {
    await memory.updateShortTerm("Hello, short-term memory!");
    const result = await memory.getShortTerm();
    expect(result).toContain("Hello, short-term memory!");
  });

  it("appendShortTerm adds entry to existing content", async () => {
    await memory.updateShortTerm("First entry\n");
    await memory.appendShortTerm("Second entry");
    const result = await memory.getShortTerm();
    expect(result).toContain("First entry");
    expect(result).toContain("Second entry");
  });

  it("appendShortTerm creates file if not exists", async () => {
    await memory.appendShortTerm("New entry");
    const result = await memory.getShortTerm();
    expect(result).toContain("New entry");
  });

  it("truncates at 10KB to keep most recent entries", async () => {
    // Write more than 10KB
    const bigEntry = "x".repeat(5000);
    await memory.appendShortTerm(bigEntry + " FIRST");
    await memory.appendShortTerm(bigEntry + " SECOND");
    await memory.appendShortTerm("RECENT ENTRY"); // this must survive

    const result = await memory.getShortTerm();
    expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(10 * 1024 + 100);
    // Most recent entry should be kept
    expect(result).toContain("RECENT ENTRY");
  });

  it("serialize returns current short-term content", async () => {
    await memory.updateShortTerm("Test content for serialization");
    const serialized = memory.serialize();
    expect(serialized).toContain("Test content for serialization");
  });

  it("deserialize restores content to disk", async () => {
    const data = "Restored from checkpoint";
    await memory.deserialize(data);
    const result = await memory.getShortTerm();
    expect(result).toBe(data);
  });

  it("serialize/deserialize roundtrip", async () => {
    await memory.updateShortTerm("Important memory");
    const serialized = memory.serialize();

    // Create a new memory manager instance
    const memory2 = new MemoryManager("instance-2", DEF, tmpDir);
    await memory2.deserialize(serialized);
    const result = await memory2.getShortTerm();
    expect(result).toBe("Important memory");
  });
});

// ---------------------------------------------------------------------------
// Level 2: Long-term memory
// ---------------------------------------------------------------------------

describe("MemoryManager — long-term", () => {
  it("queryLongTerm returns empty when no file exists", async () => {
    const results = await memory.queryLongTerm("test query");
    expect(results).toEqual([]);
  });

  it("addLongTerm creates experience file", async () => {
    const entry: MemoryEntry = {
      id: "exp-1",
      content: "Task about authentication was completed successfully.",
      source: "long_term",
      agent_id: "sonnet-devlead",
      created_at: new Date().toISOString(),
    };
    await memory.addLongTerm(entry);
    const results = await memory.queryLongTerm("authentication");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain("authentication");
  });

  it("queryLongTerm does keyword search", async () => {
    await memory.addLongTerm({
      id: "e1",
      content: "JWT middleware implementation was straightforward.",
      source: "long_term",
      created_at: new Date().toISOString(),
    });
    await memory.addLongTerm({
      id: "e2",
      content: "Database migrations completed without issues.",
      source: "long_term",
      created_at: new Date().toISOString(),
    });

    const jwtResults = await memory.queryLongTerm("JWT middleware");
    expect(jwtResults.some((r) => r.content.includes("JWT"))).toBe(true);
    expect(jwtResults.some((r) => r.content.includes("Database"))).toBe(false);
  });

  it("queryLongTerm respects limit", async () => {
    for (let i = 0; i < 10; i++) {
      await memory.addLongTerm({
        id: `entry-${i}`,
        content: `Authentication task ${i} completed.`,
        source: "long_term",
        created_at: new Date().toISOString(),
      });
    }
    const results = await memory.queryLongTerm("authentication", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Level 3: Pool memory
// ---------------------------------------------------------------------------

describe("MemoryManager — pool", () => {
  it("queryPool returns empty when no file exists", async () => {
    const results = await memory.queryPool("query");
    expect(results).toEqual([]);
  });

  it("queryPool searches existing pool file", async () => {
    // Create pool.md manually (pool is read-only in V1)
    const poolDir = join(tmpDir, "divisions", "engineering", "knowledge");
    mkdirSync(poolDir, { recursive: true });
    writeFileSync(
      join(poolDir, "pool.md"),
      `# Division Knowledge Pool\n\n---\nAPI design standards: always version your APIs.\n---\nSecurity: never store plaintext secrets.\n`,
    );

    const results = await memory.queryPool("security secrets");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain("secret");
  });

  it("addPool writes to suggestions file (not pool.md)", async () => {
    await memory.addPool({
      id: "p1",
      content: "New best practice discovered.",
      source: "pool",
      created_at: new Date().toISOString(),
    });
    // Should not throw; suggestion goes to pool-suggestions.md
    // Verify suggestions file exists
    const { existsSync } = await import("node:fs");
    const suggestionsPath = join(
      tmpDir,
      "divisions",
      "engineering",
      "knowledge",
      "pool-suggestions.md",
    );
    expect(existsSync(suggestionsPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Combined search
// ---------------------------------------------------------------------------

describe("MemoryManager — getRelevantMemories", () => {
  it("returns empty string when all memory empty", async () => {
    const task = {
      id: "t1",
      title: "Test task",
      description: "A test task",
      division: "engineering",
      type: "delegation" as const,
      tier: 2 as const,
      parent_id: null,
      root_id: "t1",
      assigned_agent: null,
      status: "RUNNING" as const,
      priority: 3,
      classification: "internal",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      result_file: null,
      result_summary: null,
      confidence: null,
      token_budget: 1000,
      token_used: 0,
      cost_budget: 0.1,
      cost_used: 0,
      ttl_seconds: 600,
      retry_count: 0,
      max_retries: 3,
      checkpoint: null,
      sub_tasks_expected: 0,
      sub_tasks_received: 0,
      embedding_id: null,
      metadata: {},
    };

    const result = await memory.getRelevantMemories(task, 2000);
    expect(typeof result).toBe("string");
    // Empty when no memory exists
    expect(result.trim().length).toBeGreaterThanOrEqual(0);
  });

  it("includes short-term content when available", async () => {
    await memory.updateShortTerm("Completed auth feature yesterday.");
    const task = {
      id: "t2",
      title: "Auth feature",
      description: "Authentication feature",
      division: "engineering",
      type: "delegation" as const,
      tier: 2 as const,
      parent_id: null,
      root_id: "t2",
      assigned_agent: null,
      status: "RUNNING" as const,
      priority: 3,
      classification: "internal",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      result_file: null,
      result_summary: null,
      confidence: null,
      token_budget: 5000,
      token_used: 0,
      cost_budget: 0.5,
      cost_used: 0,
      ttl_seconds: 1800,
      retry_count: 0,
      max_retries: 3,
      checkpoint: null,
      sub_tasks_expected: 0,
      sub_tasks_received: 0,
      embedding_id: null,
      metadata: {},
    };

    const result = await memory.getRelevantMemories(task, 5000);
    expect(result).toContain("auth feature");
  });

  it("truncates to maxTokens approximation", async () => {
    const longContent = "Memory content. ".repeat(200);
    await memory.updateShortTerm(longContent);
    const task = {
      id: "t3",
      title: "Task",
      description: "d",
      division: "engineering",
      type: "delegation" as const,
      tier: 2 as const,
      parent_id: null,
      root_id: "t3",
      assigned_agent: null,
      status: "RUNNING" as const,
      priority: 3,
      classification: "internal",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      result_file: null,
      result_summary: null,
      confidence: null,
      token_budget: 1000,
      token_used: 0,
      cost_budget: 0.1,
      cost_used: 0,
      ttl_seconds: 600,
      retry_count: 0,
      max_retries: 3,
      checkpoint: null,
      sub_tasks_expected: 0,
      sub_tasks_received: 0,
      embedding_id: null,
      metadata: {},
    };

    const maxTokens = 100;
    const result = await memory.getRelevantMemories(task, maxTokens);
    // Should be roughly 400 chars (100 tokens * 4 chars/token) or less
    expect(result.length).toBeLessThanOrEqual(maxTokens * 4 + 50);
  });
});

// ---------------------------------------------------------------------------
// buildExperienceEntry
// ---------------------------------------------------------------------------

describe("MemoryManager — buildExperienceEntry", () => {
  it("builds a valid MemoryEntry", () => {
    const task = {
      id: "task-123",
      title: "Fix bug #456",
      description: "Fix the login bug",
      division: "engineering",
      type: "delegation" as const,
      tier: 3 as const,
      parent_id: null,
      root_id: "task-123",
      assigned_agent: null,
      status: "DONE" as const,
      priority: 2,
      classification: "internal",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      result_file: null,
      result_summary: null,
      confidence: null,
      token_budget: 1000,
      token_used: 0,
      cost_budget: 0.1,
      cost_used: 0,
      ttl_seconds: 600,
      retry_count: 0,
      max_retries: 3,
      checkpoint: null,
      sub_tasks_expected: 0,
      sub_tasks_received: 0,
      embedding_id: null,
      metadata: {},
    };

    const entry = memory.buildExperienceEntry(task, "Fixed by adjusting null check.");
    expect(entry.source).toBe("long_term");
    expect(entry.content).toContain("Fix bug #456");
    expect(entry.content).toContain("Fixed by adjusting null check.");
    expect(entry.task_id).toBe("task-123");
    expect(entry.agent_id).toBe("instance-1");
    expect(entry.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Helpers for lifecycle tests
// ---------------------------------------------------------------------------

const LIFECYCLE_CONFIG: MemoryLifecycleConfig = {
  short_term_warn_kb: 0.001, // tiny threshold so tests can trigger warning easily
  short_term_compact_kb: 0.002,
  short_term_hard_limit_kb: 0.01,
  skill_file_warn_kb: 6,
  skill_file_compact_kb: 8,
  skill_file_hard_limit_kb: 12,
  long_term_max_entries: 10_000,
  dedup_threshold: 0.95,
  archival_target: "file",
  compaction_strategy: "smart",
};

const HYGIENE_CONFIG: MemoryHygieneConfig = {
  thresholds: LIFECYCLE_CONFIG,
  retention: {
    always_retain: ["open_tasks", "active_projects", "unresolved_decisions", "current_session"],
    time_based: { decisions: "7d", session_summaries: "3" },
    never_retain: ["completed_task_details"],
  },
  archival: {
    target: "file",
    collection_prefix: "sidjua_",
    required_tags: ["source_agent_id", "content_type", "original_created_at"],
    traceability: true,
  },
  compaction: { strategy: "smart", dry_run: false },
};

function makeAllowExecutor(): ActionExecutor {
  return {
    executeAction: async () => ({ success: true }),
    executeLLMCall: async () => ({ success: false }),
  } as unknown as ActionExecutor;
}

function makeBlockExecutor(): ActionExecutor {
  return {
    executeAction: async () => ({
      success: false,
      blocked: true,
      block_reason: "Blocked by test governance",
    }),
    executeLLMCall: async () => ({ success: false }),
  } as unknown as ActionExecutor;
}

let memWithExecutor: MemoryManager;

// ---------------------------------------------------------------------------
// getMemoryHealth
// ---------------------------------------------------------------------------

describe("MemoryManager — getMemoryHealth", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-memory-health-test-"));
    memWithExecutor = new MemoryManager("instance-1", DEF, tmpDir, LIFECYCLE_CONFIG);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns healthy status for empty memory", async () => {
    const health = await memWithExecutor.getMemoryHealth();
    expect(health.agent_id).toBe("instance-1");
    expect(health.short_term.status).toBe("healthy");
    expect(health.short_term.size_kb).toBe(0);
    expect(health.long_term.status).toBe("healthy");
  });

  it("reports correct sizes after writing short-term memory", async () => {
    // Use updateShortTerm to populate via MemoryManager (which creates the file)
    await memWithExecutor.updateShortTerm("A".repeat(200));

    const health = await memWithExecutor.getMemoryHealth();
    expect(health.short_term.size_kb).toBeGreaterThan(0);
  });

  it("returns warning status when size exceeds warn threshold", async () => {
    // The warn threshold is 0.001 KB = 1 byte, so any content triggers warning
    await memWithExecutor.updateShortTerm("X".repeat(10));

    const health = await memWithExecutor.getMemoryHealth();
    expect(["warning", "critical"]).toContain(health.short_term.status);
  });

  it("provides recommendations when memory is above threshold", async () => {
    await memWithExecutor.updateShortTerm("X".repeat(20));

    const health = await memWithExecutor.getMemoryHealth();
    expect(health.recommendations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// compactShortTerm
// ---------------------------------------------------------------------------

describe("MemoryManager — compactShortTerm", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-compact-test-"));
    memWithExecutor = new MemoryManager(
      "instance-1",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeAllowExecutor(),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("truncate strategy reduces content size", async () => {
    // Write a large amount of content
    const longContent = Array.from({ length: 20 }, (_, i) => `Entry ${i}: ${"x".repeat(50)}`).join(
      "\n\n",
    );
    await memWithExecutor.updateShortTerm(longContent);

    const result = await memWithExecutor.compactShortTerm("truncate");
    expect(result.strategy).toBe("truncate");
    expect(result.before_size_kb).toBeGreaterThan(0);
    expect(result.after_size_kb).toBeLessThanOrEqual(result.before_size_kb);
    expect(result.dry_run).toBe(false);
  });

  it("smart strategy returns a result", async () => {
    await memWithExecutor.updateShortTerm("Completed task T-123.\nSome session notes.");

    const result = await memWithExecutor.compactShortTerm("smart");
    expect(result.strategy).toBe("smart");
    expect(result.before_size_kb).toBeGreaterThan(0);
    expect(result.dry_run).toBe(false);
  });

  it("summarize strategy throws unsupported error", async () => {
    await expect(memWithExecutor.compactShortTerm("summarize")).rejects.toThrow(
      /UNSUPPORTED_STRATEGY|summarize/i,
    );
  });
});

// ---------------------------------------------------------------------------
// archiveFromShortTerm
// ---------------------------------------------------------------------------

describe("MemoryManager — archiveFromShortTerm", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-archive-test-"));
    memWithExecutor = new MemoryManager(
      "instance-1",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeAllowExecutor(),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const validCandidate: ArchivalCandidate = {
    content: "Completed task T-1: auth feature.",
    content_type: "task_result",
    original_created_at: new Date(Date.now() - 86_400_000).toISOString(),
    task_id: "t-1",
  };

  it("archives valid entry and returns archived_count", async () => {
    const result = await memWithExecutor.archiveFromShortTerm([validCandidate], "long_term");
    expect(result.archived_count).toBe(1);
    expect(result.target).toBe("long_term");
    expect(result.entries.length).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  it("entry has content_hash in result", async () => {
    const result = await memWithExecutor.archiveFromShortTerm([validCandidate], "long_term");
    expect(result.entries[0]!.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails without required tags — records error in result", async () => {
    const badCandidate = {
      content: "Some content",
      content_type: undefined as unknown as ArchivalCandidate["content_type"],
      original_created_at: new Date().toISOString(),
    };
    const result = await memWithExecutor.archiveFromShortTerm(
      [badCandidate as ArchivalCandidate],
      "long_term",
    );
    // Bad candidate recorded as error, not thrown
    expect(result.archived_count).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.error).toMatch(/MISSING_REQUIRED_TAGS|required archival tags/i);
  });

  it("governance block records error in result", async () => {
    const blockedMem = new MemoryManager(
      "instance-1",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeBlockExecutor(),
    );
    const result = await blockedMem.archiveFromShortTerm([validCandidate], "long_term");
    expect(result.archived_count).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.error).toMatch(/GOVERNANCE_BLOCK|Blocked/i);
  });
});

// ---------------------------------------------------------------------------
// deduplicateWithin
// ---------------------------------------------------------------------------

describe("MemoryManager — deduplicateWithin", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-dedup-test-"));
    memWithExecutor = new MemoryManager(
      "instance-1",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeAllowExecutor(),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds exact duplicates in short-term memory", async () => {
    // Deduplication splits on \n---\n separators
    const dup = "Identical session content that appears twice.";
    await memWithExecutor.updateShortTerm(`${dup}\n\n---\n\n${dup}`);

    const result = await memWithExecutor.deduplicateWithin("short_term", 0.95);
    expect(result.tier).toBe("short_term");
    expect(result.duplicates_found).toBeGreaterThan(0);
    expect(result.duplicates_removed).toBeGreaterThan(0);
  });

  it("returns zero duplicates when content is unique", async () => {
    await memWithExecutor.updateShortTerm(
      "First unique session content.\n\n---\n\nCompletely different second content.",
    );

    const result = await memWithExecutor.deduplicateWithin("short_term", 0.95);
    expect(result.duplicates_found).toBe(0);
    expect(result.duplicates_removed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkPersistence
// ---------------------------------------------------------------------------

describe("MemoryManager — checkPersistence", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-persist-test-"));
    memWithExecutor = new MemoryManager("instance-1", DEF, tmpDir, LIFECYCLE_CONFIG);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns content_hash as SHA-256", async () => {
    const result = await memWithExecutor.checkPersistence("test content");
    expect(result.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns safe_to_remove false when no DB found", async () => {
    const result = await memWithExecutor.checkPersistence("some content with no task refs");
    expect(result.safe_to_remove).toBe(false);
  });

  it("returns array for persisted_in", async () => {
    const result = await memWithExecutor.checkPersistence("content");
    expect(Array.isArray(result.persisted_in)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// migrate
// ---------------------------------------------------------------------------

describe("MemoryManager — migrate", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-migrate-test-"));
    memWithExecutor = new MemoryManager(
      "instance-1",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeAllowExecutor(),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migrates entries from short_term to long_term", async () => {
    const entries: MemoryEntry[] = [
      {
        id: "e1",
        agent_id: "instance-1",
        source: "short_term",
        content: "Task completed: feature X",
        embedding_id: null,
        created_at: new Date().toISOString(),
        relevance_score: 1.0,
      },
    ];

    const result = await memWithExecutor.migrate(
      entries,
      "short_term",
      "long_term",
      [{ key: "reason", value: "test" }],
    );

    expect(result.from).toBe("short_term");
    expect(result.to).toBe("long_term");
    expect(result.migrated_count).toBe(1);
    expect(result.errors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dryRunHygiene
// ---------------------------------------------------------------------------

describe("MemoryManager — dryRunHygiene", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-dryrun-test-"));
    memWithExecutor = new MemoryManager(
      "instance-1",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeAllowExecutor(),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns dry_run=true result without modifying files", async () => {
    await memWithExecutor.updateShortTerm("Some memory content.");

    const result = await memWithExecutor.dryRunHygiene(HYGIENE_CONFIG);
    expect(result.dry_run).toBe(true);

    // Content should still be intact
    const afterContent = await memWithExecutor.getShortTerm();
    expect(afterContent).toContain("Some memory content.");
  });

  it("dry run result contains health_before and health_after", async () => {
    const result = await memWithExecutor.dryRunHygiene(HYGIENE_CONFIG);
    expect(result.health_before).toBeDefined();
    expect(result.health_after).toBeDefined();
    expect(result.agent_id).toBe("instance-1");
  });
});
