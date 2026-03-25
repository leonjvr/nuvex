/**
 * Tests for Step 9: COST_CENTERS
 *
 * Covers:
 * - cost-centers.yaml created for active divisions
 * - User-set limits preserved on re-apply (merge logic)
 * - Inactive divisions removed from YAML (but DB rows preserved)
 * - New divisions added with null limits
 * - DB cost_budgets synced with YAML values
 * - mergeCostCenters pure function
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { applyCostCenters, mergeCostCenters } from "../../src/apply/cost-centers.js";
import { applyDatabase } from "../../src/apply/database.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";
import type { CostCentersConfig } from "../../src/types/apply.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDivision(code: string, active = true): Division {
  return {
    code,
    name: { en: code },
    scope: "test",
    required: false,
    active,
    recommend_from: null,
    head: { role: null, agent: null },
  };
}

function makeConfig(codes: string[], inactive: string[] = []): ParsedConfig {
  const activeDivs = codes.map((c) => makeDivision(c));
  const inactiveDivs = inactive.map((c) => makeDivision(c, false));
  const divisions = [...activeDivs, ...inactiveDivs];
  return {
    schema_version: "1.0",
    company: { name: "TestCo", size: "solo", locale: "en", timezone: "UTC", mode: "business" },
    mode: "business",
    divisions,
    activeDivisions: activeDivs,
    size_presets: { solo: { recommended: [], description: "Solo" } },
    sourcePath: "/tmp/test.yaml",
    contentHash: "abc123",
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-cost-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// mergeCostCenters (pure function)
// ---------------------------------------------------------------------------

describe("mergeCostCenters", () => {
  it("generates null limits for all active divisions on first run", () => {
    const merged = mergeCostCenters(null, ["engineering", "sales"]);
    expect(merged.divisions["engineering"]?.monthly_limit_usd).toBeNull();
    expect(merged.divisions["sales"]?.daily_limit_usd).toBeNull();
  });

  it("preserves user-set monthly_limit_usd on re-apply", () => {
    const existing: CostCentersConfig = {
      schema_version: "1.0",
      generated_at: "2026-01-01T00:00:00Z",
      global: { monthly_limit_usd: null, daily_limit_usd: null, alert_threshold_percent: 80 },
      divisions: {
        engineering: { monthly_limit_usd: 50.0, daily_limit_usd: null },
      },
    };
    const merged = mergeCostCenters(existing, ["engineering"]);
    expect(merged.divisions["engineering"]?.monthly_limit_usd).toBe(50.0);
  });

  it("adds new active divisions with null limits", () => {
    const existing: CostCentersConfig = {
      schema_version: "1.0",
      generated_at: "2026-01-01T00:00:00Z",
      global: { monthly_limit_usd: null, daily_limit_usd: null, alert_threshold_percent: 80 },
      divisions: { engineering: { monthly_limit_usd: null, daily_limit_usd: null } },
    };
    const merged = mergeCostCenters(existing, ["engineering", "sales"]);
    expect(Object.keys(merged.divisions)).toContain("sales");
    expect(merged.divisions["sales"]?.monthly_limit_usd).toBeNull();
  });

  it("removes divisions no longer in active list", () => {
    const existing: CostCentersConfig = {
      schema_version: "1.0",
      generated_at: "2026-01-01T00:00:00Z",
      global: { monthly_limit_usd: null, daily_limit_usd: null, alert_threshold_percent: 80 },
      divisions: {
        engineering: { monthly_limit_usd: null, daily_limit_usd: null },
        sales: { monthly_limit_usd: null, daily_limit_usd: null },
      },
    };
    const merged = mergeCostCenters(existing, ["engineering"]);
    expect(Object.keys(merged.divisions)).not.toContain("sales");
  });

  it("preserves global section from existing file", () => {
    const existing: CostCentersConfig = {
      schema_version: "1.0",
      generated_at: "2026-01-01T00:00:00Z",
      global: { monthly_limit_usd: 200, daily_limit_usd: 10, alert_threshold_percent: 75 },
      divisions: {},
    };
    const merged = mergeCostCenters(existing, []);
    expect(merged.global.monthly_limit_usd).toBe(200);
    expect(merged.global.daily_limit_usd).toBe(10);
    expect(merged.global.alert_threshold_percent).toBe(75);
  });

  it("defaults global to null limits when no existing file", () => {
    const merged = mergeCostCenters(null, []);
    expect(merged.global.monthly_limit_usd).toBeNull();
    expect(merged.global.alert_threshold_percent).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// applyCostCenters — file output
// ---------------------------------------------------------------------------

describe("applyCostCenters — file output", () => {
  it("writes cost-centers.yaml to .system/", () => {
    const config = makeConfig(["engineering", "sales"]);
    const { db } = applyDatabase(config, tmpDir);
    applyCostCenters(config, tmpDir, db);
    db.close();

    expect(existsSync(join(tmpDir, ".system", "cost-centers.yaml"))).toBe(true);
  });

  it("written YAML is parseable and contains active divisions", () => {
    const config = makeConfig(["engineering", "sales"]);
    const { db } = applyDatabase(config, tmpDir);
    applyCostCenters(config, tmpDir, db);
    db.close();

    const content = readFileSync(join(tmpDir, ".system", "cost-centers.yaml"), "utf-8");
    const parsed = parse(content) as CostCentersConfig;
    expect(parsed.schema_version).toBe("1.0");
    expect(Object.keys(parsed.divisions)).toContain("engineering");
    expect(Object.keys(parsed.divisions)).toContain("sales");
  });

  it("preserves user-set limits on re-apply", () => {
    const config = makeConfig(["engineering"]);
    const { db: db1 } = applyDatabase(config, tmpDir);
    applyCostCenters(config, tmpDir, db1);
    db1.close();

    // Simulate user editing the file
    const path = join(tmpDir, ".system", "cost-centers.yaml");
    const current = parse(readFileSync(path, "utf-8")) as CostCentersConfig;
    current.divisions["engineering"] = { monthly_limit_usd: 99.0, daily_limit_usd: 5.0 };
    writeFileSync(path, stringify(current));

    // Re-apply
    const { db: db2 } = applyDatabase(config, tmpDir);
    applyCostCenters(config, tmpDir, db2);
    db2.close();

    const updated = parse(readFileSync(path, "utf-8")) as CostCentersConfig;
    expect(updated.divisions["engineering"]?.monthly_limit_usd).toBe(99.0);
    expect(updated.divisions["engineering"]?.daily_limit_usd).toBe(5.0);
  });

  it("removes inactive divisions from YAML but keeps DB rows", () => {
    // First run with both divisions active
    const config1 = makeConfig(["engineering", "sales"]);
    const { db: db1 } = applyDatabase(config1, tmpDir);
    applyCostCenters(config1, tmpDir, db1);
    db1.close();

    // Second run — sales removed from active list
    const config2 = makeConfig(["engineering"]);
    const { db: db2 } = applyDatabase(config2, tmpDir);
    applyCostCenters(config2, tmpDir, db2);

    // YAML should not have 'sales'
    const path = join(tmpDir, ".system", "cost-centers.yaml");
    const parsed = parse(readFileSync(path, "utf-8")) as CostCentersConfig;
    expect(Object.keys(parsed.divisions)).not.toContain("sales");

    // DB row for 'sales' should still exist (from initial apply)
    const dbRow = db2
      .prepare("SELECT division_code FROM cost_budgets WHERE division_code = 'sales'")
      .get();
    db2.close();
    expect(dbRow).toBeDefined();
  });

  it("returns StepResult with success:true", () => {
    const config = makeConfig(["engineering"]);
    const { db } = applyDatabase(config, tmpDir);
    const result = applyCostCenters(config, tmpDir, db);
    db.close();

    expect(result.step).toBe("COST_CENTERS");
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DB sync
// ---------------------------------------------------------------------------

describe("applyCostCenters — DB sync", () => {
  it("syncs user-set limits to cost_budgets table", () => {
    const config = makeConfig(["engineering"]);
    const { db: db1 } = applyDatabase(config, tmpDir);
    applyCostCenters(config, tmpDir, db1);
    db1.close();

    // Edit the YAML to set limits
    const path = join(tmpDir, ".system", "cost-centers.yaml");
    const current = parse(readFileSync(path, "utf-8")) as CostCentersConfig;
    current.divisions["engineering"] = { monthly_limit_usd: 150.0, daily_limit_usd: 7.5 };
    writeFileSync(path, stringify(current));

    const { db: db2 } = applyDatabase(config, tmpDir);
    applyCostCenters(config, tmpDir, db2);

    const row = db2
      .prepare("SELECT monthly_limit_usd, daily_limit_usd FROM cost_budgets WHERE division_code = 'engineering'")
      .get() as { monthly_limit_usd: number; daily_limit_usd: number };
    db2.close();

    expect(row.monthly_limit_usd).toBe(150.0);
    expect(row.daily_limit_usd).toBe(7.5);
  });
});
