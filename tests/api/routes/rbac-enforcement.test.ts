// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P273 — RBAC lockdown regression tests.
 *
 * Verifies that every route in the 5 affected files enforces the correct
 * scope. For each route group we check:
 *   1. No CallerContext → 401 (unauthenticated)
 *   2. Scope too low   → 403 (insufficient privileges)
 *   3. Correct scope   → 200 / success
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono }              from "hono";
import type { MiddlewareHandler } from "hono";
import { CALLER_CONTEXT_KEY } from "../../../src/api/middleware/require-scope.js";
import { createErrorHandler } from "../../../src/api/middleware/error-handler.js";

// Route registrars
import { registerProviderRoutes, clearProviderTestRateLimit } from "../../../src/api/routes/provider.js";
import { registerTokenRoutes }    from "../../../src/api/routes/tokens.js";
import { registerLocaleRoutes }   from "../../../src/api/routes/locale.js";
import { createSystemRoutes }     from "../../../src/api/routes/system.js";
import { registerStarterAgentRoutes } from "../../../src/api/routes/starter-agents.js";

// Minimal TokenStore stub for token routes
import type { TokenRouteServices } from "../../../src/api/routes/tokens.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hono middleware that sets the given role as CallerContext. */
function withCtx(role: "admin" | "operator" | "agent" | "readonly"): MiddlewareHandler {
  return (c, next) => {
    c.set(CALLER_CONTEXT_KEY, { role });
    return next();
  };
}

/** Hono middleware that sets NO CallerContext (simulates unauthenticated). */
const withNoCtx: MiddlewareHandler = (_c, next) => next();

function makeTokenServices(): TokenRouteServices {
  return {
    tokenStore: {
      listTokens:   () => [],
      getToken:     () => null,
      createToken:  () => ({ id: "t1", rawToken: "raw" }),
      revokeToken:  () => true,
    } as unknown as TokenRouteServices["tokenStore"],
  };
}

// ---------------------------------------------------------------------------
// A1: Provider routes
// ---------------------------------------------------------------------------

describe("A1: Provider routes — RBAC", () => {
  beforeEach(() => { clearProviderTestRateLimit(); });

  function makeApp(role?: "admin" | "operator" | "agent" | "readonly") {
    const app = new Hono();
    if (role !== undefined) {
      app.use("*", withCtx(role));
    } else {
      app.use("*", withNoCtx);
    }
    registerProviderRoutes(app);
    app.onError(createErrorHandler(false));
    return app;
  }

  it("GET /provider/catalog — no auth → 401", async () => {
    const res = await makeApp().request("/api/v1/provider/catalog");
    expect(res.status).toBe(401);
  });

  it("GET /provider/catalog — readonly → 200", async () => {
    const res = await makeApp("readonly").request("/api/v1/provider/catalog");
    expect(res.status).toBe(200);
  });

  it("GET /provider/config — no auth → 401", async () => {
    const res = await makeApp().request("/api/v1/provider/config");
    expect(res.status).toBe(401);
  });

  it("GET /provider/config — operator (below admin) → 403", async () => {
    const res = await makeApp("operator").request("/api/v1/provider/config");
    expect(res.status).toBe(403);
  });

  it("GET /provider/config — admin → 200", async () => {
    const res = await makeApp("admin").request("/api/v1/provider/config");
    expect(res.status).toBe(200);
  });

  it("DELETE /provider/config — no auth → 401", async () => {
    const res = await makeApp().request("/api/v1/provider/config", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("DELETE /provider/config — operator → 403", async () => {
    const res = await makeApp("operator").request("/api/v1/provider/config", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  it("DELETE /provider/config — admin → 200", async () => {
    const res = await makeApp("admin").request("/api/v1/provider/config", { method: "DELETE" });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// A2: Token routes — all must be admin
// ---------------------------------------------------------------------------

describe("A2: Token routes — all require admin", () => {
  function makeApp(role?: "admin" | "operator" | "agent" | "readonly") {
    const app = new Hono();
    if (role !== undefined) {
      app.use("*", withCtx(role));
    } else {
      app.use("*", withNoCtx);
    }
    registerTokenRoutes(app, makeTokenServices());
    app.onError(createErrorHandler(false));
    return app;
  }

  it("GET /tokens — no auth → 401", async () => {
    const res = await makeApp().request("/api/v1/tokens");
    expect(res.status).toBe(401);
  });

  it("GET /tokens — readonly (below admin) → 403", async () => {
    const res = await makeApp("readonly").request("/api/v1/tokens");
    expect(res.status).toBe(403);
  });

  it("GET /tokens — admin → 200", async () => {
    const res = await makeApp("admin").request("/api/v1/tokens");
    expect(res.status).toBe(200);
  });

  it("GET /tokens/:id — no auth → 401", async () => {
    const res = await makeApp().request("/api/v1/tokens/t1");
    expect(res.status).toBe(401);
  });

  it("GET /tokens/:id — operator → 403", async () => {
    const res = await makeApp("operator").request("/api/v1/tokens/t1");
    expect(res.status).toBe(403);
  });

  it("GET /tokens/:id — admin → 404 (token not found, but scope passed)", async () => {
    // 404 here means scope was accepted (token simply doesn't exist)
    const res = await makeApp("admin").request("/api/v1/tokens/nonexistent");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// A3: Locale routes
// ---------------------------------------------------------------------------

describe("A3: Locale routes — RBAC", () => {
  function makeApp(role?: "admin" | "operator" | "agent" | "readonly") {
    const app = new Hono();
    if (role !== undefined) {
      app.use("*", withCtx(role));
    } else {
      app.use("*", withNoCtx);
    }
    registerLocaleRoutes(app, { db: null });
    app.onError(createErrorHandler(false));
    return app;
  }

  it("GET /locale — no auth → 200 (public endpoint)", async () => {
    const res = await makeApp().request("/api/v1/locale");
    expect(res.status).toBe(200);
  });

  it("GET /locale — readonly → 200", async () => {
    const res = await makeApp("readonly").request("/api/v1/locale");
    expect(res.status).toBe(200);
  });

  it("POST /config/locale — no auth → 401", async () => {
    const res = await makeApp().request("/api/v1/config/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /config/locale — agent (below operator) → 403", async () => {
    const res = await makeApp("agent").request("/api/v1/config/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /config/locale — operator → 200", async () => {
    const res = await makeApp("operator").request("/api/v1/config/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "en" }),
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// A4: System /info route
// ---------------------------------------------------------------------------

describe("A4: System /info — requireScope(readonly)", () => {
  function makeApp(role?: "admin" | "operator" | "agent" | "readonly") {
    const systemApp = createSystemRoutes();
    const app = new Hono();
    if (role !== undefined) {
      app.use("*", withCtx(role));
    } else {
      app.use("*", withNoCtx);
    }
    app.route("/api/v1", systemApp);
    app.onError(createErrorHandler(false));
    return app;
  }

  it("GET /info — no auth → 401", async () => {
    const res = await makeApp().request("/api/v1/info");
    expect(res.status).toBe(401);
  });

  it("GET /info — readonly → 200", async () => {
    const res = await makeApp("readonly").request("/api/v1/info");
    expect(res.status).toBe(200);
  });

  it("GET /health — no auth → 200 (public endpoint unchanged)", async () => {
    const res = await makeApp().request("/api/v1/health");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// A5: Starter agents — public catalog
// ---------------------------------------------------------------------------

describe("A5: Starter agent routes — public catalog", () => {
  function makeApp() {
    const app = new Hono();
    app.use("*", withNoCtx); // no auth
    registerStarterAgentRoutes(app);
    app.onError(createErrorHandler(false));
    return app;
  }

  it("GET /starter-agents — no auth → 200 (public catalog)", async () => {
    const res = await makeApp().request("/api/v1/starter-agents");
    expect(res.status).toBe(200);
  });

  it("GET /starter-divisions — no auth → 200 (public catalog)", async () => {
    const res = await makeApp().request("/api/v1/starter-divisions");
    expect(res.status).toBe(200);
  });
});
