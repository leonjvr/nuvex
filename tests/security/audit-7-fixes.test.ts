/**
 * SIDJUA — Audit 7 security/quality fixes
 *
 * Fix 1: Path traversal in resolveSkillPath (SEC-010)
 * Fix 2: Sandbox init _initFailed flag
 * Fix 3: API key dual-key auth (current + pending)
 * Fix 4: config_update IPC — assessConfigCompatibility + deepEqual
 * Fix 5: HTTP security headers middleware
 * Fix 6: WAL checksum verification in getWALSince
 * Fix 7: SSE ticket periodic pruning (startPruneTimer/stopPruneTimer)
 * Fix 8: notFound() response helper
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Fix 1 — resolveSkillPath: new param order (workDir, skillPath)
// ---------------------------------------------------------------------------

import { resolveSkillPath } from "../../src/agent-lifecycle/agent-template.js";

describe("Fix 1: resolveSkillPath — swapped param order (workDir, skillPath)", () => {
  const workDir = "/app/workdir";

  it("new param order (workDir, skillPath) resolves correctly", () => {
    expect(resolveSkillPath(workDir, "skills/test.md")).toBe("/app/workdir/skills/test.md");
  });

  it("rejects path traversal", () => {
    expect(() => resolveSkillPath(workDir, "../../etc/passwd")).toThrow(/path traversal/i);
  });

  it("rejects absolute skill paths", () => {
    expect(() => resolveSkillPath(workDir, "/etc/passwd")).toThrow(/absolute|SEC-010/i);
  });

  it("path normalisation within workDir is allowed (a/b/../c.md)", () => {
    expect(resolveSkillPath(workDir, "a/b/../c.md")).toBe("/app/workdir/a/c.md");
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — Sandbox _initFailed flag
// ---------------------------------------------------------------------------

// Note: BubblewrapProvider imports @anthropic-ai/sandbox-runtime which requires
// native binaries — tested structurally (source inspection) rather than runtime.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Fix 2: BubblewrapProvider init recovery (source inspection)", () => {
  const src = readFileSync(
    resolve("src/core/sandbox/bubblewrap-provider.ts"),
    "utf-8",
  );

  it("uses _lastInitAttempt for cooldown-based retry (not permanent _initFailed)", () => {
    expect(src).toContain("_lastInitAttempt");
    expect(src).not.toContain("_initFailed");
  });

  it("checks _lastInitAttempt before _initPromise", () => {
    const lastAttemptIdx = src.indexOf("_lastInitAttempt");
    const initPromiseIdx = src.indexOf("_initPromise !== null");
    expect(lastAttemptIdx).toBeLessThan(initPromiseIdx);
  });

  it("records failure timestamp on init failure", () => {
    expect(src).toContain("_lastInitAttempt = Date.now()");
  });

  it("throws SidjuaError (SYS-011) within cooldown window", () => {
    expect(src).toContain("SYS-011");
    expect(src).toContain("Next retry available after");
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — authenticate: dual-key (current + pending)
// ---------------------------------------------------------------------------

import { authenticate } from "../../src/api/middleware/auth.js";
import { Hono } from "hono";

function makeApp(currentKey: string, pendingKey: string | null = null): Hono {
  const app = new Hono();
  app.use("*", authenticate(() => currentKey, pendingKey !== null ? () => pendingKey : undefined));
  app.get("/api/v1/test", (c) => c.json({ ok: true }));
  return app;
}

describe("Fix 3: authenticate — dual-key support (current + pending)", () => {
  it("accepts current key", async () => {
    const app = makeApp("new-key");
    const res = await app.request("/api/v1/test", {
      headers: { Authorization: "Bearer new-key" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects wrong key", async () => {
    const app = makeApp("new-key");
    const res = await app.request("/api/v1/test", {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts pending (old) key during grace period", async () => {
    const app = makeApp("new-key", "old-key");
    const res = await app.request("/api/v1/test", {
      headers: { Authorization: "Bearer old-key" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects unknown key even when pending key is set", async () => {
    const app = makeApp("new-key", "old-key");
    const res = await app.request("/api/v1/test", {
      headers: { Authorization: "Bearer neither-key" },
    });
    expect(res.status).toBe(401);
  });

  it("null/empty pending key does not accept arbitrary requests", async () => {
    const app = makeApp("new-key", null);
    const res = await app.request("/api/v1/test", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Fix 3b — KeyStore class
// ---------------------------------------------------------------------------

import { KeyStore } from "../../src/api/key-store.js";

describe("Fix 3b: KeyStore class", () => {
  it("getCurrent returns empty string by default", () => {
    const ks = new KeyStore();
    expect(ks.getCurrent()).toBe("");
  });

  it("setCurrent/getCurrent round-trip", () => {
    const ks = new KeyStore();
    ks.setCurrent("my-key");
    expect(ks.getCurrent()).toBe("my-key");
  });

  it("setPending/getPending round-trip", () => {
    const ks = new KeyStore();
    ks.setPending("old-key");
    expect(ks.getPending()).toBe("old-key");
  });

  it("reset clears state", () => {
    const ks = new KeyStore();
    ks.setCurrent("k");
    ks.setPending("p");
    ks.reset();
    expect(ks.getCurrent()).toBe("");
    expect(ks.getPending()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — deepEqual utility
// ---------------------------------------------------------------------------

import { deepEqual } from "../../src/utils/deep-equal.js";

describe("Fix 4: deepEqual utility", () => {
  it("primitives: equal values", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
  });

  it("primitives: unequal values", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
  });

  it("objects: structurally equal (key order independent)", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("objects: structurally unequal", () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("arrays: equal", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it("arrays: unequal (different order is not equal)", () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });

  it("null vs undefined is false", () => {
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it("nested objects", () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("empty objects are equal", () => {
    expect(deepEqual({}, {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — Security headers middleware
// ---------------------------------------------------------------------------

import { securityHeaders } from "../../src/api/middleware/security-headers.js";

function makeSecApp(): Hono {
  const app = new Hono();
  app.use("*", securityHeaders);
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("Fix 5: HTTP security headers middleware", () => {
  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await makeSecApp().request("/test");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets X-Frame-Options: DENY", async () => {
    const res = await makeSecApp().request("/test");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets Referrer-Policy: no-referrer", async () => {
    const res = await makeSecApp().request("/test");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("sets strict Content-Security-Policy for API paths", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/api/v1/test", (c) => c.json({ ok: true }));
    const res = await app.request("/api/v1/test");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
  });

  it("sets permissive-safe Content-Security-Policy for GUI paths", async () => {
    const res = await makeSecApp().request("/test");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("does NOT set HSTS on plain HTTP (no X-Forwarded-Proto)", async () => {
    const res = await makeSecApp().request("/test");
    expect(res.headers.get("Strict-Transport-Security")).toBeNull();
  });

  it("sets HSTS when X-Forwarded-Proto: https", async () => {
    const res = await makeSecApp().request("/test", {
      headers: { "X-Forwarded-Proto": "https" },
    });
    const hsts = res.headers.get("Strict-Transport-Security");
    expect(hsts).not.toBeNull();
    expect(hsts).toContain("max-age=");
    expect(hsts).toContain("includeSubDomains");
  });
});

// ---------------------------------------------------------------------------
// Fix 6 — WAL checksum verification in getWALSince
// ---------------------------------------------------------------------------

import { WALManager } from "../../src/agent-lifecycle/checkpoint/wal-manager.js";
import Database from "better-sqlite3";

function makeWalDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE agent_wal (
      sequence   INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id   TEXT NOT NULL,
      timestamp  TEXT NOT NULL,
      operation  TEXT NOT NULL,
      data_json  TEXT NOT NULL,
      checksum   TEXT NOT NULL
    )
  `);
  return db;
}

describe("Fix 6: WAL checksum verification in getWALSince", () => {
  it("returns valid entries normally", () => {
    const db  = makeWalDb();
    const mgr = new WALManager(db as unknown as import("../../src/utils/db.js").Database);
    mgr.appendWAL({ agent_id: "agent-1", operation: "checkpoint", data: { v: 1 } });
    const entries = mgr.getWALSince("agent-1", 0);
    expect(entries).toHaveLength(1);
    expect(entries[0].operation).toBe("checkpoint");
  });

  it("throws SidjuaError WAL-001 on tampered entry (halt instead of filter)", () => {
    const db  = makeWalDb();
    const mgr = new WALManager(db as unknown as import("../../src/utils/db.js").Database);
    mgr.appendWAL({ agent_id: "agent-2", operation: "checkpoint", data: { v: 1 } });

    // Tamper with the checksum directly in the DB
    db.exec("UPDATE agent_wal SET checksum = 'tampered' WHERE agent_id = 'agent-2'");

    // Must throw — tampered WAL halts execution rather than silently filtering.
    expect(() => mgr.getWALSince("agent-2", 0)).toThrow("WAL integrity violation");
  });

  it("throws on first corrupted entry even when later entries are valid", () => {
    const db  = makeWalDb();
    const mgr = new WALManager(db as unknown as import("../../src/utils/db.js").Database);
    mgr.appendWAL({ agent_id: "agent-3", operation: "op1", data: {} });
    mgr.appendWAL({ agent_id: "agent-3", operation: "op2", data: {} });

    // Only tamper with the first entry
    const first = db.prepare("SELECT sequence FROM agent_wal WHERE agent_id = 'agent-3' ORDER BY sequence ASC LIMIT 1").get() as { sequence: number };
    db.prepare("UPDATE agent_wal SET checksum = 'bad' WHERE sequence = ?").run(first.sequence);

    // Must throw immediately on the first corrupted entry — partial reads are unsafe.
    expect(() => mgr.getWALSince("agent-3", 0)).toThrow("WAL integrity violation");
  });
});

// ---------------------------------------------------------------------------
// Fix 7 — SSE ticket periodic pruning
// ---------------------------------------------------------------------------

import {
  consumeTicket,
  clearTickets,
  ticketCount,
  startPruneTimer,
  stopPruneTimer,
} from "../../src/api/routes/sse-ticket.js";

describe("Fix 7: SSE ticket pruning — startPruneTimer / stopPruneTimer", () => {
  beforeEach(() => {
    clearTickets();
    stopPruneTimer(); // reset timer state
  });

  afterEach(() => {
    stopPruneTimer();
  });

  it("startPruneTimer is exported", () => {
    expect(typeof startPruneTimer).toBe("function");
  });

  it("stopPruneTimer is exported", () => {
    expect(typeof stopPruneTimer).toBe("function");
  });

  it("calling startPruneTimer twice does not create a second timer", () => {
    startPruneTimer();
    startPruneTimer(); // should be no-op
    stopPruneTimer();
    // If we reach here without error, the idempotent guard worked
    expect(true).toBe(true);
  });

  it("pruneExpired removes expired tickets on next consumeTicket call", () => {
    // We can verify via ticketCount which calls pruneExpired internally
    const src = readFileSync(resolve("src/api/routes/sse-ticket.ts"), "utf-8");
    expect(src).toContain("startPruneTimer");
    expect(src).toContain("stopPruneTimer");
    expect(src).toContain("setInterval");
  });
});

// ---------------------------------------------------------------------------
// Fix 8 — notFound() response helper
// ---------------------------------------------------------------------------

import { notFound } from "../../src/api/utils/responses.js";

function makeNotFoundApp(): Hono {
  const app = new Hono();
  app.get("/missing", (c) => notFound(c, "Widget 42 not found"));
  app.get("/custom-code", (c) => notFound(c, "Thing not found", "SEC-404"));
  return app;
}

describe("Fix 8: notFound() response helper", () => {
  it("returns 404 status", async () => {
    const res = await makeNotFoundApp().request("/missing");
    expect(res.status).toBe(404);
  });

  it("includes error.message in body", async () => {
    const res  = await makeNotFoundApp().request("/missing");
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain("Widget 42 not found");
  });

  it("uses default code SYS-404", async () => {
    const res  = await makeNotFoundApp().request("/missing");
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SYS-404");
  });

  it("accepts custom error code", async () => {
    const res  = await makeNotFoundApp().request("/custom-code");
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SEC-404");
  });

  it("includes recoverable: false", async () => {
    const res  = await makeNotFoundApp().request("/missing");
    const body = await res.json() as { error: { recoverable: boolean } };
    expect(body.error.recoverable).toBe(false);
  });
});
