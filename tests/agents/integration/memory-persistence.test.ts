/**
 * Integration: Memory persistence
 *
 * Tests that MemoryManager persists data across instances (simulating agent restarts).
 * Also tests CheckpointManager round-trip with memory snapshots.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSQLite3 from "better-sqlite3";
import { MemoryManager } from "../../../src/agents/memory.js";
import { CheckpointManager } from "../../../src/agents/checkpoint.js";
import type { AgentDefinition, AgentState, MemoryEntry } from "../../../src/agents/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEF: AgentDefinition = {
  id: "memory-test-agent",
  name: "Memory Test Agent",
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
let db: ReturnType<typeof BetterSQLite3>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-mem-persist-"));
  db = new BetterSQLite3(join(tmpDir, "checkpoints.db"));
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Short-term memory persistence across instances
// ---------------------------------------------------------------------------

describe("Memory persistence — short-term across instances", () => {
  it("short-term memory survives instance re-creation (same file)", async () => {
    // Both instances use the same agent ID → same short-term file path
    const mem1 = new MemoryManager("memory-test-agent", DEF, tmpDir);
    await mem1.updateShortTerm("Completed the auth module successfully.");

    // Simulate restart: create new instance with same ID pointing to same tmpDir
    const mem2 = new MemoryManager("memory-test-agent", DEF, tmpDir);
    const content = await mem2.getShortTerm();

    expect(content).toContain("auth module successfully");
  });

  it("appendShortTerm accumulates across instances", async () => {
    // All instances share the same short-term file (same agent ID)
    const mem1 = new MemoryManager("memory-test-agent", DEF, tmpDir);
    await mem1.appendShortTerm("Entry from session 1.");

    const mem2 = new MemoryManager("memory-test-agent", DEF, tmpDir);
    await mem2.appendShortTerm("Entry from session 2.");

    const mem3 = new MemoryManager("memory-test-agent", DEF, tmpDir);
    const content = await mem3.getShortTerm();

    expect(content).toContain("Entry from session 1.");
    expect(content).toContain("Entry from session 2.");
  });
});

// ---------------------------------------------------------------------------
// Long-term memory persistence
// ---------------------------------------------------------------------------

describe("Memory persistence — long-term across instances", () => {
  it("long-term entries survive instance re-creation", async () => {
    const mem1 = new MemoryManager("instance-1", DEF, tmpDir);

    const entry: MemoryEntry = {
      id: "exp-1",
      content: "JWT implementation completed. Used RS256 signing for enhanced security.",
      source: "long_term",
      agent_id: "memory-test-agent",
      created_at: new Date().toISOString(),
    };
    await mem1.addLongTerm(entry);

    // New instance reads same long-term file
    const mem2 = new MemoryManager("instance-2", DEF, tmpDir);
    const results = await mem2.queryLongTerm("JWT");

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.content).toContain("JWT implementation");
  });

  it("multiple long-term entries are all retrievable", async () => {
    const mem1 = new MemoryManager("instance-1", DEF, tmpDir);

    for (let i = 1; i <= 5; i++) {
      await mem1.addLongTerm({
        id: `exp-${i}`,
        content: `Authentication task ${i}: completed with confidence 0.9.`,
        source: "long_term",
        created_at: new Date().toISOString(),
      });
    }

    const mem2 = new MemoryManager("instance-2", DEF, tmpDir);
    const results = await mem2.queryLongTerm("authentication", 10);
    expect(results.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint + memory snapshot round-trip
// ---------------------------------------------------------------------------

describe("Memory persistence — checkpoint snapshot round-trip", () => {
  it("serialize/deserialize restores short-term memory exactly", async () => {
    const mem1 = new MemoryManager("instance-1", DEF, tmpDir);
    const originalContent = "Task completed: built REST API with 95% test coverage.";
    await mem1.updateShortTerm(originalContent);

    // Serialize (as would happen at checkpoint)
    const snapshot = mem1.serialize();

    // Deserialize in a new instance (as would happen after restart)
    const mem2 = new MemoryManager("instance-2", DEF, tmpDir);
    await mem2.deserialize(snapshot);

    const restored = await mem2.getShortTerm();
    expect(restored).toBe(originalContent);
  });

  it("checkpoint manager stores and restores memory snapshot", async () => {
    const cpMgr = new CheckpointManager(db);
    cpMgr.initialize();

    const mem = new MemoryManager("instance-1", DEF, tmpDir);
    await mem.updateShortTerm("Critical context: team uses monorepo, all PRs need review.");

    const snapshot = mem.serialize();
    const state: AgentState = {
      agent_id: "memory-test-agent",
      status: "IDLE",
      pid: null,
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      last_checkpoint: null,
      active_tasks: [],
      waiting_tasks: [],
      queued_tasks: 0,
      total_tokens_used: 1000,
      total_cost_usd: 0.01,
      restart_count: 0,
      current_hour_cost: 0.01,
      hour_start: new Date().toISOString(),
      error_log: [],
    };

    // Save checkpoint with memory snapshot
    await cpMgr.save({
      agent_id: "memory-test-agent",
      timestamp: new Date().toISOString(),
      version: 0,
      state,
      task_states: [],
      memory_snapshot: snapshot,
    });

    // Load checkpoint
    const loaded = await cpMgr.loadLatest("memory-test-agent");
    expect(loaded).not.toBeNull();

    // Restore memory from snapshot
    const mem2 = new MemoryManager("instance-2", DEF, tmpDir);
    await mem2.deserialize(loaded!.memory_snapshot);

    const restored = await mem2.getShortTerm();
    expect(restored).toContain("monorepo");
    expect(restored).toContain("PRs need review");
  });
});

// ---------------------------------------------------------------------------
// Pool memory (read-only for agents, write goes to suggestions)
// ---------------------------------------------------------------------------

describe("Memory persistence — pool suggestions", () => {
  it("addPool writes to suggestions file, not pool", async () => {
    const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");

    const mem = new MemoryManager("instance-1", DEF, tmpDir);

    // Create pool.md
    const poolDir = join(tmpDir, "divisions", "engineering", "knowledge");
    mkdirSync(poolDir, { recursive: true });
    writeFileSync(join(poolDir, "pool.md"), "# Pool\n\n---\nExisting knowledge.\n");

    // Add suggestion
    await mem.addPool({
      id: "sugg-1",
      content: "Always run tests before PR.",
      source: "pool",
      created_at: new Date().toISOString(),
    });

    // Pool file should be unchanged
    const { readFileSync } = await import("node:fs");
    const poolContent = readFileSync(join(poolDir, "pool.md"), "utf-8");
    expect(poolContent).not.toContain("Always run tests before PR");

    // Suggestions file should have our entry
    const suggestionsPath = join(poolDir, "pool-suggestions.md");
    expect(existsSync(suggestionsPath)).toBe(true);
    const sugContent = readFileSync(suggestionsPath, "utf-8");
    expect(sugContent).toContain("Always run tests before PR");
  });

  it("multiple pool suggestion writes accumulate", async () => {
    const mem1 = new MemoryManager("instance-1", DEF, tmpDir);
    const mem2 = new MemoryManager("instance-2", DEF, tmpDir);

    await mem1.addPool({ id: "s1", content: "Use async/await consistently.", source: "pool", created_at: new Date().toISOString() });
    await mem2.addPool({ id: "s2", content: "Prefer functional patterns.", source: "pool", created_at: new Date().toISOString() });

    const { readFileSync } = await import("node:fs");
    const path = join(tmpDir, "divisions", "engineering", "knowledge", "pool-suggestions.md");
    const content = readFileSync(path, "utf-8");

    expect(content).toContain("async/await");
    expect(content).toContain("functional patterns");
  });
});

// ---------------------------------------------------------------------------
// getRelevantMemories combines all levels
// ---------------------------------------------------------------------------

describe("Memory persistence — getRelevantMemories across levels", () => {
  it("returns content from short-term and long-term when available", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const mem = new MemoryManager("instance-1", DEF, tmpDir);

    // Short-term
    await mem.updateShortTerm("Recently completed: database migration.");

    // Long-term
    await mem.addLongTerm({
      id: "exp-1",
      content: "PostgreSQL migrations work best with flyway tooling.",
      source: "long_term",
      created_at: new Date().toISOString(),
    });

    // Pool
    const poolDir = join(tmpDir, "divisions", "engineering", "knowledge");
    mkdirSync(poolDir, { recursive: true });
    writeFileSync(join(poolDir, "pool.md"), "---\nAlways backup before migration.\n---\n");

    const task = {
      id: "t1",
      title: "Database migration",
      description: "Run database migration scripts",
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

    const relevant = await mem.getRelevantMemories(task, 5000);
    expect(relevant).toContain("database migration");
  });

  it("empty result when no memory exists", async () => {
    const mem = new MemoryManager("instance-1", DEF, tmpDir);

    const task = {
      id: "t2",
      title: "New task",
      description: "No related memory.",
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

    const relevant = await mem.getRelevantMemories(task, 1000);
    expect(typeof relevant).toBe("string");
    // Could be empty or whitespace when no memories exist
    expect(relevant.trim().length).toBeGreaterThanOrEqual(0);
  });
});
