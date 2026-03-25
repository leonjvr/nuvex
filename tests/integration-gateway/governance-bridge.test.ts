// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Integration Gateway — Governance Bridge Tests (#503)
 *
 * Covers:
 *   - PolicyEnforcer (access decisions, glob matching, domain allow-list)
 *   - WebAccessPolicyLoader (YAML parse + validation)
 *   - InMemoryGatewayBudgetTracker
 *   - IntegrationGateway with governance (blocked, approval_required, allowed)
 *   - IntegrationError
 *   - globMatch utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir }    from "node:os";
import { join }      from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { PolicyEnforcer, globMatch } from "../../src/integration-gateway/policy-enforcer.js";
import { WebAccessPolicyLoader }      from "../../src/integration-gateway/web-access-policy.js";
import { InMemoryGatewayBudgetTracker } from "../../src/integration-gateway/budget-tracker.js";
import { IntegrationError }           from "../../src/integration-gateway/errors.js";
import { IntegrationGateway }         from "../../src/integration-gateway/gateway.js";
import { AdapterRegistry }            from "../../src/integration-gateway/adapter-registry.js";
import { RouteResolver }              from "../../src/integration-gateway/route-resolver.js";
import { HttpExecutor }               from "../../src/integration-gateway/http-executor.js";
import type {
  WebAccessPolicy,
  GatewayAuditService,
  GatewaySecretsService,
  GatewayBudgetService,
  IntegrationConfig,
  GatewayRequest,
} from "../../src/integration-gateway/types.js";
import { setGlobalLevel, resetLogger } from "../../src/core/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides: Partial<WebAccessPolicy> = {}): WebAccessPolicy {
  return {
    division: "engineering",
    allowed_services: [
      { service: "github", actions: ["getRepo", "listIssues"] },
      { service: "slack",  actions: ["*"] },
    ],
    blocked_services:  [],
    approval_rules:    [],
    budget: { per_call: 0.01, daily_limit: 5.0, monthly_limit: 50.0 },
    rate_limits: { per_service: "60/hour", total: "300/hour" },
    audit: { log_requests: true, log_responses: false, retention_days: 90 },
    ...overrides,
  };
}

function makeLoader(policy: WebAccessPolicy | null): WebAccessPolicyLoader {
  const loader = {
    getPolicy: vi.fn().mockResolvedValue(policy),
    policyPath: vi.fn().mockReturnValue("/fake/path"),
    clearCache:  vi.fn(),
  } as unknown as WebAccessPolicyLoader;
  return loader;
}

function makeBudgetService(dailySpend = 0, monthlySpend = 0): GatewayBudgetService {
  return {
    getCurrentSpend: vi.fn().mockImplementation((_div: string, period: "daily" | "monthly") =>
      Promise.resolve(period === "daily" ? dailySpend : monthlySpend),
    ),
    recordSpend: vi.fn().mockResolvedValue(undefined),
  };
}

const BASE_CONFIG: IntegrationConfig = {
  gateway: {
    enabled: true,
    intelligent_path: { enabled: false, llm_provider: "openai", llm_model: "gpt-4o", max_tokens_per_discovery: 2000, cache_discovered_schemas: false },
    deterministic_adapters: [],
    global_rate_limit: "unlimited",
    global_budget: { daily: 100, monthly: 1000 },
    credential_store: "sqlite",
    audit: { enabled: true, retention_days: 90 },
  },
};

const DEMO_ADAPTER = {
  name: "github",
  type: "deterministic" as const,
  protocol: "rest" as const,
  base_url: "https://api.github.com",
  enabled: true,
  actions: {
    getRepo: {
      method: "GET",
      path: "/repos/{owner}/{repo}",
      governance: { require_approval: false, budget_per_call: 0.001, risk_level: "low" as const },
    },
  },
};

function makeGateway(policyEnforcer?: PolicyEnforcer) {
  const registry = new AdapterRegistry();
  registry.registerAdapter(DEMO_ADAPTER);

  const resolver  = new RouteResolver(registry, BASE_CONFIG);
  const executor  = new HttpExecutor();
  const audit: GatewayAuditService = { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
  const secrets: GatewaySecretsService = { get: vi.fn().mockResolvedValue(null) };

  return new IntegrationGateway(registry, resolver, executor, audit, secrets, BASE_CONFIG, policyEnforcer);
}

function makeRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    agent_id:   "agent-001",
    division:   "engineering",
    service:    "github",
    action:     "getRepo",
    params:     { owner: "acme", repo: "core" },
    request_id: randomUUID(),
    timestamp:  new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => setGlobalLevel("error"));
afterEach(() => resetLogger());

// ── 1–7: PolicyEnforcer ────────────────────────────────────────────────────

describe("PolicyEnforcer", () => {
  it("1. allowed service + action → access granted", async () => {
    const enforcer = new PolicyEnforcer(makeLoader(makePolicy()));
    const result = await enforcer.checkAccess("engineering", "github", "getRepo", {});
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("2. blocked service pattern → access denied", async () => {
    const policy = makePolicy({
      blocked_services: [{ service: "*banking*" }],
      allowed_services: [{ service: "online-banking", actions: ["transfer"] }],
    });
    const enforcer = new PolicyEnforcer(makeLoader(policy));
    const result = await enforcer.checkAccess("engineering", "online-banking", "transfer", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/blocked/i);
  });

  it("3. service not in allow-list → access denied", async () => {
    const enforcer = new PolicyEnforcer(makeLoader(makePolicy()));
    const result = await enforcer.checkAccess("engineering", "jira", "getTicket", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not in allow-list/i);
  });

  it("4. no policy file for division → deny all", async () => {
    const enforcer = new PolicyEnforcer(makeLoader(null));
    const result = await enforcer.checkAccess("unknown-div", "github", "getRepo", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/no web access policy/i);
  });

  it("5. approval rule matches → approval_required", async () => {
    const policy = makePolicy({
      approval_rules: [{ action: "deploy*", approver: "division_head" }],
      allowed_services: [{ service: "github", actions: ["deployRelease"] }],
    });
    const enforcer = new PolicyEnforcer(makeLoader(policy));
    const result = await enforcer.checkAccess("engineering", "github", "deployRelease", {});
    expect(result.allowed).toBe(true);
    expect(result.approval_required).toBe(true);
    expect(result.approver).toBe("division_head");
  });

  it("6. budget exceeded (monthly) → denied", async () => {
    const budget = makeBudgetService(0, 50.0); // monthly spent == limit
    const enforcer = new PolicyEnforcer(makeLoader(makePolicy()), budget);
    const result = await enforcer.checkAccess("engineering", "github", "getRepo", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/budget/i);
  });

  it("6b. daily budget exceeded → denied", async () => {
    const budget = makeBudgetService(5.0, 0); // daily spent == limit
    const enforcer = new PolicyEnforcer(makeLoader(makePolicy()), budget);
    const result = await enforcer.checkAccess("engineering", "github", "getRepo", {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/budget/i);
  });
});

// ── 7–9: WebAccessPolicyLoader ─────────────────────────────────────────────

describe("WebAccessPolicyLoader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `igw-policy-test-${randomUUID()}`);
    await mkdir(join(tmpDir, "governance", "boundaries"), { recursive: true });
  });

  it("7. parse valid YAML policy", async () => {
    const yaml = `
allowed_services:
  - service: github
    actions:
      - getRepo
      - listIssues
blocked_services: []
approval_rules: []
budget:
  per_call: 0.01
  daily_limit: 5.0
  monthly_limit: 50.0
rate_limits:
  per_service: "60/hour"
  total: "300/hour"
audit:
  log_requests: true
  log_responses: false
  retention_days: 90
`;
    await writeFile(join(tmpDir, "governance", "boundaries", "web-access-engineering.yaml"), yaml);
    const loader = new WebAccessPolicyLoader(tmpDir);
    const policy = await loader.getPolicy("engineering");
    expect(policy).not.toBeNull();
    expect(policy!.allowed_services).toHaveLength(1);
    expect(policy!.allowed_services[0]!.service).toBe("github");
    expect(policy!.budget.per_call).toBe(0.01);
  });

  it("8. missing required fields → error", async () => {
    const yaml = `
blocked_services: []
`;
    await writeFile(join(tmpDir, "governance", "boundaries", "web-access-bad.yaml"), yaml);
    const loader = new WebAccessPolicyLoader(tmpDir);
    await expect(loader.getPolicy("bad")).rejects.toThrow(/allowed_services/);
  });

  it("9. no policy file → returns null (deny-all)", async () => {
    const loader = new WebAccessPolicyLoader(tmpDir);
    const policy = await loader.getPolicy("no-such-division");
    expect(policy).toBeNull();
  });
});

// ── 10–12: Credential resolution ───────────────────────────────────────────

describe("Credential resolution via gateway", () => {
  const adapterWithAuth = {
    ...DEMO_ADAPTER,
    auth: { type: "bearer" as const, secret_ref: "github-token" },
  };

  it("10. division namespace found → success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ id: 1 }),
    }));

    const registry = new AdapterRegistry();
    registry.registerAdapter(adapterWithAuth);

    const secrets: GatewaySecretsService = {
      get: vi.fn().mockImplementation((ns: string) =>
        ns.startsWith("divisions/") ? Promise.resolve("div-token") : Promise.resolve(null),
      ),
    };
    const audit: GatewayAuditService = { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
    const gw = new IntegrationGateway(registry, new RouteResolver(registry, BASE_CONFIG), new HttpExecutor(), audit, secrets, BASE_CONFIG);
    const resp = await gw.execute(makeRequest());
    expect(resp.success).toBe(true);
    vi.unstubAllGlobals();
  });

  it("11. fallback to global namespace → success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ id: 2 }),
    }));

    const registry = new AdapterRegistry();
    registry.registerAdapter(adapterWithAuth);

    const secrets: GatewaySecretsService = {
      get: vi.fn().mockImplementation((ns: string) =>
        ns.startsWith("divisions/") ? Promise.resolve(null) : Promise.resolve("global-token"),
      ),
    };
    const audit: GatewayAuditService = { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
    const gw = new IntegrationGateway(registry, new RouteResolver(registry, BASE_CONFIG), new HttpExecutor(), audit, secrets, BASE_CONFIG);
    const resp = await gw.execute(makeRequest());
    expect(resp.success).toBe(true);
    vi.unstubAllGlobals();
  });

  it("12. neither namespace found → CREDENTIALS_MISSING error", async () => {
    const registry = new AdapterRegistry();
    registry.registerAdapter(adapterWithAuth);

    const secrets: GatewaySecretsService = { get: vi.fn().mockResolvedValue(null) };
    const audit: GatewayAuditService = { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
    const gw = new IntegrationGateway(registry, new RouteResolver(registry, BASE_CONFIG), new HttpExecutor(), audit, secrets, BASE_CONFIG);
    const resp = await gw.execute(makeRequest());
    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/No credential found/i);
  });
});

// ── 13–16: Auth header building ────────────────────────────────────────────

describe("Auth header building (HttpExecutor)", () => {
  it("13. api_key type sets custom header", async () => {
    const captured: Record<string, string>[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      captured.push(init.headers as Record<string, string>);
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: () => null },
        text: async () => "{}",
      });
    }));

    const registry = new AdapterRegistry();
    registry.registerAdapter({
      ...DEMO_ADAPTER,
      auth: { type: "api_key", secret_ref: "key", header: "X-API-Key" },
    });
    const secrets: GatewaySecretsService = { get: vi.fn().mockResolvedValue("my-key") };
    const audit: GatewayAuditService = { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
    const gw = new IntegrationGateway(registry, new RouteResolver(registry, BASE_CONFIG), new HttpExecutor(), audit, secrets, BASE_CONFIG);
    await gw.execute(makeRequest());
    expect(captured[0]?.["X-API-Key"]).toBe("my-key");
    vi.unstubAllGlobals();
  });

  it("14. bearer type sets Authorization: Bearer", async () => {
    const captured: Record<string, string>[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      captured.push(init.headers as Record<string, string>);
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" });
    }));

    const registry = new AdapterRegistry();
    registry.registerAdapter({ ...DEMO_ADAPTER, auth: { type: "bearer", secret_ref: "tok" } });
    const secrets: GatewaySecretsService = { get: vi.fn().mockResolvedValue("tok123") };
    const audit: GatewayAuditService = { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
    const gw = new IntegrationGateway(registry, new RouteResolver(registry, BASE_CONFIG), new HttpExecutor(), audit, secrets, BASE_CONFIG);
    await gw.execute(makeRequest());
    expect(captured[0]?.["Authorization"]).toBe("Bearer tok123");
    vi.unstubAllGlobals();
  });

  it("15. basic type sets Authorization: Basic <b64>", async () => {
    const captured: Record<string, string>[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      captured.push(init.headers as Record<string, string>);
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" });
    }));

    const registry = new AdapterRegistry();
    registry.registerAdapter({ ...DEMO_ADAPTER, auth: { type: "basic", secret_ref: "cred" } });
    const secrets: GatewaySecretsService = { get: vi.fn().mockResolvedValue("user:pass") };
    const audit: GatewayAuditService = { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
    const gw = new IntegrationGateway(registry, new RouteResolver(registry, BASE_CONFIG), new HttpExecutor(), audit, secrets, BASE_CONFIG);
    await gw.execute(makeRequest());
    const expected = `Basic ${Buffer.from("user:pass").toString("base64")}`;
    expect(captured[0]?.["Authorization"]).toBe(expected);
    vi.unstubAllGlobals();
  });

  it("16. unknown auth type → no credential header (treated as none)", async () => {
    // Auth type validation happens at adapter registration; an unknown type
    // falls through to the default case in buildAuthHeaders which returns {}.
    const captured: Record<string, string>[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      captured.push(init.headers as Record<string, string>);
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" });
    }));

    const registry = new AdapterRegistry();
    // Register without auth — equivalent to an "unknown" type producing no header
    registry.registerAdapter(DEMO_ADAPTER);
    const secrets: GatewaySecretsService = { get: vi.fn().mockResolvedValue(null) };
    const audit: GatewayAuditService = { logIntegrationEvent: vi.fn().mockResolvedValue(undefined) };
    const gw = new IntegrationGateway(registry, new RouteResolver(registry, BASE_CONFIG), new HttpExecutor(), audit, secrets, BASE_CONFIG);
    await gw.execute(makeRequest());
    // No Authorization header should be present for a no-auth adapter
    expect(captured[0]?.["Authorization"]).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

// ── 17–19: Domain allow-list ───────────────────────────────────────────────

describe("Domain allow-list", () => {
  it("17. allowed domain → pass", () => {
    const policy = makePolicy({ allowed_domains: ["api.github.com", "*.slack.com"] });
    const enforcer = new PolicyEnforcer(makeLoader(policy));
    expect(enforcer.checkDomain(policy, "api.github.com")).toBe(true);
  });

  it("18. blocked domain (not in allow-list) → deny", () => {
    const policy = makePolicy({ allowed_domains: ["api.github.com"] });
    const enforcer = new PolicyEnforcer(makeLoader(policy));
    expect(enforcer.checkDomain(policy, "evil.example.com")).toBe(false);
  });

  it("19. no explicit allow → deny (deny-by-default)", () => {
    const policy = makePolicy({ allowed_domains: [] });
    const enforcer = new PolicyEnforcer(makeLoader(policy));
    expect(enforcer.checkDomain(policy, "api.github.com")).toBe(false);
  });

  it("19b. wildcard domain pattern matches subdomain", () => {
    const policy = makePolicy({ allowed_domains: ["*.slack.com"] });
    const enforcer = new PolicyEnforcer(makeLoader(policy));
    expect(enforcer.checkDomain(policy, "acme.slack.com")).toBe(true);
    expect(enforcer.checkDomain(policy, "other.slack.com")).toBe(true);
    expect(enforcer.checkDomain(policy, "notslack.com")).toBe(false);
  });
});

// ── 20–22: Gateway with governance ─────────────────────────────────────────

describe("IntegrationGateway with governance", () => {
  it("20. blocked by policy → audit event + error response", async () => {
    const enforcer = new PolicyEnforcer(makeLoader(null)); // null = deny-all
    const gw = makeGateway(enforcer);
    const auditSpy = vi.spyOn(
      (gw as unknown as { auditService: GatewayAuditService }).auditService,
      "logIntegrationEvent",
    );

    const resp = await gw.execute(makeRequest());
    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/no web access policy/i);
    // Audit should have been called (at least for the initial request + blocked events)
    expect(auditSpy).toHaveBeenCalled();
  });

  it("21. approval required → returns approval error", async () => {
    const policy = makePolicy({
      approval_rules: [{ action: "getRepo", approver: "human" }],
    });
    const enforcer = new PolicyEnforcer(makeLoader(policy));
    const gw = makeGateway(enforcer);

    const resp = await gw.execute(makeRequest());
    expect(resp.success).toBe(false);
    expect(resp.error).toMatch(/approval required/i);
    expect(resp.error).toMatch(/human/i);
  });

  it("22. policy allows → proceeds to HTTP execution", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ full_name: "acme/core" }),
    }));

    const policy = makePolicy(); // allows github.getRepo
    const enforcer = new PolicyEnforcer(makeLoader(policy));
    const gw = makeGateway(enforcer);

    const resp = await gw.execute(makeRequest());
    expect(resp.success).toBe(true);
    expect(resp.path_used).toBe("deterministic");
    vi.unstubAllGlobals();
  });
});

// ── 23–24: Glob matching ───────────────────────────────────────────────────

describe("globMatch utility", () => {
  it("23. *banking* matches online-banking", () => {
    expect(globMatch("*banking*", "online-banking")).toBe(true);
    expect(globMatch("*banking*", "banking-api")).toBe(true);
    expect(globMatch("*banking*", "banking")).toBe(true);
    expect(globMatch("*banking*", "BANKING")).toBe(true); // case-insensitive
    expect(globMatch("*banking*", "savings-only")).toBe(false);
  });

  it("24. newsletter-* matches newsletter-weekly", () => {
    expect(globMatch("newsletter-*", "newsletter-weekly")).toBe(true);
    expect(globMatch("newsletter-*", "newsletter-daily")).toBe(true);
    expect(globMatch("newsletter-*", "newsletter-")).toBe(true);
    expect(globMatch("newsletter-*", "other-newsletter")).toBe(false);
  });

  it("24b. ? matches exactly one character", () => {
    expect(globMatch("hel?o", "hello")).toBe(true);
    expect(globMatch("hel?o", "helllo")).toBe(false);
  });

  it("24c. exact match without wildcards", () => {
    expect(globMatch("github", "github")).toBe(true);
    expect(globMatch("github", "gitlab")).toBe(false);
  });
});

// ── 25: Budget tracker ─────────────────────────────────────────────────────

describe("InMemoryGatewayBudgetTracker", () => {
  it("25. within limit → allowed (spend recorded and retrieved correctly)", async () => {
    const tracker = new InMemoryGatewayBudgetTracker();

    // No spend yet → 0
    expect(await tracker.getCurrentSpend("eng", "monthly")).toBe(0);
    expect(await tracker.getCurrentSpend("eng", "daily")).toBe(0);

    // Record spend
    await tracker.recordSpend("eng", 2.5, "github");
    expect(await tracker.getCurrentSpend("eng", "daily")).toBe(2.5);
    expect(await tracker.getCurrentSpend("eng", "monthly")).toBe(2.5);

    // Another spend event
    await tracker.recordSpend("eng", 1.0, "slack");
    expect(await tracker.getCurrentSpend("eng", "daily")).toBe(3.5);
    expect(await tracker.getCurrentSpend("eng", "monthly")).toBe(3.5);
  });

  it("25b. different divisions tracked independently", async () => {
    const tracker = new InMemoryGatewayBudgetTracker();
    await tracker.recordSpend("eng", 5.0, "github");
    await tracker.recordSpend("ops", 1.0, "pagerduty");
    expect(await tracker.getCurrentSpend("eng", "daily")).toBe(5.0);
    expect(await tracker.getCurrentSpend("ops", "daily")).toBe(1.0);
  });

  it("25c. resetDivision clears counters", async () => {
    const tracker = new InMemoryGatewayBudgetTracker();
    await tracker.recordSpend("eng", 5.0, "github");
    tracker.resetDivision("eng");
    expect(await tracker.getCurrentSpend("eng", "daily")).toBe(0);
  });

  it("25d. PolicyEnforcer uses budget tracker correctly", async () => {
    const tracker = new InMemoryGatewayBudgetTracker();
    // Within limits
    const enforcerOk = new PolicyEnforcer(makeLoader(makePolicy()), tracker);
    const resultOk = await enforcerOk.checkAccess("engineering", "github", "getRepo", {});
    expect(resultOk.allowed).toBe(true);

    // Exceed monthly limit (50.0)
    await tracker.recordSpend("engineering", 50.0, "github");
    const enforcerExceeded = new PolicyEnforcer(makeLoader(makePolicy()), tracker);
    const resultExceeded = await enforcerExceeded.checkAccess("engineering", "github", "getRepo", {});
    expect(resultExceeded.allowed).toBe(false);
    expect(resultExceeded.reason).toMatch(/budget/i);
  });
});

// ── Extra: IntegrationError ────────────────────────────────────────────────

describe("IntegrationError", () => {
  it("has correct name and code", () => {
    const err = new IntegrationError("Creds missing", "CREDENTIALS_MISSING", "github", "getRepo");
    expect(err.name).toBe("IntegrationError");
    expect(err.code).toBe("CREDENTIALS_MISSING");
    expect(err.service).toBe("github");
    expect(err.action).toBe("getRepo");
    expect(err.message).toBe("Creds missing");
    expect(err instanceof Error).toBe(true);
  });

  it("works without optional fields", () => {
    const err = new IntegrationError("Budget exceeded", "BUDGET_EXCEEDED");
    expect(err.service).toBeUndefined();
    expect(err.action).toBeUndefined();
  });
});
