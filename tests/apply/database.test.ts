/**
 * Tests for Step 3: DATABASE
 *
 * Covers:
 * - All V1 tables created on first run
 * - Idempotency: running twice produces the same result
 * - Division sync: INSERT OR REPLACE, deactivate stale rows
 * - Budget rows: INSERT OR IGNORE (existing preserved)
 * - Migration versioning: already-applied migrations skipped
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDatabase, MIGRATIONS } from "../../src/apply/database.js";
import { openDatabase, tableExists, runMigrations } from "../../src/utils/db.js";
import { Logger } from "../../src/utils/logger.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";

// Silence logger during tests
const silent = Logger.silent();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDivision(code: string, active: boolean, agent: string | null = null): Division {
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
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-db-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Table creation
// ---------------------------------------------------------------------------

describe("applyDatabase — table creation", () => {
  it("creates all V1 tables on first run", () => {
    const config = makeConfig([makeDivision("engineering", true)]);
    const { db } = applyDatabase(config, tmpDir);
    db.close();

    const db2 = openDatabase(join(tmpDir, ".system", "sidjua.db"));
    const expectedTables = [
      "divisions",
      "audit_trail",
      "cost_ledger",
      "cost_budgets",
      "approval_queue",
      "agents",
      "_system_keys",
      "_migrations",
    ];
    for (const t of expectedTables) {
      expect(tableExists(db2, t), `table "${t}" should exist`).toBe(true);
    }
    db2.close();
  });

  it("returns a StepResult with success:true", () => {
    const config = makeConfig([makeDivision("engineering", true)]);
    const { result, db } = applyDatabase(config, tmpDir);
    db.close();

    expect(result.step).toBe("DATABASE");
    expect(result.success).toBe(true);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

describe("applyDatabase — idempotency", () => {
  it("running twice produces the same tables", () => {
    const config = makeConfig([makeDivision("engineering", true)]);

    const { db: db1 } = applyDatabase(config, tmpDir);
    db1.close();

    // Second run must not throw and must produce same result
    const { result: r2, db: db2 } = applyDatabase(config, tmpDir);
    db2.close();

    expect(r2.success).toBe(true);

    const db3 = openDatabase(join(tmpDir, ".system", "sidjua.db"));
    expect(tableExists(db3, "divisions")).toBe(true);
    db3.close();
  });

  it("does not re-apply already-applied migrations", () => {
    const config = makeConfig([]);

    const { db: db1 } = applyDatabase(config, tmpDir);
    const count1 = (db1.prepare("SELECT COUNT(*) as n FROM _migrations").get() as { n: number }).n;
    db1.close();

    const { result: r2, db: db2 } = applyDatabase(config, tmpDir);
    const count2 = (db2.prepare("SELECT COUNT(*) as n FROM _migrations").get() as { n: number }).n;
    db2.close();

    // Same number of migration rows — no new rows added on second run
    expect(count1).toBe(count2);
    expect(r2.details?.["migrationsApplied"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Division sync
// ---------------------------------------------------------------------------

describe("applyDatabase — division sync", () => {
  it("inserts active divisions into the divisions table", () => {
    const config = makeConfig([
      makeDivision("engineering", true),
      makeDivision("sales", true),
    ]);
    const { db } = applyDatabase(config, tmpDir);
    // Filter to user-configured divisions only (default divisions system/executive/workspace are also inserted)
    const rows = db.prepare(
      "SELECT code, active FROM divisions WHERE code IN ('engineering','sales') ORDER BY code",
    ).all() as { code: string; active: number }[];
    db.close();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.code).toBe("engineering");
    expect(rows[0]?.active).toBe(1);
    expect(rows[1]?.code).toBe("sales");
    expect(rows[1]?.active).toBe(1);
  });

  it("sets active=0 for divisions removed from config", () => {
    const config1 = makeConfig([
      makeDivision("engineering", true),
      makeDivision("sales", true),
    ]);
    const { db: db1 } = applyDatabase(config1, tmpDir);
    db1.close();

    // Remove 'sales' from config
    const config2 = makeConfig([makeDivision("engineering", true)]);
    const { db: db2 } = applyDatabase(config2, tmpDir);
    // Filter to user-configured divisions (excludes built-in protected ones)
    const rows = db2.prepare(
      "SELECT code, active FROM divisions WHERE code IN ('engineering','sales') ORDER BY code",
    ).all() as { code: string; active: number }[];
    db2.close();

    // 'sales' row is still in the DB (never deleted), but active=0
    expect(rows).toHaveLength(2);
    const sales = rows.find((r) => r.code === "sales");
    expect(sales?.active).toBe(0);
  });

  it("updates existing division records (upsert)", () => {
    const divV1 = makeDivision("engineering", true);
    const config1 = makeConfig([divV1]);
    const { db: db1 } = applyDatabase(config1, tmpDir);
    db1.close();

    // Now make engineering inactive
    const divV2 = makeDivision("engineering", false);
    const config2 = makeConfig([divV2]);
    const { db: db2 } = applyDatabase(config2, tmpDir);
    const row = db2
      .prepare("SELECT active FROM divisions WHERE code = 'engineering'")
      .get() as { active: number };
    db2.close();

    expect(row.active).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Budget rows
// ---------------------------------------------------------------------------

describe("applyDatabase — budget rows", () => {
  it("creates budget rows for each active division", () => {
    const config = makeConfig([
      makeDivision("engineering", true),
      makeDivision("sales", true),
      makeDivision("hr", false), // inactive — no budget row
    ]);
    const { db } = applyDatabase(config, tmpDir);
    const rows = db.prepare("SELECT division_code FROM cost_budgets ORDER BY division_code").all() as {
      division_code: string;
    }[];
    db.close();

    expect(rows.map((r) => r.division_code)).toEqual(["engineering", "sales"]);
  });

  it("does not overwrite existing budget rows (INSERT OR IGNORE)", () => {
    const config = makeConfig([makeDivision("engineering", true)]);
    const { db: db1 } = applyDatabase(config, tmpDir);
    // Manually set a limit
    db1.prepare("UPDATE cost_budgets SET monthly_limit_usd = 99.99 WHERE division_code = 'engineering'").run();
    db1.close();

    // Re-apply — should NOT reset the limit
    const { db: db2 } = applyDatabase(config, tmpDir);
    const row = db2
      .prepare("SELECT monthly_limit_usd FROM cost_budgets WHERE division_code = 'engineering'")
      .get() as { monthly_limit_usd: number };
    db2.close();

    expect(row.monthly_limit_usd).toBe(99.99);
  });

  it("reports correct budgetsInitialised count in details", () => {
    const config = makeConfig([makeDivision("eng", true), makeDivision("sales", true)]);
    const { result, db } = applyDatabase(config, tmpDir);
    db.close();
    expect(result.details?.["budgetsInitialised"]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// runMigrations helpers
// ---------------------------------------------------------------------------

describe("runMigrations", () => {
  it("creates _migrations table automatically", () => {
    const db = openDatabase(join(tmpDir, "test.db"));
    runMigrations(db, []);
    expect(tableExists(db, "_migrations")).toBe(true);
    db.close();
  });

  it("returns 0 when all migrations already applied", () => {
    const db = openDatabase(join(tmpDir, "test.db"));
    const n1 = runMigrations(db, MIGRATIONS);
    const n2 = runMigrations(db, MIGRATIONS);
    db.close();
    expect(n1).toBe(MIGRATIONS.length); // all migrations applied on first run
    expect(n2).toBe(0);
  });
});
