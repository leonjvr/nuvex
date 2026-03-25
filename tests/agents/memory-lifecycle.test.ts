/**
 * Tests for src/agents/memory-lifecycle.ts
 * Unit tests for MemoryLifecycleManager.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLifecycleManager } from "../../src/agents/memory-lifecycle.js";
import { MemoryManager } from "../../src/agents/memory.js";
import type {
  AgentDefinition,
  MemoryHygieneConfig,
  MemoryLifecycleConfig,
  HygieneCycleResult,
} from "../../src/agents/types.js";
import type { ActionExecutor } from "../../src/agents/action-executor.js";
import type { SkillLoader } from "../../src/agents/skill-loader.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEF: AgentDefinition = {
  id: "lifecycle-test-agent",
  name: "Lifecycle Test Agent",
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
  compaction_strategy: "truncate", // use truncate to avoid DB cross-reference in tests
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

function makeSkillLoader(): SkillLoader {
  return {} as unknown as SkillLoader;
}

let tmpDir: string;
let memManager: MemoryManager;
let lifecycleManager: MemoryLifecycleManager;

// ---------------------------------------------------------------------------
// MemoryLifecycleManager — runCycle
// ---------------------------------------------------------------------------

describe("MemoryLifecycleManager — runCycle", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-lifecycle-test-"));
    memManager = new MemoryManager(
      "lifecycle-test-agent",
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

  it("runs a full cycle and returns HygieneCycleResult", async () => {
    await memManager.updateShortTerm("Some short-term content for lifecycle test.");

    const result = await lifecycleManager.runCycle("lifecycle-test-agent");

    expect(result.agent_id).toBe("lifecycle-test-agent");
    expect(result.dry_run).toBe(false);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.health_before).toBeDefined();
    expect(result.health_after).toBeDefined();
    expect(Array.isArray(result.governance_actions)).toBe(true);
  });

  it("governance_actions contain at least the dedup action", async () => {
    const result = await lifecycleManager.runCycle("lifecycle-test-agent");

    const types = result.governance_actions.map((a) => a.action_type);
    expect(types).toContain("memory.deduplicate");
  });

  it("records governance ALLOW when executor allows", async () => {
    const result = await lifecycleManager.runCycle("lifecycle-test-agent");

    const allowed = result.governance_actions.filter((a) => a.verdict === "ALLOW");
    expect(allowed.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// MemoryLifecycleManager — governance block
// ---------------------------------------------------------------------------

describe("MemoryLifecycleManager — governance block on dedup", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-lifecycle-block-test-"));
    memManager = new MemoryManager(
      "lifecycle-test-agent",
      DEF,
      tmpDir,
      LIFECYCLE_CONFIG,
      makeBlockExecutor(),
    );
    lifecycleManager = new MemoryLifecycleManager(
      memManager,
      makeSkillLoader(),
      makeBlockExecutor(),
      HYGIENE_CONFIG,
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records BLOCK verdict when governance blocks operations", async () => {
    const result = await lifecycleManager.runCycle("lifecycle-test-agent");

    const blocked = result.governance_actions.filter((a) => a.verdict === "BLOCK");
    expect(blocked.length).toBeGreaterThan(0);
  });

  it("still returns a valid HygieneCycleResult even when blocked", async () => {
    const result = await lifecycleManager.runCycle("lifecycle-test-agent");

    expect(result.agent_id).toBe("lifecycle-test-agent");
    expect(result.timestamp).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MemoryLifecycleManager — runDivisionCycle
// ---------------------------------------------------------------------------

describe("MemoryLifecycleManager — runDivisionCycle", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-division-test-"));
    memManager = new MemoryManager(
      "agent-1",
      { ...DEF, id: "agent-1" },
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

  it("processes multiple agents and returns a Map", async () => {
    const results = await lifecycleManager.runDivisionCycle("engineering", ["agent-1"]);

    expect(results instanceof Map).toBe(true);
    expect(results.has("agent-1")).toBe(true);
  });

  it("continues to next agent on failure", async () => {
    // Even if one agent fails, the others should complete
    const results = await lifecycleManager.runDivisionCycle("engineering", [
      "agent-1",
      "agent-nonexistent",
    ]);

    expect(results.size).toBe(2);
    const failedResult = results.get("agent-nonexistent") as HygieneCycleResult;
    expect(failedResult).toBeDefined();
    // Should have a governance action recording the failure
    expect(failedResult.governance_actions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// MemoryLifecycleManager — dryRun
// ---------------------------------------------------------------------------

describe("MemoryLifecycleManager — dryRun", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-lifecycle-dry-test-"));
    memManager = new MemoryManager(
      "lifecycle-test-agent",
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

  it("returns dry_run=true result without modifying data", async () => {
    await memManager.updateShortTerm("Content that should survive dry run.");

    const result = await lifecycleManager.dryRun("lifecycle-test-agent");
    expect(result.dry_run).toBe(true);

    const after = await memManager.getShortTerm();
    expect(after).toContain("Content that should survive dry run.");
  });

  it("dry run result has health snapshots", async () => {
    const result = await lifecycleManager.dryRun("lifecycle-test-agent");

    expect(result.health_before).toBeDefined();
    expect(result.health_after).toBeDefined();
  });
});
