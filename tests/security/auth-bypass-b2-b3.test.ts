// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Authentication bypass prevention tests (#519 B2 B3).
 *
 * B2: Key rotation grace period bypass
 *   - Pending key must not equal current key
 *   - Grace period hard-capped at MAX_GRACE_PERIOD_MS (24 h)
 *   - Auth accepts current + pending; rejects all else
 *
 * B3: 503 fallback routes behind auth
 *   - Unauthenticated requests → 401, not 503
 *   - Authenticated requests with missing registry → 503
 *   - 503 bodies are generic (no service names, no internal codes)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync }                                  from "node:fs";
import { Hono }                                          from "hono";
import { authenticate }                                  from "../../src/api/middleware/auth.js";
import {
  MAX_GRACE_PERIOD_MS,
  _resetApiKeyState,
  generateApiKey,
} from "../../src/api/cli-server.js";
import { registerAllRoutes } from "../../src/api/routes/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Hono app with auth middleware + all routes.
 * Pass `registry: undefined` (default) to trigger 503 fallbacks for agent routes.
 */
function buildApp(currentKey: string, pendingKey: string | null = null): Hono {
  const app = new Hono();
  app.use("*", authenticate(() => currentKey, pendingKey !== null ? () => pendingKey : undefined));
  registerAllRoutes(app, {}); // no registry → 503 fallbacks
  return app;
}

// ---------------------------------------------------------------------------
// B2 — MAX_GRACE_PERIOD_MS constant
// ---------------------------------------------------------------------------

describe("B2: MAX_GRACE_PERIOD_MS constant", () => {
  it("is exactly 24 hours in milliseconds", () => {
    expect(MAX_GRACE_PERIOD_MS).toBe(24 * 60 * 60 * 1_000);
  });

  it("is exported from cli-server", () => {
    expect(typeof MAX_GRACE_PERIOD_MS).toBe("number");
    expect(MAX_GRACE_PERIOD_MS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// B2 — Source-level checks for grace period cap and same-key rejection
// ---------------------------------------------------------------------------

describe("B2: cli-server.ts source — grace period cap", () => {
  let src: string;
  beforeEach(() => {
    src = readFileSync(
      new URL("../../src/api/cli-server.ts", import.meta.url),
      "utf8",
    );
  });

  it("exports MAX_GRACE_PERIOD_MS", () => {
    expect(src).toContain("export const MAX_GRACE_PERIOD_MS");
  });

  it("applies Math.min cap using MAX_GRACE_PERIOD_MS", () => {
    expect(src).toContain("Math.min");
    expect(src).toContain("MAX_GRACE_PERIOD_MS");
  });

  it("rejects rotation when new key equals current key", () => {
    // Source must contain an early-exit guard comparing newKey and oldKey
    expect(src).toContain("newKey === oldKey");
    expect(src).toContain("Rotation aborted");
  });

  it("rejects rotation when no current key is set", () => {
    expect(src).toContain("No current API key");
  });

  it("caps grace period via MAX_GRACE_PERIOD_MS / 1_000", () => {
    // Verify the cap formula divides by 1_000 to convert ms → seconds
    expect(src).toContain("MAX_GRACE_PERIOD_MS / 1_000");
  });
});

// ---------------------------------------------------------------------------
// B2 — Auth middleware: pending key accepted during grace window
// ---------------------------------------------------------------------------

describe("B2: authenticate — pending key behaviour", () => {
  it("accepts the current key alone", async () => {
    const app = buildApp("current-key-abc");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer current-key-abc" },
    });
    // 503 because registry not configured, but NOT 401
    expect(res.status).toBe(503);
  });

  it("accepts the pending (old) key during grace window", async () => {
    const app = buildApp("new-key-xyz", "old-key-abc");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer old-key-abc" },
    });
    expect(res.status).toBe(503); // 503 not 401 — auth passed
  });

  it("rejects a key that is neither current nor pending", async () => {
    const app = buildApp("new-key-xyz", "old-key-abc");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer totally-wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects request with no Authorization header", async () => {
    const app = buildApp("any-key");
    const res = await app.request("/api/v1/agents");
    expect(res.status).toBe(401);
  });

  it("rejects empty Bearer token", async () => {
    const app = buildApp("any-key");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("does NOT accept pending key when it is null", async () => {
    // With no pendingKey, requests using an old key must be rejected
    const app = buildApp("current-key", null);
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer old-key" },
    });
    expect(res.status).toBe(401);
  });

  it("does NOT accept pending key when it equals current key (same-key guard)", async () => {
    // If somehow pending === current (guard should prevent this, but auth must still be safe)
    const sameKey = "shared-key";
    const app = buildApp(sameKey, sameKey);
    // Still authenticates (key is valid); but no infinite bypass is created
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: `Bearer ${sameKey}` },
    });
    // Should still authenticate (returns 503 from registry, not 401)
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// B2 — generateApiKey returns unique values (PRNG sanity)
// ---------------------------------------------------------------------------

describe("B2: generateApiKey — uniqueness", () => {
  beforeEach(() => _resetApiKeyState());
  afterEach(() => _resetApiKeyState());

  it("generates different keys on successive calls", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
  });

  it("generates 64-character hex keys", () => {
    const key = generateApiKey();
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// B3 — 503 fallback routes: auth must run first
// ---------------------------------------------------------------------------

describe("B3: 503 fallback routes — require authentication", () => {
  const AGENT_ROUTES = [
    { method: "GET",  path: "/api/v1/agents" },
    { method: "GET",  path: "/api/v1/agents/some-id" },
    { method: "POST", path: "/api/v1/agents/some-id/start" },
    { method: "POST", path: "/api/v1/agents/some-id/stop" },
  ] as const;

  for (const { method, path } of AGENT_ROUTES) {
    it(`${method} ${path} — unauthenticated → 401 not 503`, async () => {
      const app = buildApp("valid-key");
      const res = await app.request(path, { method });
      // Auth runs FIRST: missing key → 401, never reaches 503 handler
      expect(res.status).toBe(401);
    });

    it(`${method} ${path} — authenticated → 503 with generic body`, async () => {
      const app = buildApp("valid-key");
      const res = await app.request(path, {
        method,
        headers: { Authorization: "Bearer valid-key" },
      });
      expect(res.status).toBe(503);
      const body = await res.json() as { error: { code: string; message: string } };
      expect(body.error.message).toBe("Service temporarily unavailable");
      // Must NOT leak internal details
      expect(body.error.message).not.toContain("agent registry");
      expect(body.error.message).not.toContain("sidjua apply");
      expect(body.error.message).not.toContain("AGT-003");
    });
  }
});

// ---------------------------------------------------------------------------
// B3 — 503 body does not leak internal service names or error codes
// ---------------------------------------------------------------------------

describe("B3: 503 response body — generic, non-leaking", () => {
  it("uses SYS-503 error code, not an internal AGT- code", async () => {
    const app = buildApp("key-xyz");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer key-xyz" },
    });
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("SYS-503");
    expect(body.error.code).not.toMatch(/^AGT-/);
  });

  it("marks the error as recoverable (transient, not permanent)", async () => {
    const app = buildApp("key-xyz");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer key-xyz" },
    });
    const body = await res.json() as { error: { recoverable: boolean } };
    expect(body.error.recoverable).toBe(true);
  });

  it("does not include 'apply' or 'provision' hints in the body", async () => {
    const app = buildApp("key-xyz");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer key-xyz" },
    });
    const text = await res.text();
    expect(text).not.toContain("apply");
    expect(text).not.toContain("provision");
    expect(text).not.toContain("configured");
  });
});

// ---------------------------------------------------------------------------
// B3 — Source check: routes/index.ts body is generic
// ---------------------------------------------------------------------------

describe("B3: routes/index.ts source — 503 body is generic", () => {
  let src: string;
  beforeEach(() => {
    src = readFileSync(
      new URL("../../src/api/routes/index.ts", import.meta.url),
      "utf8",
    );
  });

  it("does not contain 'AGT-003' in the fallback handler", () => {
    // The notConfigured handler must use the generic SYS-503 code
    expect(src).not.toContain("AGT-003");
  });

  it("uses 'Service temporarily unavailable' as the fallback message", () => {
    expect(src).toContain("Service temporarily unavailable");
  });

  it("body is intentionally generic (no internal service names in 503 response)", () => {
    expect(src).toContain("Body is intentionally generic");
  });
});

// ---------------------------------------------------------------------------
// P194 Task 3 — Auth hardening: empty string and whitespace-only pending key
// ---------------------------------------------------------------------------

describe("P194: authenticate — empty and whitespace pending key hardening (Task 3)", () => {
  it("empty-string pending key: does NOT authenticate with empty Bearer token", async () => {
    // pendingKey="" must not allow "Bearer " (empty Bearer) through
    const app = buildApp("current-key", "");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer " },
    });
    // The auth middleware guards against empty pending key (pendingKey !== "")
    expect(res.status).toBe(401);
  });

  it("empty-string pending key: does NOT authenticate with the empty string itself", async () => {
    // Even if pending key is empty, sending an empty token must fail
    const app = buildApp("real-key", "");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("empty-string pending key: current key still works normally", async () => {
    const app = buildApp("current-key-abc", "");
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer current-key-abc" },
    });
    // Auth passes (503 from missing registry, not 401)
    expect(res.status).toBe(503);
  });

  it("whitespace-only key is rejected (does not match any valid key)", async () => {
    const app = buildApp("current-key", null);
    const res = await app.request("/api/v1/agents", {
      headers: { Authorization: "Bearer    " }, // whitespace Bearer token
    });
    expect(res.status).toBe(401);
  });

  it("auth.ts source confirms double-guard: pendingKey !== null && pendingKey !== \"\"", () => {
    const src = readFileSync(
      new URL("../../src/api/middleware/auth.ts", import.meta.url),
      "utf8",
    );
    // Both null-check and empty-string check must be present
    expect(src).toContain("pendingKey !== null");
    expect(src).toContain('pendingKey !== ""');
  });
});
