// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Integration tests: full sandbox lifecycle — factory → initialize → use → cleanup.
 * SandboxManager mocked so bwrap binaries are not required in CI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sandbox-runtime
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  mockInit:       vi.fn().mockResolvedValue(undefined),
  mockReset:      vi.fn().mockResolvedValue(undefined),
  mockCheckDeps:  vi.fn().mockReturnValue({ errors: [], warnings: [] }),
  mockWrap:       vi.fn().mockImplementation(async (cmd: string) => `bwrap:${cmd}`),
  mockProxyPort:  vi.fn().mockReturnValue(7777),
  mockSocksPort:  vi.fn().mockReturnValue(7778),
  mockGetStore:   vi.fn().mockReturnValue({
    subscribe: vi.fn().mockReturnValue(() => {}),
  }),
}));

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize:               mocks.mockInit,
    reset:                    mocks.mockReset,
    checkDependencies:        mocks.mockCheckDeps,
    wrapWithSandbox:          mocks.mockWrap,
    getProxyPort:             mocks.mockProxyPort,
    getSocksProxyPort:        mocks.mockSocksPort,
    getSandboxViolationStore: mocks.mockGetStore,
  },
}));

// ---------------------------------------------------------------------------

import {
  createSandboxProvider,
  DEFAULT_SANDBOX_CONFIG,
  NoSandboxProvider,
  BubblewrapProvider,
} from "../../../src/core/sandbox/index.js";
import type { AgentSandboxConfig, SandboxConfig } from "../../../src/core/sandbox/types.js";

const AGENT_CFG: AgentSandboxConfig = {
  agentId:    "test-agent",
  workDir:    "/tmp/test",
  network:    { allowedDomains: ["api.example.com"], deniedDomains: [] },
  filesystem: { denyRead: ["~/.ssh"], allowWrite: [], denyWrite: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  // FIX-3: provider "none" requires SIDJUA_ALLOW_NO_SANDBOX=true
  vi.stubEnv("SIDJUA_ALLOW_NO_SANDBOX", "true");
});
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------

describe("Full lifecycle: provider='none'", () => {
  it("wrapCommand returns command unchanged after full lifecycle", async () => {
    const config: SandboxConfig = { provider: "none", defaults: DEFAULT_SANDBOX_CONFIG.defaults };
    const provider = createSandboxProvider(config);
    expect(provider).toBeInstanceOf(NoSandboxProvider);

    await provider.initialize();
    expect(provider.initialized).toBe(true);

    const cmd = "node scripts/process.js";
    expect(await provider.wrapCommand(cmd, AGENT_CFG)).toBe(cmd);

    await provider.cleanup();
    expect(provider.initialized).toBe(false);
  });
});

describe("Full lifecycle: provider='bubblewrap'", () => {
  it("wrapCommand calls SandboxManager.wrapWithSandbox after initialize", async () => {
    const config: SandboxConfig = {
      provider: "bubblewrap",
      defaults: DEFAULT_SANDBOX_CONFIG.defaults,
    };
    const provider = createSandboxProvider(config);
    expect(provider).toBeInstanceOf(BubblewrapProvider);

    await provider.initialize();
    expect(mocks.mockInit).toHaveBeenCalledOnce();

    const wrapped = await provider.wrapCommand("ls /tmp", AGENT_CFG);
    expect(wrapped).toContain("bwrap:");
    expect(mocks.mockWrap).toHaveBeenCalledOnce();

    await provider.cleanup();
    expect(mocks.mockReset).toHaveBeenCalledOnce();
  });
});

describe("Config merge — sandbox defaults fallback", () => {
  it("DEFAULT_SANDBOX_CONFIG denyRead includes sensitive paths", () => {
    const { denyRead } = DEFAULT_SANDBOX_CONFIG.defaults.filesystem;
    expect(denyRead).toContain("~/.ssh");
    expect(denyRead).toContain("~/.gnupg");
    expect(denyRead).toContain("/etc/shadow");
  });

  it("DEFAULT_SANDBOX_CONFIG network lists are empty", () => {
    expect(DEFAULT_SANDBOX_CONFIG.defaults.network.allowedDomains).toEqual([]);
    expect(DEFAULT_SANDBOX_CONFIG.defaults.network.deniedDomains).toEqual([]);
  });

  it("DEFAULT_SANDBOX_CONFIG provider is 'none'", () => {
    expect(DEFAULT_SANDBOX_CONFIG.provider).toBe("none");
  });
});

describe("checkDependencies — interface mapping", () => {
  it("NoSandboxProvider always reports available:true", async () => {
    const provider = new NoSandboxProvider();
    const result = await provider.checkDependencies();
    expect(result.available).toBe(true);
    expect(result.provider).toBe("none");
    expect(result.missing).toHaveLength(0);
  });

  it("BubblewrapProvider maps errors→missing, available=false when errors", async () => {
    mocks.mockCheckDeps.mockReturnValue({
      errors: ["bwrap not found"],
      warnings: [],
    });
    const provider = new BubblewrapProvider(DEFAULT_SANDBOX_CONFIG.defaults);
    const result = await provider.checkDependencies();
    expect(result.available).toBe(false);
    expect(result.missing).toContain("bwrap not found");
    expect(result.provider).toBe("bubblewrap");
  });

  it("BubblewrapProvider includes warnings in message when deps satisfied", async () => {
    mocks.mockCheckDeps.mockReturnValue({
      errors: [],
      warnings: ["seccomp unavailable — degraded isolation"],
    });
    const provider = new BubblewrapProvider(DEFAULT_SANDBOX_CONFIG.defaults);
    const result = await provider.checkDependencies();
    expect(result.available).toBe(true);
    expect(result.message).toContain("seccomp unavailable");
  });
});

describe("Invalid provider — fail-secure (FIX-H2)", () => {
  it("unknown provider string throws SidjuaError instead of silently falling back", () => {
    // We cast to force an invalid value — the factory default branch now throws (fail-secure).
    const config = { provider: "invalid-xyz" as "none", defaults: DEFAULT_SANDBOX_CONFIG.defaults };
    expect(() => createSandboxProvider(config)).toThrow("Unknown sandbox provider");
  });
});
