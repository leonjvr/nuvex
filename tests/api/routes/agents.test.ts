/**
 * Phase 11b: Agent route handler tests
 *
 * Uses mock AgentRegistry (vi.fn()) to avoid needing Phase 10.5 DB schema.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { registerAgentRoutes }  from "../../../src/api/routes/agents.js";
import { createErrorHandler }   from "../../../src/api/middleware/error-handler.js";
import type { AgentRegistryLike } from "../../../src/api/routes/agents.js";
import { withAdminCtx }           from "../../helpers/with-admin-ctx.js";
import type {
  AgentDefinitionRow,
  AgentLifecycleStatus,
} from "../../../src/agent-lifecycle/index.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const MOCK_AGENT: AgentDefinitionRow = {
  id:          "agent-001",
  name:        "sonnet-dev",
  tier:        2,
  division:    "engineering",
  provider:    "anthropic",
  model:       "claude-sonnet-4-6",
  skill_path:  "/skills/engineering/",
  config_yaml: "{}",
  config_hash: "abc123",
  status:      "stopped",
  created_at:  new Date().toISOString(),
  created_by:  "system",
  updated_at:  new Date().toISOString(),
};

function makeRegistry(overrides: Partial<AgentRegistryLike> = {}): AgentRegistryLike {
  return {
    list:      vi.fn().mockReturnValue([MOCK_AGENT]),
    getById:   vi.fn().mockImplementation((id: string) => (id === MOCK_AGENT.id ? MOCK_AGENT : undefined)),
    setStatus: vi.fn(),
    ...overrides,
  };
}

function makeApp(registry: AgentRegistryLike): Hono {
  const app = new Hono();
  app.onError(createErrorHandler(false));
  app.use("*", withAdminCtx);
  registerAgentRoutes(app, { registry });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/v1/agents", () => {
  it("returns list of agents", async () => {
    const app = makeApp(makeRegistry());
    const res = await app.request("/api/v1/agents");

    expect(res.status).toBe(200);
    const body = await res.json() as { agents: AgentDefinitionRow[] };
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]?.id).toBe("agent-001");
  });

  it("passes division filter to registry", async () => {
    const registry = makeRegistry();
    const app      = makeApp(registry);
    await app.request("/api/v1/agents?division=engineering");

    expect(registry.list).toHaveBeenCalledWith(expect.objectContaining({ division: "engineering" }));
  });
});

describe("GET /api/v1/agents/:id", () => {
  it("returns agent detail for valid ID", async () => {
    const app = makeApp(makeRegistry());
    const res = await app.request("/api/v1/agents/agent-001");

    expect(res.status).toBe(200);
    const body = await res.json() as { agent: AgentDefinitionRow };
    expect(body.agent.id).toBe("agent-001");
  });

  it("returns 404 for non-existent agent", async () => {
    const app = makeApp(makeRegistry());
    const res = await app.request("/api/v1/agents/ghost-agent");

    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("AGT-001");
  });
});

describe("POST /api/v1/agents/:id/start", () => {
  it("starts a stopped agent and calls registry.setStatus", async () => {
    const registry = makeRegistry();
    const app      = makeApp(registry);
    const res      = await app.request("/api/v1/agents/agent-001/start", { method: "POST" });

    expect(res.status).toBe(200);
    expect(registry.setStatus).toHaveBeenCalledWith("agent-001", "starting");
    const body = await res.json() as { message: string };
    expect(body.message).toContain("started");
  });
});
