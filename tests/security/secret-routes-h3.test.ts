// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for #529 H3 (#519):
 *
 *   H3: Namespace-level authorization (IDOR fix)
 *     - Operators have full access (backwards-compatible)
 *     - Division-scoped agents can only read from "global" or their own namespace
 *     - Division-scoped agents can only write to their own namespace
 *     - Denied access is audit-logged
 *     - Allowed access is audit-logged
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { CALLER_CONTEXT_KEY } from "../../src/api/middleware/require-scope.js";
import Database from "better-sqlite3";
import {
  registerSecretRoutes,
  clearSecretAuditLog,
  getSecretAuditLog,
  authorizeSecretAccess,
  authorizeSecretWrite,
} from "../../src/api/routes/secrets.js";
import type { SecretsProvider, SecretMetadata } from "../../src/types/apply.js";
import type { CallerContext } from "../../src/api/routes/secrets.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const META: SecretMetadata = {
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  last_accessed_at: "2026-01-03T00:00:00Z",
  last_accessed_by: "system",
  rotation_age_days: 30,
  version: 1,
};

function makeProvider(): SecretsProvider {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue("test-value"),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(["alpha", "beta"]),
    ensureNamespace: vi.fn().mockResolvedValue(undefined),
    rotate: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn().mockResolvedValue(META),
  };
}

function makeSecretsDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS secrets (
      namespace TEXT NOT NULL,
      key       TEXT NOT NULL,
      value_encrypted TEXT NOT NULL,
      version   INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (namespace, key)
    );
  `);
  db.prepare("INSERT INTO secrets (namespace, key, value_encrypted) VALUES (?, ?, ?)").run("global", "k1", "enc");
  db.prepare("INSERT INTO secrets (namespace, key, value_encrypted) VALUES (?, ?, ?)").run("divisions/eng", "k2", "enc");
  return db;
}

function makeApp(provider: SecretsProvider, callerContext?: CallerContext): Hono {
  const app = new Hono();
  // Inject the test-specific CallerContext so requireScope() passes.
  // When callerContext is undefined we inject {} (empty) — scopeAtLeast defaults
  // it to readonly(1) so requireScope("readonly") passes, but the secrets route's
  // own RBAC (authorizeSecretAccess/Write) still returns 403 (fail-closed).
  const ctxToInject = callerContext ?? ({} as CallerContext);
  app.use("*", (c, next) => { c.set(CALLER_CONTEXT_KEY, ctxToInject); return next(); });
  registerSecretRoutes(app, { provider, secretsDb: makeSecretsDb(), callerContext });
  return app;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearSecretAuditLog();
});

// ===========================================================================
// Unit tests for authorization helpers
// ===========================================================================

describe("H3 #519: authorizeSecretAccess()", () => {
  it("operator context grants access to any namespace", () => {
    const ctx: CallerContext = { role: "operator" };
    expect(authorizeSecretAccess("global", ctx)).toBe(true);
    expect(authorizeSecretAccess("divisions/engineering", ctx)).toBe(true);
    expect(authorizeSecretAccess("divisions/finance", ctx)).toBe(true);
  });

  it("empty context {} can read 'global' but is denied non-global namespaces (IDOR fix)", () => {
    // P194: isOperator() now requires explicit role="operator".
    // {} (no role) is NOT operator — this closes the IDOR gap where any API caller
    // without a scoped CallerContext could access any division namespace.
    const ctx: CallerContext = {};
    expect(authorizeSecretAccess("global", ctx)).toBe(true);            // global is open
    expect(authorizeSecretAccess("divisions/anything", ctx)).toBe(false); // IDOR fixed
  });

  it("division-scoped agent can read from 'global'", () => {
    const ctx: CallerContext = { role: "agent", division: "engineering" };
    expect(authorizeSecretAccess("global", ctx)).toBe(true);
  });

  it("division-scoped agent can read from own division namespace", () => {
    const ctx: CallerContext = { role: "agent", division: "engineering" };
    expect(authorizeSecretAccess("divisions/engineering", ctx)).toBe(true);
  });

  it("division-scoped agent is denied access to another division's namespace", () => {
    const ctx: CallerContext = { role: "agent", division: "engineering" };
    expect(authorizeSecretAccess("divisions/finance", ctx)).toBe(false);
  });

  it("agent with no division is denied non-global namespaces", () => {
    const ctx: CallerContext = { role: "agent" };
    expect(authorizeSecretAccess("divisions/engineering", ctx)).toBe(false);
    expect(authorizeSecretAccess("global", ctx)).toBe(true);
  });
});

describe("H3 #519: authorizeSecretWrite()", () => {
  it("operator context grants write to any namespace", () => {
    const ctx: CallerContext = { role: "operator" };
    expect(authorizeSecretWrite("global", ctx)).toBe(true);
    expect(authorizeSecretWrite("divisions/engineering", ctx)).toBe(true);
  });

  it("division-scoped agent can write to own division namespace", () => {
    const ctx: CallerContext = { role: "agent", division: "engineering" };
    expect(authorizeSecretWrite("divisions/engineering", ctx)).toBe(true);
  });

  it("division-scoped agent is denied write to 'global'", () => {
    const ctx: CallerContext = { role: "agent", division: "engineering" };
    expect(authorizeSecretWrite("global", ctx)).toBe(false);
  });

  it("division-scoped agent is denied write to another division's namespace", () => {
    const ctx: CallerContext = { role: "agent", division: "engineering" };
    expect(authorizeSecretWrite("divisions/finance", ctx)).toBe(false);
  });
});

// ===========================================================================
// Integration tests — operator access (backwards-compatible)
// ===========================================================================

describe("H3 #519: Operator access (full — backwards-compatible)", () => {
  it("GET /value — operator can read from any namespace", async () => {
    const app = makeApp(makeProvider(), { role: "operator" });
    const res = await app.request("/api/v1/secrets/value?ns=divisions/finance&key=API_KEY");
    expect(res.status).toBe(200);
  });

  it("PUT /value — operator can write to global namespace", async () => {
    const app = makeApp(makeProvider(), { role: "operator" });
    const res = await app.request("/api/v1/secrets/value", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "global", key: "SHARED_KEY", value: "secret" }),
    });
    expect(res.status).toBe(200);
  });

  it("no callerContext — fail-closed, returns 403 (HP-2 behavioral change)", async () => {
    // HP-2: registerSecretRoutes without callerContext now registers 403 handlers (fail-closed).
    // Old behavior was to default to { role: "operator" }; new behavior is explicit context required.
    const app = makeApp(makeProvider());  // no callerContext
    const res = await app.request("/api/v1/secrets/value?ns=divisions/finance&key=K");
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// Integration tests — division-scoped agent READ access
// ===========================================================================

describe("H3 #519: Division-scoped agent — read access", () => {
  it("GET /value — agent can read from 'global' namespace", async () => {
    const app = makeApp(makeProvider(), { role: "agent", division: "engineering" });
    const res = await app.request("/api/v1/secrets/value?ns=global&key=SHARED");
    expect(res.status).toBe(200);
  });

  it("GET /value — agent can read from own division namespace", async () => {
    const app = makeApp(makeProvider(), { role: "agent", division: "engineering" });
    const res = await app.request("/api/v1/secrets/value?ns=divisions%2Fengineering&key=PRIVATE");
    expect(res.status).toBe(200);
  });

  it("GET /value — agent is denied access to another division's namespace (IDOR blocked)", async () => {
    const app = makeApp(makeProvider(), { role: "agent", division: "engineering" });
    const res = await app.request("/api/v1/secrets/value?ns=divisions%2Ffinance&key=PRIVATE");
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SEC-403");
  });

  it("GET /keys — agent is denied listing keys in another namespace", async () => {
    const app = makeApp(makeProvider(), { role: "agent", division: "engineering" });
    const res = await app.request("/api/v1/secrets/keys?ns=divisions%2Ffinance");
    expect(res.status).toBe(403);
  });

  it("GET /info — agent is denied metadata from another namespace", async () => {
    const app = makeApp(makeProvider(), { role: "agent", division: "engineering" });
    const res = await app.request("/api/v1/secrets/info?ns=divisions%2Ffinance&key=K");
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// Integration tests — division-scoped agent WRITE access
// ===========================================================================

describe("H3 #519: Division-scoped agent — write access", () => {
  it("PUT /value — agent can write to own division namespace", async () => {
    const provider = makeProvider();
    const app = makeApp(provider, { role: "agent", division: "engineering" });
    const res = await app.request("/api/v1/secrets/value", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "divisions/engineering", key: "MY_KEY", value: "secret" }),
    });
    expect(res.status).toBe(200);
    expect(provider.set).toHaveBeenCalledWith("divisions/engineering", "MY_KEY", "secret");
  });

  it("PUT /value — agent is denied writing to 'global' namespace", async () => {
    const provider = makeProvider();
    const app = makeApp(provider, { role: "agent", division: "engineering" });
    const res = await app.request("/api/v1/secrets/value", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "global", key: "HIJACK", value: "evil" }),
    });
    expect(res.status).toBe(403);
    expect(provider.set).not.toHaveBeenCalled();
  });

  it("DELETE /value — agent is denied deleting from another division's namespace", async () => {
    const provider = makeProvider();
    const app = makeApp(provider, { role: "agent", division: "engineering" });
    const res = await app.request("/api/v1/secrets/value?ns=divisions%2Ffinance&key=SECRET", {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    expect(provider.delete).not.toHaveBeenCalled();
  });

  it("POST /rotate — agent is denied rotating a secret in another namespace", async () => {
    const provider = makeProvider();
    const app = makeApp(provider, { role: "agent", division: "engineering" });
    const res = await app.request("/api/v1/secrets/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "divisions/finance", key: "K", value: "new" }),
    });
    expect(res.status).toBe(403);
    expect(provider.rotate).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// H3: Audit logging
// ===========================================================================

describe("H3 #519: Audit logging", () => {
  it("allowed read is recorded in audit log", async () => {
    const app = makeApp(makeProvider(), { role: "agent", division: "engineering" });
    await app.request("/api/v1/secrets/value?ns=global&key=MY_KEY");
    const log = getSecretAuditLog();
    const entry = log.find((e) => e.op === "read" && e.ns === "global");
    expect(entry).toBeDefined();
    expect(entry?.outcome).toBe("allowed");
  });

  it("denied read is recorded in audit log with 'denied' outcome", async () => {
    const app = makeApp(makeProvider(), { role: "agent", agentId: "agent-007", division: "engineering" });
    await app.request("/api/v1/secrets/value?ns=divisions%2Ffinance&key=SECRET");
    const log = getSecretAuditLog();
    const entry = log.find((e) => e.op === "read" && e.outcome === "denied");
    expect(entry).toBeDefined();
    expect(entry?.ns).toBe("divisions/finance");
    expect(entry?.agentId).toBe("agent-007");
    expect(entry?.division).toBe("engineering");
  });

  it("denied write is recorded in audit log with 'denied' outcome", async () => {
    const app = makeApp(makeProvider(), { role: "agent", division: "engineering" });
    await app.request("/api/v1/secrets/value", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "global", key: "HIJACK", value: "evil" }),
    });
    const log = getSecretAuditLog();
    const entry = log.find((e) => e.op === "write" && e.outcome === "denied");
    expect(entry).toBeDefined();
    expect(entry?.ns).toBe("global");
  });

  it("audit log is cleared between tests (clearSecretAuditLog works)", () => {
    // This test verifies that beforeEach clearSecretAuditLog() ensures isolation
    expect(getSecretAuditLog()).toHaveLength(0);
  });
});

// ===========================================================================
// P194 Task 4 — IDOR hardening: isOperator() requires explicit role
// ===========================================================================

describe("P194: IDOR fix — isOperator() requires explicit role='operator' (Task 4)", () => {
  it("authorizeSecretAccess: explicit operator role grants full access", () => {
    const ctx: CallerContext = { role: "operator" };
    expect(authorizeSecretAccess("global", ctx)).toBe(true);
    expect(authorizeSecretAccess("divisions/secret", ctx)).toBe(true);
  });

  it("authorizeSecretWrite: explicit operator role grants write anywhere", () => {
    const ctx: CallerContext = { role: "operator" };
    expect(authorizeSecretWrite("global", ctx)).toBe(true);
    expect(authorizeSecretWrite("divisions/any", ctx)).toBe(true);
  });

  it("authorizeSecretAccess: {} context (no role) is denied non-global namespaces", () => {
    // This is the IDOR fix: empty CallerContext no longer equals operator
    const ctx: CallerContext = {};
    expect(authorizeSecretAccess("divisions/finance", ctx)).toBe(false);
    expect(authorizeSecretAccess("divisions/engineering", ctx)).toBe(false);
  });

  it("authorizeSecretAccess: {} context can still read 'global' (open namespace)", () => {
    const ctx: CallerContext = {};
    expect(authorizeSecretAccess("global", ctx)).toBe(true);
  });

  it("authorizeSecretWrite: {} context is denied writes to any namespace", () => {
    const ctx: CallerContext = {};
    expect(authorizeSecretWrite("global", ctx)).toBe(false);
    expect(authorizeSecretWrite("divisions/x", ctx)).toBe(false);
  });

  it("GET /value — {} callerContext returns 403 for division namespace (IDOR blocked)", async () => {
    const app = makeApp(makeProvider(), {});  // explicit empty context (not undefined)
    const res = await app.request("/api/v1/secrets/value?ns=divisions%2Ffinance&key=K");
    expect(res.status).toBe(403);
  });

  it("GET /keys — {} callerContext returns 403 for division namespace", async () => {
    const app = makeApp(makeProvider(), {});
    const res = await app.request("/api/v1/secrets/keys?ns=divisions%2Fengineering");
    expect(res.status).toBe(403);
  });

  it("PUT /value — {} callerContext cannot write to global (no write access)", async () => {
    const app = makeApp(makeProvider(), {});
    const res = await app.request("/api/v1/secrets/value", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ns: "global", key: "HIJACK", value: "evil" }),
    });
    expect(res.status).toBe(403);
  });

  it("no callerContext (undefined) — fail-closed, returns 403 (HP-2 behavioral change)", async () => {
    // HP-2: registerSecretRoutes without callerContext now registers 403 handlers (fail-closed).
    // Old behavior defaulted to { role: "operator" }; new behavior requires explicit context.
    const app = makeApp(makeProvider());  // no callerContext → all endpoints return 403
    const res = await app.request("/api/v1/secrets/value?ns=divisions%2Ffinance&key=K");
    expect(res.status).toBe(403);
  });

  it("secrets.ts source: isOperator() does NOT check role === undefined", () => {
    const src: string = readFileSync(
      new URL("../../src/api/routes/secrets.ts", import.meta.url),
      "utf8",
    );
    // The old vulnerable pattern must be gone (both forms that granted undefined-role access)
    expect(src).not.toContain('role === undefined || ctx.role === "operator"');
    expect(src).not.toContain("ctx.role === undefined || ctx.role");
    // The hardened check must be present
    expect(src).toContain('return ctx.role === "operator"');
  });
});
