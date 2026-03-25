/**
 * Phase 10.5 — AgentValidator unit tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { AgentValidator } from "../../src/agent-lifecycle/agent-validator.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";
import { runMigrations } from "../../src/utils/db.js";
import type { AgentLifecycleDefinition } from "../../src/agent-lifecycle/types.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  // Run V1 initial migration (divisions table)
  db.exec(`
    CREATE TABLE IF NOT EXISTS divisions (
      code    TEXT PRIMARY KEY,
      name_en TEXT NOT NULL,
      active  INTEGER NOT NULL DEFAULT 1,
      scope   TEXT
    );
    CREATE TABLE IF NOT EXISTS _migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  runMigrations105(db);

  // Insert a test division
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en, active) VALUES (?, ?, 1)").run(
    "engineering",
    "Engineering",
  );

  // Insert a test provider
  db.prepare(
    "INSERT OR IGNORE INTO provider_configs (id, type, config_yaml, api_key_ref, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
  ).run(
    "anthropic",
    "anthropic",
    "type: anthropic\nmodels:\n  - id: claude-sonnet-4-5\n",
    "anthropic-api-key",
  );

  return db;
}

function makeSkillFile(dir: string, content?: string): string {
  const skillContent = content ?? `# Test Agent

## Identity
You are {agent_name} at {organization}. Supervisor: {reports_to}.

## Work Style
- Work carefully

## Decision Authority
- You MAY: do tasks
- You MAY NOT: delete data
- ESCALATE: security issues

## Quality Standards
- Accuracy over speed

## Supervision Expectations
Write result to result file and include management summary.

## Error Handling
Retry once then escalate.

## Communication Style
Be concise.
`;

  mkdirSync(dir, { recursive: true });
  const path = join(dir, "test-skill.md");
  writeFileSync(path, skillContent, "utf-8");
  return path;
}

const VALID_DEF = (skillPath: string): AgentLifecycleDefinition => ({
  id: "test-agent",
  name: "Test Agent",
  tier: 3,
  division: "engineering",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  skill: skillPath,
  capabilities: ["coding", "testing"],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentValidator", () => {
  let db: ReturnType<typeof makeDb>;
  let validator: AgentValidator;
  let tmpDir: string;
  let skillPath: string;

  beforeEach(() => {
    db = makeDb();
    validator = new AgentValidator(db);
    tmpDir = join(tmpdir(), `sidjua-test-${Date.now()}`);
    skillPath = makeSkillFile(tmpDir);
  });

  // ── Check 1: Schema ────────────────────────────────────────────────────────

  it("check 1: passes valid schema", async () => {
    const result = await validator.validate(VALID_DEF(skillPath));
    expect(result.checks_passed).toContain("schema");
    expect(result.checks_failed).not.toContain("schema");
  });

  it("check 1: fails when id is missing", async () => {
    const def = { ...VALID_DEF(skillPath), id: "" };
    const result = await validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.checks_failed).toContain("schema");
  });

  it("check 1: fails when tier is out of range", async () => {
    const def = { ...VALID_DEF(skillPath), tier: 0 };
    const result = await validator.validate(def);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("tier"))).toBe(true);
  });

  it("check 1: passes when skill is empty — skill is optional", async () => {
    const def = { ...VALID_DEF(skillPath), skill: "" };
    const result = await validator.validate(def);
    expect(result.valid).toBe(true);
    expect(result.checks_failed).not.toContain("schema");
  });

  // ── Check 2: Provider ──────────────────────────────────────────────────────

  it("check 2: passes when provider is registered", async () => {
    const result = await validator.validate(VALID_DEF(skillPath));
    expect(result.checks_passed).toContain("provider");
  });

  it("check 2: fails when provider is not registered", async () => {
    const def = { ...VALID_DEF(skillPath), provider: "unknown-llm" };
    const result = await validator.validate(def);
    expect(result.checks_failed).toContain("provider");
  });

  it("check 2: passes with mixed-case provider (case-insensitive)", async () => {
    const def = { ...VALID_DEF(skillPath), provider: "Anthropic" };
    const result = await validator.validate(def);
    expect(result.checks_passed).toContain("provider");
  });

  it("check 2: passes with uppercase provider", async () => {
    const def = { ...VALID_DEF(skillPath), provider: "ANTHROPIC" };
    const result = await validator.validate(def);
    expect(result.checks_passed).toContain("provider");
  });

  it("check 2: error message suggests sidjua provider add", async () => {
    const def = { ...VALID_DEF(skillPath), provider: "unknown-llm" };
    const result = await validator.validate(def);
    expect(result.errors.some((e) => e.includes("sidjua provider add"))).toBe(true);
  });

  // ── Check 3: Model ─────────────────────────────────────────────────────────

  it("check 3: passes when model is in provider config", async () => {
    const result = await validator.validate(VALID_DEF(skillPath));
    expect(result.checks_passed).toContain("model");
  });

  it("check 3: warns when model not in config yaml", async () => {
    const def = { ...VALID_DEF(skillPath), model: "claude-opus-9000" };
    const result = await validator.validate(def);
    // Should warn but not fail (model list may be outdated)
    expect(result.checks_passed).toContain("model");
    expect(result.warnings.some((w) => w.includes("claude-opus-9000"))).toBe(true);
  });

  // ── Check 4: Division ──────────────────────────────────────────────────────

  it("check 4: passes when division exists", async () => {
    const result = await validator.validate(VALID_DEF(skillPath));
    expect(result.checks_passed).toContain("division");
  });

  it("check 4: fails when division does not exist", async () => {
    const def = { ...VALID_DEF(skillPath), division: "nonexistent-div" };
    const result = await validator.validate(def);
    expect(result.checks_failed).toContain("division");
  });

  // ── Check 6: Tier hierarchy ────────────────────────────────────────────────

  it("check 6: passes when no reports_to", async () => {
    const result = await validator.validate(VALID_DEF(skillPath));
    expect(result.checks_passed).toContain("tier");
  });

  // ── Check 7: Skill file ────────────────────────────────────────────────────

  it("check 7: passes when skill file is valid (relative path within workDir)", async () => {
    // Use a relative skill path so resolveSkillPath(workDir, relPath) can validate it
    const relativeSkill = "test-skill.md"; // file exists at tmpDir/test-skill.md
    const result = await validator.validate(
      { ...VALID_DEF(skillPath), skill: relativeSkill },
      { workDir: tmpDir },
    );
    expect(result.checks_passed).toContain("skill");
  });

  it("check 7: fails when skill file does not exist", async () => {
    const def = { ...VALID_DEF(skillPath), skill: "nonexistent-skill.md" };
    const result = await validator.validate(def, { workDir: tmpDir });
    expect(result.checks_failed).toContain("skill");
  });

  it("check 7: fails when skill path is absolute (SEC-010)", async () => {
    const def = { ...VALID_DEF(skillPath), skill: "/nonexistent/path/skill.md" };
    const result = await validator.validate(def, { workDir: tmpDir });
    expect(result.checks_failed).toContain("skill");
  });

  it("check 7: passes when skill is not provided (optional)", async () => {
    const def = { ...VALID_DEF(skillPath), skill: undefined };
    const result = await validator.validate(def);
    expect(result.checks_passed).toContain("skill");
    expect(result.checks_failed).not.toContain("skill");
  });

  it("check 7: skips file check when skill is empty string", async () => {
    const def = { ...VALID_DEF(skillPath), skill: "" };
    const result = await validator.validate(def);
    expect(result.checks_passed).toContain("skill");
    expect(result.checks_failed).not.toContain("skill");
  });

  // ── Check 8: Capabilities ─────────────────────────────────────────────────

  it("check 8: rejects strategic-planning capability for T3", async () => {
    const def = { ...VALID_DEF(skillPath), tier: 3, capabilities: ["strategic-planning"] };
    const result = await validator.validate(def);
    expect(result.checks_failed).toContain("capability");
  });

  it("check 8: allows strategic-planning for T1", async () => {
    const def = { ...VALID_DEF(skillPath), tier: 1, capabilities: ["strategic-planning"] };
    const result = await validator.validate(def);
    expect(result.checks_passed).toContain("capability");
  });

  // ── Check 9: Classification ────────────────────────────────────────────────

  it("check 9: passes valid classification", async () => {
    const def = { ...VALID_DEF(skillPath), max_classification: "CONFIDENTIAL" };
    const result = await validator.validate(def);
    expect(result.checks_passed).toContain("classification");
  });

  it("check 9: fails unknown classification", async () => {
    const def = { ...VALID_DEF(skillPath), max_classification: "ULTRA-SECRET" };
    const result = await validator.validate(def);
    expect(result.checks_failed).toContain("classification");
  });

  // ── Check 10/11: Tool/Knowledge stubs ────────────────────────────────────

  it("check 10: warns when tools referenced (Phase 10.7 stub)", async () => {
    const def = { ...VALID_DEF(skillPath), tools: [{ tool: "mac-studio-mcp", permissions: ["filesystem"] }] };
    const result = await validator.validate(def);
    expect(result.warnings.some((w) => w.includes("Phase 10.7"))).toBe(true);
    expect(result.checks_passed).toContain("tool");
  });

  it("check 11: warns when knowledge referenced (Phase 10.6 stub)", async () => {
    const def = { ...VALID_DEF(skillPath), knowledge: [{ collection: "manual" }] };
    const result = await validator.validate(def);
    expect(result.warnings.some((w) => w.includes("Phase 10.6"))).toBe(true);
    expect(result.checks_passed).toContain("knowledge");
  });

  // ── Check 12: Circular dependency ─────────────────────────────────────────

  it("check 12: fails when agent reports to itself", async () => {
    const def = { ...VALID_DEF(skillPath), reports_to: "test-agent" };
    const result = await validator.validate(def);
    expect(result.checks_failed).toContain("circular-dep");
  });

  it("check 12: passes when reports_to is different agent", async () => {
    const def = { ...VALID_DEF(skillPath), reports_to: "opus-ceo" };
    const result = await validator.validate(def);
    expect(result.checks_passed).toContain("circular-dep");
  });

  // ── Overall ───────────────────────────────────────────────────────────────

  it("returns all 12 checks in result", async () => {
    const def = { ...VALID_DEF(skillPath), tools: [], knowledge: [] };
    const result = await validator.validate(def, { workDir: tmpDir });
    const allChecks = [...result.checks_passed, ...result.checks_failed];
    const expectedChecks = [
      "schema", "provider", "model", "division", "budget", "tier",
      "skill", "capability", "classification", "tool", "knowledge", "circular-dep",
    ];
    for (const check of expectedChecks) {
      expect(allChecks).toContain(check);
    }
  });
});
