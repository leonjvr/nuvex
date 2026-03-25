/**
 * Tests for Step 8: AUDIT
 *
 * Covers:
 * - Per-division SQLite views created in DB
 * - Views correctly filter audit_trail by division_code
 * - governance/audit/reports/ directory created
 * - audit-config.yaml generated with correct defaults
 * - Existing audit-config.yaml NOT overwritten (overwrite:false)
 * - Hyphenated division codes get underscore-sanitized view names
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { applyAudit } from "../../src/apply/audit.js";
import { applyDatabase } from "../../src/apply/database.js";
import { viewExists } from "../../src/utils/db.js";
import type { ParsedConfig, Division } from "../../src/types/config.js";
import type { AuditConfig } from "../../src/types/apply.js";

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

function makeConfig(codes: string[]): ParsedConfig {
  const divisions = codes.map((c) => makeDivision(c));
  return {
    schema_version: "1.0",
    company: { name: "TestCo", size: "solo", locale: "en", timezone: "UTC", mode: "business" },
    mode: "business",
    divisions,
    activeDivisions: divisions,
    size_presets: { solo: { recommended: [], description: "Solo" } },
    sourcePath: "/tmp/test.yaml",
    contentHash: "abc123",
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-audit-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Audit views
// ---------------------------------------------------------------------------

describe("applyAudit — SQLite views", () => {
  it("creates per-division views in the database", () => {
    const config = makeConfig(["engineering", "sales"]);
    const { db } = applyDatabase(config, tmpDir);
    applyAudit(config, tmpDir, db);

    expect(viewExists(db, "audit_engineering")).toBe(true);
    expect(viewExists(db, "audit_sales")).toBe(true);
    db.close();
  });

  it("sanitizes hyphens in division codes to underscores", () => {
    const config = makeConfig(["customer-service", "ai-governance"]);
    const { db } = applyDatabase(config, tmpDir);
    applyAudit(config, tmpDir, db);

    expect(viewExists(db, "audit_customer_service")).toBe(true);
    expect(viewExists(db, "audit_ai_governance")).toBe(true);
    db.close();
  });

  it("views filter audit_trail by division_code", () => {
    const config = makeConfig(["engineering", "sales"]);
    const { db } = applyDatabase(config, tmpDir);
    applyAudit(config, tmpDir, db);

    // Insert audit trail rows for each division
    db.prepare(`
      INSERT INTO audit_trail (agent_id, division_code, action_type, action_detail)
      VALUES ('agent-a', 'engineering', 'task_start', 'started')
    `).run();
    db.prepare(`
      INSERT INTO audit_trail (agent_id, division_code, action_type, action_detail)
      VALUES ('agent-b', 'sales', 'decision', 'sold')
    `).run();

    const engRows = db.prepare("SELECT * FROM audit_engineering").all();
    const salesRows = db.prepare("SELECT * FROM audit_sales").all();
    db.close();

    expect(engRows).toHaveLength(1);
    expect(salesRows).toHaveLength(1);
  });

  it("is idempotent — running twice does not error", () => {
    const config = makeConfig(["engineering"]);
    const { db } = applyDatabase(config, tmpDir);
    applyAudit(config, tmpDir, db);
    // Second call — CREATE VIEW IF NOT EXISTS should not throw
    expect(() => applyAudit(config, tmpDir, db)).not.toThrow();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// Governance directory and audit config
// ---------------------------------------------------------------------------

describe("applyAudit — governance/audit/", () => {
  it("creates governance/audit/reports/ directory", () => {
    const config = makeConfig(["engineering"]);
    const { db } = applyDatabase(config, tmpDir);
    applyAudit(config, tmpDir, db);
    db.close();

    expect(existsSync(join(tmpDir, "governance", "audit", "reports"))).toBe(true);
  });

  it("generates audit-config.yaml with correct defaults", () => {
    const config = makeConfig(["engineering"]);
    const { db } = applyDatabase(config, tmpDir);
    applyAudit(config, tmpDir, db);
    db.close();

    const configPath = join(tmpDir, "governance", "audit", "audit-config.yaml");
    expect(existsSync(configPath)).toBe(true);

    const parsed = parse(readFileSync(configPath, "utf-8")) as AuditConfig;
    expect(parsed.schema_version).toBe("1.0");
    expect(parsed.log_level).toBe("standard");
    expect(parsed.retention.days).toBe(365);
    expect(parsed.retention.export_before_delete).toBe(true);
    expect(parsed.events.escalation).toBe(true);
    expect(parsed.events.governance_check).toBe(true);
    expect(parsed.events.blocked).toBe(true);
    expect(parsed.export.formats).toContain("json");
    expect(parsed.export.formats).toContain("csv");
  });

  it("does NOT overwrite existing audit-config.yaml", () => {
    const config = makeConfig(["engineering"]);
    const { db } = applyDatabase(config, tmpDir);

    // Pre-create the dir and config
    mkdirSync(join(tmpDir, "governance", "audit"), { recursive: true });
    const customContent = "# CUSTOM AUDIT CONFIG\nschema_version: '1.0'\nlog_level: minimal\n";
    writeFileSync(join(tmpDir, "governance", "audit", "audit-config.yaml"), customContent);

    applyAudit(config, tmpDir, db);
    db.close();

    const content = readFileSync(join(tmpDir, "governance", "audit", "audit-config.yaml"), "utf-8");
    expect(content).toBe(customContent);
  });
});

// ---------------------------------------------------------------------------
// StepResult
// ---------------------------------------------------------------------------

describe("applyAudit — StepResult", () => {
  it("returns success:true", () => {
    const config = makeConfig(["engineering"]);
    const { db } = applyDatabase(config, tmpDir);
    const result = applyAudit(config, tmpDir, db);
    db.close();

    expect(result.step).toBe("AUDIT");
    expect(result.success).toBe(true);
  });

  it("summary contains view count and retention days", () => {
    const config = makeConfig(["engineering", "sales"]);
    const { db } = applyDatabase(config, tmpDir);
    const result = applyAudit(config, tmpDir, db);
    db.close();

    expect(result.summary).toContain("2");
    expect(result.summary).toContain("365");
  });
});
