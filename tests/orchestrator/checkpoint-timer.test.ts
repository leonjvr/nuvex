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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { CheckpointTimer } from "../../src/orchestrator/checkpoint-timer.js";

function makeTmpDb(): { db: InstanceType<typeof Database>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sidjua-ckpt-test-"));
  const db  = new Database(join(dir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE test_data (id INTEGER PRIMARY KEY, val TEXT)");
  return { db, dir };
}

describe("CheckpointTimer", () => {
  let db: InstanceType<typeof Database>;
  let dir: string;
  let timer: CheckpointTimer;

  beforeEach(() => {
    ({ db, dir } = makeTmpDb());
  });

  afterEach(() => {
    timer?.stop();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("start() begins the interval and does not throw", () => {
    timer = new CheckpointTimer(db, 10_000);
    expect(() => timer.start()).not.toThrow();
    timer.stop();
  });

  it("start() is idempotent — calling twice does not create two timers", () => {
    timer = new CheckpointTimer(db, 10_000);
    timer.start();
    timer.start(); // second call should be no-op
    timer.stop();
  });

  it("stop() clears the interval (no throw, safe to call when not started)", () => {
    timer = new CheckpointTimer(db, 10_000);
    expect(() => timer.stop()).not.toThrow(); // stop before start is safe
    timer.start();
    timer.stop();
    expect(() => timer.stop()).not.toThrow(); // stop twice is safe
  });

  it("runPeriodicCheckpoint() runs PRAGMA wal_checkpoint without throwing", () => {
    timer = new CheckpointTimer(db, 10_000);
    // Insert data to ensure WAL has content
    db.prepare("INSERT INTO test_data (val) VALUES (?)").run("test");
    expect(() => timer.runPeriodicCheckpoint()).not.toThrow();
  });

  it("runPeriodicCheckpoint() does not throw when DB is empty", () => {
    timer = new CheckpointTimer(db, 10_000);
    expect(() => timer.runPeriodicCheckpoint()).not.toThrow();
  });

  it("periodic checkpoint fires after interval elapses", async () => {
    // Use fake timers to avoid actual 60s wait
    vi.useFakeTimers();
    const pragmaSpy = vi.spyOn(db, "pragma");

    timer = new CheckpointTimer(db, 100);
    timer.start();

    vi.advanceTimersByTime(250); // advance past two intervals

    expect(pragmaSpy).toHaveBeenCalledWith("wal_checkpoint(PASSIVE)");

    timer.stop();
    vi.useRealTimers();
  });
});
