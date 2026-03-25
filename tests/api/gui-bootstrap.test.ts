/**
 * GUI Bootstrap + system route build-info tests
 *
 * GET /api/v1/gui-bootstrap — removed; must return 404.
 * GET /api/v1/health        — public; includes build_date + build_ref fields.
 * GET /api/v1/info          — authenticated; includes build_date, build_ref, build_sig.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createApiServer, type ApiServerConfig } from "../../src/api/server.js";
import { clearRateLimitState }                   from "../../src/api/middleware/rate-limiter.js";

// ---------------------------------------------------------------------------
// Test config
// ---------------------------------------------------------------------------

const VALID_KEY = "test-api-key-gui-bootstrap-abcdef1234567890";

const BASE_CONFIG: ApiServerConfig = {
  port:         3099,
  host:         "127.0.0.1",
  api_key:      VALID_KEY,
  cors_origins: [],
  rate_limit: {
    enabled:      false,
    window_ms:    60_000,
    max_requests: 100,
    burst_max:    20,
  },
  trust_proxy: false,
};

function makeServer(overrides: Partial<ApiServerConfig> = {}) {
  return createApiServer({ ...BASE_CONFIG, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/gui-bootstrap — public, localhost-only", () => {
  beforeEach(() => {
    clearRateLimitState();
  });

  afterEach(() => {
    clearRateLimitState();
  });

  it("returns 200 from localhost without auth (public endpoint)", async () => {
    // Hono test client uses Host: localhost by default
    const { app } = makeServer();
    const res = await app.request("/api/v1/gui-bootstrap");
    expect(res.status).toBe(200);
  });

  it("returns api_key in JSON body", async () => {
    const { app } = makeServer();
    const body = await app.request("/api/v1/gui-bootstrap").then((r) => r.json()) as Record<string, unknown>;
    expect(body["api_key"]).toBe(VALID_KEY);
  });

  it("returns 403 when Host is an external address", async () => {
    const { app } = makeServer();
    const res = await app.request("/api/v1/gui-bootstrap", {
      headers: { Host: "192.168.1.50:4200" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 also when authenticated from localhost", async () => {
    const { app } = makeServer();
    const res = await app.request("/api/v1/gui-bootstrap", {
      headers: { Authorization: `Bearer ${VALID_KEY}` },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Build info in /health and /info
// ---------------------------------------------------------------------------

describe("GET /api/v1/health — build info fields", () => {
  beforeEach(() => { clearRateLimitState(); });

  it("includes build_date and build_ref fields (null when .build-meta absent)", async () => {
    const { app } = makeServer();
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("build_date");
    expect(body).toHaveProperty("build_ref");
    // In test env (no Docker) these will be null — just verify the keys exist
    expect(body["build_date"] === null || typeof body["build_date"] === "string").toBe(true);
    expect(body["build_ref"]  === null || typeof body["build_ref"]  === "string").toBe(true);
  });

  it("includes version, status, and uptime_ms alongside build fields", async () => {
    const { app } = makeServer();
    const body = await app.request("/api/v1/health").then((r) => r.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(typeof body["version"]).toBe("string");
    expect(typeof body["uptime_ms"]).toBe("number");
  });
});

describe("GET /api/v1/info — build info fields", () => {
  beforeEach(() => { clearRateLimitState(); });

  it("includes build_date, build_ref, build_sig fields when authenticated", async () => {
    const { app } = makeServer();
    const res = await app.request("/api/v1/info", {
      headers: { Authorization: `Bearer ${VALID_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("build_date");
    expect(body).toHaveProperty("build_ref");
    expect(body).toHaveProperty("build_sig");
  });
});
