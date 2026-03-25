/**
 * Unit tests: PolicyDeployer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PolicyDeployer } from "../../../src/knowledge-pipeline/policy/policy-deployer.js";
import { runKnowledgeMigrations } from "../../../src/knowledge-pipeline/migration.js";
import { Logger } from "../../../src/utils/logger.js";
import type { PolicyRuleInput } from "../../../src/knowledge-pipeline/types.js";

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runKnowledgeMigrations(db);
  return db;
}

describe("PolicyDeployer", () => {
  let db: Database;
  let tempDir: string;
  let deployer: PolicyDeployer;
  const silentLogger = Logger.silent();

  beforeEach(() => {
    db = makeDb();
    tempDir = mkdtempSync(join(tmpdir(), "sidjua-policy-deployer-test-"));
    deployer = new PolicyDeployer(db, tempDir, silentLogger);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("deploy() inserts a row into policy_rules table", async () => {
    const rule: PolicyRuleInput = {
      source_file: "governance/test.yaml",
      rule_type: "forbidden",
      action_pattern: "delete originals/*",
      enforcement: "block",
      reason: "Originals must never be deleted",
    };

    await deployer.deploy(rule);

    const row = db
      .prepare("SELECT * FROM policy_rules WHERE action_pattern = ?")
      .get("delete originals/*") as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!["source_file"]).toBe("governance/test.yaml");
    expect(row!["active"]).toBe(1);
  });

  it("deploy() returns a DeployResult with rule_id > 0", async () => {
    const rule: PolicyRuleInput = {
      source_file: "governance/rules.yaml",
      rule_type: "approval",
      action_pattern: "send external/*",
      enforcement: "ask_first",
    };

    const result = await deployer.deploy(rule);

    expect(result.rule_id).toBeGreaterThan(0);
    expect(typeof result.file_written).toBe("string");
    expect(result.file_written.length).toBeGreaterThan(0);
  });

  it("written rule has correct rule_type, enforcement, and action_pattern", async () => {
    const rule: PolicyRuleInput = {
      source_file: "governance/export-policy.yaml",
      rule_type: "escalation",
      action_pattern: "export confidential/*",
      enforcement: "escalate",
      escalate_to: "security-team",
      reason: "Confidential export requires escalation",
    };

    const result = await deployer.deploy(rule);

    const row = db
      .prepare("SELECT * FROM policy_rules WHERE id = ?")
      .get(result.rule_id) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!["rule_type"]).toBe("escalation");
    expect(row!["enforcement"]).toBe("escalate");
    expect(row!["action_pattern"]).toBe("export confidential/*");
    expect(row!["escalate_to"]).toBe("security-team");
    expect(row!["reason"]).toBe("Confidential export requires escalation");
  });

  it("deploy() writes a YAML file to the governance directory", async () => {
    const rule: PolicyRuleInput = {
      source_file: "governance/forbidden.yaml",
      rule_type: "forbidden",
      action_pattern: "drop tables/*",
      enforcement: "block",
    };

    const result = await deployer.deploy(rule);

    expect(existsSync(result.file_written)).toBe(true);
    const content = readFileSync(result.file_written, "utf-8");
    expect(content).toContain("block");
    expect(content).toContain("drop tables/*");
  });

  it("deploy() creates intermediate directories if they do not exist", async () => {
    const rule: PolicyRuleInput = {
      source_file: "subdir/nested/policy.yaml",
      rule_type: "custom",
      action_pattern: "special.action",
      enforcement: "warn",
    };

    const result = await deployer.deploy(rule);

    expect(existsSync(result.file_written)).toBe(true);
    // The path should be inside tempDir/subdir/nested/
    expect(result.file_written).toContain(join(tempDir, "subdir", "nested"));
  });

  it("deploy() twice appends with a YAML separator in the file", async () => {
    const rule1: PolicyRuleInput = {
      source_file: "governance/combined.yaml",
      rule_type: "forbidden",
      action_pattern: "action.one",
      enforcement: "block",
    };
    const rule2: PolicyRuleInput = {
      source_file: "governance/combined.yaml",
      rule_type: "forbidden",
      action_pattern: "action.two",
      enforcement: "log",
    };

    const result1 = await deployer.deploy(rule1);
    await deployer.deploy(rule2);

    const content = readFileSync(result1.file_written, "utf-8");
    // Second deploy appends with "---" separator
    expect(content).toContain("---");
    expect(content).toContain("action.one");
    expect(content).toContain("action.two");
  });

  it("multiple deploy() calls produce incrementing rule_ids", async () => {
    const base: Omit<PolicyRuleInput, "action_pattern"> = {
      source_file: "governance/multi.yaml",
      rule_type: "forbidden",
      enforcement: "block",
    };

    const r1 = await deployer.deploy({ ...base, action_pattern: "act.1" });
    const r2 = await deployer.deploy({ ...base, action_pattern: "act.2" });
    const r3 = await deployer.deploy({ ...base, action_pattern: "act.3" });

    expect(r2.rule_id).toBe(r1.rule_id + 1);
    expect(r3.rule_id).toBe(r2.rule_id + 1);
  });

  it("deploy() with undefined action_pattern stores NULL in DB", async () => {
    const rule: PolicyRuleInput = {
      source_file: "governance/no-pattern.yaml",
      rule_type: "budget",
      enforcement: "warn",
    };

    const result = await deployer.deploy(rule);

    const row = db
      .prepare("SELECT * FROM policy_rules WHERE id = ?")
      .get(result.rule_id) as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!["action_pattern"]).toBeNull();
  });
});
