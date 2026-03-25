// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/governance/rule-loader.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir }                                        from "node:os";
import { join }                                          from "node:path";
import {
  loadGovernanceRuleset,
  loadRulesetVersion,
  loadVersionInfo,
}                                                        from "../../../src/core/governance/rule-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-ruleloader-test-"));
}

function writeYaml(dir: string, filename: string, content: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, "utf-8");
}

const SYSTEM_GOVERNANCE_DIR = join(process.cwd(), "system", "governance");

// ---------------------------------------------------------------------------
// loadRulesetVersion
// ---------------------------------------------------------------------------

describe("loadRulesetVersion", () => {
  it("returns 'unknown' when VERSION file does not exist", () => {
    const tmp = makeTempDir();
    const result = loadRulesetVersion(tmp);
    rmSync(tmp, { recursive: true, force: true });
    expect(result).toBe("unknown");
  });

  it("parses ruleset_version from VERSION file", () => {
    const tmp = makeTempDir();
    writeFileSync(join(tmp, "VERSION"), JSON.stringify({ ruleset_version: "2.5" }));
    const result = loadRulesetVersion(tmp);
    rmSync(tmp, { recursive: true, force: true });
    expect(result).toBe("2.5");
  });

  it("returns 'unknown' for malformed VERSION file", () => {
    const tmp = makeTempDir();
    writeFileSync(join(tmp, "VERSION"), "not-json{{{");
    const result = loadRulesetVersion(tmp);
    rmSync(tmp, { recursive: true, force: true });
    expect(result).toBe("unknown");
  });

  it("reads from actual system/governance/VERSION", () => {
    const version = loadRulesetVersion(SYSTEM_GOVERNANCE_DIR);
    expect(version).toBe("1.0");
  });
});

// ---------------------------------------------------------------------------
// loadVersionInfo
// ---------------------------------------------------------------------------

describe("loadVersionInfo", () => {
  it("returns null when file does not exist", () => {
    const tmp = makeTempDir();
    const result = loadVersionInfo(tmp);
    rmSync(tmp, { recursive: true, force: true });
    expect(result).toBeNull();
  });

  it("returns full version info object", () => {
    const tmp = makeTempDir();
    const info = {
      ruleset_version: "1.0",
      compatible_sidjua_min: "0.10.0",
      compatible_sidjua_max: "0.x.x",
      released: "2026-03-14T00:00:00Z",
      rules_count: 10,
      changelog: "Initial",
    };
    writeFileSync(join(tmp, "VERSION"), JSON.stringify(info));
    const result = loadVersionInfo(tmp);
    rmSync(tmp, { recursive: true, force: true });
    expect(result).not.toBeNull();
    expect(result?.ruleset_version).toBe("1.0");
    expect(result?.rules_count).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// loadGovernanceRuleset — system rules
// ---------------------------------------------------------------------------

describe("loadGovernanceRuleset — system rules from real files", () => {
  it("loads 10 system rules from system/governance/", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, "/nonexistent/data");
    expect(ruleset.systemRules.length).toBe(10);
  });

  it("all system rules have source='system'", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, "/nonexistent/data");
    for (const rule of ruleset.systemRules) {
      expect(rule.source).toBe("system");
    }
  });

  it("all system rules have enforcement='mandatory'", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, "/nonexistent/data");
    for (const rule of ruleset.systemRules) {
      expect(rule.enforcement).toBe("mandatory");
    }
  });

  it("system rules include expected IDs", () => {
    const ruleset  = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, "/nonexistent/data");
    const ids      = ruleset.systemRules.map((r) => r.id);
    expect(ids).toContain("SYS-SEC-001");
    expect(ids).toContain("SYS-SEC-007");
    expect(ids).toContain("SYS-GOV-001");
    expect(ids).toContain("SYS-GOV-002");
  });

  it("severity levels are parsed correctly", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, "/nonexistent/data");
    const sec001  = ruleset.systemRules.find((r) => r.id === "SYS-SEC-001");
    expect(sec001?.severity).toBe("critical");
    const sec006  = ruleset.systemRules.find((r) => r.id === "SYS-SEC-006");
    expect(sec006?.severity).toBe("high");
  });

  it("category field is preserved", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, "/nonexistent/data");
    const sec001  = ruleset.systemRules.find((r) => r.id === "SYS-SEC-001");
    expect(sec001?.category).toBe("credential-security");
  });

  it("ruleset version is '1.0' from real VERSION file", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, "/nonexistent/data");
    expect(ruleset.rulesetVersion).toBe("1.0");
  });

  it("empty user rules dir → only system rules active, no conflicts", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, "/nonexistent/data");
    expect(ruleset.conflicts).toHaveLength(0);
    expect(ruleset.userRules).toHaveLength(0);
    expect(ruleset.mergedRules).toHaveLength(ruleset.systemRules.length);
  });
});

// ---------------------------------------------------------------------------
// loadGovernanceRuleset — user rules
// ---------------------------------------------------------------------------

describe("loadGovernanceRuleset — user rule loading and merging", () => {
  let tmp: string;
  let policiesDir: string;

  beforeEach(() => {
    tmp = makeTempDir();
    policiesDir = join(tmp, "policies");
    mkdirSync(policiesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("loads user rules from data/governance/policies/", () => {
    writeYaml(policiesDir, "custom-rules.yaml", `
rules:
  - id: USR-FIN-001
    name: Purchase approval threshold
    description: Purchases over $100 need approval
    enforcement: mandatory
    severity: high
    category: financial
`);
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp);
    const userRule = ruleset.userRules.find((r) => r.id === "USR-FIN-001");
    expect(userRule).toBeDefined();
    expect(userRule?.source).toBe("user");
    expect(userRule?.enforcement).toBe("mandatory");
  });

  it("loads user rules from data/governance/policies/custom/", () => {
    const customDir = join(policiesDir, "custom");
    mkdirSync(customDir, { recursive: true });
    writeYaml(customDir, "extra.yaml", `
rules:
  - id: USR-EXTRA-001
    name: Extra rule
    description: An extra rule
    enforcement: advisory
    severity: low
    category: general
`);
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp);
    const found = ruleset.userRules.find((r) => r.id === "USR-EXTRA-001");
    expect(found).toBeDefined();
    expect(found?.source).toBe("user");
  });

  it("mergedRules = systemRules + validUserRules", () => {
    writeYaml(policiesDir, "rules.yaml", `
rules:
  - id: USR-NEW-001
    name: New rule
    description: A new rule
    enforcement: mandatory
    severity: medium
    category: custom
`);
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp);
    expect(ruleset.mergedRules.length).toBe(ruleset.systemRules.length + ruleset.userRules.length);
    const newRule = ruleset.mergedRules.find((r) => r.id === "USR-NEW-001");
    expect(newRule).toBeDefined();
  });

  it("CONFLICT: user rule with same ID as system rule → system wins", () => {
    writeYaml(policiesDir, "bad.yaml", `
rules:
  - id: SYS-SEC-001
    name: Override attempt
    description: Trying to override
    enforcement: advisory
    severity: low
    category: credential-security
`);
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp);
    expect(ruleset.conflicts).toHaveLength(1);
    expect(ruleset.conflicts[0]?.userRule.id).toBe("SYS-SEC-001");
    expect(ruleset.conflicts[0]?.reason).toContain("system rule takes precedence");
    // Conflict excluded from userRules and mergedRules
    const inUser = ruleset.userRules.find((r) => r.id === "SYS-SEC-001" && r.source === "user");
    expect(inUser).toBeUndefined();
  });

  it("CONFLICT: user rule with enforcement=advisory in mandatory category → rejected", () => {
    writeYaml(policiesDir, "weak.yaml", `
rules:
  - id: USR-CRED-WEAK
    name: Weak credential rule
    description: This tries to add an advisory rule in a mandatory category
    enforcement: advisory
    severity: low
    category: credential-security
`);
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp);
    expect(ruleset.conflicts).toHaveLength(1);
    expect(ruleset.conflicts[0]?.userRule.id).toBe("USR-CRED-WEAK");
    expect(ruleset.conflicts[0]?.reason).toContain("advisory");
  });

  it("user rule with mandatory enforcement in non-mandatory category → accepted", () => {
    writeYaml(policiesDir, "ok.yaml", `
rules:
  - id: USR-CUSTOM-001
    name: Custom mandatory rule
    description: New category not in system
    enforcement: mandatory
    severity: high
    category: my-new-category
`);
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp);
    expect(ruleset.conflicts).toHaveLength(0);
    const rule = ruleset.userRules.find((r) => r.id === "USR-CUSTOM-001");
    expect(rule).toBeDefined();
    expect(rule?.enforcement).toBe("mandatory");
  });

  it("malformed YAML file → skips file gracefully (no exception thrown)", () => {
    writeYaml(policiesDir, "broken.yaml", "rules: [[[invalid yaml{{{{");
    expect(() => loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp)).not.toThrow();
  });

  it("conflict list populated correctly with multiple conflicts", () => {
    writeYaml(policiesDir, "multi-conflict.yaml", `
rules:
  - id: SYS-SEC-001
    name: Conflict 1
    description: x
    enforcement: advisory
    severity: low
    category: credential-security
  - id: SYS-GOV-001
    name: Conflict 2
    description: y
    enforcement: advisory
    severity: low
    category: system-integrity
`);
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp);
    // Both IDs match system rules → both are conflicts
    expect(ruleset.conflicts.length).toBeGreaterThanOrEqual(2);
  });

  it("multiple YAML files in policies/ all loaded", () => {
    writeYaml(policiesDir, "file1.yaml", `
rules:
  - id: USR-A-001
    name: Rule A
    description: First rule
    enforcement: mandatory
    severity: high
    category: custom-a
`);
    writeYaml(policiesDir, "file2.yaml", `
rules:
  - id: USR-B-001
    name: Rule B
    description: Second rule
    enforcement: mandatory
    severity: medium
    category: custom-b
`);
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp);
    const ids = ruleset.userRules.map((r) => r.id);
    expect(ids).toContain("USR-A-001");
    expect(ids).toContain("USR-B-001");
  });
});

// ---------------------------------------------------------------------------
// loadGovernanceRuleset — edge cases
// ---------------------------------------------------------------------------

describe("loadGovernanceRuleset — edge cases", () => {
  it("handles empty user governance dir", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, "/nonexistent-data-dir");
    expect(ruleset.userRules).toHaveLength(0);
    expect(ruleset.systemRules.length).toBeGreaterThan(0);
  });

  it("rules with missing optional fields get defaults", () => {
    const tmp = makeTempDir();
    const policiesDir = join(tmp, "policies");
    mkdirSync(policiesDir, { recursive: true });
    writeFileSync(join(policiesDir, "minimal.yaml"), `
rules:
  - id: USR-MINIMAL-001
    name: Minimal rule
`);
    const ruleset = loadGovernanceRuleset(SYSTEM_GOVERNANCE_DIR, tmp);
    rmSync(tmp, { recursive: true, force: true });
    const rule = ruleset.userRules.find((r) => r.id === "USR-MINIMAL-001");
    expect(rule?.enforcement).toBe("advisory");   // default
    expect(rule?.severity).toBe("medium");          // default
    expect(rule?.category).toBe("general");         // default
  });
});
