/**
 * V1.1 — daemon API route tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerDaemonRoutes, type DaemonManagerLike } from "../../../src/api/routes/daemon.js";
import type { DaemonStatus } from "../../../src/agent-lifecycle/types.js";
import { createErrorHandler } from "../../../src/api/middleware/error-handler.js";
import { withAdminCtx }       from "../../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatus(agentId: string, running = true): DaemonStatus {
  return {
    agent_id:        agentId,
    running,
    tasks_completed: 5,
    tasks_failed:    1,
    last_task_at:    new Date().toISOString(),
    started_at:      new Date().toISOString(),
    hourly_cost_usd: 0.12,
  };
}

function makeManager(overrides: Partial<DaemonManagerLike> = {}): DaemonManagerLike {
  return {
    getAllStatuses:  vi.fn().mockReturnValue([makeStatus("agent-1"), makeStatus("agent-2")]),
    getStatus:      vi.fn().mockImplementation((id: string) =>
      id === "agent-1" ? makeStatus("agent-1") : undefined,
    ),
    startAgent:     vi.fn().mockReturnValue(true),
    stopAgent:      vi.fn().mockResolvedValue(true),
    restartAgent:   vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeApp(manager: DaemonManagerLike | null = makeManager()): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(false));
  app.use("*", withAdminCtx);
  registerDaemonRoutes(app, manager);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/daemon", () => {
  it("returns list of all daemon statuses", async () => {
    const app  = makeApp();
    const res  = await app.request("/api/v1/daemon");
    const body = await res.json() as { daemons: DaemonStatus[] };
    expect(res.status).toBe(200);
    expect(body.daemons).toHaveLength(2);
    expect(body.daemons[0]!.agent_id).toBe("agent-1");
  });

  it("returns 503 when daemon manager is null", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/v1/daemon");
    expect(res.status).toBe(503);
  });

  it("returns empty array when no daemons running", async () => {
    const mgr = makeManager({ getAllStatuses: vi.fn().mockReturnValue([]) });
    const app = makeApp(mgr);
    const res = await app.request("/api/v1/daemon");
    const body = await res.json() as { daemons: DaemonStatus[] };
    expect(res.status).toBe(200);
    expect(body.daemons).toHaveLength(0);
  });
});

describe("GET /api/v1/daemon/:id", () => {
  it("returns daemon status for known agent", async () => {
    const app  = makeApp();
    const res  = await app.request("/api/v1/daemon/agent-1");
    const body = await res.json() as { daemon: DaemonStatus };
    expect(res.status).toBe(200);
    expect(body.daemon.agent_id).toBe("agent-1");
  });

  it("returns 404 for unknown agent", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/daemon/unknown-agent");
    expect(res.status).toBe(404);
  });

  it("returns 503 when daemon manager is null", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/v1/daemon/agent-1");
    expect(res.status).toBe(503);
  });
});

describe("POST /api/v1/daemon/:id/start", () => {
  it("starts a daemon and returns 201", async () => {
    const app  = makeApp();
    const res  = await app.request("/api/v1/daemon/agent-3/start", { method: "POST" });
    const body = await res.json() as { agent_id: string; action: string };
    expect(res.status).toBe(201);
    expect(body.action).toBe("started");
    expect(body.agent_id).toBe("agent-3");
  });

  it("returns 409 when daemon already running", async () => {
    const mgr = makeManager({ startAgent: vi.fn().mockReturnValue(false) });
    const app = makeApp(mgr);
    const res = await app.request("/api/v1/daemon/agent-1/start", { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("returns 503 when daemon manager is null", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/v1/daemon/agent-1/start", { method: "POST" });
    expect(res.status).toBe(503);
  });
});

describe("POST /api/v1/daemon/:id/stop", () => {
  it("stops a running daemon", async () => {
    const app  = makeApp();
    const res  = await app.request("/api/v1/daemon/agent-1/stop", { method: "POST" });
    const body = await res.json() as { agent_id: string; action: string };
    expect(res.status).toBe(200);
    expect(body.action).toBe("stopped");
  });

  it("returns 404 when daemon is not running", async () => {
    const mgr = makeManager({ stopAgent: vi.fn().mockResolvedValue(false) });
    const app = makeApp(mgr);
    const res = await app.request("/api/v1/daemon/agent-99/stop", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 503 when daemon manager is null", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/v1/daemon/agent-1/stop", { method: "POST" });
    expect(res.status).toBe(503);
  });
});

describe("POST /api/v1/daemon/:id/restart", () => {
  it("restarts a daemon", async () => {
    const app  = makeApp();
    const res  = await app.request("/api/v1/daemon/agent-1/restart", { method: "POST" });
    const body = await res.json() as { agent_id: string; action: string };
    expect(res.status).toBe(200);
    expect(body.action).toBe("restarted");
  });

  it("returns 404 when agent not found in registry", async () => {
    const mgr = makeManager({ restartAgent: vi.fn().mockResolvedValue(false) });
    const app = makeApp(mgr);
    const res = await app.request("/api/v1/daemon/missing/restart", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("returns 503 when daemon manager is null", async () => {
    const app = makeApp(null);
    const res = await app.request("/api/v1/daemon/agent-1/restart", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("calls restartAgent with correct agent id", async () => {
    const mgr = makeManager();
    const app = makeApp(mgr);
    await app.request("/api/v1/daemon/agent-2/restart", { method: "POST" });
    expect(mgr.restartAgent).toHaveBeenCalledWith("agent-2");
  });
});
