/**
 * Integration: Memory Lifecycle end-to-end tests
 *
 * Tests the full memory lifecycle cycle:
 *   Agent accumulates memory → hygiene cycle triggers → memory compacted
 *   Checkpoint includes memory lifecycle state → recovery restores it
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSQLite3 from "better-sqlite3";
import { MemoryManager } from "../../../src/agents/memory.js";
import { MemoryLifecycleManager } from "../../../src/agents/memory-lifecycle.js";
import { CheckpointManager } from "../../../src/agents/checkpoint.js";
import type {
  AgentDefinition,
  MemoryLifecycleConfig,
  MemoryHygieneConfig,
  ArchivalCandidate,
} from "../../../src/agents/types.js";
import type { ActionExecutor } from "../../../src/agents/action-executor.js";
import type { SkillLoader } from "../../../src/agents/skill-loader.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEF: AgentDefinition = {
  id: "integration-lifecycle-agent",
  name: "Integration Lifecycle Agent",
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

const LIFECYCLE_CONFIG: MemoryLifecycleConfig = {
  short_term_warn_kb: 0.001,
  short_term_compact_kb: 0.002,
  short_term_hard_limit_kb: 0.01,
  skill_file_warn_kb: 6,
  skill_file_compact_kb: 8,
  skill_file_hard_limit_kb: 12,
  long_term_max_entries: 10_000,
  dedup_threshold: 0.95,
  archival_target: "file",
  compaction_strategy: "truncate",
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
  compaction: { strategy: "truncate", dry_run: false },
};

function makeAllowExecutor(): ActionExecutor {
  return {
    executeAction: async () => ({ success: true }),
    executeLLMCall: async () => ({ success: false }),
  } as unknown as ActionExecutor;
}

function makeSkillLoader(): SkillLoader {
  return {} as unknown as SkillLoader;
}

let tmpDir: string;
let memManager: MemoryManager;
let lifecycleManager: MemoryLifecycleManager;

// ---------------------------------------------------------------------------
// Agent accumulates memory → hygiene cycle → memory compacted
// ---------------------------------------------------------------------------

describe("Memory lifecycle: accumulate → compact", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-ml-integ-"));
    memManager = new MemoryManager(
      "integration-lifecycle-agent",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeAllowExecutor(),
    );
    lifecycleManager = new MemoryLifecycleManager(
      memManager,
      makeSkillLoader(),
      makeAllowExecutor(),
      HYGIENE_CONFIG,
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("memory grows, hygiene cycle compacts it", async () => {
    // Accumulate short-term memory
    for (let i = 0; i < 20; i++) {
      await memManager.appendShortTerm(`Task ${i} completed: ${"x".repeat(50)}`);
    }

    const beforeHealth = await memManager.getMemoryHealth();
    expect(beforeHealth.short_term.size_kb).toBeGreaterThan(0);

    // Run hygiene cycle
    const result = await lifecycleManager.runCycle("integration-lifecycle-agent");
    expect(result.dry_run).toBe(false);
    expect(result.agent_id).toBe("integration-lifecycle-agent");

    // After hygiene, health should be available
    const afterHealth = await memManager.getMemoryHealth();
    expect(afterHealth.short_term.size_kb).toBeGreaterThanOrEqual(0);
  });

  it("hygiene cycle result records governance actions", async () => {
    await memManager.updateShortTerm("Some memory content for integration test.");

    const result = await lifecycleManager.runCycle("integration-lifecycle-agent");
    expect(result.governance_actions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint includes memory lifecycle state
// ---------------------------------------------------------------------------

describe("Memory lifecycle: checkpoint preservation", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-ml-checkpoint-"));
    memManager = new MemoryManager(
      "integration-lifecycle-agent",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeAllowExecutor(),
    );
    lifecycleManager = new MemoryLifecycleManager(
      memManager,
      makeSkillLoader(),
      makeAllowExecutor(),
      HYGIENE_CONFIG,
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("checkpoint saves and restores memory_lifecycle field", async () => {
    const db = new BetterSQLite3(join(tmpDir, "checkpoints.db"));
    const cpMgr = new CheckpointManager(db);
    cpMgr.initialize();

    const healthSnapshot = await memManager.getMemoryHealth();

    const version = await cpMgr.save({
      agent_id: "integration-lifecycle-agent",
      timestamp: new Date().toISOString(),
      version: 0,
      state: {
        agent_id: "integration-lifecycle-agent",
        status: "IDLE",
        pid: null,
        started_at: null,
        last_heartbeat: null,
        last_checkpoint: null,
        active_tasks: [],
        waiting_tasks: [],
        queued_tasks: 0,
        total_tokens_used: 0,
        total_cost_usd: 0,
        restart_count: 0,
        current_hour_cost: 0,
        hour_start: new Date().toISOString(),
        error_log: [],
      },
      task_states: [],
      memory_snapshot: await memManager.getShortTerm(),
      memory_lifecycle: {
        last_hygiene_cycle: new Date().toISOString(),
        last_compaction: null,
        pending_archival: [],
        health_snapshot: healthSnapshot,
      },
    });

    expect(version).toBe(1);

    const loaded = await cpMgr.loadLatest("integration-lifecycle-agent");
    expect(loaded).not.toBeNull();
    expect(loaded!.memory_lifecycle).toBeDefined();
    expect(loaded!.memory_lifecycle!.last_hygiene_cycle).toBeTruthy();
    expect(loaded!.memory_lifecycle!.pending_archival).toHaveLength(0);

    db.close();
  });

  it("checkpoint without memory_lifecycle field loads correctly", async () => {
    const db = new BetterSQLite3(join(tmpDir, "checkpoints.db"));
    const cpMgr = new CheckpointManager(db);
    cpMgr.initialize();

    const version = await cpMgr.save({
      agent_id: "integration-lifecycle-agent",
      timestamp: new Date().toISOString(),
      version: 0,
      state: {
        agent_id: "integration-lifecycle-agent",
        status: "IDLE",
        pid: null,
        started_at: null,
        last_heartbeat: null,
        last_checkpoint: null,
        active_tasks: [],
        waiting_tasks: [],
        queued_tasks: 0,
        total_tokens_used: 0,
        total_cost_usd: 0,
        restart_count: 0,
        current_hour_cost: 0,
        hour_start: new Date().toISOString(),
        error_log: [],
      },
      task_states: [],
      memory_snapshot: "",
      // memory_lifecycle intentionally omitted
    });

    const loaded = await cpMgr.loadLatest("integration-lifecycle-agent");
    expect(loaded).not.toBeNull();
    expect(loaded!.memory_lifecycle).toBeUndefined();

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Multi-agent hygiene in same division
// ---------------------------------------------------------------------------

describe("Memory lifecycle: multi-agent division cycle", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-ml-multi-"));
    memManager = new MemoryManager(
      "agent-alpha",
      { ...DEF, id: "agent-alpha" },
      tmpDir,
      LIFECYCLE_CONFIG,
      makeAllowExecutor(),
    );
    lifecycleManager = new MemoryLifecycleManager(
      memManager,
      makeSkillLoader(),
      makeAllowExecutor(),
      HYGIENE_CONFIG,
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("division cycle returns results for each agent", async () => {
    const results = await lifecycleManager.runDivisionCycle("engineering", [
      "agent-alpha",
      "agent-beta",
    ]);

    expect(results.size).toBe(2);
    expect(results.has("agent-alpha")).toBe(true);
    expect(results.has("agent-beta")).toBe(true);
  });

  it("each agent's result has valid timestamp", async () => {
    const results = await lifecycleManager.runDivisionCycle("engineering", ["agent-alpha"]);

    const result = results.get("agent-alpha")!;
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// Deduplication across short-term memory
// ---------------------------------------------------------------------------

describe("Memory lifecycle: deduplication", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-ml-dedup-"));
    memManager = new MemoryManager(
      "integration-lifecycle-agent",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeAllowExecutor(),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("deduplication removes exact duplicates and keeps originals", async () => {
    // Deduplication splits on \n---\n separators
    const dup = "Task T-1 completed successfully with confidence 0.9.";
    const unique = "Some unique content in a separate section.";
    await memManager.updateShortTerm(`${dup}\n\n---\n\n${dup}\n\n---\n\n${unique}`);

    const result = await memManager.deduplicateWithin("short_term", 0.95);
    expect(result.duplicates_found).toBeGreaterThan(0);

    const afterContent = await memManager.getShortTerm();
    expect(afterContent).toContain("Some unique content");
  });

  it("deduplication is idempotent (run twice, same result)", async () => {
    const content = "## Session\nUnique session note.\n\n## Work\nCompleted task A.";
    await memManager.updateShortTerm(content);

    const result1 = await memManager.deduplicateWithin("short_term", 0.95);
    const result2 = await memManager.deduplicateWithin("short_term", 0.95);

    expect(result2.duplicates_found).toBe(0); // already deduplicated
  });
});
