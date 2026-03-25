/**
 * Integration tests: Policy test flow
 * Deploy rules → test scenarios → verify DB persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSQLite3 from "better-sqlite3";
import type { Database } from "better-sqlite3";
import { runKnowledgeMigrations } from "../../../src/knowledge-pipeline/migration.js";
import { PolicyDeployer } from "../../../src/knowledge-pipeline/policy/policy-deployer.js";
import { PolicyTester } from "../../../src/knowledge-pipeline/policy/policy-tester.js";
import type { PolicyRuleDB } from "../../../src/knowledge-pipeline/types.js";

function makeDb(): Database {
  const db = new BetterSQLite3(":memory:");
  runKnowledgeMigrations(db);
  return db;
}

function loadActiveRules(db: Database): PolicyRuleDB[] {
  return db
    .prepare<[], {
      id: number;
      source_file: string;
      rule_type: string;
      action_pattern: string | null;
      condition: string | null;
      enforcement: string;
      escalate_to: string | null;
      reason: string | null;
      active: number;
      created_at: string;
    }>("SELECT * FROM policy_rules WHERE active = 1")
    .all()
    .map((row) => ({
      id: row.id,
      source_file: row.source_file,
      rule_type: row.rule_type as PolicyRuleDB["rule_type"],
      action_pattern: row.action_pattern ?? undefined,
      condition: row.condition ?? undefined,
      enforcement: row.enforcement as PolicyRuleDB["enforcement"],
      escalate_to: row.escalate_to ?? undefined,
      reason: row.reason ?? undefined,
      active: row.active === 1,
      created_at: row.created_at,
    }));
}

describe("Policy test flow — integration", () => {
  let db: Database;
  let tempDir: string;
  let deployer: PolicyDeployer;
  const tester = new PolicyTester();

  beforeEach(() => {
    db = makeDb();
    tempDir = mkdtempSync(join(tmpdir(), "sidjua-policy-test-"));
    deployer = new PolicyDeployer(db, tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("add a rule and test scenario that matches it → BLOCK", async () => {
    await deployer.deploy({
      source_file: "forbidden.yaml",
      rule_type: "forbidden",
      action_pattern: "data.delete",
      enforcement: "block",
      reason: "Data deletion requires T1 approval",
    });

    const rules = loadActiveRules(db);
    expect(rules.length).toBeGreaterThan(0);

    const result = tester.test(
      {
        agent_id: "agent-test-1",
        division: "engineering",
        tier: 2,
        action: "data.delete",
      },
      rules,
    );

    expect(result.verdict).toBe("BLOCK");
    expect(result.triggered_rules.length).toBeGreaterThan(0);
    expect(result.blocking_rule).toBeDefined();
    expect(result.blocking_rule!.enforcement).toBe("block");
  });

  it("add a rule and test scenario that doesn't match → ALLOW", async () => {
    await deployer.deploy({
      source_file: "forbidden.yaml",
      rule_type: "forbidden",
      action_pattern: "data.delete",
      enforcement: "block",
      reason: "Data deletion requires T1 approval",
    });

    const rules = loadActiveRules(db);

    const result = tester.test(
      {
        agent_id: "agent-test-1",
        division: "engineering",
        tier: 2,
        action: "data.read", // different action — no matching rule
      },
      rules,
    );

    expect(result.verdict).toBe("ALLOW");
    expect(result.triggered_rules).toHaveLength(0);
    expect(result.blocking_rule).toBeUndefined();
  });

  it("deployed rule persists in policy_rules table", async () => {
    const deployResult = await deployer.deploy({
      source_file: "governance/approval.yaml",
      rule_type: "approval",
      action_pattern: "budget.*",
      enforcement: "ask_first",
      escalate_to: "cfo",
      reason: "Budget actions need CFO approval",
    });

    expect(deployResult.rule_id).toBeGreaterThan(0);
    expect(deployResult.file_written).toContain("governance");
    expect(deployResult.file_written).toContain("approval.yaml");

    // Verify it persisted in DB
    const rule = db
      .prepare<[number], {
        id: number;
        rule_type: string;
        action_pattern: string | null;
        enforcement: string;
        escalate_to: string | null;
        active: number;
      }>("SELECT * FROM policy_rules WHERE id = ?")
      .get(deployResult.rule_id);

    expect(rule).toBeDefined();
    expect(rule!.rule_type).toBe("approval");
    expect(rule!.action_pattern).toBe("budget.*");
    expect(rule!.enforcement).toBe("ask_first");
    expect(rule!.escalate_to).toBe("cfo");
    expect(rule!.active).toBe(1);
  });

  it("wildcard rule blocks matching sub-actions", async () => {
    await deployer.deploy({
      source_file: "forbidden.yaml",
      rule_type: "forbidden",
      action_pattern: "secrets.*",
      enforcement: "block",
      reason: "Secrets namespace is off-limits for T2 agents",
    });

    const rules = loadActiveRules(db);

    const resultRead = tester.test(
      { agent_id: "agent-1", division: "eng", tier: 2, action: "secrets.read" },
      rules,
    );
    const resultWrite = tester.test(
      { agent_id: "agent-1", division: "eng", tier: 2, action: "secrets.write" },
      rules,
    );
    const resultOther = tester.test(
      { agent_id: "agent-1", division: "eng", tier: 2, action: "data.read" },
      rules,
    );

    expect(resultRead.verdict).toBe("BLOCK");
    expect(resultWrite.verdict).toBe("BLOCK");
    expect(resultOther.verdict).toBe("ALLOW");
  });

  it("warn enforcement produces WARN verdict", async () => {
    await deployer.deploy({
      source_file: "warnings.yaml",
      rule_type: "custom",
      action_pattern: "api.external_call",
      enforcement: "warn",
      reason: "External API calls should be monitored",
    });

    const rules = loadActiveRules(db);
    const result = tester.test(
      { agent_id: "agent-1", division: "eng", tier: 2, action: "api.external_call" },
      rules,
    );

    expect(result.verdict).toBe("WARN");
    expect(result.triggered_rules).toHaveLength(1);
    expect(result.blocking_rule).toBeUndefined();
  });
});
