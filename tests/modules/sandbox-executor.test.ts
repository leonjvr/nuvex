// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Unit tests for ModuleSandboxExecutor and network-policy registry.
 *
 * Covers:
 *   - Tool execution routes through sandbox provider (mock)
 *   - NoSandboxProvider: passthrough, sandboxed=false
 *   - BubblewrapProvider mock: sandboxed=true
 *   - Network policy correct domains for discord
 *   - Network policy null for unknown module (deny-all)
 *   - Audit event logged on every successful execution
 *   - Audit event logged on tool error
 *   - Audit event includes agentId, divisionId, moduleName, toolName
 *   - Timeout enforced
 *   - Error in tool → caught, returns success: false
 *   - sandboxed flag reflects provider type
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ModuleSandboxExecutor,
  getModuleToolAuditLog,
  clearModuleToolAuditLog,
  resetDefaultModuleSandboxExecutor,
  getDefaultModuleSandboxExecutor,
  DEFAULT_MODULE_TIMEOUT_MS,
} from "../../src/modules/sandbox-executor.js";
import {
  getModuleNetworkPolicy,
  listModuleNetworkPolicies,
} from "../../src/modules/network-policy.js";
import { NoSandboxProvider } from "../../src/core/sandbox/no-sandbox-provider.js";
import type { SandboxProvider, AgentSandboxConfig, SandboxDependencyCheck } from "../../src/core/sandbox/types.js";

// ---------------------------------------------------------------------------
// Mock sandbox providers
// ---------------------------------------------------------------------------

function makeNoSandbox(): SandboxProvider {
  return new NoSandboxProvider();
}

/** Minimal mock that pretends to be BubblewrapProvider. */
function makeMockBubblewrapProvider(): SandboxProvider {
  return {
    name:        "bubblewrap",
    initialized: true,
    async initialize() {},
    async wrapCommand(cmd: string, _cfg: AgentSandboxConfig) { return cmd; },
    async checkDependencies(): Promise<SandboxDependencyCheck> {
      return { available: true, provider: "bubblewrap", missing: [], message: "" };
    },
    async cleanup() {},
  };
}

const SAMPLE_REQUEST = {
  moduleName: "discord",
  toolName:   "discord_send_message",
  params:     { channel_id: "123", content: "hello" },
  agentId:    "guide",
  divisionId: "system",
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearModuleToolAuditLog();
  resetDefaultModuleSandboxExecutor();
});

// ---------------------------------------------------------------------------
// Network policy tests
// ---------------------------------------------------------------------------

describe("getModuleNetworkPolicy()", () => {
  it("returns policy for discord module", () => {
    const policy = getModuleNetworkPolicy("discord");
    expect(policy).not.toBeNull();
    expect(policy!.moduleName).toBe("discord");
  });

  it("discord policy allows discord.com", () => {
    const policy = getModuleNetworkPolicy("discord");
    expect(policy!.allowedDomains).toContain("discord.com");
  });

  it("discord policy allows gateway.discord.gg", () => {
    const policy = getModuleNetworkPolicy("discord");
    expect(policy!.allowedDomains).toContain("gateway.discord.gg");
  });

  it("discord policy allows cdn.discordapp.com", () => {
    const policy = getModuleNetworkPolicy("discord");
    expect(policy!.allowedDomains).toContain("cdn.discordapp.com");
  });

  it("discord policy only allows port 443", () => {
    const policy = getModuleNetworkPolicy("discord");
    expect(policy!.allowedPorts).toEqual([443]);
  });

  it("returns null for unknown module (deny-all)", () => {
    const policy = getModuleNetworkPolicy("unknown-module");
    expect(policy).toBeNull();
  });

  it("returns null for empty string module name", () => {
    const policy = getModuleNetworkPolicy("");
    expect(policy).toBeNull();
  });

  it("listModuleNetworkPolicies returns at least discord", () => {
    const list = listModuleNetworkPolicies();
    const names = list.map((p) => p.moduleName);
    expect(names).toContain("discord");
  });
});

// ---------------------------------------------------------------------------
// ModuleSandboxExecutor — NoSandboxProvider
// ---------------------------------------------------------------------------

describe("ModuleSandboxExecutor with NoSandboxProvider", () => {
  it("executes tool function and returns success: true", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    const toolFn   = async () => ({ sent: true });

    const result = await executor.execute(SAMPLE_REQUEST, toolFn);

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ sent: true });
  });

  it("sets sandboxed: false for NoSandboxProvider", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    const result   = await executor.execute(SAMPLE_REQUEST, async () => "ok");
    expect(result.sandboxed).toBe(false);
  });

  it("records executionTimeMs >= 0", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    const result   = await executor.execute(SAMPLE_REQUEST, async () => null);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// ModuleSandboxExecutor — mock BubblewrapProvider
// ---------------------------------------------------------------------------

describe("ModuleSandboxExecutor with BubblewrapProvider (mock)", () => {
  it("sets sandboxed: true for bubblewrap provider", async () => {
    const executor = new ModuleSandboxExecutor(makeMockBubblewrapProvider());
    const result   = await executor.execute(SAMPLE_REQUEST, async () => "ok");
    expect(result.sandboxed).toBe(true);
  });

  it("executes tool function successfully with bubblewrap provider", async () => {
    const executor = new ModuleSandboxExecutor(makeMockBubblewrapProvider());
    const result   = await executor.execute(SAMPLE_REQUEST, async () => ({ done: true }));
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ done: true });
  });
});

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

describe("Audit logging", () => {
  it("logs a module_tool_execution event on success", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    await executor.execute(SAMPLE_REQUEST, async () => "ok");

    const log = getModuleToolAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.eventType).toBe("module_tool_execution");
  });

  it("audit event includes agentId", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    await executor.execute(SAMPLE_REQUEST, async () => "ok");

    const log = getModuleToolAuditLog();
    expect(log[0]!.agentId).toBe(SAMPLE_REQUEST.agentId);
  });

  it("audit event includes divisionId", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    await executor.execute(SAMPLE_REQUEST, async () => "ok");

    const log = getModuleToolAuditLog();
    expect(log[0]!.divisionId).toBe(SAMPLE_REQUEST.divisionId);
  });

  it("audit event includes moduleName", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    await executor.execute(SAMPLE_REQUEST, async () => "ok");

    const log = getModuleToolAuditLog();
    expect(log[0]!.moduleName).toBe(SAMPLE_REQUEST.moduleName);
  });

  it("audit event includes toolName", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    await executor.execute(SAMPLE_REQUEST, async () => "ok");

    const log = getModuleToolAuditLog();
    expect(log[0]!.toolName).toBe(SAMPLE_REQUEST.toolName);
  });

  it("audit event includes sandboxed flag", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    await executor.execute(SAMPLE_REQUEST, async () => "ok");

    const log = getModuleToolAuditLog();
    expect(typeof log[0]!.sandboxed).toBe("boolean");
    expect(log[0]!.sandboxed).toBe(false);
  });

  it("logs module_tool_error event on failure", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    await executor.execute(SAMPLE_REQUEST, async () => {
      throw new Error("Discord API error");
    });

    const log = getModuleToolAuditLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.eventType).toBe("module_tool_error");
    expect(log[0]!.error).toContain("Discord API error");
  });

  it("two executions produce two audit events", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    await executor.execute(SAMPLE_REQUEST, async () => "ok1");
    await executor.execute(SAMPLE_REQUEST, async () => "ok2");

    const log = getModuleToolAuditLog();
    expect(log).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("Error handling", () => {
  it("tool throwing returns success: false", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    const result   = await executor.execute(SAMPLE_REQUEST, async () => {
      throw new Error("Tool crashed");
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Tool crashed");
  });

  it("result is undefined when tool throws", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    const result   = await executor.execute(SAMPLE_REQUEST, async () => {
      throw new Error("fail");
    });

    expect(result.result).toBeUndefined();
  });

  it("does not rethrow — execute always resolves", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    await expect(executor.execute(SAMPLE_REQUEST, async () => {
      throw new Error("internal");
    })).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Timeout enforcement
// ---------------------------------------------------------------------------

describe("Timeout enforcement", () => {
  it("slow tool exceeds timeout → success: false with timeout message", async () => {
    const SHORT_TIMEOUT = 50; // ms
    const executor = new ModuleSandboxExecutor(makeNoSandbox(), SHORT_TIMEOUT);

    const slowTool = async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return "too late";
    };

    const result = await executor.execute(SAMPLE_REQUEST, slowTool);

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("fast tool completes before timeout → success: true", async () => {
    const executor = new ModuleSandboxExecutor(makeNoSandbox(), 1_000);
    const result   = await executor.execute(SAMPLE_REQUEST, async () => "fast");
    expect(result.success).toBe(true);
  });

  it("default timeout is 30000ms", () => {
    expect(DEFAULT_MODULE_TIMEOUT_MS).toBe(30_000);
    const executor = new ModuleSandboxExecutor(makeNoSandbox());
    expect(executor.timeoutMs).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// getDefaultModuleSandboxExecutor
// ---------------------------------------------------------------------------

describe("getDefaultModuleSandboxExecutor()", () => {
  it("returns a ModuleSandboxExecutor instance", () => {
    const exec = getDefaultModuleSandboxExecutor();
    expect(exec).toBeInstanceOf(ModuleSandboxExecutor);
  });

  it("default executor uses NoSandboxProvider (sandboxed=false)", async () => {
    const exec   = getDefaultModuleSandboxExecutor();
    const result = await exec.execute(SAMPLE_REQUEST, async () => "ok");
    expect(result.sandboxed).toBe(false);
  });

  it("custom provider is used when supplied", () => {
    const provider = makeMockBubblewrapProvider();
    const exec     = getDefaultModuleSandboxExecutor(provider);
    expect(exec.sandboxProvider.name).toBe("bubblewrap");
  });

  it("clearModuleToolAuditLog resets audit log", async () => {
    const exec = getDefaultModuleSandboxExecutor();
    await exec.execute(SAMPLE_REQUEST, async () => "ok");

    clearModuleToolAuditLog();
    expect(getModuleToolAuditLog()).toHaveLength(0);
  });
});
