// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/update/migration-framework.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir }                                        from "node:os";
import { join }                                          from "node:path";
import {
  loadMigrationState,
  saveMigrationState,
  loadMigrationRegistry,
  runPendingMigrations,
  rollbackMigration,
  findAgentDatabases,
  type MigrationState,
}                                                        from "../../../src/core/update/migration-framework.js";
import { openDatabase }                                  from "../../../src/utils/db.js";
import type { Database }                                 from "better-sqlite3";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-migration-test-"));
}

const REAL_MIGRATIONS_DIR = join(process.cwd(), "system", "migrations");

// ---------------------------------------------------------------------------
// loadMigrationState
// ---------------------------------------------------------------------------

describe("loadMigrationState", () => {
  let tmp: string;

  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("returns empty state when file does not exist", () => {
    const state = loadMigrationState(tmp);
    expect(state.schemaVersion).toBe(0);
    expect(state.appliedMigrations).toHaveLength(0);
  });

  it("reads existing state file", () => {
    const state: MigrationState = {
      schemaVersion:     3,
      appliedMigrations: [
        { id: "001_initial-schema", appliedAt: "2026-03-01T00:00:00Z", version: "0.9.0" },
      ],
    };
    writeFileSync(join(tmp, ".migration-state.json"), JSON.stringify(state), "utf-8");
    const loaded = loadMigrationState(tmp);
    expect(loaded.schemaVersion).toBe(3);
    expect(loaded.appliedMigrations).toHaveLength(1);
    expect(loaded.appliedMigrations[0]?.id).toBe("001_initial-schema");
  });

  it("returns empty state for malformed JSON", () => {
    writeFileSync(join(tmp, ".migration-state.json"), "{{{invalid");
    const state = loadMigrationState(tmp);
    expect(state.schemaVersion).toBe(0);
    expect(state.appliedMigrations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// saveMigrationState
// ---------------------------------------------------------------------------

describe("saveMigrationState", () => {
  let tmp: string;

  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("writes state file atomically (temp + rename)", () => {
    const state: MigrationState = {
      schemaVersion:    1,
      appliedMigrations: [{ id: "001", appliedAt: "2026-01-01Z", version: "0.9.0" }],
    };
    saveMigrationState(tmp, state);
    const statePath = join(tmp, ".migration-state.json");
    expect(existsSync(statePath)).toBe(true);
    // Temp file should not remain
    expect(existsSync(`${statePath}.tmp`)).toBe(false);
    const loaded = JSON.parse(readFileSync(statePath, "utf-8")) as MigrationState;
    expect(loaded.schemaVersion).toBe(1);
  });

  it("round-trips state correctly", () => {
    const state: MigrationState = {
      schemaVersion:    5,
      appliedMigrations: [
        { id: "001", appliedAt: "2026-01-01Z", version: "0.9.0" },
        { id: "002", appliedAt: "2026-02-01Z", version: "0.10.0" },
      ],
    };
    saveMigrationState(tmp, state);
    const loaded = loadMigrationState(tmp);
    expect(loaded.schemaVersion).toBe(5);
    expect(loaded.appliedMigrations).toHaveLength(2);
  });

  it("creates parent directory if it does not exist", () => {
    const nested = join(tmp, "a", "b", "c");
    const state: MigrationState = { schemaVersion: 0, appliedMigrations: [] };
    saveMigrationState(nested, state);
    expect(existsSync(join(nested, ".migration-state.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadMigrationRegistry
// ---------------------------------------------------------------------------

describe("loadMigrationRegistry", () => {
  it("loads from real system/migrations/migration-registry.json", () => {
    const entries = loadMigrationRegistry(REAL_MIGRATIONS_DIR);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0]?.id).toBe("001_initial-schema");
    expect(entries[0]?.version).toBe("0.9.0");
  });

  it("returns empty array when registry file not found", () => {
    const entries = loadMigrationRegistry("/nonexistent/path");
    expect(entries).toHaveLength(0);
  });

  it("returns empty array for malformed registry JSON", () => {
    const tmp = makeTempDir();
    writeFileSync(join(tmp, "migration-registry.json"), "{{invalid");
    const entries = loadMigrationRegistry(tmp);
    rmSync(tmp, { recursive: true, force: true });
    expect(entries).toHaveLength(0);
  });

  it("preserves ordering from registry file", () => {
    const tmp = makeTempDir();
    const registry = {
      migrations: [
        { id: "003_c", version: "0.10.0", file: "003_c.js", description: "C" },
        { id: "001_a", version: "0.9.0",  file: "001_a.js", description: "A" },
        { id: "002_b", version: "0.9.1",  file: "002_b.js", description: "B" },
      ],
    };
    writeFileSync(join(tmp, "migration-registry.json"), JSON.stringify(registry));
    const entries = loadMigrationRegistry(tmp);
    rmSync(tmp, { recursive: true, force: true });
    expect(entries[0]?.id).toBe("003_c");
    expect(entries[1]?.id).toBe("001_a");
    expect(entries[2]?.id).toBe("002_b");
  });
});

// ---------------------------------------------------------------------------
// runPendingMigrations
// ---------------------------------------------------------------------------

describe("runPendingMigrations", () => {
  let tmp: string;
  let db: Database;
  let migrationsDir: string;

  beforeEach(() => {
    tmp           = makeTempDir();
    db            = openDatabase(":memory:");
    migrationsDir = makeTempDir();
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
    rmSync(migrationsDir, { recursive: true, force: true });
  });

  function writeMigrationFile(dir: string, id: string, upSql: string, downSql: string): void {
    const content = `
const migration = {
  id: "${id}",
  version: "0.9.0",
  description: "Test migration",
  async up(db) { db.exec(\`${upSql}\`); },
  async down(db) { db.exec(\`${downSql}\`); },
};
module.exports = migration;
`;
    writeFileSync(join(dir, `${id}.cjs`), content);
  }

  function writeRegistry(dir: string, ids: string[]): void {
    const migrations = ids.map((id) => ({ id, version: "0.9.0", file: `${id}.cjs`, description: id }));
    writeFileSync(join(dir, "migration-registry.json"), JSON.stringify({ migrations }));
  }

  it("runs the real 001_initial-schema migration successfully", async () => {
    const result = await runPendingMigrations(db, REAL_MIGRATIONS_DIR, tmp);
    expect(result.failed).toBeNull();
    expect(result.applied).toContain("001_initial-schema");
    // Table should exist
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_state'").get();
    expect(row).toBeDefined();
  });

  it("skips already-applied migrations", async () => {
    const state: MigrationState = {
      schemaVersion:    1,
      appliedMigrations: [{ id: "001_initial-schema", appliedAt: "2026-01-01Z", version: "0.9.0" }],
    };
    saveMigrationState(tmp, state);
    const result = await runPendingMigrations(db, REAL_MIGRATIONS_DIR, tmp);
    expect(result.failed).toBeNull();
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toContain("001_initial-schema");
  });

  it("saves migration state after each successful migration", async () => {
    await runPendingMigrations(db, REAL_MIGRATIONS_DIR, tmp);
    const state = loadMigrationState(tmp);
    expect(state.appliedMigrations.some((m) => m.id === "001_initial-schema")).toBe(true);
    expect(state.schemaVersion).toBeGreaterThan(0);
  });

  it("creates state file if it does not exist", async () => {
    const statePath = join(tmp, ".migration-state.json");
    expect(existsSync(statePath)).toBe(false);
    await runPendingMigrations(db, REAL_MIGRATIONS_DIR, tmp);
    expect(existsSync(statePath)).toBe(true);
  });

  it("returns error info when migration file not found", async () => {
    writeRegistry(migrationsDir, ["999_missing"]);
    // No actual migration file created
    const result = await runPendingMigrations(db, migrationsDir, tmp);
    expect(result.failed).toBe("999_missing");
    expect(result.error).toBeDefined();
  });

  it("rolls back transaction on migration failure", async () => {
    writeMigrationFile(migrationsDir, "bad_mig", "CREATE TABLE t (id INTEGER PRIMARY KEY)", "DROP TABLE t");
    const badContent = `
const migration = {
  id: "bad_mig",
  version: "0.9.0",
  description: "Fails",
  async up(db) { throw new Error("Intentional failure"); },
  async down(db) {},
};
module.exports = migration;
`;
    writeFileSync(join(migrationsDir, "bad_mig.cjs"), badContent);
    writeRegistry(migrationsDir, ["bad_mig"]);
    const result = await runPendingMigrations(db, migrationsDir, tmp);
    expect(result.failed).toBe("bad_mig");
    // State should not have recorded the failed migration
    const state = loadMigrationState(tmp);
    expect(state.appliedMigrations.some((m) => m.id === "bad_mig")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rollbackMigration
// ---------------------------------------------------------------------------

describe("rollbackMigration", () => {
  let tmp: string;
  let db: Database;

  beforeEach(() => {
    tmp = makeTempDir();
    db  = openDatabase(":memory:");
    // Apply the initial migration first
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("reverses a previously applied migration", async () => {
    // Apply first
    await runPendingMigrations(db, REAL_MIGRATIONS_DIR, tmp);
    const before = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_state'").get();
    expect(before).toBeDefined();

    // Rollback
    const result = await rollbackMigration("001_initial-schema", db, REAL_MIGRATIONS_DIR, tmp);
    expect(result.failed).toBeNull();
    expect(result.applied).toContain("001_initial-schema");

    // Table should be gone
    const after = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_state'").get();
    expect(after).toBeUndefined();
  });

  it("removes migration from state after rollback", async () => {
    await runPendingMigrations(db, REAL_MIGRATIONS_DIR, tmp);
    await rollbackMigration("001_initial-schema", db, REAL_MIGRATIONS_DIR, tmp);
    const state = loadMigrationState(tmp);
    expect(state.appliedMigrations.some((m) => m.id === "001_initial-schema")).toBe(false);
  });

  it("returns skipped for migration not in applied list", async () => {
    // Don't apply anything
    const result = await rollbackMigration("001_initial-schema", db, REAL_MIGRATIONS_DIR, tmp);
    expect(result.failed).toBeNull();
    expect(result.skipped).toContain("001_initial-schema");
  });

  it("returns error for migration ID not in registry", async () => {
    const result = await rollbackMigration("999_nonexistent", db, REAL_MIGRATIONS_DIR, tmp);
    expect(result.failed).toBe("999_nonexistent");
  });
});

// ---------------------------------------------------------------------------
// findAgentDatabases
// ---------------------------------------------------------------------------

describe("findAgentDatabases", () => {
  let tmp: string;

  beforeEach(() => { tmp = makeTempDir(); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("returns empty array when divisions dir does not exist", () => {
    const result = findAgentDatabases(tmp);
    expect(result).toHaveLength(0);
  });

  it("finds agent state.sqlite files", () => {
    const agentDir = join(tmp, "divisions", "engineering", "agents", "dev-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "state.sqlite"), "");
    const result = findAgentDatabases(tmp);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("state.sqlite");
  });

  it("finds multiple agent databases across divisions", () => {
    for (const [div, agent] of [["eng", "agent1"], ["finance", "agent2"], ["hr", "agent3"]]) {
      const dir = join(tmp, "divisions", div, "agents", agent);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "state.sqlite"), "");
    }
    const result = findAgentDatabases(tmp);
    expect(result).toHaveLength(3);
  });
});
