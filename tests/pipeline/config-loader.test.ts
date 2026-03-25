/**
 * Tests for src/pipeline/config-loader.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadGovernanceConfig,
  loadPersonalGovernanceConfig,
  DEFAULT_CLASSIFICATION_LEVELS,
  DEFAULT_AGENT_CLEARANCE,
} from "../../src/pipeline/config-loader.js";
import { GovernanceError } from "../../src/pipeline/errors.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const FIXTURES = join(import.meta.dirname ?? process.cwd(), "fixtures/governance");

let tmpDir: string;
let govDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-config-test-"));
  govDir = join(tmpDir, "governance");
  mkdirSync(join(govDir, "boundaries"),        { recursive: true });
  mkdirSync(join(govDir, "classification"),    { recursive: true });
  mkdirSync(join(govDir, "policies", "custom"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeYaml(relPath: string, content: string): void {
  writeFileSync(join(govDir, relPath), content, "utf-8");
}

// ---------------------------------------------------------------------------
// loadGovernanceConfig
// ---------------------------------------------------------------------------

describe("loadGovernanceConfig", () => {
  it("loads all fixture files successfully", () => {
    const config = loadGovernanceConfig(FIXTURES);
    expect(config.forbidden.length).toBeGreaterThan(0);
    expect(config.approval.length).toBeGreaterThan(0);
    expect(config.policies.length).toBeGreaterThan(0);
    expect(config.classification.levels.length).toBeGreaterThan(0);
    expect(config.loaded_at).toBeDefined();
    expect(typeof config.file_hashes).toBe("object");
  });

  it("forbidden rules are loaded correctly", () => {
    const config = loadGovernanceConfig(FIXTURES);
    const contractRule = config.forbidden.find((r) => r.action === "contract.sign");
    expect(contractRule).toBeDefined();
    expect(contractRule?.escalate_to).toBe("CEO");
  });

  it("approval workflows are loaded correctly", () => {
    const config = loadGovernanceConfig(FIXTURES);
    const deployWf = config.approval.find((w) => w.trigger.action === "code.deploy");
    expect(deployWf).toBeDefined();
    expect(deployWf?.require).toBe("division_head");
    expect(deployWf?.timeout_hours).toBe(24);
  });

  it("classification levels include FYEO", () => {
    const config = loadGovernanceConfig(FIXTURES);
    const fyeo = config.classification.levels.find((l) => l.code === "FYEO");
    expect(fyeo).toBeDefined();
    expect(fyeo?.rank).toBe(4);
  });

  it("division overrides loaded", () => {
    const config = loadGovernanceConfig(FIXTURES);
    expect(config.classification.division_overrides?.["legal"]?.["tier_2"]).toBe("SECRET");
  });

  it("policies from fixtures loaded", () => {
    const config = loadGovernanceConfig(FIXTURES);
    const allRuleIds = config.policies.flatMap((p) => p.rules.map((r) => r.id));
    expect(allRuleIds).toContain("no_deception");
    expect(allRuleIds).toContain("log_external_access");
  });

  it("uses defaults when files are missing", () => {
    // govDir has no files — should use defaults, not throw
    const config = loadGovernanceConfig(govDir);
    expect(config.forbidden).toEqual([]);
    expect(config.approval).toEqual([]);
    expect(config.classification.levels).toEqual(DEFAULT_CLASSIFICATION_LEVELS);
    expect(config.classification.agent_clearance).toEqual(DEFAULT_AGENT_CLEARANCE);
    expect(config.policies).toEqual([]);
  });

  it("throws GovernanceError on invalid YAML", () => {
    writeYaml("boundaries/forbidden-actions.yaml", "forbidden: [not: valid: yaml: |||");
    expect(() => loadGovernanceConfig(govDir)).toThrow(GovernanceError);
  });

  it("throws GovernanceError on invalid config (duplicate ranks)", () => {
    writeYaml("classification/levels.yaml", `
levels:
  - code: PUBLIC
    rank: 0
    description: "No restrictions"
  - code: INTERNAL
    rank: 0
    description: "Duplicate rank!"
`);
    expect(() => loadGovernanceConfig(govDir)).toThrow(GovernanceError);
  });

  it("loaded_at is an ISO 8601 timestamp", () => {
    const config = loadGovernanceConfig(FIXTURES);
    expect(() => new Date(config.loaded_at)).not.toThrow();
    expect(new Date(config.loaded_at).getFullYear()).toBeGreaterThan(2020);
  });

  it("loads custom policies from policies/ subdirectory", () => {
    writeYaml("policies/custom/my-policy.yaml", `
rules:
  - id: custom_rule
    description: "A custom policy rule"
    action_types: ["file.write"]
    check: "always"
    enforcement: soft
`);
    const config = loadGovernanceConfig(govDir);
    const allRuleIds = config.policies.flatMap((p) => p.rules.map((r) => r.id));
    expect(allRuleIds).toContain("custom_rule");
  });
});

// ---------------------------------------------------------------------------
// loadPersonalGovernanceConfig
// ---------------------------------------------------------------------------

describe("loadPersonalGovernanceConfig", () => {
  it("returns empty config when my-rules.yaml does not exist", () => {
    const config = loadPersonalGovernanceConfig(govDir);
    expect(config.forbidden).toEqual([]);
    expect(config.approval).toEqual([]);
    expect(config.policies).toEqual([]);
  });

  it("converts block rules to forbidden rules", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES);
    const rule = config.forbidden.find((r) => r.action === "contract.sign");
    expect(rule).toBeDefined();
    expect(rule?.escalate_to).toBe("SYSTEM_BLOCK");
  });

  it("converts ask_first rules to approval workflows", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES);
    const wf = config.approval.find((w) => w.trigger.action === "code.deploy");
    expect(wf).toBeDefined();
    expect(wf?.require).toBe("human");
  });

  it("uses personal classification defaults", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES);
    const codes = config.classification.levels.map((l) => l.code);
    expect(codes).toContain("PUBLIC");
    expect(codes).toContain("PRIVATE");
    expect(codes).not.toContain("SECRET");
    expect(codes).not.toContain("FYEO");
  });

  it("converts warn rules to soft policy rules", () => {
    const config = loadPersonalGovernanceConfig(FIXTURES);
    const allRules = config.policies.flatMap((p) => p.rules);
    const warnRule = allRules.find((r) => r.action_types.includes("web.fetch"));
    expect(warnRule).toBeDefined();
    expect(warnRule?.enforcement).toBe("soft");
  });
});
