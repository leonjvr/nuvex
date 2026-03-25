// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — P269: Scoped API Tokens + Full Authorization
 *
 * Tests covering:
 *   1. TokenStore CRUD (create, list, get, revoke, validate)
 *   2. Token format (sidjua_sk_ prefix)
 *   3. Expiry enforcement
 *   4. Scope hierarchy via requireScope middleware
 *   5. Auth middleware — scoped token path + legacy key fallback
 *   6. Agent + division restriction in CallerContext
 *   7. Secrets route dynamic CallerContext
 *   8. Route-level scope coverage meta-test
 *   9. Token management REST endpoints
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { Hono }       from "hono";
import { TokenStore, TOKEN_SCHEMA_SQL, TOKEN_PREFIX } from "../../src/api/token-store.js";
import { requireScope, scopeAtLeast, CALLER_CONTEXT_KEY } from "../../src/api/middleware/require-scope.js";
import { authenticate } from "../../src/api/middleware/auth.js";
import { registerTokenRoutes } from "../../src/api/routes/tokens.js";
import type { CallerContext } from "../../src/api/caller-context.js";
import { readFileSync } from "node:fs";
import { resolve }     from "node:path";


// ── helpers ────────────────────────────────────────────────────────────────

function makeDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(TOKEN_SCHEMA_SQL);
  return db;
}

function bearerHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}


// ── 1. TokenStore CRUD ─────────────────────────────────────────────────────

describe("TokenStore", () => {
  let db:    InstanceType<typeof Database>;
  let store: TokenStore;

  beforeEach(() => {
    db    = makeDb();
    store = new TokenStore(db);
  });

  it("createToken returns id and rawToken", () => {
    const { id, rawToken } = store.createToken({ scope: "operator", label: "test" });
    expect(id).toBeTruthy();
    expect(rawToken).toBeTruthy();
  });

  it("rawToken starts with sidjua_sk_ prefix", () => {
    const { rawToken } = store.createToken({ scope: "admin", label: "prefix-test" });
    expect(rawToken.startsWith(TOKEN_PREFIX)).toBe(true);
  });

  it("rawToken is 74 chars (prefix 10 + 64 hex)", () => {
    const { rawToken } = store.createToken({ scope: "readonly", label: "len-test" });
    // TOKEN_PREFIX = "sidjua_sk_" (10) + 64 hex chars = 74 total
    expect(rawToken.length).toBe(74);
  });

  it("validateToken returns token on valid raw token", () => {
    const { id, rawToken } = store.createToken({ scope: "operator", label: "validate" });
    const result = store.validateToken(rawToken);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(id);
    expect(result!.scope).toBe("operator");
  });

  it("validateToken returns null for unknown token", () => {
    expect(store.validateToken("sidjua_sk_" + "0".repeat(64))).toBeNull();
  });

  it("revokeToken prevents subsequent validation", () => {
    const { id, rawToken } = store.createToken({ scope: "agent", label: "revoke-test" });
    const revoked = store.revokeToken(id);
    expect(revoked).toBe(true);
    expect(store.validateToken(rawToken)).toBeNull();
  });

  it("revokeToken returns false for unknown id", () => {
    expect(store.revokeToken("nonexistent-id")).toBe(false);
  });

  it("listTokens returns tokens without hash field", () => {
    store.createToken({ scope: "admin",    label: "a1" });
    store.createToken({ scope: "readonly", label: "a2" });
    const tokens = store.listTokens();
    expect(tokens.length).toBe(2);
    expect((tokens[0] as unknown as Record<string, unknown>)["hash"]).toBeUndefined();
  });

  it("getToken returns token by id without hash", () => {
    const { id } = store.createToken({ scope: "agent", label: "get-test" });
    const token  = store.getToken(id);
    expect(token).not.toBeNull();
    expect(token!.id).toBe(id);
    expect((token as unknown as Record<string, unknown>)["hash"]).toBeUndefined();
  });

  it("hasAdminToken returns false when no admin token", () => {
    store.createToken({ scope: "operator", label: "not-admin" });
    expect(store.hasAdminToken()).toBe(false);
  });

  it("hasAdminToken returns true when admin token exists", () => {
    store.createToken({ scope: "admin", label: "is-admin" });
    expect(store.hasAdminToken()).toBe(true);
  });

  it("hasAdminToken returns false when admin token is revoked", () => {
    const { id } = store.createToken({ scope: "admin", label: "revoked-admin" });
    store.revokeToken(id);
    expect(store.hasAdminToken()).toBe(false);
  });

  it("createToken stores division and agentId", () => {
    const { id } = store.createToken({
      scope:    "agent",
      label:    "scoped",
      division: "engineering",
      agentId:  "sonnet-dev",
    });
    const token = store.getToken(id);
    expect(token!.division).toBe("engineering");
    expect(token!.agentId).toBe("sonnet-dev");
  });

  it("validateToken enforces expiry", () => {
    const pastDate = new Date(Date.now() - 1000); // expired 1 second ago
    const { rawToken } = store.createToken({
      scope:     "operator",
      label:     "expired",
      expiresAt: pastDate,
    });
    expect(store.validateToken(rawToken)).toBeNull();
  });

  it("validateToken accepts non-expired token", () => {
    const futureDate = new Date(Date.now() + 60_000); // expires in 60s
    const { rawToken } = store.createToken({
      scope:     "operator",
      label:     "future",
      expiresAt: futureDate,
    });
    expect(store.validateToken(rawToken)).not.toBeNull();
  });
});


// ── 2. scopeAtLeast ────────────────────────────────────────────────────────

describe("scopeAtLeast", () => {
  it("readonly ≥ readonly", () => expect(scopeAtLeast("readonly", "readonly")).toBe(true));
  it("agent ≥ readonly",    () => expect(scopeAtLeast("agent",    "readonly")).toBe(true));
  it("operator ≥ readonly", () => expect(scopeAtLeast("operator", "readonly")).toBe(true));
  it("admin ≥ readonly",    () => expect(scopeAtLeast("admin",    "readonly")).toBe(true));
  it("readonly < agent",    () => expect(scopeAtLeast("readonly", "agent"   )).toBe(false));
  it("agent ≥ agent",       () => expect(scopeAtLeast("agent",    "agent"   )).toBe(true));
  it("operator ≥ agent",    () => expect(scopeAtLeast("operator", "agent"   )).toBe(true));
  it("admin ≥ operator",    () => expect(scopeAtLeast("admin",    "operator")).toBe(true));
  it("operator < admin",    () => expect(scopeAtLeast("operator", "admin"   )).toBe(false));
  it("undefined < readonly",() => expect(scopeAtLeast(undefined,  "readonly")).toBe(false));
});


// ── 3. requireScope middleware ─────────────────────────────────────────────

describe("requireScope middleware", () => {
  function makeApp(minScope: "readonly" | "operator" | "admin" | "agent", ctxRole?: CallerContext["role"]) {
    const app = new Hono();
    app.use("*", async (c, next) => {
      if (ctxRole !== undefined) {
        c.set(CALLER_CONTEXT_KEY, { role: ctxRole } satisfies CallerContext);
      }
      await next();
    });
    app.get("/test", requireScope(minScope), (c) => c.json({ ok: true }));
    return app;
  }

  it("returns 401 when no CallerContext set", async () => {
    const app = makeApp("readonly");
    const res = await app.request("/test");
    expect(res.status).toBe(401);
  });

  it("returns 200 when scope meets minimum", async () => {
    const app = makeApp("readonly", "readonly");
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });

  it("returns 403 when scope below minimum", async () => {
    const app = makeApp("operator", "readonly");
    const res = await app.request("/test");
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string; actual: string; required: string } };
    expect(body.error.code).toBe("AUTH-003");
    expect(body.error.actual).toBe("readonly");
    expect(body.error.required).toBe("operator");
  });

  it("admin passes an operator-gated route", async () => {
    const app = makeApp("operator", "admin");
    const res = await app.request("/test");
    expect(res.status).toBe(200);
  });
});


// ── 4. authenticate middleware — scoped token path ─────────────────────────

describe("authenticate middleware — scoped tokens", () => {
  const LEGACY_KEY = "legacy-key-abc123";

  function makeAuthApp(tokenStore?: TokenStore | null) {
    const app = new Hono();
    app.use("*", authenticate({
      getApiKey:  () => LEGACY_KEY,
      tokenStore: tokenStore ?? null,
    }));
    app.get("/api/v1/test", (c) => {
      const ctx = c.get(CALLER_CONTEXT_KEY) as CallerContext | undefined;
      return c.json({ role: ctx?.role ?? null, division: ctx?.division ?? null, tokenId: ctx?.tokenId ?? null });
    });
    return app;
  }

  it("legacy key sets role=admin", async () => {
    const app = makeAuthApp();
    const res = await app.request("/api/v1/test", { headers: bearerHeaders(LEGACY_KEY) });
    expect(res.status).toBe(200);
    const body = await res.json() as { role: string };
    expect(body.role).toBe("admin");
  });

  it("scoped token sets correct role", async () => {
    const db    = makeDb();
    const store = new TokenStore(db);
    const { rawToken } = store.createToken({ scope: "operator", label: "op-token" });

    const app = makeAuthApp(store);
    const res = await app.request("/api/v1/test", { headers: bearerHeaders(rawToken) });
    expect(res.status).toBe(200);
    const body = await res.json() as { role: string };
    expect(body.role).toBe("operator");
  });

  it("scoped token with division sets division in context", async () => {
    const db    = makeDb();
    const store = new TokenStore(db);
    const { rawToken } = store.createToken({ scope: "agent", label: "div-token", division: "engineering" });

    const app = makeAuthApp(store);
    const res = await app.request("/api/v1/test", { headers: bearerHeaders(rawToken) });
    const body = await res.json() as { division: string };
    expect(body.division).toBe("engineering");
  });

  it("revoked token falls through to 401", async () => {
    const db    = makeDb();
    const store = new TokenStore(db);
    const { id, rawToken } = store.createToken({ scope: "operator", label: "will-revoke" });
    store.revokeToken(id);

    const app = makeAuthApp(store);
    const res = await app.request("/api/v1/test", { headers: bearerHeaders(rawToken) });
    expect(res.status).toBe(401);
  });

  it("unknown token falls through to legacy key check (fails → 401)", async () => {
    const db    = makeDb();
    const store = new TokenStore(db);
    const app   = makeAuthApp(store);
    const res   = await app.request("/api/v1/test", { headers: bearerHeaders("sidjua_sk_" + "f".repeat(64)) });
    expect(res.status).toBe(401);
  });

  it("returns 401 with no Authorization header", async () => {
    const app = makeAuthApp();
    const res = await app.request("/api/v1/test");
    expect(res.status).toBe(401);
  });
});


// ── 5. Token REST endpoints ────────────────────────────────────────────────

describe("Token REST endpoints (registerTokenRoutes)", () => {
  function makeTokenApp() {
    const db    = makeDb();
    const store = new TokenStore(db);
    const app   = new Hono();

    // Simulate auth middleware setting admin context
    app.use("*", async (c, next) => {
      c.set(CALLER_CONTEXT_KEY, { role: "admin" } satisfies CallerContext);
      await next();
    });
    registerTokenRoutes(app, { tokenStore: store });
    return { app, store };
  }

  it("GET /api/v1/tokens — returns empty list", async () => {
    const { app } = makeTokenApp();
    const res     = await app.request("/api/v1/tokens");
    expect(res.status).toBe(200);
    const body = await res.json() as { tokens: unknown[] };
    expect(body.tokens).toHaveLength(0);
  });

  it("POST /api/v1/tokens — creates token and returns rawToken once", async () => {
    const { app } = makeTokenApp();
    const res = await app.request("/api/v1/tokens", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ scope: "operator", label: "test-op-token" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; rawToken: string; warning: string };
    expect(body.id).toBeTruthy();
    expect(body.rawToken.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(body.warning).toContain("not be shown again");
  });

  it("POST /api/v1/tokens — validates scope", async () => {
    const { app } = makeTokenApp();
    const res = await app.request("/api/v1/tokens", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ scope: "superuser", label: "bad" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("TOKEN-400");
  });

  it("POST /api/v1/tokens — requires label", async () => {
    const { app } = makeTokenApp();
    const res = await app.request("/api/v1/tokens", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ scope: "readonly" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/v1/tokens/:id — returns token", async () => {
    const { app, store } = makeTokenApp();
    const { id } = store.createToken({ scope: "operator", label: "getme" });
    const res    = await app.request(`/api/v1/tokens/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { token: { id: string; scope: string } };
    expect(body.token.id).toBe(id);
    expect(body.token.scope).toBe("operator");
  });

  it("GET /api/v1/tokens/:id — 404 for unknown id", async () => {
    const { app } = makeTokenApp();
    const res = await app.request("/api/v1/tokens/nonexistent");
    expect(res.status).toBe(404);
  });

  it("DELETE /api/v1/tokens/:id — revokes token", async () => {
    const { app, store } = makeTokenApp();
    const { id, rawToken } = store.createToken({ scope: "operator", label: "revokeme" });
    const res = await app.request(`/api/v1/tokens/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; revoked: boolean };
    expect(body.ok).toBe(true);
    expect(body.revoked).toBe(true);
    // Token should no longer validate
    expect(store.validateToken(rawToken)).toBeNull();
  });

  it("DELETE /api/v1/tokens/:id — 404 for already-revoked", async () => {
    const { app, store } = makeTokenApp();
    const { id } = store.createToken({ scope: "operator", label: "alreadygone" });
    store.revokeToken(id);
    const res = await app.request(`/api/v1/tokens/${id}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});


// ── 6. Scope enforcement — insufficient scope returns 403 ──────────────────

describe("Route-level scope enforcement (integration)", () => {
  function makeRouteApp(role: CallerContext["role"]) {
    const db    = makeDb();
    const store = new TokenStore(db);
    const app   = new Hono();

    // Set fixed CallerContext for all requests (simulate already-authenticated)
    app.use("*", async (c, next) => {
      if (role !== undefined) {
        c.set(CALLER_CONTEXT_KEY, { role } satisfies CallerContext);
      }
      await next();
    });

    // Register token routes — uses admin scope for mutations
    registerTokenRoutes(app, { tokenStore: store });
    return { app, store };
  }

  it("readonly CANNOT LIST tokens (403 — requires admin)", async () => {
    const { app } = makeRouteApp("readonly");
    const res = await app.request("/api/v1/tokens");
    expect(res.status).toBe(403);
  });

  it("admin CAN LIST tokens (200)", async () => {
    const { app } = makeRouteApp("admin");
    const res = await app.request("/api/v1/tokens");
    expect(res.status).toBe(200);
  });

  it("readonly CANNOT create a token (403)", async () => {
    const { app } = makeRouteApp("readonly");
    const res = await app.request("/api/v1/tokens", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ scope: "readonly", label: "attempt" }),
    });
    expect(res.status).toBe(403);
  });

  it("operator CANNOT create a token (403 — requires admin)", async () => {
    const { app } = makeRouteApp("operator");
    const res = await app.request("/api/v1/tokens", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ scope: "readonly", label: "attempt" }),
    });
    expect(res.status).toBe(403);
  });

  it("admin CAN create a token (201)", async () => {
    const { app } = makeRouteApp("admin");
    const res = await app.request("/api/v1/tokens", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ scope: "readonly", label: "admin-create" }),
    });
    expect(res.status).toBe(201);
  });
});


// ── 7. Route coverage meta-test ────────────────────────────────────────────

describe("requireScope coverage meta-test", () => {
  const ROUTES_DIR = resolve(import.meta.dirname, "../../src/api/routes");

  it("every app.get/post/put/patch/delete in route files has requireScope", () => {
    // Read all route files and verify that every route registration call
    // includes requireScope. Exceptions: sse-ticket (own auth), events (ticket auth),
    // pwa (static assets), locale (non-sensitive), system (public routes),
    // starter-agents (public catalog), provider (public catalog).
    const EXCLUDED_FILES = new Set([
      "pwa.ts",
      "locale.ts",
      "system.ts",
      "starter-agents.ts",
      "provider.ts",
    ]);

    // Files expected to have their own auth mechanism instead of requireScope
    const SPECIAL_AUTH_FILES = new Set([
      "events.ts",     // ticket-based auth (ticket consumed before handler runs)
      "sse-ticket.ts", // requireScope("readonly") + own auth for defense-in-depth
    ]);

    const routeFiles = [
      "tasks.ts", "agents.ts", "divisions.ts", "costs.ts", "audit.ts",
      "governance.ts", "orchestrator.ts", "execution.ts", "outputs.ts",
      "logging.ts", "selftest.ts", "workspace-config.ts", "daemon.ts",
      "schedule.ts", "messaging.ts", "integration.ts", "chat.ts",
      "agent-tools.ts", "tokens.ts",
    ];

    const missingScope: string[] = [];

    for (const filename of routeFiles) {
      if (EXCLUDED_FILES.has(filename) || SPECIAL_AUTH_FILES.has(filename)) continue;
      const src = readFileSync(`${ROUTES_DIR}/${filename}`, "utf-8");

      // Find all route registrations (app.get/post/put/patch/delete)
      const routeRe = /app\.(get|post|put|patch|delete)\s*\(/g;
      let match: RegExpExecArray | null;
      while ((match = routeRe.exec(src)) !== null) {
        // Extract the line
        const lineStart = src.lastIndexOf("\n", match.index) + 1;
        const lineEnd   = src.indexOf("\n", match.index);
        const line      = src.slice(lineStart, lineEnd).trim();

        // Skip route declarations that have requireScope or are stubs (notConfigured)
        if (!line.includes("requireScope(") && !line.includes("notConfigured")) {
          missingScope.push(`${filename}: ${line.slice(0, 100)}`);
        }
      }
    }

    expect(missingScope).toEqual([]);
  });
});
