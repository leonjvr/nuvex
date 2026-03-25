/**
 * SIDJUA — Multi-Agent Governance Framework
 * Copyright (c) 2026 Götz Kohlberg
 *
 * Dual licensed under:
 *   - AGPL-3.0 (see LICENSE-AGPL)
 *   - SIDJUA Commercial License (see LICENSE-COMMERCIAL)
 *
 * Unless you have a signed Commercial License, your use is governed
 * by the AGPL-3.0. See LICENSE for details.
 */

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for crash recovery logic in start.ts.
 * Verifies that RUNNING/ASSIGNED tasks left from a previous crash are
 * marked as FAILED with a descriptive result_summary.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { openDatabase } from "../../../src/utils/db.js";

// ---------------------------------------------------------------------------
// Helper: create a minimal tasks table and insert a task
// ---------------------------------------------------------------------------

function makeTmpDb(): { db: InstanceType<typeof Database>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sidjua-recovery-test-"));
  const db  = openDatabase(join(dir, "sidjua.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      status         TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      result_summary TEXT
    )
  `);
  return { db, dir };
}

function insertTask(
  db: InstanceType<typeof Database>,
  id: string,
  status: string,
): void {
  db.prepare(
    "INSERT INTO tasks (id, title, status, updated_at) VALUES (?, ?, ?, ?)",
  ).run(id, "test task", status, new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Recovery SQL (extracted from start.ts for unit testing)
// ---------------------------------------------------------------------------

function runRecovery(db: InstanceType<typeof Database>): number {
  const now    = new Date().toISOString();
  const result = db.prepare<[string], unknown>(
    `UPDATE tasks SET status = 'FAILED', updated_at = ?, result_summary = 'Interrupted by unclean shutdown'
     WHERE status IN ('RUNNING', 'ASSIGNED')`,
  ).run(now) as { changes: number };
  return result.changes;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Crash recovery — start.ts", () => {
  let db: InstanceType<typeof Database>;
  let dir: string;

  beforeEach(() => {
    ({ db, dir } = makeTmpDb());
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("marks RUNNING tasks as FAILED with descriptive result_summary", () => {
    insertTask(db, "task-1", "RUNNING");
    const recovered = runRecovery(db);
    expect(recovered).toBe(1);

    const row = db.prepare("SELECT status, result_summary FROM tasks WHERE id = 'task-1'").get() as
      { status: string; result_summary: string };
    expect(row.status).toBe("FAILED");
    expect(row.result_summary).toContain("unclean shutdown");
  });

  it("marks ASSIGNED tasks as FAILED", () => {
    insertTask(db, "task-2", "ASSIGNED");
    const recovered = runRecovery(db);
    expect(recovered).toBe(1);

    const row = db.prepare("SELECT status FROM tasks WHERE id = 'task-2'").get() as
      { status: string };
    expect(row.status).toBe("FAILED");
  });

  it("does NOT affect tasks in terminal statuses (DONE, FAILED, CANCELLED)", () => {
    insertTask(db, "task-done",      "DONE");
    insertTask(db, "task-failed",    "FAILED");
    insertTask(db, "task-cancelled", "CANCELLED");

    const recovered = runRecovery(db);
    expect(recovered).toBe(0);

    const done      = db.prepare("SELECT status FROM tasks WHERE id = 'task-done'").get() as { status: string };
    const failed    = db.prepare("SELECT status FROM tasks WHERE id = 'task-failed'").get() as { status: string };
    const cancelled = db.prepare("SELECT status FROM tasks WHERE id = 'task-cancelled'").get() as { status: string };

    expect(done.status).toBe("DONE");
    expect(failed.status).toBe("FAILED");       // unchanged — was already FAILED
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("returns 0 (no print) when no in-flight tasks exist", () => {
    insertTask(db, "task-pending", "PENDING");
    const recovered = runRecovery(db);
    expect(recovered).toBe(0);
  });

  it("recovers multiple in-flight tasks in one pass", () => {
    insertTask(db, "task-r1", "RUNNING");
    insertTask(db, "task-r2", "RUNNING");
    insertTask(db, "task-a1", "ASSIGNED");
    insertTask(db, "task-ok", "DONE");

    const recovered = runRecovery(db);
    expect(recovered).toBe(3);
  });
});
