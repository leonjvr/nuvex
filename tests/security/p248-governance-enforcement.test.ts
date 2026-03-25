// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P248 — Governance Enforcement Universality regression tests
 *
 * FIX-1: run --wait blocked in production (NODE_ENV !== "test")
 * FIX-2: MessageToTaskBridge defaultGovernanceCheck is fail-closed
 * FIX-3: SandboxFactory throws SANDBOX-001 for "none" without SIDJUA_ALLOW_NO_SANDBOX=true
 * FIX-4: NoSandboxProvider.wrapCommand() emits a warning on every call
 * FIX-5: ModuleSandboxExecutor throws MOD-002 for unknown module (enforces, not just logs)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// FIX-1: run --wait production guard (source inspection)
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve }      from "node:path";

// FIX-1 → P268: The production guard (NODE_ENV / SIDJUA_UNSAFE_INLINE) was
// the half-measure from P248. P268 removed inline execution entirely.
// These tests now verify the P268 architecture: orchestrator-required routing.
describe("FIX-1 (P268 supersedes): run --wait routes through orchestrator", () => {
  it("run.ts does NOT contain SIDJUA_UNSAFE_INLINE (P268 cleanup)", () => {
    const src = readFileSync(resolve("src/cli/commands/run.ts"), "utf-8");
    expect(src).not.toContain("SIDJUA_UNSAFE_INLINE");
  });

  it("run.ts does NOT contain executeTaskInline (P268 cleanup)", () => {
    const src = readFileSync(resolve("src/cli/commands/run.ts"), "utf-8");
    expect(src).not.toContain("executeTaskInline");
  });

  it("run.ts requires orchestrator PID for all modes including --wait", () => {
    const src = readFileSync(resolve("src/cli/commands/run.ts"), "utf-8");
    // PID check must appear BEFORE the if (opts.wait) block
    const pidCheckIdx  = src.indexOf("orchestrator.pid");
    const waitBlockIdx = src.indexOf("if (opts.wait)");
    expect(pidCheckIdx).toBeGreaterThan(-1);
    expect(waitBlockIdx).toBeGreaterThan(-1);
    expect(pidCheckIdx).toBeLessThan(waitBlockIdx);
  });
});

// ---------------------------------------------------------------------------
// FIX-2: defaultGovernanceCheck fail-closed
// ---------------------------------------------------------------------------

import { defaultGovernanceCheck } from "../../src/messaging/task-bridge.js";
import type { UserTaskInput }     from "../../src/messaging/types.js";

const SAMPLE_INPUT: UserTaskInput = {
  description:      "Test task",
  division:         "engineering",
  priority:         3,
  budget_usd:       5.0,
  ttl_seconds:      300,
  source_metadata:  { platform: "telegram", sender_id: "u1", channel_id: "c1" },
};

describe("FIX-2: defaultGovernanceCheck is fail-closed", () => {
  it("defaultGovernanceCheck returns blocked: true", async () => {
    const result = await defaultGovernanceCheck(SAMPLE_INPUT);
    expect(result.blocked).toBe(true);
  });

  it("defaultGovernanceCheck block is not overrideable", async () => {
    const result = await defaultGovernanceCheck(SAMPLE_INPUT);
    expect(result.blocked).toBe(true);
    expect((result as { overrideable?: boolean }).overrideable).toBe(false);
  });

  it("defaultGovernanceCheck rule is NO_GOVERNANCE_EVALUATOR", async () => {
    const result = await defaultGovernanceCheck(SAMPLE_INPUT);
    expect(result.blocked).toBe(true);
    expect((result as { rule?: string }).rule).toBe("NO_GOVERNANCE_EVALUATOR");
  });
});

// ---------------------------------------------------------------------------
// FIX-3: SandboxFactory requires SIDJUA_ALLOW_NO_SANDBOX=true for "none"
// ---------------------------------------------------------------------------

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize:               vi.fn().mockResolvedValue(undefined),
    reset:                    vi.fn().mockResolvedValue(undefined),
    checkDependencies:        vi.fn().mockReturnValue({ errors: [], warnings: [] }),
    getProxyPort:             vi.fn().mockReturnValue(9000),
    getSocksProxyPort:        vi.fn().mockReturnValue(9001),
    wrapWithSandbox:          vi.fn().mockResolvedValue("wrapped"),
    getSandboxViolationStore: vi.fn().mockReturnValue({ subscribe: vi.fn().mockReturnValue(() => {}) }),
  },
}));

import { createSandboxProvider, DEFAULT_SANDBOX_CONFIG } from "../../src/core/sandbox/sandbox-factory.js";
import { SidjuaError }                                   from "../../src/core/error-codes.js";

describe("FIX-3: SandboxFactory requires SIDJUA_ALLOW_NO_SANDBOX for provider 'none'", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("throws SANDBOX-001 when SIDJUA_ALLOW_NO_SANDBOX is not set", () => {
    vi.stubEnv("SIDJUA_ALLOW_NO_SANDBOX", "false");
    expect(() =>
      createSandboxProvider({ provider: "none", defaults: DEFAULT_SANDBOX_CONFIG.defaults }),
    ).toThrow(SidjuaError);
  });

  it("thrown error has code SANDBOX-001", () => {
    vi.stubEnv("SIDJUA_ALLOW_NO_SANDBOX", "false");
    try {
      createSandboxProvider({ provider: "none", defaults: DEFAULT_SANDBOX_CONFIG.defaults });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SidjuaError);
      expect((err as SidjuaError).code).toBe("SANDBOX-001");
    }
  });

  it("succeeds when SIDJUA_ALLOW_NO_SANDBOX=true", () => {
    vi.stubEnv("SIDJUA_ALLOW_NO_SANDBOX", "true");
    expect(() =>
      createSandboxProvider({ provider: "none", defaults: DEFAULT_SANDBOX_CONFIG.defaults }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// FIX-4: NoSandboxProvider.wrapCommand() emits warning
// ---------------------------------------------------------------------------

import { NoSandboxProvider } from "../../src/core/sandbox/no-sandbox-provider.js";

describe("FIX-4: NoSandboxProvider.wrapCommand() emits warning", () => {
  it("wrapCommand() source contains sandbox_no_isolation log key", () => {
    const src = readFileSync(resolve("src/core/sandbox/no-sandbox-provider.ts"), "utf-8");
    expect(src).toContain("sandbox_no_isolation");
    expect(src).toContain("logger.warn");
  });

  it("wrapCommand() still returns the command unchanged", async () => {
    const provider = new NoSandboxProvider();
    const cmd = "node /app/worker.js";
    const result = await provider.wrapCommand(cmd, {
      agentId:    "test-agent",
      workDir:    "/tmp",
      network:    { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    });
    expect(result).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// FIX-5: ModuleSandboxExecutor enforces network policy
// ---------------------------------------------------------------------------

import {
  ModuleSandboxExecutor,
  clearModuleToolAuditLog,
} from "../../src/modules/sandbox-executor.js";

describe("FIX-5: ModuleSandboxExecutor enforces network policy for unknown modules", () => {
  beforeEach(() => clearModuleToolAuditLog());

  it("throws SidjuaError(MOD-002) for unknown module", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider());
    let caught: unknown;
    try {
      await executor.execute(
        { moduleName: "totally-unknown", toolName: "some_tool", params: {}, agentId: "a1", divisionId: "d1" },
        async () => ({ ok: true }),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SidjuaError);
    expect((caught as SidjuaError).code).toBe("MOD-002");
  });

  it("does NOT execute the tool function when module is unknown", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider());
    const toolFn   = vi.fn(async () => ({ ok: true }));
    await expect(
      executor.execute(
        { moduleName: "unknown-module", toolName: "tool", params: {}, agentId: "a1", divisionId: "d1" },
        toolFn,
      ),
    ).rejects.toThrow();
    expect(toolFn).not.toHaveBeenCalled();
  });

  it("succeeds for known module (discord)", async () => {
    const executor = new ModuleSandboxExecutor(new NoSandboxProvider());
    const result   = await executor.execute(
      { moduleName: "discord", toolName: "discord_send_message", params: {}, agentId: "a1", divisionId: "d1" },
      async () => ({ message_id: "123" }),
    );
    expect(result.success).toBe(true);
  });
});
