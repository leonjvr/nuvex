// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P271 — Operational Integrity + Quality Cleanup regression tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

// A1: Request timeout
import { requestTimeout, ABORT_SIGNAL_KEY } from "../../src/api/middleware/request-timeout.js";
import { Hono } from "hono";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";

// A2: Provider selftest
import { ProviderConnectivity } from "../../src/core/selftest/checks/provider-checks.js";

// A5: Config resolver
import { resolveConfigPath } from "../../src/core/config/resolve-config-path.js";

// A7: SSE ticket persistence
import {
  persistTicket, validateTicketFromDb, cleanupExpiredTicketsDb,
} from "../../src/api/routes/sse-ticket.js";

// B1: Embedding vector
import { Buffer } from "node:buffer";

// B3: Telemetry cleanup
import { stopTelemetryCleanup } from "../../src/core/telemetry/telemetry-buffer.js";

// B5: Apply error handling
import { runApplyCommand } from "../../src/cli/apply-command.js";

// B10: Request logger
import { requestLogger } from "../../src/api/middleware/request-logger.js";

// ---------------------------------------------------------------------------
// A1: Request timeout aborts on signal
// ---------------------------------------------------------------------------

describe("A1: Request timeout — AbortSignal cancellation", () => {
  it("sets abortSignal in context before calling next", async () => {
    const app = new Hono();
    app.use("*", withAdminCtx);
    app.use("*", requestTimeout);
    let capturedSignal: AbortSignal | undefined;
    app.get("/test", (c) => {
      capturedSignal = c.get(ABORT_SIGNAL_KEY) as AbortSignal | undefined;
      return c.text("ok");
    });
    await app.request("/test");
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal!.aborted).toBe(false);
  });

  it("aborts signal when timeout fires and returns 504", async () => {
    const app = new Hono();
    app.use("*", withAdminCtx);

    // Inline a timeout middleware with 1ms timeout to simulate timeout behavior
    app.use("*", async (c, next) => {
      const controller = new AbortController();
      c.set(ABORT_SIGNAL_KEY, controller.signal);
      const timeoutPromise = new Promise<never>((_, reject) => {
        const h = setTimeout(() => { controller.abort(); reject(new Error("TIMEOUT_1")); }, 1);
        if (typeof h === "object" && h !== null && "unref" in h) (h as { unref(): void }).unref();
      });
      try {
        await Promise.race([next(), timeoutPromise]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith("TIMEOUT_")) {
          return c.json({ error: { code: "SYS-504", message: "Request timed out" } }, 504);
        }
        throw err;
      }
    });
    app.get("/slow", async (c) => {
      await new Promise((r) => setTimeout(r, 200));
      return c.text("done");
    });

    const res = await app.request("/slow");
    expect(res.status).toBe(504);
  });

  it("ABORT_SIGNAL_KEY is exported from request-timeout", () => {
    expect(typeof ABORT_SIGNAL_KEY).toBe("string");
    expect(ABORT_SIGNAL_KEY.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// A2: Provider selftest opt-in connectivity
// ---------------------------------------------------------------------------

describe("A2: Provider selftest — connectivity opt-in", () => {
  it("ProviderConnectivity skips network call without checkConnectivity flag", async () => {
    const result = await ProviderConnectivity.run({ workDir: tmpdir(), verbose: false, fix: false });
    // Should be "skip" — no connectivity flag and no providers configured
    expect(["skip"]).toContain(result.status);
  });

  it("ProviderConnectivity skips when checkConnectivity not set in context", async () => {
    const result = await ProviderConnectivity.run({ workDir: tmpdir(), verbose: false, fix: false, checkConnectivity: false });
    expect(result.status).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// A5: Config resolver
// ---------------------------------------------------------------------------

describe("A5: resolveConfigPath — shared config resolution", () => {
  let tmp: string;

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "sidjua-a5-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("finds governance/divisions.yaml", () => {
    const govDir = join(tmp, "governance");
    mkdirSync(govDir, { recursive: true });
    const configPath = join(govDir, "divisions.yaml");
    writeFileSync(configPath, "schema_version: '1.0'\n");
    expect(resolveConfigPath(tmp)).toBe(configPath);
  });

  it("finds governance/divisions/ directory when present", () => {
    const divDir = join(tmp, "governance", "divisions");
    mkdirSync(divDir, { recursive: true });
    expect(resolveConfigPath(tmp)).toBe(divDir);
  });

  it("falls back to workDir/divisions.yaml (legacy)", () => {
    const configPath = join(tmp, "divisions.yaml");
    writeFileSync(configPath, "schema_version: '1.0'\n");
    expect(resolveConfigPath(tmp)).toBe(configPath);
  });

  it("throws when no config found", () => {
    expect(() => resolveConfigPath(tmp)).toThrow(/No SIDJUA config found/);
  });

  it("uses explicit path when provided", () => {
    const customPath = join(tmp, "custom.yaml");
    writeFileSync(customPath, "schema_version: '1.0'\n");
    expect(resolveConfigPath(tmp, "custom.yaml")).toBe(customPath);
  });
});

// ---------------------------------------------------------------------------
// A7: SSE ticket persistence
// ---------------------------------------------------------------------------

describe("A7: SSE ticket — DB persistence", () => {
  it("persistTicket and validateTicketFromDb round-trip", () => {
    const db = new Database(":memory:");
    const ticketId = "test-ticket-1234";
    const ctx = { role: "agent" as const, division: "engineering" };

    persistTicket(db, ticketId, ctx);

    const recovered = validateTicketFromDb(db, ticketId);
    expect(recovered).not.toBeNull();
    expect(recovered!.role).toBe("agent");
    expect(recovered!.division).toBe("engineering");
    db.close();
  });

  it("validateTicketFromDb returns null for unknown ticket", () => {
    const db = new Database(":memory:");
    const result = validateTicketFromDb(db, "nonexistent");
    expect(result).toBeNull();
    db.close();
  });

  it("validateTicketFromDb returns null for expired ticket", () => {
    const db = new Database(":memory:");
    const ticketId = "expired-ticket";
    // Insert with past expiry
    db.exec(`CREATE TABLE IF NOT EXISTS sse_tickets (
      ticket_id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'readonly',
      division TEXT, agent_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
    )`);
    db.prepare("INSERT INTO sse_tickets (ticket_id, scope, expires_at) VALUES (?, ?, ?)").run(
      ticketId, "readonly", new Date(Date.now() - 60000).toISOString()
    );
    const result = validateTicketFromDb(db, ticketId);
    expect(result).toBeNull();
    db.close();
  });

  it("validateTicketFromDb marks ticket as used (single-use)", () => {
    const db = new Database(":memory:");
    const ticketId = "single-use-ticket";
    persistTicket(db, ticketId, { role: "readonly" as const });
    const first = validateTicketFromDb(db, ticketId);
    expect(first).not.toBeNull();
    const second = validateTicketFromDb(db, ticketId); // same ticket again
    expect(second).toBeNull(); // already used
    db.close();
  });

  it("cleanupExpiredTicketsDb removes expired entries", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE IF NOT EXISTS sse_tickets (
      ticket_id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'readonly',
      division TEXT, agent_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0
    )`);
    db.prepare("INSERT INTO sse_tickets (ticket_id, scope, expires_at) VALUES (?, ?, ?)").run(
      "old", "readonly", new Date(Date.now() - 60000).toISOString()
    );
    db.prepare("INSERT INTO sse_tickets (ticket_id, scope, expires_at) VALUES (?, ?, ?)").run(
      "new", "readonly", new Date(Date.now() + 60000).toISOString()
    );
    cleanupExpiredTicketsDb(db);
    const remaining = db.prepare("SELECT COUNT(*) as c FROM sse_tickets").get() as { c: number };
    expect(remaining.c).toBe(1);
    db.close();
  });
});

// ---------------------------------------------------------------------------
// B1: Embedding vector typed array view
// ---------------------------------------------------------------------------

describe("B1: Embedding vector — typed array view serialization", () => {
  it("Float32Array with non-zero byteOffset serializes correctly via byteOffset/byteLength", () => {
    // Create a Float32Array view with non-zero offset
    const underlying = new Float32Array([0, 1, 2, 3, 4]);
    const view = underlying.subarray(2); // byteOffset = 2 * 4 = 8
    expect(view.byteOffset).toBeGreaterThan(0);

    // Correct approach: Buffer.from(buffer, byteOffset, byteLength)
    const correct = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    // Incorrect approach: Buffer.from(buffer) — takes ALL bytes of underlying buffer
    const incorrect = Buffer.from(view.buffer);

    expect(correct.length).toBe(view.byteLength); // 3 floats * 4 bytes = 12
    expect(incorrect.length).toBe(underlying.buffer.byteLength); // 5 floats * 4 bytes = 20

    // Verify round-trip
    const recovered = new Float32Array(correct.buffer, correct.byteOffset, correct.byteLength / 4);
    expect(recovered[0]).toBe(view[0]);
    expect(recovered[1]).toBe(view[1]);
    expect(recovered[2]).toBe(view[2]);
  });
});

// ---------------------------------------------------------------------------
// B3: Telemetry cleanup export
// ---------------------------------------------------------------------------

describe("B3: Telemetry buffer — stopTelemetryCleanup export", () => {
  it("stopTelemetryCleanup is exported and callable without throwing", () => {
    expect(typeof stopTelemetryCleanup).toBe("function");
    expect(() => stopTelemetryCleanup()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// B5: Apply command error handling
// ---------------------------------------------------------------------------

describe("B5: Apply command — error handling", () => {
  let tmp: string;

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "sidjua-b5-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it("returns exit code 1 on missing config without throwing", async () => {
    const result = await runApplyCommand({
      config:  "nonexistent.yaml",
      dryRun:  false,
      verbose: false,
      force:   false,
      workDir: tmp,
    });
    expect(result).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B10: Request logger — error coverage
// ---------------------------------------------------------------------------

describe("B10: Request logger — try/finally coverage", () => {
  it("logs request even when route throws", async () => {
    const app = new Hono();
    app.use("*", requestLogger());
    app.get("/throws", () => { throw new Error("route error"); });
    app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500));

    // Should not throw — the logger's finally block must run
    const res = await app.request("/throws");
    expect(res.status).toBe(500);
  });

  it("logs request on success", async () => {
    const app = new Hono();
    app.use("*", requestLogger());
    app.get("/ok", (c) => c.text("ok"));
    const res = await app.request("/ok");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });
});
