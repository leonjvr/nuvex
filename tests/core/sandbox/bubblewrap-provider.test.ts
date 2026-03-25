// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/sandbox/bubblewrap-provider.ts
 * SandboxManager is mocked to avoid real bwrap/proxy dependencies in CI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { AgentSandboxConfig, SandboxDefaults } from "../../../src/core/sandbox/types.js";

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sandbox-runtime before importing our module
// ---------------------------------------------------------------------------

const mockInitialize       = vi.fn<[SandboxRuntimeConfig], Promise<void>>().mockResolvedValue(undefined);
const mockWrapWithSandbox  = vi.fn<[string, string?, Partial<SandboxRuntimeConfig>?], Promise<string>>();
const mockCheckDeps        = vi.fn();
const mockGetProxyPort     = vi.fn<[], number | undefined>();
const mockGetSocksPort     = vi.fn<[], number | undefined>();
const mockReset            = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);
const mockGetViolationStore = vi.fn();

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize:              (...args: unknown[]) => mockInitialize(...(args as [SandboxRuntimeConfig])),
    wrapWithSandbox:         (...args: unknown[]) => mockWrapWithSandbox(...(args as [string, string?, Partial<SandboxRuntimeConfig>?])),
    checkDependencies:       () => mockCheckDeps(),
    getProxyPort:            () => mockGetProxyPort(),
    getSocksProxyPort:       () => mockGetSocksPort(),
    reset:                   () => mockReset(),
    getSandboxViolationStore: () => mockGetViolationStore(),
  },
}));

// Import AFTER mock is in place
const { BubblewrapProvider } = await import("../../../src/core/sandbox/bubblewrap-provider.js");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_DEFAULTS: SandboxDefaults = {
  network:    { allowedDomains: [], deniedDomains: [] },
  filesystem: { denyRead: ["~/.ssh"], allowWrite: [], denyWrite: [] },
};

const AGENT_CONFIG: AgentSandboxConfig = {
  agentId:    "test-agent",
  workDir:    "/tmp/test-agent",
  network:    { allowedDomains: ["api.example.com"], deniedDomains: ["evil.com"] },
  filesystem: { denyRead: ["~/.aws"], allowWrite: ["/tmp/out"], denyWrite: [] },
};

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckDeps.mockReturnValue({ errors: [], warnings: [] });
  mockWrapWithSandbox.mockImplementation(async (cmd: string) => `bwrap --wrapped ${cmd}`);
  mockGetProxyPort.mockReturnValue(12345);
  mockGetSocksPort.mockReturnValue(12346);
});

// ---------------------------------------------------------------------------

describe("BubblewrapProvider — lifecycle", () => {
  it("has name 'bubblewrap'", () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    expect(p.name).toBe("bubblewrap");
  });

  it("is not initialized before initialize()", () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    expect(p.initialized).toBe(false);
  });

  it("initialize() calls SandboxManager.initialize with mapped config", async () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await p.initialize();
    expect(p.initialized).toBe(true);
    expect(mockInitialize).toHaveBeenCalledOnce();
    const arg = mockInitialize.mock.calls[0][0] as SandboxRuntimeConfig;
    expect(arg.network.allowedDomains).toEqual([]);
    expect(arg.filesystem.denyRead).toContain("~/.ssh");
  });

  it("initialize() is idempotent (calls SandboxManager.initialize once)", async () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await p.initialize();
    await p.initialize();
    expect(mockInitialize).toHaveBeenCalledOnce();
  });

  it("concurrent initialize() calls all resolve with a single SandboxManager.initialize call", async () => {
    // Simulate a slow initialization so concurrent callers queue up
    let resolveInit!: () => void;
    mockInitialize.mockImplementationOnce(
      () => new Promise<void>((res) => { resolveInit = res; }),
    );

    const p = new BubblewrapProvider(BASE_DEFAULTS);
    // Launch 10 concurrent calls before the first one resolves
    const promises = Array.from({ length: 10 }, () => p.initialize());
    // Unblock the initialization
    resolveInit();
    const results = await Promise.allSettled(promises);

    // All should succeed
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    // SandboxManager.initialize must have been called exactly once
    expect(mockInitialize).toHaveBeenCalledOnce();
    expect(p.initialized).toBe(true);
  });

  it("enforces cooldown after failure — subsequent call within 60s throws SYS-011 (no retry)", async () => {
    // First call fails with a transient-looking error
    mockInitialize.mockRejectedValueOnce(new Error("bwrap not found"));

    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await expect(p.initialize()).rejects.toThrow("bwrap not found");
    expect(p.initialized).toBe(false);

    // Second call within the 60s cooldown must NOT retry — throws SYS-011 immediately.
    await expect(p.initialize()).rejects.toThrow(/SYS-011|Next retry available after/i);
    // SandboxManager.initialize must NOT have been called a second time
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("cleanup() calls SandboxManager.reset() and sets initialized to false", async () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await p.initialize();
    expect(p.initialized).toBe(true);
    await p.cleanup();
    expect(mockReset).toHaveBeenCalledOnce();
    expect(p.initialized).toBe(false);
  });

  it("cleanup() is a no-op when not initialized", async () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await p.cleanup();
    expect(mockReset).not.toHaveBeenCalled();
    expect(p.initialized).toBe(false);
  });
});

describe("BubblewrapProvider — wrapCommand", () => {
  it("passes command to SandboxManager.wrapWithSandbox", async () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await p.initialize();
    const cmd = "node scripts/run.js";
    const result = await p.wrapCommand(cmd, AGENT_CONFIG);
    expect(mockWrapWithSandbox).toHaveBeenCalledOnce();
    const [passedCmd] = mockWrapWithSandbox.mock.calls[0] as [string];
    expect(passedCmd).toBe(cmd);
    expect(result).toContain("wrapped");
  });

  it("passes per-agent network config as customConfig", async () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await p.initialize();
    await p.wrapCommand("ls -la", AGENT_CONFIG);
    const customConfig = mockWrapWithSandbox.mock.calls[0][2] as Partial<SandboxRuntimeConfig>;
    expect(customConfig.network?.allowedDomains).toContain("api.example.com");
    expect(customConfig.network?.deniedDomains).toContain("evil.com");
  });

  it("passes per-agent filesystem config as customConfig", async () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await p.initialize();
    await p.wrapCommand("ls -la", AGENT_CONFIG);
    const customConfig = mockWrapWithSandbox.mock.calls[0][2] as Partial<SandboxRuntimeConfig>;
    expect(customConfig.filesystem?.denyRead).toContain("~/.aws");
    expect(customConfig.filesystem?.allowWrite).toContain("/tmp/out");
  });

  it("throws if called before initialize()", async () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await expect(p.wrapCommand("echo hi", AGENT_CONFIG)).rejects.toThrow(
      /called before initialize/,
    );
  });
});

describe("BubblewrapProvider — checkDependencies", () => {
  it("returns available:true when no errors", async () => {
    mockCheckDeps.mockReturnValue({ errors: [], warnings: [] });
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    const result = await p.checkDependencies();
    expect(result.available).toBe(true);
    expect(result.provider).toBe("bubblewrap");
    expect(result.missing).toHaveLength(0);
    expect(result.message).toBeTruthy();
  });

  it("returns available:false with missing list when errors exist", async () => {
    mockCheckDeps.mockReturnValue({ errors: ["bwrap not found", "socat not found"], warnings: [] });
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    const result = await p.checkDependencies();
    expect(result.available).toBe(false);
    expect(result.missing).toContain("bwrap not found");
    expect(result.missing).toContain("socat not found");
    expect(result.message).toContain("missing");
  });

  it("includes warning summary in message when warnings present", async () => {
    mockCheckDeps.mockReturnValue({
      errors: [],
      warnings: ["seccomp degraded"],
    });
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    const result = await p.checkDependencies();
    expect(result.available).toBe(true);
    expect(result.message).toContain("seccomp degraded");
  });
});

describe("BubblewrapProvider — proxy ports", () => {
  it("getProxyPort() returns undefined before initialize()", () => {
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    expect(p.getProxyPort()).toBeUndefined();
  });

  it("getProxyPort() returns SandboxManager.getProxyPort() after initialize()", async () => {
    mockGetProxyPort.mockReturnValue(9999);
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await p.initialize();
    expect(p.getProxyPort()).toBe(9999);
  });

  it("getSocksProxyPort() returns SandboxManager.getSocksProxyPort() after initialize()", async () => {
    mockGetSocksPort.mockReturnValue(9998);
    const p = new BubblewrapProvider(BASE_DEFAULTS);
    await p.initialize();
    expect(p.getSocksProxyPort()).toBe(9998);
  });
});
