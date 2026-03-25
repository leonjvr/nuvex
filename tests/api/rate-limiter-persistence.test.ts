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

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  clearRateLimitState,
  persistRateLimiterState,
  restoreRateLimiterState,
} from "../../src/api/middleware/rate-limiter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDb(): { db: InstanceType<typeof Database>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sidjua-ratelimiter-persist-test-"));
  const db  = new Database(join(dir, "test.db"));
  db.pragma("journal_mode = WAL");
  return { db, dir };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rate-limiter persistence", () => {
  let db: InstanceType<typeof Database>;
  let dir: string;

  beforeEach(() => {
    ({ db, dir } = makeTmpDb());
    clearRateLimitState();
  });

  afterEach(() => {
    clearRateLimitState();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("persistRateLimiterState creates the rate_limiter_state table if absent", () => {
    persistRateLimiterState(db);
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='rate_limiter_state'")
      .get();
    expect(exists).toBeDefined();
  });

  it("persistRateLimiterState does not throw when bucket map is empty", () => {
    expect(() => persistRateLimiterState(db)).not.toThrow();
  });

  it("persistRateLimiterState writes buckets that were seeded via restoreRateLimiterState round-trip", () => {
    // Seed the DB manually, restore into memory, then persist back
    db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limiter_state (
        key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        last_refill TEXT NOT NULL
      )
    `);
    const recentTime = new Date(Date.now() - 5000).toISOString(); // 5s ago — fresh
    db.prepare(
      "INSERT INTO rate_limiter_state (key, tokens, last_refill) VALUES (?, ?, ?)",
    ).run("client-hash-abc", 15.5, recentTime);

    const restored = restoreRateLimiterState(db);
    expect(restored).toBe(1);

    // Persist back — should upsert the same bucket
    persistRateLimiterState(db);

    const row = db
      .prepare("SELECT tokens FROM rate_limiter_state WHERE key = 'client-hash-abc'")
      .get() as { tokens: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.tokens).toBeCloseTo(15.5, 1);
  });

  it("restoreRateLimiterState skips entries older than 2× cleanup interval", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limiter_state (
        key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        last_refill TEXT NOT NULL
      )
    `);
    // The default cleanup interval is 60s; 2× = 120s. Insert a 3-min-old entry.
    const staleTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    db.prepare(
      "INSERT INTO rate_limiter_state (key, tokens, last_refill) VALUES (?, ?, ?)",
    ).run("stale-key", 10.0, staleTime);

    const restored = restoreRateLimiterState(db);
    expect(restored).toBe(0); // stale entry skipped
  });

  it("restoreRateLimiterState loads fresh entries", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limiter_state (
        key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        last_refill TEXT NOT NULL
      )
    `);
    const freshTime = new Date(Date.now() - 10_000).toISOString(); // 10s ago
    db.prepare(
      "INSERT INTO rate_limiter_state (key, tokens, last_refill) VALUES (?, ?, ?)",
    ).run("fresh-key", 20.0, freshTime);

    const restored = restoreRateLimiterState(db);
    expect(restored).toBe(1);
  });

  it("restoreRateLimiterState works cleanly when table does not exist", () => {
    const count = restoreRateLimiterState(db);
    expect(count).toBe(0);
  });
});
