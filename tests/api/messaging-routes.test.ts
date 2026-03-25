/**
 * V1.1 — Messaging API routes unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerMessagingRoutes } from "../../src/api/routes/messaging.js";
import type {
  AdapterRegistryLike,
  UserMappingStoreLike,
  MessagingRouteServices,
} from "../../src/api/routes/messaging.js";
import { withAdminCtx } from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(overrides: Partial<AdapterRegistryLike> = {}): AdapterRegistryLike {
  return {
    getAllInstances:  vi.fn().mockReturnValue([
      { instanceId: "inst-1", channel: "telegram", healthy: true },
    ]),
    getInstance:     vi.fn().mockReturnValue({ channel: "telegram", isHealthy: () => true }),
    startInstance:   vi.fn().mockResolvedValue(undefined),
    stopInstance:    vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeUserMapping(overrides: Partial<UserMappingStoreLike> = {}): UserMappingStoreLike {
  return {
    listMappings:  vi.fn().mockReturnValue([]),
    mapUser:       vi.fn().mockResolvedValue(undefined),
    unmapUser:     vi.fn().mockResolvedValue(undefined),
    isAuthorized:  vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

function makeApp(services: MessagingRouteServices = {}): Hono {
  const app = new Hono();
  app.use("*", withAdminCtx);
  registerMessagingRoutes(app, services);
  return app;
}

// ---------------------------------------------------------------------------
// Tests — 503 when not configured
// ---------------------------------------------------------------------------

describe("Messaging routes — no gateway configured", () => {
  const app = makeApp(); // empty services

  it("GET /api/v1/messaging/instances → 503", async () => {
    const res = await app.request("/api/v1/messaging/instances");
    expect(res.status).toBe(503);
  });

  it("GET /api/v1/messaging/instances/:id → 503", async () => {
    const res = await app.request("/api/v1/messaging/instances/inst-1");
    expect(res.status).toBe(503);
  });

  it("POST /api/v1/messaging/instances/:id/start → 503", async () => {
    const res = await app.request("/api/v1/messaging/instances/inst-1/start", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("POST /api/v1/messaging/reload → 503", async () => {
    const res = await app.request("/api/v1/messaging/reload", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("GET /api/v1/messaging/mappings → 503", async () => {
    const res = await app.request("/api/v1/messaging/mappings");
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// Tests — instances list
// ---------------------------------------------------------------------------

describe("Messaging routes — instances", () => {
  it("GET /api/v1/messaging/instances returns list", async () => {
    const registry = makeRegistry();
    const app      = makeApp({ registry });
    const res      = await app.request("/api/v1/messaging/instances");
    expect(res.status).toBe(200);
    const body = await res.json() as { instances: unknown[] };
    expect(body.instances).toHaveLength(1);
    expect(vi.mocked(registry.getAllInstances)).toHaveBeenCalledOnce();
  });

  it("GET /api/v1/messaging/instances/:id returns instance", async () => {
    const registry = makeRegistry();
    const app      = makeApp({ registry });
    const res      = await app.request("/api/v1/messaging/instances/inst-1");
    expect(res.status).toBe(200);
    const body = await res.json() as { instance: { instanceId: string } };
    expect(body.instance.instanceId).toBe("inst-1");
  });

  it("GET /api/v1/messaging/instances/:id → 404 when not found", async () => {
    const registry = makeRegistry({
      getInstance: vi.fn().mockReturnValue(undefined),
    });
    const app = makeApp({ registry });
    const res = await app.request("/api/v1/messaging/instances/missing");
    expect(res.status).toBe(404);
  });

  it("POST /api/v1/messaging/instances/:id/start calls startInstance", async () => {
    const registry = makeRegistry();
    const app      = makeApp({ registry });
    const res      = await app.request("/api/v1/messaging/instances/inst-1/start", { method: "POST" });
    expect(res.status).toBe(200);
    expect(vi.mocked(registry.startInstance)).toHaveBeenCalledWith("inst-1");
  });

  it("POST /api/v1/messaging/instances/:id/stop calls stopInstance", async () => {
    const registry = makeRegistry();
    const app      = makeApp({ registry });
    const res      = await app.request("/api/v1/messaging/instances/inst-1/stop", { method: "POST" });
    expect(res.status).toBe(200);
    expect(vi.mocked(registry.stopInstance)).toHaveBeenCalledWith("inst-1");
  });

  it("start returns 500 on error", async () => {
    const registry = makeRegistry({
      startInstance: vi.fn().mockRejectedValue(new Error("port in use")),
    });
    const app = makeApp({ registry });
    const res = await app.request("/api/v1/messaging/instances/inst-1/start", { method: "POST" });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Tests — reload
// ---------------------------------------------------------------------------

describe("Messaging routes — reload", () => {
  it("POST /api/v1/messaging/reload calls reloadConfig", async () => {
    const reloadConfig = vi.fn().mockResolvedValue(undefined);
    const app = makeApp({ reloadConfig });
    const res = await app.request("/api/v1/messaging/reload", { method: "POST" });
    expect(res.status).toBe(200);
    expect(reloadConfig).toHaveBeenCalledOnce();
  });

  it("reload returns 500 on error", async () => {
    const reloadConfig = vi.fn().mockRejectedValue(new Error("reload failed"));
    const app = makeApp({ reloadConfig });
    const res = await app.request("/api/v1/messaging/reload", { method: "POST" });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Tests — mappings
// ---------------------------------------------------------------------------

describe("Messaging routes — mappings", () => {
  it("GET /api/v1/messaging/mappings returns empty list", async () => {
    const userMapping = makeUserMapping();
    const app = makeApp({ userMapping });
    const res = await app.request("/api/v1/messaging/mappings");
    expect(res.status).toBe(200);
    const body = await res.json() as { mappings: unknown[] };
    expect(body.mappings).toHaveLength(0);
  });

  it("GET /api/v1/messaging/mappings?sidjua_user_id=alice filters by user", async () => {
    const userMapping = makeUserMapping({
      listMappings: vi.fn().mockReturnValue([{ sidjua_user_id: "alice", instance_id: "inst-1", platform_user_id: "u1", role: "user" }]),
    });
    const app = makeApp({ userMapping });
    const res = await app.request("/api/v1/messaging/mappings?sidjua_user_id=alice");
    expect(res.status).toBe(200);
    expect(vi.mocked(userMapping.listMappings)).toHaveBeenCalledWith("alice");
  });

  it("POST /api/v1/messaging/mappings creates mapping", async () => {
    const userMapping = makeUserMapping();
    const app = makeApp({ userMapping });
    const res = await app.request("/api/v1/messaging/mappings", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        sidjua_user_id:  "alice",
        instance_id:     "inst-1",
        platform_user_id: "u-123",
        role:             "user",
      }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(userMapping.mapUser)).toHaveBeenCalledWith("alice", "inst-1", "u-123", "user");
  });

  it("POST /api/v1/messaging/mappings → 400 when fields missing", async () => {
    const userMapping = makeUserMapping();
    const app = makeApp({ userMapping });
    const res = await app.request("/api/v1/messaging/mappings", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ sidjua_user_id: "alice" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/v1/messaging/mappings → 400 when role invalid", async () => {
    const userMapping = makeUserMapping();
    const app = makeApp({ userMapping });
    const res = await app.request("/api/v1/messaging/mappings", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        sidjua_user_id:  "alice",
        instance_id:     "inst-1",
        platform_user_id: "u-123",
        role:             "superadmin",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /api/v1/messaging/mappings/:instanceId/:platformId calls unmapUser", async () => {
    const userMapping = makeUserMapping();
    const app = makeApp({ userMapping });
    const res = await app.request("/api/v1/messaging/mappings/inst-1/u-123", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(vi.mocked(userMapping.unmapUser)).toHaveBeenCalledWith("inst-1", "u-123");
  });
});
