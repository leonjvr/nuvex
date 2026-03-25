// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for session DB migration — Phase 186
 */

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runSessionMigrations, SESSION_MIGRATIONS } from "../../src/session/migration.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";

function makeDb() {
  const db = new Database(":memory:");
  runMigrations105(db);
  return db;
}

describe("session migration", () => {
  it("creates session_token_usage table", () => {
    const db = makeDb();
    runSessionMigrations(db);
    const row = db.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='session_token_usage'",
    ).get();
    expect(row).toBeDefined();
  });

  it("creates session_checkpoints table", () => {
    const db = makeDb();
    runSessionMigrations(db);
    const row = db.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='session_checkpoints'",
    ).get();
    expect(row).toBeDefined();
  });

  it("creates session_audit_log table", () => {
    const db = makeDb();
    runSessionMigrations(db);
    const row = db.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='session_audit_log'",
    ).get();
    expect(row).toBeDefined();
  });

  it("is idempotent (safe to run twice)", () => {
    const db = makeDb();
    expect(() => {
      runSessionMigrations(db);
      runSessionMigrations(db);
    }).not.toThrow();
  });

  it("records migration version 1.9", () => {
    const db = makeDb();
    runSessionMigrations(db);
    const row = db.prepare<[], { version: string }>(
      "SELECT version FROM _migrations WHERE version = '1.9'",
    ).get();
    expect(row).toBeDefined();
    expect(row!.version).toBe("1.9");
  });

  it("SESSION_MIGRATIONS has one entry", () => {
    expect(SESSION_MIGRATIONS).toHaveLength(1);
    expect(SESSION_MIGRATIONS[0]!.version).toBe("1.9");
  });
});
