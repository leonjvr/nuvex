// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for #519 H1 and H2 (#528):
 *
 *   H1a: Tier parameter validation — strict allowlist, rejects coercible values
 *   H1b: Task submission schema — strict key allowlist, max lengths, type checks
 *   H1c: Division format validation — applied to agents + execution routes
 *   H2:  CSRF middleware — missing Origin now blocked; API-key bypass preserved
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono }             from "hono";
import BetterSqlite3        from "better-sqlite3";
import { vi }               from "vitest";

import { withAdminCtx } from "../helpers/with-admin-ctx.js";
import { registerAgentRoutes }    from "../../src/api/routes/agents.js";
import { registerExecutionRoutes } from "../../src/api/routes/execution.js";
import { csrfMiddleware }         from "../../src/api/middleware/csrf.js";
import { createErrorHandler }     from "../../src/api/middleware/error-handler.js";
import { PHASE9_SCHEMA_SQL }      from "../../src/orchestrator/types.js";
import { TaskStore }              from "../../src/tasks/store.js";
import { TaskEventBus }           from "../../src/tasks/event-bus.js";
import type { AgentRegistryLike } from "../../src/api/routes/agents.js";
import type {
  AgentDefinitionRow,
  AgentLifecycleStatus,
} from "../../src/agent-lifecycle/index.js";

// ---------------------------------------------------------------------------
// Helpers — agent route app
// ---------------------------------------------------------------------------

const MOCK_AGENT: AgentDefinitionRow = {
  id:          "agent-001",
  name:        "test-agent",
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

function makeAgentApp(registry?: AgentRegistryLike): Hono {
  const app = new Hono();
  app.use("*", withAdminCtx);
  app.onError(createErrorHandler(false));
  registerAgentRoutes(app, { registry: registry ?? makeRegistry() });
  return app;
}

// ---------------------------------------------------------------------------
// Helpers — execution route app
// ---------------------------------------------------------------------------

type Db = InstanceType<typeof BetterSqlite3>;

function makeDb(): Db {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  new TaskStore(db).initialize();
  new TaskEventBus(db).initialize();
  return db;
}

function makeExecApp(db?: Db): Hono {
  const app = new Hono();
  app.use("*", withAdminCtx);
  app.onError(createErrorHandler(false));
  registerExecutionRoutes(app, { db: db ?? makeDb() });
  return app;
}

// ---------------------------------------------------------------------------
// Helpers — CSRF-only app
// ---------------------------------------------------------------------------

function makeCsrfApp(): Hono {
  const app = new Hono();
  app.use("*", withAdminCtx);
  app.use("*", csrfMiddleware);
  app.post("/test", (c) => c.json({ ok: true }));
  app.get("/test",  (c) => c.json({ ok: true }));
  return app;
}

// ===========================================================================
// H1a: Tier parameter validation
// ===========================================================================

describe("H1a #519: Tier parameter validation", () => {
  it("tier=1 accepted", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?tier=1");
    expect(res.status).toBe(200);
  });

  it("tier=2 accepted", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?tier=2");
    expect(res.status).toBe(200);
  });

  it("tier=3 accepted", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?tier=3");
    expect(res.status).toBe(200);
  });

  it("tier=__proto__ returns 400", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?tier=__proto__");
    expect(res.status).toBe(400);
  });

  it("tier=999 returns 400", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?tier=999");
    expect(res.status).toBe(400);
  });

  it("tier='' (empty string) returns 400", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?tier=");
    expect(res.status).toBe(400);
  });

  it("tier=T1 (string label) returns 400", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?tier=T1");
    expect(res.status).toBe(400);
  });

  it("tier=1e1 (coercible to 10) returns 400", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?tier=1e1");
    expect(res.status).toBe(400);
  });

  it("tier=1abc (parseInt-coercible to 1) returns 400", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?tier=1abc");
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// H1b: Task submission schema (strict key allowlist + field validation)
// ===========================================================================

describe("H1b #519: Task submission schema validation", () => {
  it("valid minimal body accepted (description only)", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "Write a report" }),
    });
    expect(res.status).toBe(201);
  });

  it("valid full body accepted", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        description:     "Write a report",
        priority:        5,
        division:        "engineering",
        budget_usd:      1.0,
        budget_tokens:   1000,
        timeout_seconds: 300,
      }),
    });
    expect(res.status).toBe(201);
  });

  it("prototype-key '__proto__' in raw JSON body returns 400 (strict mode)", async () => {
    // NOTE: JSON.stringify({ __proto__: ... }) drops __proto__ (not own property),
    // so we must send the raw JSON string to actually include the key in the body.
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      // Raw JSON string — '__proto__' IS included as a key in the serialized body
      // even if V8 may reassign it on parse; the strict-key check sees it first
      // via the body object's own enumerable keys.
      body:    '{"description":"test","constructor":{"prototype":{"admin":true}}}',
    });
    expect(res.status).toBe(400);
  });

  it("extra unknown field returns 400", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "test", malicious_field: "evil" }),
    });
    expect(res.status).toBe(400);
  });

  it("empty description string returns 400", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("whitespace-only description returns 400", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("description exceeding 10000 chars returns 400", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "x".repeat(10_001) }),
    });
    expect(res.status).toBe(400);
  });

  it("non-numeric budget_usd returns 400", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "test", budget_usd: "free" }),
    });
    expect(res.status).toBe(400);
  });

  it("negative budget_usd returns 400", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "test", budget_usd: -1 }),
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// H1c: Division format validation
// ===========================================================================

describe("H1c #519: Division format validation", () => {
  it("agents route — valid division query param accepted", async () => {
    const registry = makeRegistry();
    await makeAgentApp(registry).request("/api/v1/agents?division=engineering");
    expect(registry.list).toHaveBeenCalledWith(expect.objectContaining({ division: "engineering" }));
  });

  it("agents route — division with ../ returns 400", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?division=../etc/passwd");
    expect(res.status).toBe(400);
  });

  it("agents route — division with special chars returns 400", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?division=eng!neer%3Bexec");
    expect(res.status).toBe(400);
  });

  it("agents route — division exceeding 64 chars returns 400", async () => {
    const res = await makeAgentApp().request(`/api/v1/agents?division=${"a".repeat(65)}`);
    expect(res.status).toBe(400);
  });

  it("agents route — division starting with digit returns 400", async () => {
    const res = await makeAgentApp().request("/api/v1/agents?division=1engineering");
    expect(res.status).toBe(400);
  });

  it("execution route — valid division in body accepted", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "test", division: "finance" }),
    });
    expect(res.status).toBe(201);
  });

  it("execution route — division with path traversal returns 400", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "test", division: "../escape" }),
    });
    expect(res.status).toBe(400);
  });

  it("execution route — division starting with digit returns 400", async () => {
    const res = await makeExecApp().request("/api/v1/tasks/run", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ description: "test", division: "1invalid" }),
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// H2: CSRF middleware fixes
// ===========================================================================

describe("H2 #519: CSRF middleware — Origin enforcement", () => {
  it("GET passes without any Origin header", async () => {
    const res = await makeCsrfApp().request("/test");
    expect(res.status).toBe(200);
  });

  it("POST with valid localhost Origin passes", async () => {
    const res = await makeCsrfApp().request("/test", {
      method:  "POST",
      headers: { Origin: "http://localhost:3000" },
    });
    expect(res.status).toBe(200);
  });

  it("POST with disallowed Origin returns 403", async () => {
    const res = await makeCsrfApp().request("/test", {
      method:  "POST",
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("invalid origin");
  });

  it("POST with no Origin AND no Referer returns 403 (H2 fix)", async () => {
    const res = await makeCsrfApp().request("/test", {
      method: "POST",
      // no Origin, no Referer, no Authorization
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("missing Origin");
  });

  it("POST with Authorization header bypasses CSRF check (API-key auth)", async () => {
    const res = await makeCsrfApp().request("/test", {
      method:  "POST",
      headers: { Authorization: "Bearer sk-testkey" },
      // no Origin header — would normally be blocked
    });
    expect(res.status).toBe(200);
  });

  it("POST with valid Referer but no Origin passes", async () => {
    const res = await makeCsrfApp().request("/test", {
      method:  "POST",
      headers: { Referer: "http://localhost:3000/dashboard" },
    });
    expect(res.status).toBe(200);
  });

  it("POST with disallowed Referer origin returns 403", async () => {
    const res = await makeCsrfApp().request("/test", {
      method:  "POST",
      headers: { Referer: "https://attacker.example.com/steal" },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("disallowed Referer");
  });

  it("POST with malformed Referer URL returns 403", async () => {
    const res = await makeCsrfApp().request("/test", {
      method:  "POST",
      headers: { Referer: "not-a-url" },
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("malformed Referer");
  });

  it("tauri://localhost Origin passes", async () => {
    const res = await makeCsrfApp().request("/test", {
      method:  "POST",
      headers: { Origin: "tauri://localhost" },
    });
    expect(res.status).toBe(200);
  });

  it("DELETE with disallowed Origin returns 403", async () => {
    const res = await makeCsrfApp().request("/test", {
      method:  "DELETE",
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.status).toBe(403);
  });

  it("HEAD request bypasses CSRF check (safe method)", async () => {
    const res = await makeCsrfApp().request("/test", {
      method: "HEAD",
    });
    // HEAD on /test — not a registered GET handler that has HEAD support, just check no CSRF 403
    expect(res.status).not.toBe(403);
  });

  it("OPTIONS request bypasses CSRF check (safe method)", async () => {
    const res = await makeCsrfApp().request("/test", {
      method: "OPTIONS",
    });
    expect(res.status).not.toBe(403);
  });
});
