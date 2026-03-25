// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for P223 integration:
 *   - InboundMessageGateway → MessageToTaskBridge wiring
 *   - TaskLifecycleRouter event subscription
 *   - Full message → task → confirmation flow
 *   - Block → override → re-submit flow
 *   - Slash command delegation to CommandHandler
 *   - Task completed/failed notifications back to messaging user
 *   - Non-messaging tasks do not trigger notifications
 *   - Channel routing config applied correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InboundMessageGateway } from "../../src/messaging/inbound-gateway.js";
import { MessageToTaskBridge, type GovernanceCheckFn } from "../../src/messaging/task-bridge.js";
import { TaskBuilder } from "../../src/messaging/task-builder.js";
import { OverrideManager } from "../../src/messaging/override-manager.js";
import { TaskLifecycleRouter } from "../../src/messaging/task-lifecycle-router.js";
import type {
  MessageEnvelope,
  UserMapping,
  AcceptResult,
  BlockResult,
  TaskBridgeConfig,
  MessagingGovernance,
} from "../../src/messaging/types.js";
import type { Task } from "../../src/tasks/types.js";
import { setGlobalLevel, resetLogger } from "../../src/core/logger.js";

// ---------------------------------------------------------------------------
// Config fixtures
// ---------------------------------------------------------------------------

const BRIDGE_CONFIG: TaskBridgeConfig = {
  mode: "direct_passthrough",
  defaults: { priority: 3, budget_usd: 1.00, ttl_seconds: 3600 },
  override: {
    enabled:                    true,
    window_seconds:             300,
    non_overrideable_rules:     ["HARD_BLOCK"],
    require_admin_for_override: ["ADMIN_RULE"],
  },
  channel_routing: {
    telegram: { "chat-eng": "engineering" },
  },
};

const GATEWAY_GOV: MessagingGovernance = {
  require_mapping:             false,
  allow_self_register:         false,
  response_max_length:         4000,
  include_task_id_in_response: false,
  typing_indicator:            false,
  max_inbound_per_hour:        0,
};

// ---------------------------------------------------------------------------
// Envelope / user helpers
// ---------------------------------------------------------------------------

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    id:          "msg-1",
    instance_id: "tg-1",
    channel:     "telegram",
    sender:      { platform_id: "plat-1", display_name: "Alice", verified: true },
    content:     { text: "Run the health check" },
    metadata:    { timestamp: new Date().toISOString(), chat_id: "chat-eng", platform_raw: {} },
    ...overrides,
  };
}

function makeUser(overrides: Partial<UserMapping> = {}): UserMapping {
  return {
    sidjua_user_id:   "user-alice",
    instance_id:      "tg-1",
    platform_user_id: "plat-1",
    role:             "user",
    created_at:       new Date().toISOString(),
    ...overrides,
  };
}

const ACCEPT_RESULT: AcceptResult = {
  blocked: false,
  handle: {
    id:          "task-abc-123",
    description: "Run the health check",
    agent_id:    "agent-1",
    budget_usd:  1.00,
    status:      "CREATED",
  },
};

const BLOCK_RESULT: BlockResult = {
  blocked:      true,
  reason:       "Dangerous action detected",
  rule:         "NO_DANGEROUS",
  overrideable: true,
};

// ---------------------------------------------------------------------------
// Bridge mock factory
// ---------------------------------------------------------------------------

function makeBridgeMocks() {
  const userMapping    = { lookupUser: vi.fn(() => makeUser()) };
  const executionBridge = { submitMessageTask: vi.fn(async () => ACCEPT_RESULT) };
  const responseRouter  = {
    sendUnauthorized:  vi.fn(async () => undefined),
    sendTaskAccepted:  vi.fn(async () => undefined),
    sendBlocked:       vi.fn(async () => undefined),
    sendDirectMessage: vi.fn(async () => undefined),
  };
  const overrideManager = {
    isOverrideResponse: vi.fn(() => false),
    processOverride:    vi.fn(async () => undefined),
    registerBlock:      vi.fn(),
  };
  const govCheck: GovernanceCheckFn = vi.fn(async () => ACCEPT_RESULT);

  return { userMapping, executionBridge, responseRouter, overrideManager, govCheck };
}

function makeBridge(mocks: ReturnType<typeof makeBridgeMocks>): MessageToTaskBridge {
  return new MessageToTaskBridge(
    new TaskBuilder(BRIDGE_CONFIG),
    mocks.executionBridge as never,
    mocks.responseRouter as never,
    mocks.userMapping as never,
    mocks.overrideManager as never,
    BRIDGE_CONFIG,
    mocks.govCheck,
  );
}

// ---------------------------------------------------------------------------
// Gateway mock factory
// ---------------------------------------------------------------------------

function makeGatewayMocks() {
  const registry = {
    discoverAdapters: vi.fn(async () => undefined),
    startAll:         vi.fn(async () => undefined),
    stopAll:          vi.fn(async () => undefined),
    getInstance:      vi.fn(() => undefined),
    createInstance:   vi.fn(async () => undefined),
    startInstance:    vi.fn(async () => undefined),
    removeInstance:   vi.fn(async () => undefined),
  } as never;
  const userMapping = {
    initialize:  vi.fn(),
    lookupUser:  vi.fn(() => null),
    isAuthorized: vi.fn(() => true),
  } as never;
  return { registry, userMapping };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  setGlobalLevel("error");
});

afterEach(() => {
  resetLogger();
});

// ---------------------------------------------------------------------------
// Tests — InboundMessageGateway → TaskBridge wiring
// ---------------------------------------------------------------------------

describe("InboundMessageGateway → TaskBridge wiring", () => {
  it("delegates to bridge's processMessage via onMessage()", async () => {
    const gm = makeGatewayMocks();
    const gateway = new InboundMessageGateway(gm.registry, gm.userMapping, GATEWAY_GOV);
    const processMessage = vi.fn(async () => undefined);
    gateway.onMessage(processMessage);

    await gateway.handleInboundMessage(makeEnvelope());

    expect(processMessage).toHaveBeenCalledOnce();
    expect(processMessage.mock.calls[0]![0]).toMatchObject({ id: "msg-1" });
  });

  it("delegates when messageProcessor passed to constructor", async () => {
    const gm = makeGatewayMocks();
    const processMessage = vi.fn(async () => undefined);
    const processor = { processMessage };
    const gateway = new InboundMessageGateway(
      gm.registry, gm.userMapping, GATEWAY_GOV,
      async () => { throw new Error("no secrets"); },
      processor,
    );

    await gateway.handleInboundMessage(makeEnvelope());

    expect(processMessage).toHaveBeenCalledOnce();
  });

  it("does not call bridge when gateway authorization fails", async () => {
    const gm = makeGatewayMocks();
    const gov: MessagingGovernance = { ...GATEWAY_GOV, require_mapping: true };
    // isAuthorized returns false
    const userMappingUnauth = { ...gm.userMapping, isAuthorized: vi.fn(() => false) } as never;
    const processMessage = vi.fn(async () => undefined);
    const gateway = new InboundMessageGateway(gm.registry, userMappingUnauth, gov);
    gateway.onMessage(processMessage);

    await gateway.handleInboundMessage(makeEnvelope());

    expect(processMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — Full message → task flow via bridge
// ---------------------------------------------------------------------------

describe("full message → task flow", () => {
  it("submits task and sends accepted confirmation", async () => {
    const mocks = makeBridgeMocks();
    await makeBridge(mocks).processMessage(makeEnvelope());

    expect(mocks.executionBridge.submitMessageTask).toHaveBeenCalledOnce();
    expect(mocks.responseRouter.sendTaskAccepted).toHaveBeenCalledOnce();
  });

  it("applies channel routing from config", async () => {
    const mocks = makeBridgeMocks();
    await makeBridge(mocks).processMessage(makeEnvelope()); // chat_id: "chat-eng" → "engineering"

    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { division: string };
    expect(input.division).toBe("engineering");
  });

  it("sends block notification when governance blocks", async () => {
    const mocks = makeBridgeMocks();
    (mocks.govCheck as ReturnType<typeof vi.fn>).mockResolvedValue(BLOCK_RESULT);

    await makeBridge(mocks).processMessage(makeEnvelope());

    expect(mocks.responseRouter.sendBlocked).toHaveBeenCalledOnce();
    expect(mocks.executionBridge.submitMessageTask).not.toHaveBeenCalled();
  });

  it("registers block for override when governance blocks with overrideable=true", async () => {
    const mocks = makeBridgeMocks();
    (mocks.govCheck as ReturnType<typeof vi.fn>).mockResolvedValue(BLOCK_RESULT);

    await makeBridge(mocks).processMessage(makeEnvelope());

    expect(mocks.overrideManager.registerBlock).toHaveBeenCalledOnce();
  });

  it("routes override response to overrideManager", async () => {
    const mocks = makeBridgeMocks();
    mocks.overrideManager.isOverrideResponse.mockReturnValue(true);

    await makeBridge(mocks).processMessage(makeEnvelope({ content: { text: "freigabe" } }));

    expect(mocks.overrideManager.processOverride).toHaveBeenCalledOnce();
    expect(mocks.govCheck).not.toHaveBeenCalled();
  });

  it("slash command delegated to CommandHandler when set", async () => {
    const mocks = makeBridgeMocks();
    const bridge = makeBridge(mocks);
    const commandHandler = { handle: vi.fn(async () => undefined) };
    bridge.setCommandHandler(commandHandler);

    await bridge.processMessage(makeEnvelope({ content: { text: "/status" } }));

    expect(commandHandler.handle).toHaveBeenCalledOnce();
    expect(mocks.govCheck).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — TaskLifecycleRouter
// ---------------------------------------------------------------------------

describe("TaskLifecycleRouter", () => {
  function makeTask(overrides: Partial<Task> = {}): Task {
    return {
      id:                   "task-life-1",
      parent_id:            null,
      root_id:              "task-life-1",
      division:             "engineering",
      type:                 "root",
      tier:                 1,
      title:                "Health check",
      description:          "Run the health check",
      assigned_agent:       "agent-1",
      status:               "DONE",
      priority:             3,
      classification:       "internal",
      created_at:           "2026-03-21T10:00:00.000Z",
      updated_at:           "2026-03-21T10:01:00.000Z",
      started_at:           "2026-03-21T10:00:01.000Z",
      completed_at:         "2026-03-21T10:01:00.000Z",
      result_file:          null,
      result_summary:       "All systems nominal.",
      confidence:           0.95,
      token_budget:         100_000,
      token_used:           1_200,
      cost_budget:          1.0,
      cost_used:            0.08,
      ttl_seconds:          3600,
      retry_count:          0,
      max_retries:          3,
      checkpoint:           null,
      sub_tasks_expected:   0,
      sub_tasks_received:   0,
      embedding_id:         null,
      metadata:             {},
      recurring_schedule_id: null,
      is_recurring:         false,
      source_metadata: {
        source_channel:     "telegram",
        source_instance_id: "tg-1",
        source_message_id:  "msg-1",
        source_chat_id:     "chat-eng",
        source_user:        "user-alice",
      },
      ...overrides,
    };
  }

  function makeRouterMocks() {
    let handler: ((data: unknown) => void) | undefined;
    let failHandler: ((data: unknown) => void) | undefined;

    const eventBus = {
      on: vi.fn((event: string, fn: (data: unknown) => void) => {
        if (event === "RESULT_READY") handler = fn;
        if (event === "TASK_FAILED")  failHandler = fn;
      }),
    };

    const taskStore = { get: vi.fn() };

    const responseRouter = {
      sendTaskCompleted: vi.fn(async () => undefined),
      sendTaskFailed:    vi.fn(async () => undefined),
    };

    return { eventBus, taskStore, responseRouter, getHandler: () => handler, getFailHandler: () => failHandler };
  }

  it("subscribes to RESULT_READY and TASK_FAILED on start()", () => {
    const rm = makeRouterMocks();
    const router = new TaskLifecycleRouter(rm.eventBus, rm.taskStore as never, rm.responseRouter as never);
    router.start();
    expect(rm.eventBus.on).toHaveBeenCalledTimes(2);
    const events = (rm.eventBus.on as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
    expect(events).toContain("RESULT_READY");
    expect(events).toContain("TASK_FAILED");
  });

  it("sends completion notification when RESULT_READY with source_metadata", async () => {
    const rm = makeRouterMocks();
    const task = makeTask();
    rm.taskStore.get.mockReturnValue(task);

    const router = new TaskLifecycleRouter(rm.eventBus, rm.taskStore as never, rm.responseRouter as never);
    router.start();

    await rm.getHandler()!({ task_id: "task-life-1" });

    expect(rm.responseRouter.sendTaskCompleted).toHaveBeenCalledOnce();
    const [envelope, handle, summary] = (rm.responseRouter.sendTaskCompleted as ReturnType<typeof vi.fn>).mock.calls[0] as [MessageEnvelope, unknown, string];
    expect(envelope.instance_id).toBe("tg-1");
    expect(envelope.metadata.chat_id).toBe("chat-eng");
    expect(summary).toBe("All systems nominal.");
    expect((handle as { id: string }).id).toBe("task-life-1");
  });

  it("sends failure notification when TASK_FAILED with source_metadata", async () => {
    const rm = makeRouterMocks();
    const task = makeTask({ status: "FAILED" });
    rm.taskStore.get.mockReturnValue(task);

    const router = new TaskLifecycleRouter(rm.eventBus, rm.taskStore as never, rm.responseRouter as never);
    router.start();

    await rm.getFailHandler()!({ task_id: "task-life-1", data: { error: "agent crashed" } });

    expect(rm.responseRouter.sendTaskFailed).toHaveBeenCalledOnce();
    const [, , error] = (rm.responseRouter.sendTaskFailed as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, unknown, string];
    expect(error).toBe("agent crashed");
  });

  it("ignores task without source_metadata (non-messaging task)", async () => {
    const rm = makeRouterMocks();
    // Task with no source_metadata
    const task = makeTask();
    delete (task as Partial<Task>).source_metadata;
    rm.taskStore.get.mockReturnValue(task);

    const router = new TaskLifecycleRouter(rm.eventBus, rm.taskStore as never, rm.responseRouter as never);
    router.start();

    await rm.getHandler()!({ task_id: "task-life-1" });

    expect(rm.responseRouter.sendTaskCompleted).not.toHaveBeenCalled();
  });

  it("ignores event when task not found in store", async () => {
    const rm = makeRouterMocks();
    rm.taskStore.get.mockReturnValue(null);

    const router = new TaskLifecycleRouter(rm.eventBus, rm.taskStore as never, rm.responseRouter as never);
    router.start();

    await rm.getHandler()!({ task_id: "nonexistent" });

    expect(rm.responseRouter.sendTaskCompleted).not.toHaveBeenCalled();
  });

  it("ignores event with invalid data (no task_id)", async () => {
    const rm = makeRouterMocks();

    const router = new TaskLifecycleRouter(rm.eventBus, rm.taskStore as never, rm.responseRouter as never);
    router.start();

    await rm.getHandler()!({ some: "other data" });

    expect(rm.taskStore.get).not.toHaveBeenCalled();
  });

  it("uses default error message when event has no error field", async () => {
    const rm = makeRouterMocks();
    const task = makeTask({ status: "FAILED" });
    rm.taskStore.get.mockReturnValue(task);

    const router = new TaskLifecycleRouter(rm.eventBus, rm.taskStore as never, rm.responseRouter as never);
    router.start();

    await rm.getFailHandler()!({ task_id: "task-life-1" });

    const [, , error] = (rm.responseRouter.sendTaskFailed as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, unknown, string];
    expect(error).toBe("Unbekannter Fehler");
  });
});
