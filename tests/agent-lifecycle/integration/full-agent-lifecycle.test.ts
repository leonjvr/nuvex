/**
 * Phase 10.5 — Integration: Full agent lifecycle
 *
 * create → start → record cost → check budget → stop → delete
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { AgentRegistry } from "../../../src/agent-lifecycle/agent-registry.js";
import { AgentValidator } from "../../../src/agent-lifecycle/agent-validator.js";
import { BudgetResolver } from "../../../src/agent-lifecycle/budget-resolver.js";
import { BudgetTracker } from "../../../src/agent-lifecycle/budget-tracker.js";
import { HotReconfigure } from "../../../src/agent-lifecycle/hot-reconfigure.js";
import { runMigrations105 } from "../../../src/agent-lifecycle/migration.js";
import type { AgentLifecycleDefinition } from "../../../src/agent-lifecycle/types.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY, applied_at TEXT);
    CREATE TABLE IF NOT EXISTS divisions (code TEXT PRIMARY KEY, name_en TEXT, active INTEGER DEFAULT 1, scope TEXT);
    CREATE TABLE IF NOT EXISTS cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      division_code TEXT, agent_id TEXT, provider TEXT, model TEXT,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0, task_id TEXT
    );
    CREATE TABLE IF NOT EXISTS cost_budgets (
      division_code TEXT PRIMARY KEY, monthly_limit_usd REAL, daily_limit_usd REAL,
      alert_threshold_percent REAL DEFAULT 80.0
    );
  `);
  runMigrations105(db);
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en) VALUES (?, ?)").run("content", "Content");
  db.prepare("INSERT OR IGNORE INTO provider_configs (id, type, config_yaml, api_key_ref, created_at) VALUES (?, ?, ?, ?, datetime('now'))").run(
    "anthropic", "anthropic", "type: anthropic\nmodels:\n  - id: claude-sonnet-4-5\n", "anthropic-key",
  );
  return db;
}

function makeSkillFile(tmpDir: string): string {
  mkdirSync(tmpDir, { recursive: true });
  const path = join(tmpDir, "skill.md");
  writeFileSync(path, `# Video Editor

## Identity
You are {agent_name} at {organization}. Supervisor: {reports_to}.

## Work Style
- Review footage first

## Decision Authority
- You MAY: edit clips
- You MAY NOT: delete originals
- ESCALATE: brand issues

## Quality Standards
- 1080p minimum

## Supervision Expectations
Write result file. Include management summary.

## Error Handling
Retry once.

## Communication Style
Use video terms.
`, "utf-8");
  return path;
}

const AGENT_DEF = (skillPath: string): AgentLifecycleDefinition => ({
  id: "video-editor",
  name: "Video Editor",
  tier: 3,
  division: "content",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  skill: skillPath,
  capabilities: ["video-editing", "color-grading"],
  budget: { per_task_usd: 5.00, per_hour_usd: 10.00, per_month_usd: 200.00 },
  created_by: "goetz",
});

describe("Integration: Full Agent Lifecycle", () => {
  let db: ReturnType<typeof makeTestDb>;
  let registry: AgentRegistry;
  let resolver: BudgetResolver;
  let tracker: BudgetTracker;
  let reconfigurer: HotReconfigure;
  let validator: AgentValidator;
  let tmpDir: string;
  let skillPath: string;

  beforeEach(() => {
    db = makeTestDb();
    registry = new AgentRegistry(db);
    resolver = new BudgetResolver(db);
    tracker = new BudgetTracker(db);
    reconfigurer = new HotReconfigure();
    validator = new AgentValidator(db);
    tmpDir = join(tmpdir(), `lifecycle-test-${Date.now()}`);
    skillPath = makeSkillFile(tmpDir);
  });

  it("create → start → stop lifecycle", async () => {
    const def = AGENT_DEF(skillPath);

    // Create
    const row = registry.create(def);
    expect(row.status).toBe("stopped");

    // Start
    registry.setStatus("video-editor", "active");
    expect(registry.getById("video-editor")?.status).toBe("active");

    // Stop
    registry.setStatus("video-editor", "stopped");
    expect(registry.getById("video-editor")?.status).toBe("stopped");
  });

  it("budget cascade: action blocked when over task limit", () => {
    registry.create(AGENT_DEF(skillPath));

    // $6 estimate > $5 per-task limit
    const result = resolver.resolve("video-editor", "content", 6.00);
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toBe("task");
  });

  it("budget cascade: action allowed within limits", () => {
    registry.create(AGENT_DEF(skillPath));

    const result = resolver.resolve("video-editor", "content", 1.00);
    expect(result.allowed).toBe(true);
  });

  it("cost tracking reflects actual spending", () => {
    registry.create(AGENT_DEF(skillPath));

    // Insert directly into cost_ledger (simulates actual LLM call costs)
    // getAgentMonthlySpend reads from cost_ledger, not agent_budgets
    db.prepare("INSERT INTO cost_ledger (division_code, agent_id, provider, model, cost_usd) VALUES (?, ?, ?, ?, ?)").run("content", "video-editor", "anthropic", "sonnet", 2.50);
    db.prepare("INSERT INTO cost_ledger (division_code, agent_id, provider, model, cost_usd) VALUES (?, ?, ?, ?, ?)").run("content", "video-editor", "anthropic", "sonnet", 1.75);

    const spend = tracker.getAgentMonthlySpend("video-editor");
    expect(spend).toBeCloseTo(4.25);
  });

  it("hot-reconfigure detects model upgrade without restart", () => {
    const def = AGENT_DEF(skillPath);
    registry.create(def);

    const { result } = reconfigurer.applyPatch(def, { model: "claude-opus-4-5" });
    expect(result.config_hash_changed).toBe(true);
    expect(result.requires_restart).toBe(false);
    expect(result.immediate_fields).toContain("model");
  });

  it("hot-reconfigure detects division change requires restart", () => {
    const def = AGENT_DEF(skillPath);
    registry.create(def);

    const { result } = reconfigurer.applyPatch(def, { division: "engineering" });
    expect(result.requires_restart).toBe(true);
    expect(result.restart_fields).toContain("division");
  });

  it("delete removes agent and cleans up budgets", () => {
    registry.create(AGENT_DEF(skillPath));
    resolver.recordAgentCost("video-editor", 5.00);

    registry.delete("video-editor");
    expect(registry.getById("video-editor")).toBeUndefined();
  });

  it("delete with keepHistory preserves agent row", () => {
    registry.create(AGENT_DEF(skillPath));
    registry.delete("video-editor", true);

    const row = registry.getById("video-editor");
    expect(row).toBeDefined();
    expect(row?.status).toBe("deleted");
  });

  it("budget alert triggers at 80% consumption", () => {
    registry.create(AGENT_DEF(skillPath));

    // $175 of $200 = 87.5%
    db.prepare("INSERT INTO cost_ledger (division_code, agent_id, provider, model, cost_usd) VALUES (?, ?, 'anthropic', 'sonnet', ?)").run(
      "content", "video-editor", 175.00,
    );

    const alert = tracker.checkAgentBudgetAlert("video-editor", 200.00);
    expect(alert).not.toBeNull();
    expect(alert?.level).toBe("warning");
    expect(alert?.percent_used).toBeGreaterThan(80);
  });

  it("validation fails when division does not exist", async () => {
    const def = { ...AGENT_DEF(skillPath), division: "no-such-division" };
    const result = await validator.validate(def, { workDir: tmpDir });
    expect(result.valid).toBe(false);
    expect(result.checks_failed).toContain("division");
  });

  it("registry.toRuntimeDefinition is compatible with Phase 8", () => {
    const def = AGENT_DEF(skillPath);
    const runtime = registry.toRuntimeDefinition(def);

    // Must match Phase 8 AgentDefinition structure
    expect(runtime.id).toBe("video-editor");
    expect(runtime.tier).toBe(3);
    expect(typeof runtime.checkpoint_interval_ms).toBe("number");
    expect(typeof runtime.heartbeat_interval_ms).toBe("number");
    expect(typeof runtime.ttl_default_seconds).toBe("number");
    expect(Array.isArray(runtime.capabilities)).toBe(true);
  });
});
