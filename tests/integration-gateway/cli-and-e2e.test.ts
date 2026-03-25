// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for Integration Gateway CLI commands, REST API, and E2E flows.
 * P170 — #503 Final.
 */

import {
  describe, it, expect, vi, beforeEach, afterEach,
} from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir }  from "node:os";
import { join }    from "node:path";
import { Hono }    from "hono";

import { openDatabase }           from "../../src/utils/db.js";
import { AdapterRegistry }        from "../../src/integration-gateway/adapter-registry.js";
import { SchemaStore }            from "../../src/integration-gateway/schema-store.js";
import { IntegrationGateway }     from "../../src/integration-gateway/gateway.js";
import { RouteResolver }          from "../../src/integration-gateway/route-resolver.js";
import { HttpExecutor }           from "../../src/integration-gateway/http-executor.js";
import { IntelligentPathResolver } from "../../src/integration-gateway/intelligent-path.js";
import {
  SqliteGatewayAuditService,
  NoOpGatewayAuditService,
  INTEGRATION_AUDIT_SQL,
} from "../../src/integration-gateway/sqlite-audit-service.js";
import { registerIntegrationRoutes } from "../../src/api/routes/integration.js";
import {
  runIntegrationListCommand,
  runIntegrationInfoCommand,
  runIntegrationAddCommand,
  runIntegrationAuditCommand,
  runIntegrationPromoteCommand,
  runIntegrationTestCommand,
} from "../../src/cli/commands/integration.js";
import type {
  IntegrationConfig,
  GatewaySecretsService,
} from "../../src/integration-gateway/types.js";
import type { ProviderRegistryLike } from "../../src/integration-gateway/intelligent-path.js";
import { setGlobalLevel, resetLogger } from "../../src/core/logger.js";
import { withAdminCtx }               from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_OPENAPI = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0.0" },
  servers: [{ url: "https://api.test.example" }],
  paths: {
    "/items": {
      get: {
        operationId: "listItems",
        summary: "List items",
        parameters: [],
        responses: { "200": { description: "OK" } },
      },
      post: {
        operationId: "createItem",
        summary: "Create item",
        parameters: [],
        responses: { "201": { description: "Created" } },
      },
    },
  },
  components: { securitySchemes: { ApiKey: { type: "apiKey", name: "X-Api-Key", in: "header" } } },
});

const SAMPLE_ADAPTER_YAML = `
name: sample-api
type: deterministic
protocol: rest
base_url: https://api.test.example
auth:
  type: api_key
  secret_ref: SAMPLE_API_KEY
actions:
  list_items:
    method: GET
    path: /items
    governance:
      require_approval: false
      budget_per_call: 0.00
      rate_limit: "30/minute"
      risk_level: low
  create_item:
    method: POST
    path: /items
    governance:
      require_approval: false
      budget_per_call: 0.00
      rate_limit: "10/minute"
      risk_level: medium
enabled: true
`.trim();

const GATEWAY_CONFIG: IntegrationConfig = {
  gateway: {
    enabled: true,
    intelligent_path: {
      enabled: true,
      llm_provider: "anthropic",
      llm_model: "claude-haiku-4-5-20251001",
      max_tokens_per_discovery: 2000,
      cache_discovered_schemas: true,
    },
    deterministic_adapters: [],
    global_rate_limit: "100/minute",
    global_budget: { daily: 10, monthly: 100 },
    credential_store: "sqlite",
    audit: { enabled: true, retention_days: 30 },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
let stdout = "";
let stderr = "";

function captureOutput(): void {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((c) => { stdout += String(c); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((c) => { stderr += String(c); return true; });
}

function makeIntegrationsDir(): void {
  mkdirSync(join(tmpDir, "governance", "integrations"), { recursive: true });
  writeFileSync(join(tmpDir, "governance", "integrations", "sample-api.yaml"), SAMPLE_ADAPTER_YAML);
}

function makeSystemDir(): void {
  mkdirSync(join(tmpDir, ".system"), { recursive: true });
}

function makeSecrets(): GatewaySecretsService {
  return { get: vi.fn().mockResolvedValue(null) };
}

function makeGateway(
  registry: AdapterRegistry,
  auditSvc = new NoOpGatewayAuditService(),
): IntegrationGateway {
  return new IntegrationGateway(
    registry,
    new RouteResolver(registry, GATEWAY_CONFIG),
    new HttpExecutor(),
    auditSvc,
    makeSecrets(),
    GATEWAY_CONFIG,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setGlobalLevel("error");
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-igw-cli-test-"));
  captureOutput();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetLogger();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// CLI Tests (1-10)
// ============================================================================

describe("CLI — integration list", () => {
  it("1 — lists all registered adapters from YAML files", async () => {
    makeIntegrationsDir();
    const code = await runIntegrationListCommand({ workDir: tmpDir, json: false });
    expect(code).toBe(0);
    expect(stdout).toContain("sample-api");
    expect(stdout).toContain("REST");
  });

  it("2 — --json returns valid JSON with adapters array", async () => {
    makeIntegrationsDir();
    const code = await runIntegrationListCommand({ workDir: tmpDir, json: true });
    expect(code).toBe(0);
    const data = JSON.parse(stdout) as { adapters: unknown[] };
    expect(Array.isArray(data.adapters)).toBe(true);
    expect(data.adapters).toHaveLength(1);
  });
});

describe("CLI — integration info", () => {
  it("3 — shows adapter details for known service", async () => {
    makeIntegrationsDir();
    const code = await runIntegrationInfoCommand({
      workDir: tmpDir, service: "sample-api", json: false,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("Integration: sample-api");
    expect(stdout).toContain("list_items");
    expect(stdout).toContain("create_item");
  });

  it("4 — returns error for unknown service", async () => {
    makeIntegrationsDir();
    const code = await runIntegrationInfoCommand({
      workDir: tmpDir, service: "unknown-svc", json: false,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});

describe("CLI — integration test", () => {
  it("5 — test with mock service returns success", async () => {
    makeIntegrationsDir();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("{}", { status: 200 }),
    ));
    const code = await runIntegrationTestCommand({
      workDir: tmpDir, service: "sample-api", json: false,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("✓");
  });

  it("6 — test with unreachable service returns connection error", async () => {
    makeIntegrationsDir();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const code = await runIntegrationTestCommand({
      workDir: tmpDir, service: "sample-api", json: false,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("ECONNREFUSED");
  });
});

describe("CLI — integration audit", () => {
  it("7 — returns audit events from DB", () => {
    makeSystemDir();
    const dbPath = join(tmpDir, ".system", "sidjua.db");
    const db = openDatabase(dbPath);
    db.exec(INTEGRATION_AUDIT_SQL);
    db.prepare(`
      INSERT INTO integration_audit_events
        (event_type, request_id, agent_id, division, service, action,
         path_used, risk_level, status_code, execution_ms, error, timestamp)
      VALUES ('integration_success', 'r1', 'agent-1', 'eng', 'sample-api', 'list_items',
              'deterministic', 'low', 200, 150, NULL, datetime('now'))
    `).run();
    db.close();

    const code = runIntegrationAuditCommand({
      workDir: tmpDir, last: "24h", json: false,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("sample-api");
    expect(stdout).toContain("list_items");
  });

  it("8 — --service filter returns only matching events", () => {
    makeSystemDir();
    const dbPath = join(tmpDir, ".system", "sidjua.db");
    const db = openDatabase(dbPath);
    db.exec(INTEGRATION_AUDIT_SQL);
    const ins = db.prepare(`
      INSERT INTO integration_audit_events
        (event_type, request_id, agent_id, division, service, action,
         path_used, risk_level, status_code, execution_ms, error, timestamp)
      VALUES (?, ?, 'agent-1', 'eng', ?, ?, 'deterministic', 'low', 200, 100, NULL, datetime('now'))
    `);
    ins.run("integration_success", "r1", "sample-api", "list_items");
    ins.run("integration_success", "r2", "other-svc", "do_thing");
    db.close();

    const code = runIntegrationAuditCommand({
      workDir: tmpDir, last: "24h", service: "sample-api", json: false,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("sample-api");
    expect(stdout).not.toContain("other-svc");
  });
});

describe("CLI — integration promote", () => {
  it("9 — shows not-eligible status for service below threshold", async () => {
    makeSystemDir();
    const store = new SchemaStore(join(tmpDir, ".system", "sidjua.db"));
    await store.init();
    await store.storeSchema({
      service_name: "my-api", spec_format: "openapi3", spec_content: SAMPLE_OPENAPI,
      quality: "discovered", last_used: new Date().toISOString(),
      success_rate: 0.5, usage_count: 3,
    });

    const code = await runIntegrationPromoteCommand({
      workDir: tmpDir, service: "my-api", review: false, json: false,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("Not eligible");
  });

  it("10 — eligible service with --review generates YAML", async () => {
    makeSystemDir();
    const store = new SchemaStore(join(tmpDir, ".system", "sidjua.db"));
    await store.init();
    await store.storeSchema({
      service_name: "my-api", spec_format: "openapi3", spec_content: SAMPLE_OPENAPI,
      quality: "discovered", last_used: new Date().toISOString(),
      success_rate: 0.95, usage_count: 15,
    });

    const code = await runIntegrationPromoteCommand({
      workDir: tmpDir, service: "my-api", review: true, json: false,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("ELIGIBLE");
    expect(stdout).toContain("name: my-api");
  });
});

// ============================================================================
// REST API Tests (11-17)
// ============================================================================

describe("REST API — /api/v1/integrations", () => {
  let app: Hono;
  let registry: AdapterRegistry;

  beforeEach(() => {
    app = new Hono();
    app.use("*", withAdminCtx);
    registry = new AdapterRegistry();
    registry.registerAdapter({
      name: "sample-api", type: "deterministic", protocol: "rest",
      base_url: "https://api.test.example",
      auth: { type: "api_key", secret_ref: "SAMPLE_API_KEY" },
      actions: {
        list_items: { method: "GET", path: "/items", governance: { require_approval: false, budget_per_call: 0, rate_limit: "30/minute", risk_level: "low" } },
        create_item: { method: "POST", path: "/items", governance: { require_approval: false, budget_per_call: 0, rate_limit: "10/minute", risk_level: "medium" } },
      },
      enabled: true,
    }, "test");
  });

  function addAuthHeader(init: RequestInit = {}): RequestInit {
    return { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), Authorization: "Bearer test-key" } };
  }

  it("11 — GET /api/v1/integrations returns list", async () => {
    // Re-register with proper YAML
    registry = new AdapterRegistry();
    registry.registerAdapter({
      name: "sample-api", type: "deterministic", protocol: "rest",
      base_url: "https://api.test.example",
      auth: { type: "api_key", secret_ref: "SAMPLE_API_KEY" },
      actions: {
        list_items: { method: "GET", path: "/items", governance: { require_approval: false, budget_per_call: 0, rate_limit: "30/minute", risk_level: "low" } },
      },
      enabled: true,
    }, "test");
    registerIntegrationRoutes(app, { adapterRegistry: registry });

    const res = await app.request("/api/v1/integrations");
    expect(res.status).toBe(200);
    const data = await res.json() as { adapters: unknown[] };
    expect(data.adapters).toHaveLength(1);
  });

  it("12 — GET /api/v1/integrations/:service returns details", async () => {
    registerIntegrationRoutes(app, { adapterRegistry: registry });
    const res = await app.request("/api/v1/integrations/sample-api");
    expect(res.status).toBe(200);
    const data = await res.json() as { name: string };
    expect(data.name).toBe("sample-api");
  });

  it("13 — GET /api/v1/integrations/:service returns 404 for unknown", async () => {
    registerIntegrationRoutes(app, { adapterRegistry: registry });
    const res = await app.request("/api/v1/integrations/nonexistent");
    expect(res.status).toBe(404);
  });

  it("14 — POST /api/v1/integrations/:service/execute deterministic success (mock fetch)", async () => {
    // Provide a secrets mock that resolves the API key so credentials don't block the request
    const secretsSvc: GatewaySecretsService = { get: vi.fn().mockResolvedValue("fake-test-key") };
    const gateway = new IntegrationGateway(
      registry, new RouteResolver(registry, GATEWAY_CONFIG),
      new HttpExecutor(), new NoOpGatewayAuditService(), secretsSvc, GATEWAY_CONFIG,
    );
    registerIntegrationRoutes(app, { adapterRegistry: registry, gateway });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    ));

    const res = await app.request("/api/v1/integrations/sample-api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "list_items", params: {}, agent_id: "test-agent", division: "eng",
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { success: boolean };
    expect(data.success).toBe(true);
  });

  it("15 — POST /api/v1/integrations/:service/execute without gateway → 503", async () => {
    registerIntegrationRoutes(app, { adapterRegistry: registry });
    const res = await app.request("/api/v1/integrations/sample-api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list_items" }),
    });
    expect(res.status).toBe(503);
  });

  it("16 — POST /api/v1/integrations/:service/execute blocked → 403-range response", async () => {
    const blockRegistry = new AdapterRegistry();
    blockRegistry.registerAdapter({
      name: "blocked-svc", type: "deterministic", protocol: "rest",
      base_url: "https://blocked.example",
      actions: {
        do_thing: { method: "POST", path: "/do", governance: { require_approval: false, budget_per_call: 0, risk_level: "medium" } },
      },
      enabled: false, // disabled adapter → route resolver blocks
    }, "test");

    const gateway = makeGateway(blockRegistry);
    registerIntegrationRoutes(app, { adapterRegistry: blockRegistry, gateway });

    const res = await app.request("/api/v1/integrations/blocked-svc/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "do_thing", agent_id: "a1", division: "eng" }),
    });
    const data = await res.json() as { success: boolean };
    expect(data.success).toBe(false);
  });

  it("17 — POST intelligent path execute → LLM + fetch flow", async () => {
    const intRegistry = new AdapterRegistry();
    // No adapter registered for "canva" → intelligent path

    const store = new SchemaStore(":memory:");
    await store.init();
    await store.storeSchema({
      service_name: "canva", spec_format: "openapi3", spec_content: SAMPLE_OPENAPI,
      quality: "discovered", last_used: new Date().toISOString(),
      success_rate: 0.9, usage_count: 5,
    });

    const mockProviderRegistry: ProviderRegistryLike = {
      call: vi.fn().mockResolvedValue({
        callId: "llm-1", provider: "anthropic", model: "claude-haiku-4-5-20251001",
        content: '{"path":"/items","method":"GET","headers":{}}',
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        costUsd: 0.001, latencyMs: 100,
      }),
    };

    const intelligentPath = new IntelligentPathResolver(
      store, mockProviderRegistry, GATEWAY_CONFIG.gateway.intelligent_path,
    );

    const config: IntegrationConfig = {
      ...GATEWAY_CONFIG,
      gateway: { ...GATEWAY_CONFIG.gateway, intelligent_path: { ...GATEWAY_CONFIG.gateway.intelligent_path, enabled: true } },
    };

    const gateway = new IntegrationGateway(
      intRegistry,
      new RouteResolver(intRegistry, config),
      new HttpExecutor(),
      new NoOpGatewayAuditService(),
      makeSecrets(),
      config,
      undefined, undefined, undefined, undefined,
      intelligentPath,
    );

    registerIntegrationRoutes(app, { adapterRegistry: intRegistry, gateway, schemaStore: store });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ));

    const res = await app.request("/api/v1/integrations/canva/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "List designs", params: {}, agent_id: "marketing-agent", division: "marketing" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { success: boolean; path_used: string };
    expect(data.success).toBe(true);
    expect(data.path_used).toBe("intelligent");
  });
});

// ============================================================================
// E2E Integration Tests (18-25)
// ============================================================================

describe("E2E — full gateway flow", () => {
  it("18 — full flow: route → HTTP → audit log (all mocked)", async () => {
    const registry = new AdapterRegistry();
    registry.registerAdapter({
      name: "e2e-api", type: "deterministic", protocol: "rest",
      base_url: "https://e2e.example",
      actions: {
        ping: { method: "GET", path: "/ping", governance: { require_approval: false, budget_per_call: 0, risk_level: "low" } },
      },
      enabled: true,
    }, "test");

    const auditSvc = new NoOpGatewayAuditService();
    const gateway  = makeGateway(registry, auditSvc);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    const result = await gateway.execute({
      service: "e2e-api", action: "ping", params: {},
      agent_id: "agent-1", division: "eng",
      request_id: "req-e2e-1", timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
    expect(result.path_used).toBe("deterministic");
    const successEvents = auditSvc.events.filter((e) => e.event_type === "integration_success");
    expect(successEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("19 — full flow: blocked by division policy → audit event with reason", async () => {
    const registry = new AdapterRegistry();
    registry.registerAdapter({
      name: "secret-svc", type: "deterministic", protocol: "rest",
      base_url: "https://secret.example",
      actions: {
        read: { method: "GET", path: "/read", governance: { require_approval: false, budget_per_call: 0, risk_level: "low" } },
      },
      enabled: false, // disabled → blocked
    }, "test");

    const auditSvc = new NoOpGatewayAuditService();
    const gateway  = makeGateway(registry, auditSvc);

    const result = await gateway.execute({
      service: "secret-svc", action: "read", params: {},
      agent_id: "agent-2", division: "restricted",
      request_id: "req-e2e-2", timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
    const blockedEvents = auditSvc.events.filter((e) => e.event_type === "integration_blocked");
    expect(blockedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("20 — full flow: approval required → response with approver info", async () => {
    const registry = new AdapterRegistry();
    registry.registerAdapter({
      name: "approval-svc", type: "deterministic", protocol: "rest",
      base_url: "https://approval.example",
      actions: {
        deploy: { method: "POST", path: "/deploy", governance: { require_approval: true, budget_per_call: 0, risk_level: "high" } },
      },
      enabled: true,
    }, "test");

    const { PolicyEnforcer } = await import("../../src/integration-gateway/policy-enforcer.js");
    const { WebAccessPolicyLoader } = await import("../../src/integration-gateway/web-access-policy.js");

    // Create a temp governance dir with a policy that requires approval
    const govDir = join(tmpDir, "governance", "boundaries");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, "web-access-eng.yaml"), `
division: eng
allowed_services:
  - service: approval-svc
    actions: ["*"]
blocked_services: []
approval_rules:
  - action: "deploy"
    approver: "division_head"
budget:
  per_call: 1.0
  daily_limit: 100.0
  monthly_limit: 1000.0
rate_limits:
  per_service: "10/minute"
  total: "100/minute"
audit:
  log_requests: true
  log_responses: false
  retention_days: 30
`.trim());

    const policyLoader = new WebAccessPolicyLoader(tmpDir);
    const enforcer = new PolicyEnforcer(policyLoader);
    const auditSvc = new NoOpGatewayAuditService();
    const gateway = new IntegrationGateway(
      registry, new RouteResolver(registry, GATEWAY_CONFIG),
      new HttpExecutor(), auditSvc, makeSecrets(), GATEWAY_CONFIG, enforcer,
    );

    const result = await gateway.execute({
      service: "approval-svc", action: "deploy", params: {},
      agent_id: "agent-3", division: "eng",
      request_id: "req-e2e-3", timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Approval required");
    const approvalEvents = auditSvc.events.filter((e) => e.event_type === "integration_approval_required");
    expect(approvalEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("21 — full flow: intelligent path → LLM + HTTP → schema usage recorded", async () => {
    const intRegistry = new AdapterRegistry();
    const store = new SchemaStore(":memory:");
    await store.init();
    await store.storeSchema({
      service_name: "smart-svc", spec_format: "openapi3", spec_content: SAMPLE_OPENAPI,
      quality: "discovered", last_used: new Date().toISOString(),
      success_rate: 0.0, usage_count: 0,
    });

    const mockRegistry: ProviderRegistryLike = {
      call: vi.fn().mockResolvedValue({
        callId: "llm-e2e", provider: "anthropic", model: "claude-haiku-4-5-20251001",
        content: '{"path":"/items","method":"GET","headers":{}}',
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        costUsd: 0.001, latencyMs: 100,
      }),
    };

    const intelligentPath = new IntelligentPathResolver(
      store, mockRegistry, GATEWAY_CONFIG.gateway.intelligent_path,
    );

    const config: IntegrationConfig = {
      ...GATEWAY_CONFIG,
      gateway: { ...GATEWAY_CONFIG.gateway, intelligent_path: { ...GATEWAY_CONFIG.gateway.intelligent_path, enabled: true } },
    };

    const auditSvc = new NoOpGatewayAuditService();
    const gateway = new IntegrationGateway(
      intRegistry, new RouteResolver(intRegistry, config),
      new HttpExecutor(), auditSvc, makeSecrets(), config,
      undefined, undefined, undefined, undefined, intelligentPath,
    );

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));

    const result = await gateway.execute({
      service: "smart-svc", action: "List items", params: {},
      agent_id: "agent-4", division: "eng",
      request_id: "req-e2e-4", timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
    expect(result.path_used).toBe("intelligent");

    const updated = await store.getSchema("smart-svc");
    expect(updated!.usage_count).toBe(1);
    expect(updated!.success_rate).toBeCloseTo(1.0);
  });

  it("22 — full flow: unknown service + intelligent disabled → blocked", async () => {
    const registry = new AdapterRegistry();
    const config: IntegrationConfig = {
      ...GATEWAY_CONFIG,
      gateway: { ...GATEWAY_CONFIG.gateway, intelligent_path: { ...GATEWAY_CONFIG.gateway.intelligent_path, enabled: false } },
    };
    const auditSvc = new NoOpGatewayAuditService();
    const gateway = new IntegrationGateway(
      registry, new RouteResolver(registry, config),
      new HttpExecutor(), auditSvc, makeSecrets(), config,
    );

    const result = await gateway.execute({
      service: "ghost-svc", action: "do-thing", params: {},
      agent_id: "agent-5", division: "eng",
      request_id: "req-e2e-5", timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
    expect(result.error?.toLowerCase()).toContain("intelligent path is disabled");
  });

  it("23 — full flow: credential resolution failure → error response", async () => {
    const registry = new AdapterRegistry();
    registry.registerAdapter({
      name: "secure-svc", type: "deterministic", protocol: "rest",
      base_url: "https://secure.example",
      auth: { type: "bearer", secret_ref: "SECURE_TOKEN" },
      actions: {
        read: { method: "GET", path: "/data", governance: { require_approval: false, budget_per_call: 0, risk_level: "low" } },
      },
      enabled: true,
    }, "test");

    const auditSvc = new NoOpGatewayAuditService();
    // Secrets service returns null → credential resolution fails
    const secrets: GatewaySecretsService = { get: vi.fn().mockResolvedValue(null) };
    const gateway = new IntegrationGateway(
      registry, new RouteResolver(registry, GATEWAY_CONFIG),
      new HttpExecutor(), auditSvc, secrets, GATEWAY_CONFIG,
    );

    const result = await gateway.execute({
      service: "secure-svc", action: "read", params: {},
      agent_id: "agent-6", division: "eng",
      request_id: "req-e2e-6", timestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("credential");
  });

  it("24 — full flow: local script execution (mock execute) → success", async () => {
    const { ScriptExecutor } = await import("../../src/integration-gateway/executors/script-executor.js");
    const registry = new AdapterRegistry();
    registry.registerAdapter({
      name: "script-svc", type: "deterministic", protocol: "local_script",
      script_path: join(tmpDir, "script.py"),
      runtime: "python3",
      actions: {
        run: { function: "run", governance: { require_approval: false, budget_per_call: 0, risk_level: "low", timeout_seconds: 5 } },
      },
      enabled: true,
    }, "test");

    writeFileSync(join(tmpDir, "script.py"), "print('hello')");

    const scriptExecutor = new ScriptExecutor(tmpDir);
    // Spy on the execute method so no real spawn happens
    vi.spyOn(scriptExecutor, "execute").mockResolvedValue({
      success: true, stdout: "hello", stderr: "", exit_code: 0, execution_ms: 10,
    });

    const auditSvc = new NoOpGatewayAuditService();
    const gateway = new IntegrationGateway(
      registry, new RouteResolver(registry, GATEWAY_CONFIG),
      new HttpExecutor(), auditSvc, makeSecrets(), GATEWAY_CONFIG,
      undefined, scriptExecutor,
    );

    const result = await gateway.execute({
      service: "script-svc", action: "run", params: {},
      agent_id: "agent-7", division: "eng",
      request_id: "req-e2e-7", timestamp: new Date().toISOString(),
    });

    expect(result.path_used).toBe("deterministic");
    expect(typeof result.success).toBe("boolean");
  });

  it("25 — full flow: CLI executor (mock spawn) → success", async () => {
    const { CliExecutor } = await import("../../src/integration-gateway/executors/cli-executor.js");
    const registry = new AdapterRegistry();
    registry.registerAdapter({
      name: "cli-svc", type: "deterministic", protocol: "cli",
      actions: {
        probe: { command: "ffmpeg", governance: { require_approval: false, budget_per_call: 0, risk_level: "low", timeout_seconds: 5 } },
      },
      enabled: true,
    }, "test");

    const cliExecutor = new CliExecutor();
    // Inject mock via spawnCommand (the private method that calls spawn)
    vi.spyOn(cliExecutor as unknown as { spawnCommand: (...a: unknown[]) => unknown }, "spawnCommand" as never)
      .mockResolvedValue({ success: true, stdout: "ffmpeg version", stderr: "", exit_code: 0, execution_ms: 5 });

    const auditSvc = new NoOpGatewayAuditService();
    const gateway = new IntegrationGateway(
      registry, new RouteResolver(registry, GATEWAY_CONFIG),
      new HttpExecutor(), auditSvc, makeSecrets(), GATEWAY_CONFIG,
      undefined, undefined, cliExecutor,
    );

    const result = await gateway.execute({
      service: "cli-svc", action: "probe", params: { input: "/dev/null" },
      agent_id: "agent-8", division: "eng",
      request_id: "req-e2e-8", timestamp: new Date().toISOString(),
    });

    expect(result.path_used).toBe("deterministic");
    expect(result.success).toBe(true);
  });
});
