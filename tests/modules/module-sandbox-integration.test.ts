// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Integration tests for module sandbox execution.
 *
 * Covers:
 *   - Full flow: agent calls tool → executor → provider → function → result
 *   - NoSandboxProvider full flow
 *   - Module tool sees correct params
 *   - Module tool timeout triggers cleanup (success: false)
 *   - Division-level timeout override
 *   - Multiple agents call same module tool independently
 *   - Error codes MOD-001..005 map to correct HTTP status
 *   - Error handler maps MODULE errors correctly
 *   - Existing module-loader tests unaffected
 *   - Unknown module gets null policy (deny-all warning logged)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono }                  from "hono";
import {
  ModuleSandboxExecutor,
  getModuleToolAuditLog,
  clearModuleToolAuditLog,
  resetDefaultModuleSandboxExecutor,
} from "../../src/modules/sandbox-executor.js";
import { getModuleNetworkPolicy } from "../../src/modules/network-policy.js";
import { NoSandboxProvider }      from "../../src/core/sandbox/no-sandbox-provider.js";
import { SidjuaError }            from "../../src/core/error-codes.js";
import { createErrorHandler }     from "../../src/api/middleware/error-handler.js";
import type { SandboxProvider, AgentSandboxConfig, SandboxDependencyCheck } from "../../src/core/sandbox/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBubblewrapMock(): SandboxProvider {
  return {
    name:        "bubblewrap",
    initialized: true,
    async initialize() {},
    async wrapCommand(cmd: string, _: AgentSandboxConfig) { return cmd; },
    async checkDependencies(): Promise<SandboxDependencyCheck> {
      return { available: true, provider: "bubblewrap", missing: [], message: "" };
    },
    async cleanup() {},
  };
}

function makeRequest(overrides: Partial<{
  moduleName: string;
  toolName:   string;
  params:     Record<string, unknown>;
  agentId:    string;
  divisionId: string;
}> = {}) {
  return {
    moduleName: "discord",
    toolName:   "discord_send_message",
    params:     { channel_id: "789", content: "Integration test" },
    agentId:    "guide",
    divisionId: "system",
    ...overrides,
  };
}

beforeEach(() => {
  clearModuleToolAuditLog();
  resetDefaultModuleSandboxExecutor();
});

// ---------------------------------------------------------------------------
// Full flow: NoSandboxProvider
// ---------------------------------------------------------------------------

describe("Full flow — NoSandboxProvider", () => {
  it("agent calls discord tool → executor → function → result", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider());
    const req      = makeRequest();

    let capturedParams: Record<string, unknown> | undefined;
    const toolFn = async (params: Record<string, unknown>) => {
      capturedParams = params;
      return { message_id: "abc123", channel_id: params["channel_id"] };
    };

    const result = await executor.execute(req, toolFn);

    expect(result.success).toBe(true);
    expect(result.sandboxed).toBe(false);
    expect(capturedParams).toEqual(req.params);
    expect((result.result as Record<string, unknown>)["message_id"]).toBe("abc123");
  });

  it("params are passed unchanged to the tool function", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider());
    const params   = { channel_id: "999", content: "hello", embed: { title: "T" } };

    let received: Record<string, unknown> | undefined;
    await executor.execute(makeRequest({ params }), async (p) => {
      received = p;
      return {};
    });

    expect(received).toEqual(params);
  });

  it("result from tool function is returned in result field", async () => {
    const executor  = new ModuleSandboxExecutor(new NoSandboxProvider());
    const toolResult = { status: "sent", ts: "1234567890.123" };

    const execResult = await executor.execute(makeRequest(), async () => toolResult);

    expect(execResult.result).toEqual(toolResult);
  });
});

// ---------------------------------------------------------------------------
// Full flow: BubblewrapProvider (mock)
// ---------------------------------------------------------------------------

describe("Full flow — BubblewrapProvider (mock)", () => {
  it("sandboxed: true when provider is bubblewrap", async () => {
    const executor = new ModuleSandboxExecutor(makeBubblewrapMock());
    const result   = await executor.execute(makeRequest(), async () => ({ ok: true }));

    expect(result.success).toBe(true);
    expect(result.sandboxed).toBe(true);
  });

  it("audit log reflects sandboxed: true", async () => {
    const executor = new ModuleSandboxExecutor(makeBubblewrapMock());
    await executor.execute(makeRequest(), async () => "done");

    const log = getModuleToolAuditLog();
    expect(log[0]!.sandboxed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple agents, independent calls
// ---------------------------------------------------------------------------

describe("Multiple agents call same module tool independently", () => {
  it("two agents produce separate audit events", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider());

    await executor.execute(makeRequest({ agentId: "guide",    divisionId: "system" }), async () => "r1");
    await executor.execute(makeRequest({ agentId: "librarian", divisionId: "system" }), async () => "r2");

    const log = getModuleToolAuditLog();
    expect(log).toHaveLength(2);

    const agentIds = log.map((e) => e.agentId);
    expect(agentIds).toContain("guide");
    expect(agentIds).toContain("librarian");
  });

  it("parallel executions all succeed independently", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider());

    const requests = ["hr", "it", "auditor", "finance"].map((id) =>
      executor.execute(makeRequest({ agentId: id }), async () => ({ from: id }))
    );

    const results = await Promise.all(requests);
    for (const r of results) {
      expect(r.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Timeout with division-level override
// ---------------------------------------------------------------------------

describe("Module tool timeout", () => {
  it("division-level short timeout blocks slow tools", async () => {
    const DIVISION_TIMEOUT = 30; // ms
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider(), DIVISION_TIMEOUT);

    const result = await executor.execute(makeRequest(), async () => {
      await new Promise((r) => setTimeout(r, 300));
      return "never";
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("timed out execution logs a module_tool_error audit event", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider(), 20);

    await executor.execute(makeRequest(), async () => {
      await new Promise((r) => setTimeout(r, 200));
      return "never";
    });

    const log = getModuleToolAuditLog();
    expect(log[0]!.eventType).toBe("module_tool_error");
    expect(log[0]!.error).toContain("timed out");
  });
});

// ---------------------------------------------------------------------------
// Unknown module gets null policy
// ---------------------------------------------------------------------------

describe("Unknown module network policy", () => {
  it("getModuleNetworkPolicy returns null for unknown module", () => {
    expect(getModuleNetworkPolicy("unknown")).toBeNull();
  });

  it("executor throws MOD-002 for unknown module (FIX-5 network policy enforcement)", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider());
    let caught: unknown;
    try {
      await executor.execute(makeRequest({ moduleName: "unknown-module" }), async () => ({ ok: true }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { code?: string }).code).toBe("MOD-002");
  });
});

// ---------------------------------------------------------------------------
// Error code HTTP status mappings
// ---------------------------------------------------------------------------

describe("MOD error codes — HTTP status mapping", () => {
  function buildTestApp(errorCode: string): Hono {
    const app = new Hono();
    app.onError(createErrorHandler(false));
    app.get("/test", () => {
      throw SidjuaError.from(errorCode as Parameters<typeof SidjuaError.from>[0], "test");
    });
    return app;
  }

  it("MOD-001 → 500", async () => {
    const res = await buildTestApp("MOD-001").request("/test");
    expect(res.status).toBe(500);
  });

  it("MOD-002 → 403 (network policy violation)", async () => {
    const res = await buildTestApp("MOD-002").request("/test");
    expect(res.status).toBe(403);
  });

  it("MOD-003 → 403 (not first-party)", async () => {
    const res = await buildTestApp("MOD-003").request("/test");
    expect(res.status).toBe(403);
  });

  it("MOD-004 → 500 (sandbox init failed)", async () => {
    const res = await buildTestApp("MOD-004").request("/test");
    expect(res.status).toBe(500);
  });

  it("MOD-005 → 504 (timeout)", async () => {
    const res = await buildTestApp("MOD-005").request("/test");
    expect(res.status).toBe(504);
  });

  it("error response body includes error code", async () => {
    const res  = await buildTestApp("MOD-003").request("/test");
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("MOD-003");
  });
});

// ---------------------------------------------------------------------------
// Regression: existing audit log cleared correctly
// ---------------------------------------------------------------------------

describe("Regression — audit log isolation", () => {
  it("clearModuleToolAuditLog clears events between tests", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider());
    await executor.execute(makeRequest(), async () => "ok");

    expect(getModuleToolAuditLog()).toHaveLength(1);

    clearModuleToolAuditLog();

    expect(getModuleToolAuditLog()).toHaveLength(0);
  });

  it("each test starts with an empty audit log", () => {
    // beforeEach calls clearModuleToolAuditLog
    expect(getModuleToolAuditLog()).toHaveLength(0);
  });
});
