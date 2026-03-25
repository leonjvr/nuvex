// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Integration tests: sandbox wiring into OrchestratorProcess.
 * SandboxManager is mocked to avoid real bwrap/proxy dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock state so vi.mock factory can reference it
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const mockSubscribe = vi.fn().mockReturnValue(() => { /* unsubscribe */ });
  return {
    mockInitialize:          vi.fn().mockResolvedValue(undefined),
    mockReset:               vi.fn().mockResolvedValue(undefined),
    mockCheckDeps:           vi.fn().mockReturnValue({ errors: [], warnings: [] }),
    mockGetProxyPort:        vi.fn().mockReturnValue(14321),
    mockGetSocksPort:        vi.fn().mockReturnValue(14322),
    mockWrapWithSandbox:     vi.fn().mockImplementation(async (cmd: string) => `bwrap:${cmd}`),
    mockSubscribe,
    mockGetViolationStore:   vi.fn().mockReturnValue({ subscribe: mockSubscribe }),
  };
});

vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize:               mocks.mockInitialize,
    reset:                    mocks.mockReset,
    checkDependencies:        mocks.mockCheckDeps,
    getProxyPort:             mocks.mockGetProxyPort,
    getSocksProxyPort:        mocks.mockGetSocksPort,
    wrapWithSandbox:          mocks.mockWrapWithSandbox,
    getSandboxViolationStore: mocks.mockGetViolationStore,
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mock
// ---------------------------------------------------------------------------

import Database from "better-sqlite3";
import { TaskEventBus } from "../../../src/tasks/event-bus.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { OrchestratorProcess } from "../../../src/orchestrator/orchestrator.js";
import type { OrchestratorConfig } from "../../../src/orchestrator/types.js";
import type { SandboxConfig } from "../../../src/core/sandbox/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(sandbox?: SandboxConfig): OrchestratorConfig {
  return {
    max_agents:             2,
    max_agents_per_tier:    { 1: 1, 2: 1, 3: 1 },
    event_poll_interval_ms: 50,
    delegation_timeout_ms:  500,
    synthesis_timeout_ms:   500,
    max_tree_depth:         3,
    max_tree_breadth:       5,
    default_division:       "engineering",
    agent_definitions:      [],
    governance_root:        "/tmp/test-gov",
    sandbox,
  };
}

function makeOrchestrator(sandbox?: SandboxConfig) {
  const db    = new Database(":memory:");
  const store = new TaskStore(db);
  store.initialize();
  const bus   = new TaskEventBus(db);
  bus.initialize();
  return { orch: new OrchestratorProcess(db, bus, makeConfig(sandbox)), db, bus };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockInitialize.mockResolvedValue(undefined);
  mocks.mockReset.mockResolvedValue(undefined);
  mocks.mockCheckDeps.mockReturnValue({ errors: [], warnings: [] });
  mocks.mockGetProxyPort.mockReturnValue(14321);
  const unsub = () => { /* no-op */ };
  mocks.mockSubscribe.mockReturnValue(unsub);
  mocks.mockGetViolationStore.mockReturnValue({ subscribe: mocks.mockSubscribe });
  // FIX-3: provider "none" requires SIDJUA_ALLOW_NO_SANDBOX=true
  vi.stubEnv("SIDJUA_ALLOW_NO_SANDBOX", "true");
});
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------------------

describe("OrchestratorProcess — no sandbox config", () => {
  it("getSandboxEnvVars() returns empty object when sandbox not configured", () => {
    const { orch } = makeOrchestrator(undefined);
    expect(orch.getSandboxEnvVars()).toEqual({});
  });

  it("start() / stop() work normally without sandbox config", async () => {
    const { orch } = makeOrchestrator(undefined);
    await orch.start();
    expect(mocks.mockInitialize).not.toHaveBeenCalled();
    await orch.stop();
    expect(mocks.mockReset).not.toHaveBeenCalled();
  });
});

describe("OrchestratorProcess — sandbox: none", () => {
  const noneConfig: SandboxConfig = {
    provider: "none",
    defaults: {
      network:    { allowedDomains: [], deniedDomains: [] },
      filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    },
  };

  it("getSandboxEnvVars() returns empty object for provider 'none'", async () => {
    const { orch } = makeOrchestrator(noneConfig);
    await orch.start();
    expect(orch.getSandboxEnvVars()).toEqual({});
    await orch.stop();
    expect(mocks.mockReset).not.toHaveBeenCalled();
  });
});

describe("OrchestratorProcess — sandbox: bubblewrap", () => {
  const bwrapConfig: SandboxConfig = {
    provider: "bubblewrap",
    defaults: {
      network:    { allowedDomains: ["api.example.com"], deniedDomains: [] },
      filesystem: { denyRead: ["~/.ssh"], allowWrite: [], denyWrite: [] },
    },
  };

  it("start() calls SandboxManager.initialize()", async () => {
    const { orch } = makeOrchestrator(bwrapConfig);
    await orch.start();
    expect(mocks.mockInitialize).toHaveBeenCalledOnce();
    await orch.stop();
  });

  it("start() subscribes to violation store", async () => {
    const { orch } = makeOrchestrator(bwrapConfig);
    await orch.start();
    expect(mocks.mockGetViolationStore).toHaveBeenCalled();
    expect(mocks.mockSubscribe).toHaveBeenCalledOnce();
    await orch.stop();
  });

  it("stop() calls SandboxManager.reset()", async () => {
    const { orch } = makeOrchestrator(bwrapConfig);
    await orch.start();
    await orch.stop();
    expect(mocks.mockReset).toHaveBeenCalledOnce();
  });

  it("getSandboxEnvVars() returns HTTP_PROXY and HTTPS_PROXY", async () => {
    mocks.mockGetProxyPort.mockReturnValue(55321);
    const { orch } = makeOrchestrator(bwrapConfig);
    await orch.start();
    const envVars = orch.getSandboxEnvVars();
    expect(envVars["HTTP_PROXY"]).toBe("http://127.0.0.1:55321");
    expect(envVars["HTTPS_PROXY"]).toBe("http://127.0.0.1:55321");
    expect(envVars["http_proxy"]).toBe("http://127.0.0.1:55321");
    expect(envVars["https_proxy"]).toBe("http://127.0.0.1:55321");
    await orch.stop();
  });

  it("getSandboxEnvVars() returns empty if proxy port is undefined", async () => {
    mocks.mockGetProxyPort.mockReturnValue(undefined);
    const { orch } = makeOrchestrator(bwrapConfig);
    await orch.start();
    expect(orch.getSandboxEnvVars()).toEqual({});
    await orch.stop();
  });

  it("getSandboxEnvVars() returns empty after stop()", async () => {
    const { orch } = makeOrchestrator(bwrapConfig);
    await orch.start();
    await orch.stop();
    // Provider is nulled out after cleanup
    expect(orch.getSandboxEnvVars()).toEqual({});
  });
});

describe("sandbox-factory integration", () => {
  it("provider: bubblewrap wires up to BubblewrapProvider (SandboxManager called)", async () => {
    const { orch } = makeOrchestrator({
      provider: "bubblewrap",
      defaults: {
        network:    { allowedDomains: [], deniedDomains: [] },
        filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
      },
    });
    await orch.start();
    // If BubblewrapProvider was correctly used, SandboxManager.initialize was called
    expect(mocks.mockInitialize).toHaveBeenCalledOnce();
    await orch.stop();
  });
});
