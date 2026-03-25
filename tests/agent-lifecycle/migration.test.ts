/**
 * Phase 10.5 — migration.ts unit tests
 * Tests for runMigrations105 including cloudflare provider seeding.
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  // Minimal _migrations table required by runMigrations()
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("runMigrations105", () => {
  it("creates lifecycle tables", () => {
    const db = makeDb();
    runMigrations105(db);
    const tables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    expect(tables).toContain("agent_definitions");
    expect(tables).toContain("provider_configs");
    expect(tables).toContain("agent_budgets");
    expect(tables).toContain("division_budgets");
  });

  it("seeds cloudflare provider by default", () => {
    const db = makeDb();
    runMigrations105(db);
    const row = db
      .prepare<[], { id: string; type: string; health_status: string }>(
        "SELECT id, type, health_status FROM provider_configs WHERE id = 'cloudflare'",
      )
      .get();
    expect(row).toBeDefined();
    expect(row!.type).toBe("cloudflare-ai");
    expect(row!.health_status).toBe("healthy");
  });

  it("cloudflare seed includes llama model", () => {
    const db = makeDb();
    runMigrations105(db);
    const row = db
      .prepare<[], { config_yaml: string }>(
        "SELECT config_yaml FROM provider_configs WHERE id = 'cloudflare'",
      )
      .get();
    expect(row).toBeDefined();
    expect(row!.config_yaml).toContain("@cf/meta/llama-3.1-8b-instruct");
  });

  it("cloudflare seed is idempotent (call twice)", () => {
    const db = makeDb();
    runMigrations105(db);
    runMigrations105(db);  // should not throw
    const count = db
      .prepare<[], { cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM provider_configs WHERE id = 'cloudflare'",
      )
      .get();
    expect(count!.cnt).toBe(1);
  });
});
