/**
 * Tests for Step 6: ROUTING
 *
 * Covers:
 * - Routes generated for each active division
 * - Primary agent = head.agent
 * - Fallback chain: T3→T2→T1, T2→T1, T1→null, no head→T1
 * - Default route = highest-tier agent with action "classify_and_route"
 * - applyRouting writes valid YAML to .system/routing-table.yaml
 * - Always overwritten on re-apply
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  generateRoutingTable,
  applyRouting,
  findAgentByTier,
  findHighestTierAgent,
} from "../../src/apply/routing.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";
import type { RoutingTable } from "../../src/types/apply.js";

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
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-routing-test-"));
  mkdirSync(join(tmpDir, ".system"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// findAgentByTier / findHighestTierAgent
// ---------------------------------------------------------------------------

describe("findAgentByTier", () => {
  it("finds the first T1 agent across active divisions", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("engineering", "sonnet-t2"),
    ]);
    expect(findAgentByTier(1, config)).toBe("opus-t1");
  });

  it("returns null when no agent of that tier exists", () => {
    const config = makeConfig([makeDivision("engineering", "sonnet-t2")]);
    expect(findAgentByTier(1, config)).toBeNull();
  });
});

describe("findHighestTierAgent", () => {
  it("returns T1 agent when T1 exists", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("engineering", "sonnet-t2"),
    ]);
    expect(findHighestTierAgent(config)).toBe("opus-t1");
  });

  it("returns T2 agent when no T1 exists", () => {
    const config = makeConfig([
      makeDivision("engineering", "sonnet-t2"),
      makeDivision("sales", "haiku-t3"),
    ]);
    expect(findHighestTierAgent(config)).toBe("sonnet-t2");
  });

  it("returns null when no headed divisions", () => {
    const config = makeConfig([makeDivision("sales", null)]);
    expect(findHighestTierAgent(config)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// generateRoutingTable — fallback logic
// ---------------------------------------------------------------------------

describe("generateRoutingTable — primary agents", () => {
  it("primary = head.agent for each active division", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("engineering", "sonnet-t2"),
    ]);
    const table = generateRoutingTable(config);
    const exec = table.routes.find((r) => r.division === "executive");
    const eng = table.routes.find((r) => r.division === "engineering");
    expect(exec?.primary).toBe("opus-t1");
    expect(eng?.primary).toBe("sonnet-t2");
  });

  it("primary = null for divisions with no head agent", () => {
    const config = makeConfig([makeDivision("sales", null)]);
    const table = generateRoutingTable(config);
    expect(table.routes[0]?.primary).toBeNull();
  });
});

describe("generateRoutingTable — fallback chain", () => {
  it("T3 primary → fallback is T2", () => {
    const config = makeConfig([
      makeDivision("engineering", "sonnet-t2"),
      makeDivision("customer-service", "haiku-t3"),
    ]);
    const table = generateRoutingTable(config);
    const cs = table.routes.find((r) => r.division === "customer-service");
    expect(cs?.fallback).toBe("sonnet-t2");
  });

  it("T3 primary → fallback is T1 when no T2 available", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("customer-service", "haiku-t3"),
    ]);
    const table = generateRoutingTable(config);
    const cs = table.routes.find((r) => r.division === "customer-service");
    // T2 not available → falls back to T1
    expect(cs?.fallback).toBe("opus-t1");
  });

  it("T2 primary → fallback is T1", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("engineering", "sonnet-t2"),
    ]);
    const table = generateRoutingTable(config);
    const eng = table.routes.find((r) => r.division === "engineering");
    expect(eng?.fallback).toBe("opus-t1");
  });

  it("T1 primary → fallback is null (human escalation)", () => {
    const config = makeConfig([makeDivision("executive", "opus-t1")]);
    const table = generateRoutingTable(config);
    const exec = table.routes.find((r) => r.division === "executive");
    expect(exec?.fallback).toBeNull();
  });

  it("no head agent → fallback is T1 agent", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("sales", null),
    ]);
    const table = generateRoutingTable(config);
    const sales = table.routes.find((r) => r.division === "sales");
    expect(sales?.fallback).toBe("opus-t1");
  });

  it("no head agent and no T1 → fallback is null", () => {
    const config = makeConfig([
      makeDivision("engineering", "sonnet-t2"),
      makeDivision("sales", null),
    ]);
    const table = generateRoutingTable(config);
    const sales = table.routes.find((r) => r.division === "sales");
    // findAgentByTier(1) returns null → fallback is null
    expect(sales?.fallback).toBeNull();
  });
});

describe("generateRoutingTable — default route", () => {
  it("default agent is the highest-tier active head agent", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("engineering", "sonnet-t2"),
    ]);
    const table = generateRoutingTable(config);
    expect(table.default_route.agent).toBe("opus-t1");
    expect(table.default_route.action).toBe("classify_and_route");
  });

  it("falls back to 'opus-t1' constant when no agents configured", () => {
    const config = makeConfig([makeDivision("sales", null)]);
    const table = generateRoutingTable(config);
    expect(table.default_route.agent).toBe("opus-t1");
  });

  it("schema_version is '1.0'", () => {
    const config = makeConfig([]);
    const table = generateRoutingTable(config);
    expect(table.schema_version).toBe("1.0");
  });
});

// ---------------------------------------------------------------------------
// applyRouting — file output
// ---------------------------------------------------------------------------

describe("applyRouting", () => {
  it("writes routing-table.yaml to .system/", () => {
    const config = makeConfig([makeDivision("engineering", "sonnet-t2")]);
    applyRouting(config, tmpDir);
    expect(existsSync(join(tmpDir, ".system", "routing-table.yaml"))).toBe(true);
  });

  it("written YAML is valid and parseable", () => {
    const config = makeConfig([makeDivision("engineering", "sonnet-t2")]);
    applyRouting(config, tmpDir);
    const content = readFileSync(join(tmpDir, ".system", "routing-table.yaml"), "utf-8");
    const parsed = parse(content) as RoutingTable;
    expect(parsed.schema_version).toBe("1.0");
    expect(Array.isArray(parsed.routes)).toBe(true);
  });

  it("returns StepResult with success:true", () => {
    const config = makeConfig([makeDivision("engineering", "sonnet-t2")]);
    const result = applyRouting(config, tmpDir);
    expect(result.step).toBe("ROUTING");
    expect(result.success).toBe(true);
  });

  it("always overwrites routing-table.yaml on re-apply", () => {
    const config1 = makeConfig([makeDivision("engineering", "sonnet-t2")]);
    applyRouting(config1, tmpDir);

    const config2 = makeConfig([makeDivision("engineering", "opus-t1")]);
    applyRouting(config2, tmpDir);

    const content = readFileSync(join(tmpDir, ".system", "routing-table.yaml"), "utf-8");
    expect(content).toContain("opus-t1");
  });

  it("route count in summary matches active divisions", () => {
    const config = makeConfig([
      makeDivision("executive", "opus-t1"),
      makeDivision("engineering", "sonnet-t2"),
      makeDivision("sales", null),
    ]);
    const result = applyRouting(config, tmpDir);
    expect(result.details?.["routeCount"]).toBe(3);
  });
});
