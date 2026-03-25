// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SchemaStore }              from "../../src/integration-gateway/schema-store.js";
import { parseOpenApiSpec }         from "../../src/integration-gateway/openapi-parser.js";
import { IntelligentPathResolver }  from "../../src/integration-gateway/intelligent-path.js";
import { AdapterPromoter }          from "../../src/integration-gateway/adapter-promoter.js";
import { IntegrationGateway }       from "../../src/integration-gateway/gateway.js";
import { AdapterRegistry }          from "../../src/integration-gateway/adapter-registry.js";
import { RouteResolver }            from "../../src/integration-gateway/route-resolver.js";
import { HttpExecutor }             from "../../src/integration-gateway/http-executor.js";
import type { ApiSchema }           from "../../src/integration-gateway/schema-store.js";
import type {
  GatewayAuditService,
  GatewaySecretsService,
  IntegrationConfig,
} from "../../src/integration-gateway/types.js";
import type { ProviderRegistryLike } from "../../src/integration-gateway/intelligent-path.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_OPENAPI = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0.0" },
  servers: [{ url: "https://api.example.com" }],
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
        parameters: [
          { name: "x-request-id", in: "header", required: false, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "201": { description: "Created" } },
      },
    },
    "/items/{id}": {
      get: {
        operationId: "getItem",
        summary: "Get item by id",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "format", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: { "200": { description: "OK" } },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: "apiKey", name: "X-API-Key", in: "header" },
      BearerAuth:  { type: "http", scheme: "bearer" },
    },
  },
});

const MINIMAL_YAML_OPENAPI = `
openapi: 3.0.0
info:
  title: YAML API
  version: 2.0.0
servers:
  - url: https://yaml.example.com
paths:
  /ping:
    get:
      summary: Ping
      responses:
        "200":
          description: OK
`.trim();

const SCHEMA_FIXTURE: ApiSchema = {
  service_name: "test-api",
  spec_format:  "openapi3",
  spec_content: MINIMAL_OPENAPI,
  quality:      "draft",
  last_used:    "2026-01-01T00:00:00.000Z",
  success_rate: 0.0,
  usage_count:  0,
};

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

function makeAuditService(): GatewayAuditService {
  return { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
}
function makeSecretsService(): GatewaySecretsService {
  return { get: vi.fn().mockResolvedValue(null) };
}
function makeRegistry(): ProviderRegistryLike {
  return { call: vi.fn() };
}

// ---------------------------------------------------------------------------
// 1-5: SchemaStore
// ---------------------------------------------------------------------------

describe("SchemaStore", () => {
  it("1 — init creates api_schemas table", async () => {
    const store = new SchemaStore(":memory:");
    await store.init();
    // If we can store + retrieve, the table exists
    const schema = await store.getSchema("nonexistent");
    expect(schema).toBeNull();
  });

  it("2 — store and retrieve schema", async () => {
    const store = new SchemaStore(":memory:");
    await store.init();
    await store.storeSchema(SCHEMA_FIXTURE);
    const retrieved = await store.getSchema("test-api");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.service_name).toBe("test-api");
    expect(retrieved!.spec_format).toBe("openapi3");
    expect(retrieved!.quality).toBe("draft");
  });

  it("3 — getSchema returns null for unknown service", async () => {
    const store = new SchemaStore(":memory:");
    await store.init();
    const result = await store.getSchema("does-not-exist");
    expect(result).toBeNull();
  });

  it("4 — recordUsage updates count and success_rate", async () => {
    const store = new SchemaStore(":memory:");
    await store.init();
    await store.storeSchema(SCHEMA_FIXTURE);

    // 1st call: success
    await store.recordUsage("test-api", true);
    const after1 = await store.getSchema("test-api");
    expect(after1!.usage_count).toBe(1);
    expect(after1!.success_rate).toBeCloseTo(1.0);

    // 2nd call: failure
    await store.recordUsage("test-api", false);
    const after2 = await store.getSchema("test-api");
    expect(after2!.usage_count).toBe(2);
    expect(after2!.success_rate).toBeCloseTo(0.5);
  });

  it("5 — listSchemas returns all stored schemas", async () => {
    const store = new SchemaStore(":memory:");
    await store.init();
    await store.storeSchema(SCHEMA_FIXTURE);
    await store.storeSchema({
      ...SCHEMA_FIXTURE,
      service_name: "other-api",
      spec_format:  "graphql",
    });
    const all = await store.listSchemas();
    expect(all).toHaveLength(2);
    const names = all.map((s) => s.service_name).sort();
    expect(names).toEqual(["other-api", "test-api"]);
  });
});

// ---------------------------------------------------------------------------
// 6-10: OpenAPI parser
// ---------------------------------------------------------------------------

describe("parseOpenApiSpec", () => {
  it("6 — parse minimal valid JSON spec", () => {
    const spec = parseOpenApiSpec(MINIMAL_OPENAPI);
    expect(spec.title).toBe("Test API");
    expect(spec.version).toBe("1.0.0");
    expect(spec.base_url).toBe("https://api.example.com");
  });

  it("7 — extract endpoints with paths and methods", () => {
    const spec = parseOpenApiSpec(MINIMAL_OPENAPI);
    const methods = spec.endpoints.map((e) => `${e.method} ${e.path}`).sort();
    expect(methods).toContain("GET /items");
    expect(methods).toContain("POST /items");
    expect(methods).toContain("GET /items/{id}");
    expect(spec.endpoints).toHaveLength(3);
  });

  it("8 — extract parameters (path, query, header)", () => {
    const spec = parseOpenApiSpec(MINIMAL_OPENAPI);
    const getById = spec.endpoints.find((e) => e.path === "/items/{id}" && e.method === "GET")!;
    expect(getById).toBeDefined();
    const pathParam = getById.parameters.find((p) => p.name === "id");
    expect(pathParam).toBeDefined();
    expect(pathParam!.in).toBe("path");
    expect(pathParam!.required).toBe(true);
    const queryParam = getById.parameters.find((p) => p.name === "format");
    expect(queryParam).toBeDefined();
    expect(queryParam!.in).toBe("query");
    expect(queryParam!.required).toBe(false);
  });

  it("9 — extract auth schemes from components.securitySchemes", () => {
    const spec = parseOpenApiSpec(MINIMAL_OPENAPI);
    expect(spec.auth_schemes["ApiKeyAuth"]).toBeDefined();
    expect(spec.auth_schemes["ApiKeyAuth"]!.type).toBe("apiKey");
    expect(spec.auth_schemes["ApiKeyAuth"]!.name).toBe("X-API-Key");
    expect(spec.auth_schemes["ApiKeyAuth"]!.in).toBe("header");
    expect(spec.auth_schemes["BearerAuth"]).toBeDefined();
  });

  it("10 — handle YAML spec and missing optional fields gracefully", () => {
    const spec = parseOpenApiSpec(MINIMAL_YAML_OPENAPI);
    expect(spec.title).toBe("YAML API");
    expect(spec.version).toBe("2.0.0");
    expect(spec.base_url).toBe("https://yaml.example.com");
    expect(spec.endpoints).toHaveLength(1);
    expect(spec.endpoints[0]!.method).toBe("GET");
    expect(spec.endpoints[0]!.parameters).toEqual([]);
    expect(spec.auth_schemes).toEqual({});
    // No operation_id — field should be absent
    expect(spec.endpoints[0]!.operation_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 11-15: IntelligentPathResolver
// ---------------------------------------------------------------------------

describe("IntelligentPathResolver", () => {
  let store: SchemaStore;
  let registry: ReturnType<typeof makeRegistry>;
  let resolver: IntelligentPathResolver;

  beforeEach(async () => {
    store    = new SchemaStore(":memory:");
    await store.init();
    registry = makeRegistry();
    resolver = new IntelligentPathResolver(store, registry, GATEWAY_CONFIG.gateway.intelligent_path);
  });

  it("11 — resolve with valid schema constructs request", async () => {
    await store.storeSchema(SCHEMA_FIXTURE);
    vi.mocked(registry.call).mockResolvedValue({
      callId: "c1",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      content: '{"path":"/items","method":"GET","headers":{},"body":null,"query_params":{}}',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      costUsd: 0.001,
      latencyMs: 200,
    });

    const result = await resolver.resolve("test-api", "List all items", {});
    expect(result.success).toBe(true);
    expect(result.url).toBe("https://api.example.com/items");
    expect(result.method).toBe("GET");
  });

  it("12 — resolve with missing schema returns error", async () => {
    const result = await resolver.resolve("nonexistent-api", "Do something", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("No API schema found");
    expect(registry.call).not.toHaveBeenCalled();
  });

  it("13 — LLM response validation fails → returns error", async () => {
    await store.storeSchema(SCHEMA_FIXTURE);
    // LLM returns a path that doesn't exist in spec
    vi.mocked(registry.call).mockResolvedValue({
      callId: "c2",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      content: '{"path":"/nonexistent","method":"DELETE","headers":{}}',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      costUsd: 0.001,
      latencyMs: 200,
    });

    const result = await resolver.resolve("test-api", "Delete everything", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("validation failed");
  });

  it("14 — credentials are NOT included in the LLM prompt", async () => {
    // The IntelligentPathResolver structurally cannot include credentials:
    // its constructor takes (schemaStore, providerRegistry, config) — no credentials.
    // Credentials are resolved by the gateway AFTER resolve() returns.
    // This test verifies the LLM prompt contains no auth header values.
    await store.storeSchema({
      ...SCHEMA_FIXTURE,
      service_name: "secret-api",
    });
    vi.mocked(registry.call).mockResolvedValue({
      callId: "c3",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      content: '{"path":"/items","method":"GET","headers":{}}',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      costUsd: 0.001,
      latencyMs: 200,
    });

    // Normal agent params (not gateway credentials)
    await resolver.resolve("secret-api", "List items", { user_id: "123", format: "json" });

    expect(registry.call).toHaveBeenCalled();
    const callArg = vi.mocked(registry.call).mock.calls[0]![0];
    const promptText = callArg.messages.map((m) => m.content).join(" ");

    // No auth header values should appear in the prompt
    expect(promptText).not.toContain("Authorization:");
    expect(promptText).not.toContain("Bearer sk-");
    // Auth scheme names (ApiKeyAuth, BearerAuth) may appear, but not credential values
    expect(promptText).not.toContain("X-API-Key: sk-");
  });

  it("15 — records usage on success", async () => {
    await store.storeSchema(SCHEMA_FIXTURE);
    vi.mocked(registry.call).mockResolvedValue({
      callId: "c4",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      content: '{"path":"/items","method":"GET","headers":{}}',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      costUsd: 0.001,
      latencyMs: 200,
    });

    await resolver.resolve("test-api", "List items", {});

    const updated = await store.getSchema("test-api");
    expect(updated!.usage_count).toBe(1);
    expect(updated!.success_rate).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// 16-18: AdapterPromoter
// ---------------------------------------------------------------------------

describe("AdapterPromoter", () => {
  let store: SchemaStore;
  const promoter = new AdapterPromoter();

  beforeEach(async () => {
    store = new SchemaStore(":memory:");
    await store.init();
  });

  it("16 — identify candidates above threshold as recommended", async () => {
    await store.storeSchema({
      ...SCHEMA_FIXTURE,
      usage_count: 15,
      success_rate: 0.9,
      quality: "discovered",
    });
    const candidates = await promoter.getCandidates(store);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.recommended).toBe(true);
  });

  it("17 — filter out services below threshold", async () => {
    await store.storeSchema({
      ...SCHEMA_FIXTURE,
      service_name: "below-threshold",
      usage_count: 5,      // < 10
      success_rate: 0.9,
      quality: "draft",
    });
    await store.storeSchema({
      ...SCHEMA_FIXTURE,
      service_name: "low-success",
      usage_count: 20,
      success_rate: 0.5,   // < 0.8
      quality: "discovered",
    });
    await store.storeSchema({
      ...SCHEMA_FIXTURE,
      service_name: "verified-skip",
      usage_count: 100,
      success_rate: 1.0,
      quality: "verified", // excluded
    });
    const candidates = await promoter.getCandidates(store);
    // verified is excluded; below-threshold and low-success are not recommended
    const names = candidates.map((c) => c.service_name).sort();
    expect(names).toContain("below-threshold");
    expect(names).toContain("low-success");
    expect(names).not.toContain("verified-skip");
    expect(candidates.every((c) => !c.recommended)).toBe(true);
  });

  it("18 — generateAdapterYaml produces valid YAML with service name and actions", async () => {
    const yaml = await promoter.generateAdapterYaml(SCHEMA_FIXTURE, []);
    expect(yaml).toContain("name: test-api");
    expect(yaml).toContain("type: deterministic");
    expect(yaml).toContain("protocol: rest");
    expect(yaml).toContain("base_url: \"https://api.example.com\"");
    expect(yaml).toContain("listItems:");
    expect(yaml).toContain("method: GET");
    expect(yaml).toContain("createItem:");
    expect(yaml).toContain("method: POST");
    expect(yaml).toContain("risk_level: low");
    expect(yaml).toContain("risk_level: medium");
  });
});

// ---------------------------------------------------------------------------
// 19-20: Gateway intelligent path integration
// ---------------------------------------------------------------------------

describe("Gateway — intelligent path", () => {
  function makeGateway(
    intelligentEnabled: boolean,
    resolver?: IntelligentPathResolver,
  ): IntegrationGateway {
    const config: IntegrationConfig = {
      ...GATEWAY_CONFIG,
      gateway: {
        ...GATEWAY_CONFIG.gateway,
        intelligent_path: {
          ...GATEWAY_CONFIG.gateway.intelligent_path,
          enabled: intelligentEnabled,
        },
      },
    };
    const reg     = new AdapterRegistry();
    const router  = new RouteResolver(reg, config);
    const http    = new HttpExecutor();
    return new IntegrationGateway(
      reg,
      router,
      http,
      makeAuditService(),
      makeSecretsService(),
      config,
      undefined,
      undefined,
      undefined,
      undefined,
      resolver,
    );
  }

  const baseRequest = {
    service:    "unknown-service",
    action:     "do-something",
    params:     {},
    agent_id:   "agent-1",
    division:   "engineering",
    request_id: "req-123",
    timestamp:  "2026-01-01T00:00:00.000Z",
  };

  it("19 — intelligent path disabled → returns error without calling resolver", async () => {
    const mockResolver = {
      resolve: vi.fn(),
    } as unknown as IntelligentPathResolver;

    const gateway = makeGateway(false, mockResolver);
    const result  = await gateway.execute(baseRequest);

    expect(result.success).toBe(false);
    // When intelligent path is disabled, the route resolver returns 'blocked'
    // with a message containing "intelligent path is disabled"
    expect(result.error?.toLowerCase()).toContain("intelligent path is disabled");
    expect(mockResolver.resolve).not.toHaveBeenCalled();
  });

  it("20 — intelligent path enabled + schema exists → full flow (mock LLM + fetch)", async () => {
    // Build schema store + resolver
    const store  = new SchemaStore(":memory:");
    await store.init();
    await store.storeSchema(SCHEMA_FIXTURE);

    const mockRegistry: ProviderRegistryLike = {
      call: vi.fn().mockResolvedValue({
        callId:  "llm-1",
        provider: "anthropic",
        model:    "claude-haiku-4-5-20251001",
        content:  '{"path":"/items","method":"GET","headers":{}}',
        usage:    { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        costUsd:  0.001,
        latencyMs: 200,
      }),
    };

    const resolver = new IntelligentPathResolver(
      store,
      mockRegistry,
      GATEWAY_CONFIG.gateway.intelligent_path,
    );

    const gateway = makeGateway(true, resolver);

    // Mock fetch to return a successful HTTP response
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await gateway.execute({
      ...baseRequest,
      service: "test-api",
    });

    vi.unstubAllGlobals();

    expect(result.success).toBe(true);
    expect(result.path_used).toBe("intelligent");
    expect(result.status_code).toBe(200);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl] = mockFetch.mock.calls[0]!;
    expect(calledUrl).toContain("api.example.com");
  });
});
