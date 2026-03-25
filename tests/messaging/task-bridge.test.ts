// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/messaging/task-bridge.ts
 *
 * Covers:
 * - processMessage rejects unauthorized sender
 * - processMessage builds task with message text as description (1:1)
 * - processMessage uses channel routing for division
 * - processMessage falls back to user default division
 * - processMessage falls back to "general" when no routing or default
 * - processMessage submits task via executionBridge
 * - processMessage sends accepted confirmation on success
 * - processMessage sends block notification when governance blocks
 * - processMessage registers block for override when overrideable
 * - processMessage delegates override responses to OverrideManager
 * - processMessage delegates slash commands (returns early, no task)
 * - task priority always equals configured default
 * - task budget/TTL use config defaults
 * - source_metadata populated correctly from envelope
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageToTaskBridge } from "../../src/messaging/task-bridge.js";
import type { GovernanceCheckFn } from "../../src/messaging/task-bridge.js";
import { TaskBuilder } from "../../src/messaging/task-builder.js";
import type {
  MessageEnvelope,
  UserMapping,
  UserTaskInput,
  MessagingTaskHandle,
  AcceptResult,
  BlockResult,
  TaskBridgeConfig,
} from "../../src/messaging/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONFIG: TaskBridgeConfig = {
  mode: "direct_passthrough",
  defaults: { priority: 3, budget_usd: 5.0, ttl_seconds: 300 },
  override: {
    enabled: true,
    window_seconds: 300,
    non_overrideable_rules: ["FORBIDDEN_ALWAYS"],
    require_admin_for_override: ["ADMIN_ONLY_RULE"],
  },
  channel_routing: {
    telegram: { "chat-eng": "engineering", "chat-ops": "operations" },
  },
};

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    id:          "msg-1",
    instance_id: "tg-instance-1",
    channel:     "telegram",
    sender: { platform_id: "plat-user-1", display_name: "Alice", verified: true },
    content: { text: "Run the daily health check" },
    metadata: {
      timestamp:    new Date().toISOString(),
      chat_id:      "chat-eng",
      platform_raw: {},
    },
    ...overrides,
  };
}

function makeUser(overrides: Partial<UserMapping> = {}): UserMapping {
  return {
    sidjua_user_id:   "user-alice",
    instance_id:      "tg-instance-1",
    platform_user_id: "plat-user-1",
    role:             "user",
    created_at:       new Date().toISOString(),
    ...overrides,
  };
}

const TASK_HANDLE: MessagingTaskHandle = {
  id:          "task-abc-1234",
  description: "Run the daily health check",
  agent_id:    "agent-1",
  budget_usd:  5.0,
  status:      "CREATED",
};

const ACCEPT_RESULT: AcceptResult = { blocked: false, handle: TASK_HANDLE };

const BLOCK_RESULT: BlockResult = {
  blocked:      true,
  reason:       "Action is forbidden",
  rule:         "NO_DANGEROUS_ACTIONS",
  overrideable: true,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMocks() {
  const userMapping = { lookupUser: vi.fn(() => makeUser()) };
  const executionBridge = { submitMessageTask: vi.fn(async () => ACCEPT_RESULT) };
  const responseRouter = {
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

function makeBridge(
  mocks: ReturnType<typeof makeMocks>,
  govCheck?: GovernanceCheckFn,
) {
  const builder = new TaskBuilder(CONFIG);
  return new MessageToTaskBridge(
    builder,
    mocks.executionBridge as never,
    mocks.responseRouter as never,
    mocks.userMapping as never,
    mocks.overrideManager as never,
    CONFIG,
    govCheck ?? mocks.govCheck,
  );
}

// ---------------------------------------------------------------------------
// Tests — authorization
// ---------------------------------------------------------------------------

describe("authorization", () => {
  it("sends unauthorized when sender is not mapped", async () => {
    const mocks = makeMocks();
    mocks.userMapping.lookupUser.mockReturnValue(null);

    const bridge = makeBridge(mocks);
    await bridge.processMessage(makeEnvelope());

    expect(mocks.responseRouter.sendUnauthorized).toHaveBeenCalledOnce();
    expect(mocks.executionBridge.submitMessageTask).not.toHaveBeenCalled();
  });

  it("does not create a task for unauthorized sender", async () => {
    const mocks = makeMocks();
    mocks.userMapping.lookupUser.mockReturnValue(null);

    await makeBridge(mocks).processMessage(makeEnvelope());
    expect(mocks.govCheck).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — task building (1:1 pass-through)
// ---------------------------------------------------------------------------

describe("task building", () => {
  it("uses message text as task description verbatim", async () => {
    const mocks = makeMocks();
    await makeBridge(mocks).processMessage(makeEnvelope({ content: { text: "Specific instruction text" } }));
    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserTaskInput;
    expect(input.description).toBe("Specific instruction text");
  });

  it("priority always equals configured default — no inference", async () => {
    const mocks = makeMocks();
    await makeBridge(mocks).processMessage(makeEnvelope());
    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserTaskInput;
    expect(input.priority).toBe(CONFIG.defaults.priority);
  });

  it("budget_usd uses config default", async () => {
    const mocks = makeMocks();
    await makeBridge(mocks).processMessage(makeEnvelope());
    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserTaskInput;
    expect(input.budget_usd).toBe(CONFIG.defaults.budget_usd);
  });

  it("ttl_seconds uses config default", async () => {
    const mocks = makeMocks();
    await makeBridge(mocks).processMessage(makeEnvelope());
    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserTaskInput;
    expect(input.ttl_seconds).toBe(CONFIG.defaults.ttl_seconds);
  });

  it("source_metadata populated from envelope", async () => {
    const mocks = makeMocks();
    const env = makeEnvelope();
    await makeBridge(mocks).processMessage(env);
    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserTaskInput;
    expect(input.source_metadata.source_channel).toBe("telegram");
    expect(input.source_metadata.source_instance_id).toBe("tg-instance-1");
    expect(input.source_metadata.source_message_id).toBe("msg-1");
    expect(input.source_metadata.source_chat_id).toBe("chat-eng");
    expect(input.source_metadata.source_user).toBe("user-alice");
  });
});

// ---------------------------------------------------------------------------
// Tests — division routing
// ---------------------------------------------------------------------------

describe("division routing", () => {
  it("uses channel routing config when chat_id matches", async () => {
    const mocks = makeMocks();
    const env = makeEnvelope(); // chat_id: "chat-eng" → "engineering"
    await makeBridge(mocks).processMessage(env);
    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserTaskInput;
    expect(input.division).toBe("engineering");
  });

  it("uses 'ops' routing for chat-ops", async () => {
    const mocks = makeMocks();
    const env = makeEnvelope({
      metadata: { timestamp: new Date().toISOString(), chat_id: "chat-ops", platform_raw: {} },
    });
    await makeBridge(mocks).processMessage(env);
    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserTaskInput;
    expect(input.division).toBe("operations");
  });

  it("falls back to user default_division when no channel routing matches", async () => {
    const mocks = makeMocks();
    mocks.userMapping.lookupUser.mockReturnValue(makeUser({ default_division: "finance" }));
    const env = makeEnvelope({
      channel:  "slack",
      metadata: { timestamp: new Date().toISOString(), chat_id: "unknown-chat", platform_raw: {} },
    });
    await makeBridge(mocks).processMessage(env);
    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserTaskInput;
    expect(input.division).toBe("finance");
  });

  it("falls back to 'general' when no routing and no default division", async () => {
    const mocks = makeMocks();
    const env = makeEnvelope({
      channel:  "slack",
      metadata: { timestamp: new Date().toISOString(), chat_id: "unknown-chat", platform_raw: {} },
    });
    await makeBridge(mocks).processMessage(env);
    const input = (mocks.govCheck as ReturnType<typeof vi.fn>).mock.calls[0][0] as UserTaskInput;
    expect(input.division).toBe("general");
  });
});

// ---------------------------------------------------------------------------
// Tests — task submission
// ---------------------------------------------------------------------------

describe("task submission", () => {
  it("calls executionBridge.submitMessageTask with task input", async () => {
    const mocks = makeMocks();
    await makeBridge(mocks).processMessage(makeEnvelope());
    expect(mocks.executionBridge.submitMessageTask).toHaveBeenCalledOnce();
    const arg = mocks.executionBridge.submitMessageTask.mock.calls[0][0] as UserTaskInput;
    expect(arg.description).toBe("Run the daily health check");
  });

  it("sends task accepted confirmation on success", async () => {
    const mocks = makeMocks();
    await makeBridge(mocks).processMessage(makeEnvelope());
    expect(mocks.responseRouter.sendTaskAccepted).toHaveBeenCalledOnce();
    const [, handle, isOverride] = mocks.responseRouter.sendTaskAccepted.mock.calls[0] as [MessageEnvelope, MessagingTaskHandle, boolean];
    expect(handle.id).toBe(TASK_HANDLE.id);
    expect(isOverride).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — governance blocking
// ---------------------------------------------------------------------------

describe("governance blocking", () => {
  it("sends block notification when governance blocks", async () => {
    const mocks = makeMocks();
    (mocks.govCheck as ReturnType<typeof vi.fn>).mockResolvedValue(BLOCK_RESULT);

    await makeBridge(mocks).processMessage(makeEnvelope());

    expect(mocks.responseRouter.sendBlocked).toHaveBeenCalledOnce();
    expect(mocks.executionBridge.submitMessageTask).not.toHaveBeenCalled();
  });

  it("registers block for override when governance blocks and overrideable=true", async () => {
    const mocks = makeMocks();
    (mocks.govCheck as ReturnType<typeof vi.fn>).mockResolvedValue(BLOCK_RESULT);

    await makeBridge(mocks).processMessage(makeEnvelope());

    expect(mocks.overrideManager.registerBlock).toHaveBeenCalledOnce();
    const [, , , block] = mocks.overrideManager.registerBlock.mock.calls[0] as [MessageEnvelope, UserMapping, UserTaskInput, BlockResult];
    expect(block.overrideable).toBe(true);
    expect(block.rule).toBe("NO_DANGEROUS_ACTIONS");
  });

  it("does NOT register block when governance blocks with overrideable=false", async () => {
    const mocks = makeMocks();
    (mocks.govCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...BLOCK_RESULT,
      overrideable: false,
    });

    // Still registers (OverrideManager internally marks it non-overrideable)
    await makeBridge(mocks).processMessage(makeEnvelope());
    expect(mocks.overrideManager.registerBlock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests — override delegation
// ---------------------------------------------------------------------------

describe("override delegation", () => {
  it("delegates to OverrideManager when isOverrideResponse returns true", async () => {
    const mocks = makeMocks();
    mocks.overrideManager.isOverrideResponse.mockReturnValue(true);

    await makeBridge(mocks).processMessage(makeEnvelope({ content: { text: "freigabe" } }));

    expect(mocks.overrideManager.processOverride).toHaveBeenCalledOnce();
    expect(mocks.govCheck).not.toHaveBeenCalled();
    expect(mocks.executionBridge.submitMessageTask).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — slash command delegation
// ---------------------------------------------------------------------------

describe("slash command delegation", () => {
  it("returns early without building a task for slash commands", async () => {
    const mocks = makeMocks();
    await makeBridge(mocks).processMessage(makeEnvelope({ content: { text: "/status" } }));

    expect(mocks.govCheck).not.toHaveBeenCalled();
    expect(mocks.executionBridge.submitMessageTask).not.toHaveBeenCalled();
    expect(mocks.responseRouter.sendTaskAccepted).not.toHaveBeenCalled();
  });

  it("calls commandHandler.handle for slash commands when handler is set", async () => {
    const mocks = makeMocks();
    const commandHandler = { handle: vi.fn(async () => undefined) };
    const bridge = makeBridge(mocks);
    bridge.setCommandHandler(commandHandler);

    await bridge.processMessage(makeEnvelope({ content: { text: "/help" } }));
    expect(commandHandler.handle).toHaveBeenCalledOnce();
  });
});
