/**
 * Tests for personal mode (my-rules.yaml → GovernanceConfig conversion)
 *
 * Checklist items covered:
 *   ✓ Personal mode loads from my-rules.yaml
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, runMigrations } from "../../src/utils/db.js";
import { MIGRATIONS } from "../../src/apply/database.js";
import { loadPersonalGovernanceConfig } from "../../src/pipeline/config-loader.js";
import { evaluateAction } from "../../src/pipeline/index.js";
import type { ActionRequest } from "../../src/types/pipeline.js";
import type { Database } from "../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_BASE = join(import.meta.dirname ?? process.cwd(), "fixtures/governance");

function makeRequest(type: string, overrides: Partial<ActionRequest["action"]> = {}): ActionRequest {
  return {
    request_id:    "req-personal-001",
    timestamp:     "2026-02-27T00:00:00Z",
    agent_id:      "personal-agent",
    agent_tier:    2,
    division_code: "personal",
    action: {
      type,
      target:      "/home/user/file.txt",
      description: "personal action",
      ...overrides,
    },
    context: { division_code: "personal", session_id: "sess-personal" },
  };
}

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-personal-test-"));
  db     = openDatabase(join(tmpDir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db, MIGRATIONS);
  db.prepare("INSERT OR IGNORE INTO divisions (code, name_en, active, required) VALUES (?, ?, 1, 0)").run("personal", "Personal");
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Personal mode — loadPersonalGovernanceConfig", () => {
  it("block rules from my-rules.yaml become forbidden rules", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES_BASE);
    const forbidden = config.forbidden.map((r) => r.action);
    expect(forbidden).toContain("contract.sign");
  });

  it("ask_first rules become approval workflows with human approver", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES_BASE);
    const wf = config.approval.find((w) => w.trigger.action === "code.deploy");
    expect(wf?.require).toBe("human");
  });

  it("warn rules become soft policy rules", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES_BASE);
    const rules = config.policies.flatMap((p) => p.rules);
    const warnRule = rules.find((r) => r.action_types.includes("web.fetch"));
    expect(warnRule).toBeDefined();
    expect(warnRule?.enforcement).toBe("soft");
  });

  it("personal classification has only PUBLIC and PRIVATE levels", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES_BASE);
    const codes = config.classification.levels.map((l) => l.code);
    expect(codes).toContain("PUBLIC");
    expect(codes).toContain("PRIVATE");
    expect(codes).not.toContain("CONFIDENTIAL");
    expect(codes).not.toContain("SECRET");
    expect(codes).not.toContain("FYEO");
  });

  it("personal mode no-op: returns empty config when my-rules.yaml absent", () => {
    const tmpGov = join(tmpDir, "empty-gov");
    mkdirSync(tmpGov);
    const config = loadPersonalGovernanceConfig(tmpGov);
    expect(config.forbidden).toEqual([]);
    expect(config.approval).toEqual([]);
    expect(config.policies).toEqual([]);
  });
});

describe("Personal mode pipeline integration", () => {
  it("BLOCK: contract.sign blocked by my-rules.yaml block rule", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES_BASE);
    const result = evaluateAction(
      makeRequest("contract.sign"),
      config,
      db,
    );
    expect(result.verdict).toBe("BLOCK");
    expect(result.blocking_stage).toBe("forbidden");
  });

  it("PAUSE: code.deploy paused by my-rules.yaml ask_first rule", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES_BASE);
    const result = evaluateAction(
      makeRequest("code.deploy"),
      config,
      db,
    );
    expect(result.verdict).toBe("PAUSE");
  });

  it("ALLOW: file.read passes through personal mode", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES_BASE);
    const result = evaluateAction(
      makeRequest("file.read"),
      config,
      db,
    );
    expect(result.verdict).toBe("ALLOW");
  });

  it("audit trail written for personal mode verdicts", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES_BASE);
    evaluateAction(makeRequest("file.read"), config, db);
    const count = (db.prepare("SELECT COUNT(*) as n FROM audit_trail").get() as { n: number }).n;
    expect(count).toBe(1);
  });
});

describe("Personal mode — manual my-rules.yaml", () => {
  it("loads rules from a custom my-rules.yaml file", () => {
    const govDir = join(tmpDir, "personal-gov");
    mkdirSync(govDir);
    writeFileSync(join(govDir, "my-rules.yaml"), `
my_rules:
  - action: "data.delete"
    enforce: block
    reason: "Never delete data"
  - action: "api.call"
    enforce: ask_first
    reason: "Confirm API calls"
  - action: "web.fetch"
    enforce: warn
    reason: "Log web fetches"
`);

    const config = loadPersonalGovernanceConfig(govDir);
    expect(config.forbidden.find((r) => r.action === "data.delete")).toBeDefined();
    expect(config.approval.find((w) => w.trigger.action === "api.call")).toBeDefined();
    expect(config.policies.flatMap((p) => p.rules).find((r) => r.action_types.includes("web.fetch"))).toBeDefined();
  });
});
