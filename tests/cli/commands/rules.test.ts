// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/cli/commands/rules.ts — `sidjua rules` command.
 * Tests are run against the real system/governance directory.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command }  from "commander";
import { join }     from "node:path";
import {
  loadGovernanceRuleset,
  loadVersionInfo,
  type GovernanceRule,
}                   from "../../../src/core/governance/rule-loader.js";

const SYSTEM_GOV_DIR  = join(process.cwd(), "system", "governance");
const NO_USER_DIR     = "/nonexistent-data-dir";

// ---------------------------------------------------------------------------
// Helpers: run the CLI action logic directly via rule-loader (not full CLI)
// ---------------------------------------------------------------------------

function listRules(filter: "all" | "system" | "user"): GovernanceRule[] {
  const ruleset = loadGovernanceRuleset(SYSTEM_GOV_DIR, NO_USER_DIR);
  if (filter === "system") return ruleset.systemRules;
  if (filter === "user")   return ruleset.userRules;
  return ruleset.mergedRules;
}

// ---------------------------------------------------------------------------
// Tests: governance rule listing (validates what `sidjua rules` would show)
// ---------------------------------------------------------------------------

describe("sidjua rules — governance rule listing", () => {
  it("default (all) returns system + user rules", () => {
    const rules = listRules("all");
    expect(rules.length).toBeGreaterThanOrEqual(10);
  });

  it("--system returns only system rules", () => {
    const rules = listRules("system");
    expect(rules.every((r) => r.source === "system")).toBe(true);
  });

  it("--user returns only user-defined rules (empty for fresh install)", () => {
    const rules = listRules("user");
    expect(rules.every((r) => r.source === "user")).toBe(true);
    expect(rules).toHaveLength(0); // fresh — no user rules
  });

  it("--version: governance ruleset version is 1.0", () => {
    const info = loadVersionInfo(SYSTEM_GOV_DIR);
    expect(info).not.toBeNull();
    expect(info?.ruleset_version).toBe("1.0");
    expect(info?.compatible_sidjua_min).toBe("0.10.0");
  });

  it("--validate: fresh install has 0 conflicts", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOV_DIR, NO_USER_DIR);
    expect(ruleset.conflicts).toHaveLength(0);
  });

  it("--validate output would list system and user rule counts", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOV_DIR, NO_USER_DIR);
    expect(ruleset.systemRules.length).toBe(10);
    expect(ruleset.userRules.length).toBe(0);
  });

  it("SYS-SEC-001 is in the active rule set", () => {
    const rules = listRules("all");
    const rule = rules.find((r) => r.id === "SYS-SEC-001");
    expect(rule).toBeDefined();
    expect(rule?.source).toBe("system");
    expect(rule?.enforcement).toBe("mandatory");
  });

  it("all system rules have severity of critical or high", () => {
    const rules = listRules("system");
    const validSeverities = new Set(["critical", "high"]);
    for (const rule of rules) {
      expect(validSeverities.has(rule.severity), `Rule ${rule.id} has unexpected severity: ${rule.severity}`).toBe(true);
    }
  });

  it("total rule count matches system + user sum", () => {
    const ruleset = loadGovernanceRuleset(SYSTEM_GOV_DIR, NO_USER_DIR);
    expect(ruleset.mergedRules.length).toBe(ruleset.systemRules.length + ruleset.userRules.length);
  });
});

// ---------------------------------------------------------------------------
// Tests: CLI command registration (structural tests)
// ---------------------------------------------------------------------------

describe("registerRulesCommands — structural", () => {
  it("registers a 'rules' command on the program", async () => {
    const { registerRulesCommands } = await import("../../../src/cli/commands/rules.js");
    const program = new Command();
    program.exitOverride();
    registerRulesCommands(program);
    const rulesCmd = program.commands.find((c) => c.name() === "rules");
    expect(rulesCmd).toBeDefined();
  });

  it("rules command has --system, --user, --version, --validate options", async () => {
    const { registerRulesCommands } = await import("../../../src/cli/commands/rules.js");
    const program = new Command();
    program.exitOverride();
    registerRulesCommands(program);
    const rulesCmd = program.commands.find((c) => c.name() === "rules")!;
    const optionNames = rulesCmd.options.map((o) => o.long);
    expect(optionNames).toContain("--system");
    expect(optionNames).toContain("--user");
    expect(optionNames).toContain("--version");
    expect(optionNames).toContain("--validate");
    expect(optionNames).toContain("--json");
  });
});
