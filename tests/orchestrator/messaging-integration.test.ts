/**
 * V1.1 — Orchestrator messaging integration tests
 *
 * Tests that the orchestrator correctly starts/stops messaging services
 * and handles IPC commands for messaging. No real platform connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { OrchestratorProcess } from "../../src/orchestrator/orchestrator.js";
import { TaskEventBus }        from "../../src/tasks/event-bus.js";
import { TaskStore }           from "../../src/tasks/store.js";
import type { OrchestratorConfig } from "../../src/orchestrator/types.js";
import { DEFAULT_DELEGATION_RULES } from "../../src/orchestrator/types.js";
import type { InboundMessageGateway } from "../../src/messaging/inbound-gateway.js";
import type { AdapterRegistry }       from "../../src/messaging/adapter-registry.js";
import type { UserMappingStore }       from "../../src/messaging/user-mapping.js";
import type { AdapterInstanceConfig }  from "../../src/messaging/types.js";

// ---------------------------------------------------------------------------
// Minimal orchestrator config (no agents, no pipeline)
// ---------------------------------------------------------------------------

function makeConfig(): OrchestratorConfig {
  return {
    max_agents:             0,
    max_agents_per_tier:    { 1: 0, 2: 0, 3: 0 },
    event_poll_interval_ms: 50,
    delegation_timeout_ms:  5000,
    synthesis_timeout_ms:   5000,
    max_tree_depth:         3,
    max_tree_breadth:       5,
    default_division:       "engineering",
    agent_definitions:      [],
    governance_root:        "/tmp",
    delegation_rules:       DEFAULT_DELEGATION_RULES,
  };
}

// ---------------------------------------------------------------------------
// Mock messaging services
// ---------------------------------------------------------------------------

function makeMockGateway(): InboundMessageGateway {
  return {
    start:          vi.fn().mockResolvedValue(undefined),
    stop:           vi.fn().mockResolvedValue(undefined),
    addInstance:    vi.fn().mockResolvedValue(undefined),
    removeInstance: vi.fn().mockResolvedValue(undefined),
    onMessage:      vi.fn(),
    handleInboundMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as InboundMessageGateway;
}

function makeMockRegistry(): AdapterRegistry {
  return {
    discoverAdapters:    vi.fn().mockResolvedValue([]),
    getAvailableAdapters: vi.fn().mockReturnValue([
      { name: "telegram", channel: "telegram", capabilities: ["text"] },
    ]),
    getAllInstances:      vi.fn().mockReturnValue([]),
    getInstance:         vi.fn().mockReturnValue(undefined),
    startInstance:       vi.fn().mockResolvedValue(undefined),
    stopInstance:        vi.fn().mockResolvedValue(undefined),
    createInstance:      vi.fn().mockResolvedValue(undefined),
    removeInstance:      vi.fn().mockResolvedValue(undefined),
    startAll:            vi.fn().mockResolvedValue(undefined),
    stopAll:             vi.fn().mockResolvedValue(undefined),
  } as unknown as AdapterRegistry;
}

function makeMockUserMapping(): UserMappingStore {
  return {
    initialize:   vi.fn().mockResolvedValue(undefined),
    mapUser:      vi.fn().mockResolvedValue(undefined),
    unmapUser:    vi.fn().mockResolvedValue(undefined),
    isAuthorized: vi.fn().mockReturnValue(true),
    listMappings: vi.fn().mockReturnValue([]),
    lookupUser:   vi.fn().mockReturnValue(null),
  } as unknown as UserMappingStore;
}

const MOCK_CONFIGS: AdapterInstanceConfig[] = [
  { id: "tg-test", adapter: "telegram", enabled: true, config: {}, rate_limit_per_min: 30 },
];

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeOrchestrator() {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-msg-int-"));
  const db    = openDatabase(join(tmpDir, "tasks.db"));
  const store = new TaskStore(db);
  store.initialize();
  const bus = new TaskEventBus(db);
  return new OrchestratorProcess(db, bus, makeConfig());
}

function cleanupOrchestrator() {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e: unknown) { void e; /* cleanup-ignore: temp dir removal best-effort */ }
}

// ---------------------------------------------------------------------------
// Tests — setMessagingServices
// ---------------------------------------------------------------------------

afterEach(() => {
  // Best-effort cleanup of any temp dirs created by makeOrchestrator
  if (tmpDir !== undefined) {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch (e: unknown) { void e; /* cleanup-ignore: best-effort */ }
  }
});

describe("OrchestratorProcess — setMessagingServices", () => {
  it("can inject messaging services before start", () => {
    const orc     = makeOrchestrator();
    const gateway = makeMockGateway();
    const registry = makeMockRegistry();
    const userMap  = makeMockUserMapping();
    // Should not throw
    orc.setMessagingServices(gateway, registry, userMap, MOCK_CONFIGS);
  });
});

// ---------------------------------------------------------------------------
// Tests — start/stop with messaging
// ---------------------------------------------------------------------------

describe("OrchestratorProcess — messaging lifecycle", () => {
  let orc: OrchestratorProcess;

  afterEach(async () => {
    if (orc.state === "RUNNING" || orc.state === "PAUSED") {
      await orc.stop();
    }
    cleanupOrchestrator();
  });

  it("calls gateway.start during orchestrator start", async () => {
    orc = makeOrchestrator();
    const gateway  = makeMockGateway();
    const registry = makeMockRegistry();
    const userMap  = makeMockUserMapping();
    orc.setMessagingServices(gateway, registry, userMap, MOCK_CONFIGS);

    await orc.start();

    // Allow the best-effort async start to settle
    await new Promise((r) => setTimeout(r, 30));

    expect(vi.mocked(gateway.start)).toHaveBeenCalledWith(MOCK_CONFIGS);
  });

  it("calls gateway.stop during orchestrator stop", async () => {
    orc = makeOrchestrator();
    const gateway  = makeMockGateway();
    const registry = makeMockRegistry();
    const userMap  = makeMockUserMapping();
    orc.setMessagingServices(gateway, registry, userMap, MOCK_CONFIGS);

    await orc.start();
    await new Promise((r) => setTimeout(r, 20));
    await orc.stop();

    expect(vi.mocked(gateway.stop)).toHaveBeenCalled();
  });

  it("orchestrator starts without messaging services (no crash)", async () => {
    orc = makeOrchestrator();
    // No setMessagingServices call
    await orc.start();
    expect(orc.state).toBe("RUNNING");
  });
});

// ---------------------------------------------------------------------------
// Tests — IPC commands
// ---------------------------------------------------------------------------

describe("OrchestratorProcess — messaging IPC handlers", () => {
  it("messaging_adapters returns discovered plugins", async () => {
    const orc      = makeOrchestrator();
    const gateway  = makeMockGateway();
    const registry = makeMockRegistry();
    const userMap  = makeMockUserMapping();
    orc.setMessagingServices(gateway, registry, userMap, MOCK_CONFIGS);

    // Access private method for testing via cast
    const handleSocketRequest = (orc as unknown as {
      handleSocketRequest(req: unknown): Promise<{ success: boolean; data: Record<string, unknown> }>;
    }).handleSocketRequest.bind(orc);

    const res = await handleSocketRequest({
      command:    "messaging_adapters",
      payload:    {},
      request_id: "req-1",
    });

    expect(res.success).toBe(true);
    const adapters = res.data["adapters"] as Array<{ name: string }>;
    expect(adapters[0]!.name).toBe("telegram");
  });

  it("messaging_status returns instance list", async () => {
    const orc = makeOrchestrator();
    const registry = makeMockRegistry();
    vi.mocked(registry.getAllInstances).mockReturnValue([
      { instanceId: "tg-test", channel: "telegram", healthy: true },
    ]);
    orc.setMessagingServices(makeMockGateway(), registry, makeMockUserMapping(), MOCK_CONFIGS);

    const handleSocketRequest = (orc as unknown as {
      handleSocketRequest(req: unknown): Promise<{ success: boolean; data: Record<string, unknown> }>;
    }).handleSocketRequest.bind(orc);

    const res = await handleSocketRequest({
      command:    "messaging_status",
      payload:    {},
      request_id: "req-2",
    });

    expect(res.success).toBe(true);
    const instances = res.data["instances"] as Array<{ instanceId: string }>;
    expect(instances[0]!.instanceId).toBe("tg-test");
  });

  it("messaging_status returns empty when no messaging services", async () => {
    const orc = makeOrchestrator(); // no setMessagingServices

    const handleSocketRequest = (orc as unknown as {
      handleSocketRequest(req: unknown): Promise<{ success: boolean; data: Record<string, unknown> }>;
    }).handleSocketRequest.bind(orc);

    const res = await handleSocketRequest({
      command:    "messaging_status",
      payload:    {},
      request_id: "req-3",
    });

    expect(res.success).toBe(true);
    expect(res.data["instances"]).toEqual([]);
  });

  it("messaging_start calls startInstance on registry", async () => {
    const orc      = makeOrchestrator();
    const registry = makeMockRegistry();
    orc.setMessagingServices(makeMockGateway(), registry, makeMockUserMapping(), MOCK_CONFIGS);

    const handleSocketRequest = (orc as unknown as {
      handleSocketRequest(req: unknown): Promise<{ success: boolean; data: Record<string, unknown> }>;
    }).handleSocketRequest.bind(orc);

    const res = await handleSocketRequest({
      command:    "messaging_start",
      payload:    { instance_id: "tg-test" },
      request_id: "req-4",
    });

    expect(res.success).toBe(true);
    expect(vi.mocked(registry.startInstance)).toHaveBeenCalledWith("tg-test");
  });

  it("messaging_start returns error when instance_id missing", async () => {
    const orc = makeOrchestrator();
    orc.setMessagingServices(makeMockGateway(), makeMockRegistry(), makeMockUserMapping(), MOCK_CONFIGS);

    const handleSocketRequest = (orc as unknown as {
      handleSocketRequest(req: unknown): Promise<{ success: boolean; error?: string }>;
    }).handleSocketRequest.bind(orc);

    const res = await handleSocketRequest({
      command:    "messaging_start",
      payload:    {},
      request_id: "req-5",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("instance_id");
  });

  it("messaging_map calls userMapping.mapUser", async () => {
    const orc     = makeOrchestrator();
    const userMap = makeMockUserMapping();
    orc.setMessagingServices(makeMockGateway(), makeMockRegistry(), userMap, MOCK_CONFIGS);

    const handleSocketRequest = (orc as unknown as {
      handleSocketRequest(req: unknown): Promise<{ success: boolean; data: Record<string, unknown> }>;
    }).handleSocketRequest.bind(orc);

    const res = await handleSocketRequest({
      command: "messaging_map",
      payload: {
        instance_id:      "inst-1",
        platform_user_id: "u-123",
        sidjua_user_id:   "alice",
        role:             "user",
      },
      request_id: "req-6",
    });

    expect(res.success).toBe(true);
    expect(vi.mocked(userMap.mapUser)).toHaveBeenCalledWith("alice", "inst-1", "u-123", "user");
  });

  it("messaging_mappings returns mappings from store", async () => {
    const orc     = makeOrchestrator();
    const userMap = makeMockUserMapping();
    vi.mocked(userMap.listMappings).mockReturnValue([
      { sidjua_user_id: "alice", instance_id: "inst-1", platform_user_id: "u-123", role: "user", created_at: "2026-01-01" },
    ]);
    orc.setMessagingServices(makeMockGateway(), makeMockRegistry(), userMap, MOCK_CONFIGS);

    const handleSocketRequest = (orc as unknown as {
      handleSocketRequest(req: unknown): Promise<{ success: boolean; data: Record<string, unknown> }>;
    }).handleSocketRequest.bind(orc);

    const res = await handleSocketRequest({
      command:    "messaging_mappings",
      payload:    {},
      request_id: "req-7",
    });

    expect(res.success).toBe(true);
    const mappings = res.data["mappings"] as unknown[];
    expect(mappings).toHaveLength(1);
  });
});
