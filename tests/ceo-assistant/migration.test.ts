// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runCeoAssistantMigrations, CEO_ASSISTANT_MIGRATIONS } from "../../src/ceo-assistant/migration.js";

function makeDb() {
  return new Database(":memory:");
}

describe("CEO Assistant migration", () => {
  it("creates assistant_tasks table", () => {
    const db = makeDb();
    runCeoAssistantMigrations(db);
    const row = db.prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='assistant_tasks'",
    ).get();
    expect(row).toBeDefined();
  });

  it("is idempotent", () => {
    const db = makeDb();
    expect(() => {
      runCeoAssistantMigrations(db);
      runCeoAssistantMigrations(db);
    }).not.toThrow();
  });

  it("records version 2.0", () => {
    const db = makeDb();
    runCeoAssistantMigrations(db);
    const row = db.prepare<[], { version: string }>(
      "SELECT version FROM _migrations WHERE version = '2.0'",
    ).get();
    expect(row?.version).toBe("2.0");
  });

  it("CEO_ASSISTANT_MIGRATIONS has one entry", () => {
    expect(CEO_ASSISTANT_MIGRATIONS).toHaveLength(1);
    expect(CEO_ASSISTANT_MIGRATIONS[0]!.version).toBe("2.0");
  });
});
