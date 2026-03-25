/**
 * Tests for Step 5: RBAC
 *
 * Covers:
 * - Head agents receive division_head role assignments
 * - T1 agents: cross_division_reader for ALL divisions (["*"])
 * - T2 agents: cross_division_reader for T1-headed divisions only
 * - T3 agents: no cross_division_reader
 * - Agents heading multiple divisions
 * - No-head divisions produce no agent assignment
 * - getAgentTier infers tier from ID suffix
 * - applyRBAC writes valid YAML to .system/rbac.yaml
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { generateRBAC, applyRBAC, getAgentTier } from "../../src/apply/rbac.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";
import type { RBACConfig } from "../../src/types/apply.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDivision(code: string, agent: string | null, active = true): Division {
  return {
    code,
    name: { en: code },
    scope: "test",
    required: false,
    active,
    recommend_from: null,
    head: { role: null, agent },
  };
}

function makeConfig(divisions: Division[]): ParsedConfig {
  return {
    schema_version: "1.0",
    company: { name: "TestCo", size: "solo", locale: "en", timezone: "UTC", mode: "business" },
    mode: "business",
    divisions,
    activeDivisions: divisions.filter((d) => d.active),
    size_presets: { solo: { recommended: [], description: "Solo" } },
    sourcePath: "/tmp/test.yaml",
    contentHash: "abc123",
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-rbac-test-"));
  mkdirSync(join(tmpDir, ".system"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// getAgentTier
// ---------------------------------------------------------------------------

describe("getAgentTier", () => {
  it.each([
    ["opus-t1", 1],
    ["sonnet-t2", 2],
    ["haiku-t3", 3],
    ["claude-opus-t1", 1],
    ["my-custom-agent-t2", 2],
  ])("infers tier from %s → %d", (id, expected) => {
    expect(getAgentTier(id)).toBe(expected);
  });

  it("returns null for IDs without tier suffix", () => {
    expect(getAgentTier("opus")).toBeNull();
    expect(getAgentTier("gpt4")).toBeNull();
    expect(getAgentTier("")).toBeNull();
  });

  it("is case-insensitive for the suffix", () => {
    expect(getAgentTier("agent-T1")).toBe(1);
    expect(getAgentTier("agent-T2")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// generateRBAC — role definitions
// ---------------------------------------------------------------------------

describe("generateRBAC — fixed roles", () => {
  it("includes four fixed role definitions", () => {
    const config = makeConfig([]);
    const rbac = generateRBAC(config);
    const roleNames = rbac.roles.map((r) => r.role);
    expect(roleNames).toContain("system_admin");
    expect(roleNames).toContain("division_head");
    expect(roleNames).toContain("division_agent");
    expect(roleNames).toContain("cross_division_reader");
    expect(rbac.roles).toHaveLength(4);
  });

  it("schema_version is '1.0'", () => {
    const config = makeConfig([]);
    const rbac = generateRBAC(config);
    expect(rbac.schema_version).toBe("1.0");
  });
});

// ---------------------------------------------------------------------------
// generateRBAC — agent assignments
// ---------------------------------------------------------------------------

describe("generateRBAC — division_head assignments", () => {
  it("assigns division_head role for each headed division", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("engineering", "sonnet-t2"),
    ]);
    const rbac = generateRBAC(config);
    const opusRoles = rbac.assignments.find((a) => a.agent === "opus-t1")?.roles ?? [];
    const sonnetRoles = rbac.assignments.find((a) => a.agent === "sonnet-t2")?.roles ?? [];

    expect(opusRoles.some((r) => r.role === "division_head" && r.division === "executive")).toBe(true);
    expect(sonnetRoles.some((r) => r.role === "division_head" && r.division === "engineering")).toBe(true);
  });

  it("no assignment for divisions with no head agent", () => {
    const config = makeConfig([makeDivision("sales", null)]);
    const rbac = generateRBAC(config);
    expect(rbac.assignments).toHaveLength(0);
  });
});

describe("generateRBAC — cross_division_reader", () => {
  it("T1 agent gets cross_division_reader with divisions: ['*']", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("engineering", "sonnet-t2"),
    ]);
    const rbac = generateRBAC(config);
    const opusRoles = rbac.assignments.find((a) => a.agent === "opus-t1")?.roles ?? [];
    const cdr = opusRoles.find((r) => r.role === "cross_division_reader");
    expect(cdr?.divisions).toEqual(["*"]);
  });

  it("T2 agent gets cross_division_reader for T1-headed divisions only", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),   // T1 → executive is T1-headed
      makeDivision("product", "opus-t1"),      // T1 → product is T1-headed
      makeDivision("engineering", "sonnet-t2"),
    ]);
    const rbac = generateRBAC(config);
    const sonnetRoles = rbac.assignments.find((a) => a.agent === "sonnet-t2")?.roles ?? [];
    const cdr = sonnetRoles.find((r) => r.role === "cross_division_reader");
    expect(cdr?.divisions?.sort()).toEqual(["executive", "product"]);
  });

  it("T2 agent gets no cross_division_reader if no T1-headed divisions", () => {
    const config = makeConfig([
      makeDivision("engineering", "sonnet-t2"),
      makeDivision("sales", "sonnet-t2"),
    ]);
    const rbac = generateRBAC(config);
    const sonnetRoles = rbac.assignments.find((a) => a.agent === "sonnet-t2")?.roles ?? [];
    expect(sonnetRoles.some((r) => r.role === "cross_division_reader")).toBe(false);
  });

  it("T3 agent gets no cross_division_reader", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("customer-service", "haiku-t3"),
    ]);
    const rbac = generateRBAC(config);
    const haikuRoles = rbac.assignments.find((a) => a.agent === "haiku-t3")?.roles ?? [];
    expect(haikuRoles.some((r) => r.role === "cross_division_reader")).toBe(false);
  });

  it("agent heading multiple divisions gets all division_head roles", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("product", "opus-t1"),
      makeDivision("ai-governance", "opus-t1"),
    ]);
    const rbac = generateRBAC(config);
    const opusRoles = rbac.assignments.find((a) => a.agent === "opus-t1")?.roles ?? [];
    const headRoles = opusRoles.filter((r) => r.role === "division_head");
    expect(headRoles).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// applyRBAC — file output
// ---------------------------------------------------------------------------

describe("applyRBAC", () => {
  it("writes rbac.yaml to .system/", () => {
    const config = makeConfig([makeDivision("engineering", "sonnet-t2")]);
    applyRBAC(config, tmpDir);
    expect(existsSync(join(tmpDir, ".system", "rbac.yaml"))).toBe(true);
  });

  it("written YAML is valid and parseable", () => {
    const config = makeConfig([makeDivision("engineering", "sonnet-t2")]);
    applyRBAC(config, tmpDir);
    const content = readFileSync(join(tmpDir, ".system", "rbac.yaml"), "utf-8");
    const parsed = parse(content) as RBACConfig;
    expect(parsed.schema_version).toBe("1.0");
    expect(Array.isArray(parsed.roles)).toBe(true);
    expect(Array.isArray(parsed.assignments)).toBe(true);
  });

  it("returns a StepResult with success:true", () => {
    const config = makeConfig([makeDivision("engineering", "sonnet-t2")]);
    const result = applyRBAC(config, tmpDir);
    expect(result.step).toBe("RBAC");
    expect(result.success).toBe(true);
  });

  it("always overwrites rbac.yaml on re-apply", () => {
    const config1 = makeConfig([makeDivision("engineering", "sonnet-t2")]);
    applyRBAC(config1, tmpDir);

    const config2 = makeConfig([makeDivision("engineering", "opus-t1")]);
    applyRBAC(config2, tmpDir);

    const content = readFileSync(join(tmpDir, ".system", "rbac.yaml"), "utf-8");
    expect(content).toContain("opus-t1");
    expect(content).not.toContain("sonnet-t2");
  });
});
