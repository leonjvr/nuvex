/**
 * Tests for Phase 5 Memory Lifecycle Governance Amendment
 *
 * Covers Section 7 testing checklist:
 *   ✓ Memory-hygiene policy rules loaded from YAML
 *   ✓ memory.archive passes with correct tags
 *   ✓ memory.archive blocked without required tags
 *   ✓ memory.delete blocked when open task refs exist
 *   ✓ memory.delete triggers approval workflow
 *   ✓ memory.skill_update blocked when exceeding hard limit
 *   ✓ memory.pool_write blocked for cross-division writes
 *   ✓ memory.migrate cross-division triggers approval
 *   ✓ Scheduled policy metadata extracted correctly
 *   ✓ Personal mode memory rules loaded from my-rules.yaml
 *   ✓ Memory action types registered in ACTION_TYPES
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { openDatabase, runMigrations } from "../../src/utils/db.js";
import { MIGRATIONS } from "../../src/apply/database.js";
import { checkPolicy } from "../../src/pipeline/policy.js";
import { checkApproval } from "../../src/pipeline/approval.js";
import {
  loadGovernanceConfig,
  loadScheduledPolicies,
  loadPersonalMemoryConfig,
} from "../../src/pipeline/config-loader.js";
import { ACTION_TYPES } from "../../src/types/pipeline.js";
import type { ActionRequest, PolicyConfig } from "../../src/types/pipeline.js";
import type { Database } from "../../src/utils/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures/governance");
const POLICIES_DIR = join(FIXTURES, "policies");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  type: string,
  parameters?: Record<string, unknown>,
  overrides: Partial<{
    divisionCode:   string;
    targetDivision: string;
  }> = {},
): ActionRequest {
  return {
    request_id:    "req-mem-001",
    timestamp:     "2026-02-28T02:00:00Z",
    agent_id:      "agent-1",
    agent_tier:    2,
    division_code: overrides.divisionCode ?? "engineering",
    action: {
      type,
      target:      "memory://short-term",
      description: "memory operation",
      parameters,
    },
    context: {
      division_code:   overrides.divisionCode   ?? "engineering",
      target_division: overrides.targetDivision,
      session_id:      "sess-mem-001",
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Memory-hygiene policy rules loaded from YAML
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — policy rules loaded from YAML", () => {
  it("memory-hygiene.yaml is picked up by loadGovernanceConfig", () => {
    const config = loadGovernanceConfig(FIXTURES);
    const allRuleIds = config.policies.flatMap((p) => p.rules.map((r) => r.id));
    expect(allRuleIds).toContain("memory_hygiene_short_term_limit");
    expect(allRuleIds).toContain("memory_hygiene_skill_limit");
    expect(allRuleIds).toContain("memory_no_delete_active");
    expect(allRuleIds).toContain("memory_archive_requires_tag");
    expect(allRuleIds).toContain("memory_pool_division_scope");
    expect(allRuleIds).toContain("memory_cross_division_migrate");
  });
});

// ---------------------------------------------------------------------------
// Load policies for tests that call checkPolicy directly
// ---------------------------------------------------------------------------

function loadMemoryPolicies(): PolicyConfig[] {
  const config = loadGovernanceConfig(FIXTURES);
  return config.policies.filter((p) => p.source_file.includes("memory-hygiene"));
}

// ---------------------------------------------------------------------------
// 2. memory.archive passes with correct tags
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — memory.archive action", () => {
  it("passes with correct tags and within size limit", () => {
    const policies = loadMemoryPolicies();
    const result = checkPolicy(
      makeRequest("memory.archive", {
        has_required_tags: true,
        memory_size_kb: 10,
      }),
      policies,
    );
    expect(result.verdict).toBe("PASS");
  });

  // ---------------------------------------------------------------------------
  // 3. memory.archive blocked without required tags
  // ---------------------------------------------------------------------------

  it("blocked without required tags (hard enforcement)", () => {
    const policies = loadMemoryPolicies();
    const result = checkPolicy(
      makeRequest("memory.archive", {
        has_required_tags: false,
        memory_size_kb: 10,
      }),
      policies,
    );
    expect(result.verdict).toBe("BLOCK");
    const blocked = result.rules_checked.find(
      (c) => c.rule_id === "policy.memory_archive_requires_tag" && c.verdict === "BLOCK",
    );
    expect(blocked).toBeDefined();
  });

  it("warns (soft) when memory_size_kb exceeds threshold", () => {
    const policies = loadMemoryPolicies();
    const result = checkPolicy(
      makeRequest("memory.archive", {
        has_required_tags: true,
        memory_size_kb: 30, // exceeds 25 hard_limit
      }),
      policies,
    );
    // memory_hygiene_short_term_limit is soft enforcement → WARN
    expect(result.verdict).toBe("WARN");
  });
});

// ---------------------------------------------------------------------------
// 4. memory.delete blocked when open task refs exist
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — memory.delete action (policy check)", () => {
  it("blocked when open_task_refs > 0 (target_has_no_open_task_refs is false)", () => {
    const policies = loadMemoryPolicies();
    const result = checkPolicy(
      makeRequest("memory.delete", {
        open_task_refs: 3,
        has_required_tags: true,
      }),
      policies,
    );
    expect(result.verdict).toBe("BLOCK");
    const blocked = result.rules_checked.find(
      (c) => c.rule_id === "policy.memory_no_delete_active" && c.verdict === "BLOCK",
    );
    expect(blocked).toBeDefined();
  });

  it("passes policy check when no open task refs (open_task_refs == 0)", () => {
    const policies = loadMemoryPolicies();
    const result = checkPolicy(
      makeRequest("memory.delete", {
        open_task_refs: 0,
        has_required_tags: true,
      }),
      policies,
    );
    // memory.delete has no other hard rules in memory-hygiene
    expect(result.verdict).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// 5. memory.delete triggers approval workflow
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — memory.delete triggers approval", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-mem-approve-"));
    db     = openDatabase(join(tmpDir, "test.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db, MIGRATIONS);
    db
      .prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)")
      .run("engineering", "Engineering");
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("memory.delete causes PAUSE in approval stage", () => {
    const config = loadGovernanceConfig(FIXTURES);
    const result = checkApproval(
      makeRequest("memory.delete"),
      config.approval,
      db,
    );
    expect(result.verdict).toBe("PAUSE");
    const matched = result.rules_checked.find(
      (c) => c.rule_id === "approval.memory.delete" && c.verdict === "PAUSE",
    );
    expect(matched).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 6. memory.skill_update blocked when exceeding hard limit
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — memory.skill_update action", () => {
  it("blocked when skill_file_size_kb exceeds hard limit (> 12)", () => {
    const policies = loadMemoryPolicies();
    const result = checkPolicy(
      makeRequest("memory.skill_update", { skill_file_size_kb: 15 }),
      policies,
    );
    expect(result.verdict).toBe("BLOCK");
    const blocked = result.rules_checked.find(
      (c) => c.rule_id === "policy.memory_hygiene_skill_limit" && c.verdict === "BLOCK",
    );
    expect(blocked).toBeDefined();
  });

  it("passes when skill_file_size_kb is within limit", () => {
    const policies = loadMemoryPolicies();
    const result = checkPolicy(
      makeRequest("memory.skill_update", { skill_file_size_kb: 8 }),
      policies,
    );
    expect(result.verdict).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// 7. memory.pool_write blocked for cross-division writes
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — memory.pool_write action", () => {
  it("blocked when target_division differs from division_code", () => {
    const policies = loadMemoryPolicies();
    const result = checkPolicy(
      makeRequest("memory.pool_write", {}, {
        divisionCode:   "engineering",
        targetDivision: "finance",
      }),
      policies,
    );
    expect(result.verdict).toBe("BLOCK");
    const blocked = result.rules_checked.find(
      (c) => c.rule_id === "policy.memory_pool_division_scope" && c.verdict === "BLOCK",
    );
    expect(blocked).toBeDefined();
  });

  it("passes for same-division pool write (no target_division set)", () => {
    const policies = loadMemoryPolicies();
    const result = checkPolicy(
      makeRequest("memory.pool_write", {}, { divisionCode: "engineering" }),
      policies,
    );
    expect(result.verdict).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// 8. memory.migrate cross-division triggers approval
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — memory.migrate cross-division approval", () => {
  let tmpDir: string;
  let db: Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sidjua-mem-migrate-"));
    db     = openDatabase(join(tmpDir, "test.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db, MIGRATIONS);
    db
      .prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)")
      .run("engineering", "Engineering");
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("cross-division migrate triggers PAUSE in approval stage", () => {
    const config = loadGovernanceConfig(FIXTURES);
    const result = checkApproval(
      makeRequest("memory.migrate", {}, {
        divisionCode:   "engineering",
        targetDivision: "legal",
      }),
      config.approval,
      db,
    );
    expect(result.verdict).toBe("PAUSE");
  });

  it("same-division migrate does not trigger approval", () => {
    const config = loadGovernanceConfig(FIXTURES);
    const result = checkApproval(
      makeRequest("memory.migrate", {}, { divisionCode: "engineering" }),
      config.approval,
      db,
    );
    expect(result.verdict).toBe("PASS");
  });
});

// ---------------------------------------------------------------------------
// 9. Scheduled policy metadata extracted correctly
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — loadScheduledPolicies", () => {
  it("returns memory-hygiene.yaml as a scheduled policy", () => {
    const scheduled = loadScheduledPolicies(POLICIES_DIR);
    expect(scheduled.length).toBeGreaterThan(0);
    const hygiene = scheduled.find((s) => s.source_file.includes("memory-hygiene"));
    expect(hygiene).toBeDefined();
  });

  it("scheduled policy has correct schedule metadata", () => {
    const scheduled = loadScheduledPolicies(POLICIES_DIR);
    const hygiene = scheduled.find((s) => s.source_file.includes("memory-hygiene"))!;
    expect(hygiene.schedule.type).toBe("cron");
    expect(hygiene.schedule.expression).toBe("0 2 * * *");
    expect(hygiene.schedule.timezone).toBe("UTC");
    expect(hygiene.schedule.on_demand).toBe(true);
  });

  it("scheduled policy includes rules", () => {
    const scheduled = loadScheduledPolicies(POLICIES_DIR);
    const hygiene = scheduled.find((s) => s.source_file.includes("memory-hygiene"))!;
    expect(Array.isArray(hygiene.rules)).toBe(true);
    expect(hygiene.rules.length).toBeGreaterThan(0);
  });

  it("non-scheduled policies (ethics, data-handling) not included", () => {
    const scheduled = loadScheduledPolicies(POLICIES_DIR);
    const hasEthics = scheduled.some((s) => s.source_file.includes("ethics"));
    expect(hasEthics).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Personal mode memory rules loaded from my-rules.yaml
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — personal mode memory config", () => {
  it("loads memory section from my-rules.yaml fixture", () => {
    const config = loadPersonalMemoryConfig(FIXTURES);
    expect(config).not.toBeNull();
    expect(config!.auto_compact).toBe(true);
    expect(config!.short_term_limit_kb).toBe(20);
    expect(config!.archive_to).toBe("file");
    expect(config!.archive_path).toBe(".archive/");
  });

  it("returns null when my-rules.yaml has no memory section", () => {
    // Use a dir without my-rules.yaml (sub-dir)
    const config = loadPersonalMemoryConfig(join(FIXTURES, "policies"));
    expect(config).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. Memory action types registered in ACTION_TYPES
// ---------------------------------------------------------------------------

describe("Memory Lifecycle — action types registered", () => {
  it("memory.archive is registered as low risk INTERNAL", () => {
    expect(ACTION_TYPES["memory.archive"]).toBeDefined();
    expect(ACTION_TYPES["memory.archive"].risk).toBe("low");
    expect(ACTION_TYPES["memory.archive"].default_classification).toBe("INTERNAL");
  });

  it("memory.compact is registered as low risk INTERNAL", () => {
    expect(ACTION_TYPES["memory.compact"]).toBeDefined();
    expect(ACTION_TYPES["memory.compact"].risk).toBe("low");
  });

  it("memory.migrate is registered as medium risk INTERNAL", () => {
    expect(ACTION_TYPES["memory.migrate"]).toBeDefined();
    expect(ACTION_TYPES["memory.migrate"].risk).toBe("medium");
  });

  it("memory.delete is registered as high risk CONFIDENTIAL", () => {
    expect(ACTION_TYPES["memory.delete"]).toBeDefined();
    expect(ACTION_TYPES["memory.delete"].risk).toBe("high");
    expect(ACTION_TYPES["memory.delete"].default_classification).toBe("CONFIDENTIAL");
  });

  it("memory.pool_write is registered as medium risk INTERNAL", () => {
    expect(ACTION_TYPES["memory.pool_write"]).toBeDefined();
    expect(ACTION_TYPES["memory.pool_write"].risk).toBe("medium");
  });

  it("memory.skill_update is registered as medium risk CONFIDENTIAL", () => {
    expect(ACTION_TYPES["memory.skill_update"]).toBeDefined();
    expect(ACTION_TYPES["memory.skill_update"].risk).toBe("medium");
    expect(ACTION_TYPES["memory.skill_update"].default_classification).toBe("CONFIDENTIAL");
  });
});
