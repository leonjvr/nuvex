// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Starter agent and starter division REST API tests.
 *
 *   - GET /api/v1/starter-agents → 200, returns 6 agents
 *   - GET /api/v1/starter-agents/:id → 200, correct agent
 *   - GET /api/v1/starter-agents/nonexistent → 404
 *   - GET /api/v1/starter-divisions → 200, system division
 *   - System division has protected: true and agent_count: 6
 *   - Content-Type: application/json on all endpoints
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createErrorHandler } from "../../src/api/middleware/error-handler.js";
import { registerStarterAgentRoutes } from "../../src/api/routes/starter-agents.js";

function buildApp(): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(false));
  registerStarterAgentRoutes(app);
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/v1/starter-agents
// ---------------------------------------------------------------------------

describe("GET /api/v1/starter-agents", () => {
  it("returns 200", async () => {
    const res = await buildApp().request("/api/v1/starter-agents");
    expect(res.status).toBe(200);
  });

  it("Content-Type is application/json", async () => {
    const res = await buildApp().request("/api/v1/starter-agents");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns exactly 6 agents", async () => {
    const res  = await buildApp().request("/api/v1/starter-agents");
    const body = await res.json() as { agents: unknown[] };
    expect(body.agents).toHaveLength(6);
  });

  it("each agent has id, name, description, icon, tier, domains, capabilities, status", async () => {
    const res  = await buildApp().request("/api/v1/starter-agents");
    const body = await res.json() as { agents: Record<string, unknown>[] };
    for (const agent of body.agents) {
      expect(typeof agent["id"]).toBe("string");
      expect(typeof agent["name"]).toBe("string");
      expect(typeof agent["description"]).toBe("string");
      expect(typeof agent["icon"]).toBe("string");
      expect([1, 2, 3]).toContain(agent["tier"]);
      expect(Array.isArray(agent["domains"])).toBe(true);
      expect(Array.isArray(agent["capabilities"])).toBe(true);
      expect(["active", "inactive"]).toContain(agent["status"]);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/starter-agents/:id
// ---------------------------------------------------------------------------

describe("GET /api/v1/starter-agents/:id", () => {
  it("returns 200 for 'guide'", async () => {
    const res = await buildApp().request("/api/v1/starter-agents/guide");
    expect(res.status).toBe(200);
  });

  it("returns correct agent for 'auditor'", async () => {
    const res  = await buildApp().request("/api/v1/starter-agents/auditor");
    const body = await res.json() as { agent: Record<string, unknown> };
    expect(body.agent["id"]).toBe("auditor");
    expect(body.agent["name"]).toBe("Auditor");
    const domains = body.agent["domains"] as string[];
    expect(domains).toContain("finance");
    expect(domains).toContain("it");
    expect(domains).toContain("compliance");
  });

  it("returns 404 for nonexistent agent", async () => {
    const res = await buildApp().request("/api/v1/starter-agents/nonexistent");
    expect(res.status).toBe(404);
  });

  it("404 response is JSON", async () => {
    const res = await buildApp().request("/api/v1/starter-agents/ghost");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns guide with tier 3", async () => {
    const res  = await buildApp().request("/api/v1/starter-agents/guide");
    const body = await res.json() as { agent: Record<string, unknown> };
    expect(body.agent["tier"]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/starter-divisions
// ---------------------------------------------------------------------------

describe("GET /api/v1/starter-divisions", () => {
  it("returns 200", async () => {
    const res = await buildApp().request("/api/v1/starter-divisions");
    expect(res.status).toBe(200);
  });

  it("Content-Type is application/json", async () => {
    const res = await buildApp().request("/api/v1/starter-divisions");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns at least 1 division", async () => {
    const res  = await buildApp().request("/api/v1/starter-divisions");
    const body = await res.json() as { divisions: unknown[] };
    expect(body.divisions.length).toBeGreaterThanOrEqual(1);
  });

  it("system division has protected: true", async () => {
    const res  = await buildApp().request("/api/v1/starter-divisions");
    const body = await res.json() as { divisions: Record<string, unknown>[] };
    const sys  = body.divisions.find((d) => d["id"] === "system");
    expect(sys?.["protected"]).toBe(true);
  });

  it("system division has agent_count: 6", async () => {
    const res  = await buildApp().request("/api/v1/starter-divisions");
    const body = await res.json() as { divisions: Record<string, unknown>[] };
    const sys  = body.divisions.find((d) => d["id"] === "system");
    expect(sys?.["agent_count"]).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/starter-divisions/:id
// ---------------------------------------------------------------------------

describe("GET /api/v1/starter-divisions/:id", () => {
  it("returns 200 for 'system'", async () => {
    const res = await buildApp().request("/api/v1/starter-divisions/system");
    expect(res.status).toBe(200);
  });

  it("returns 404 for unknown division", async () => {
    const res = await buildApp().request("/api/v1/starter-divisions/unknown");
    expect(res.status).toBe(404);
  });

  it("system division has budget object", async () => {
    const res  = await buildApp().request("/api/v1/starter-divisions/system");
    const body = await res.json() as { division: Record<string, unknown> };
    const budget = body.division["budget"] as Record<string, unknown>;
    expect(typeof budget["daily_limit_usd"]).toBe("number");
    expect(typeof budget["monthly_cap_usd"]).toBe("number");
  });
});
