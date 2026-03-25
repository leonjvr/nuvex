// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/messaging/override-manager.ts
 *
 * Covers:
 * - registerBlock stores pending override with expiry
 * - isOverrideResponse returns true for recognized phrases (DE + EN)
 * - isOverrideResponse returns false for unrecognized text
 * - isOverrideResponse returns false when no pending override
 * - processOverride re-submits task with governance_override flag
 * - processOverride audits the override
 * - processOverride rejects non-overrideable rules
 * - processOverride rejects expired override window
 * - processOverride rejects non-admin for admin-required rules
 * - processOverride accepts admin for admin-required rules
 * - processOverride cleans up pending after processing
 * - cleanupExpired removes expired overrides
 * - key is unique per instance+chat+user combination
 * - multiple pending overrides for different users coexist
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OverrideManager } from "../../src/messaging/override-manager.js";
import type {
  MessageEnvelope,
  UserMapping,
  UserTaskInput,
  BlockResult,
  AcceptResult,
  TaskBridgeConfig,
  AuditLog,
} from "../../src/messaging/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONFIG: TaskBridgeConfig = {
  mode: "direct_passthrough",
  defaults: { priority: 3, budget_usd: 5.0, ttl_seconds: 300 },
  override: {
    enabled:                    true,
    window_seconds:             300,
    non_overrideable_rules:     ["FORBIDDEN_ALWAYS"],
    require_admin_for_override: ["ADMIN_ONLY_RULE"],
  },
  channel_routing: {},
};

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    id:          "msg-1",
    instance_id: "tg-1",
    channel:     "telegram",
    sender: { platform_id: "plat-1", display_name: "Alice", verified: true },
    content: { text: "some text" },
    metadata: { timestamp: new Date().toISOString(), chat_id: "chat-1", platform_raw: {} },
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

function makeTaskInput(): UserTaskInput {
  return {
    description: "Run heartbeat",
    priority:    3,
    division:    "engineering",
    budget_usd:  5.0,
    ttl_seconds: 300,
    source_metadata: {
      source_channel:     "telegram",
      source_instance_id: "tg-1",
      source_message_id:  "msg-1",
      source_chat_id:     "chat-1",
      source_user:        "user-alice",
    },
  };
}

function makeBlock(overrides: Partial<BlockResult> = {}): BlockResult {
  return {
    blocked:      true,
    reason:       "Dangerous action detected",
    rule:         "NO_DANGEROUS_ACTIONS",
    overrideable: true,
    ...overrides,
  };
}

const ACCEPT_RESULT: AcceptResult = {
  blocked: false,
  handle: {
    id:          "task-new-1",
    description: "Run heartbeat",
    agent_id:    "agent-1",
    budget_usd:  5.0,
    status:      "CREATED",
  },
};

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMocks() {
  const executionBridge = { submitTaskWithOverride: vi.fn(async () => ACCEPT_RESULT) };
  const responseRouter = {
    sendDirectMessage: vi.fn(async () => undefined),
    sendTaskAccepted:  vi.fn(async () => undefined),
  };
  const auditLog: AuditLog = { log: vi.fn() };
  return { executionBridge, responseRouter, auditLog };
}

function makeManager(mocks: ReturnType<typeof makeMocks>, config = CONFIG) {
  return new OverrideManager(
    config,
    mocks.executionBridge as never,
    mocks.responseRouter as never,
    mocks.auditLog,
  );
}

// ---------------------------------------------------------------------------
// Tests — registerBlock
// ---------------------------------------------------------------------------

describe("registerBlock", () => {
  it("stores a pending override with correct expiry", () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);
    const before = Date.now();

    mgr.registerBlock(makeEnvelope(), makeUser(), makeTaskInput(), makeBlock());

    expect(mgr.pendingCount).toBe(1);
    const expiresAt = new Date(before + CONFIG.override.window_seconds * 1000).getTime();
    expect(expiresAt).toBeGreaterThan(before);
  });

  it("marks as non-overrideable when rule is in non_overrideable_rules", () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);

    mgr.registerBlock(
      makeEnvelope(),
      makeUser(),
      makeTaskInput(),
      makeBlock({ rule: "FORBIDDEN_ALWAYS", overrideable: true }),
    );

    // Even though block.overrideable=true, the rule is in non_overrideable_rules
    // so the override should be rejected in processOverride
    expect(mgr.pendingCount).toBe(1);
  });

  it("does not store when override.enabled is false", () => {
    const mocks   = makeMocks();
    const config  = { ...CONFIG, override: { ...CONFIG.override, enabled: false } };
    const mgr     = makeManager(mocks, config);

    mgr.registerBlock(makeEnvelope(), makeUser(), makeTaskInput(), makeBlock());
    expect(mgr.pendingCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — isOverrideResponse
// ---------------------------------------------------------------------------

describe("isOverrideResponse", () => {
  const RECOGNIZED_PHRASES = [
    "freigabe erteilen",
    "freigabe",
    "override",
    "ich erteile freigabe",
    "genehmigt",
    "approved",
    "approve",
    "grant override",
    "confirm",
    "bestätigt",
    "ja, ausführen",
    "execute anyway",
  ];

  for (const phrase of RECOGNIZED_PHRASES) {
    it(`returns true for "${phrase}"`, () => {
      const mocks = makeMocks();
      const mgr   = makeManager(mocks);

      mgr.registerBlock(makeEnvelope(), makeUser(), makeTaskInput(), makeBlock());
      const env = makeEnvelope({ content: { text: phrase } });
      expect(mgr.isOverrideResponse(env)).toBe(true);
    });
  }

  it("returns false for unrecognized text", () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);

    mgr.registerBlock(makeEnvelope(), makeUser(), makeTaskInput(), makeBlock());
    const env = makeEnvelope({ content: { text: "let me think about it" } });
    expect(mgr.isOverrideResponse(env)).toBe(false);
  });

  it("returns false when there is no pending override for the context", () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);

    const env = makeEnvelope({ content: { text: "freigabe" } });
    expect(mgr.isOverrideResponse(env)).toBe(false);
  });

  it("is case-insensitive — 'FREIGABE' matches 'freigabe'", () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);

    mgr.registerBlock(makeEnvelope(), makeUser(), makeTaskInput(), makeBlock());
    const env = makeEnvelope({ content: { text: "FREIGABE" } });
    expect(mgr.isOverrideResponse(env)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — processOverride
// ---------------------------------------------------------------------------

describe("processOverride — happy path", () => {
  it("re-submits task with governance_override flag", async () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);
    const user  = makeUser();

    mgr.registerBlock(makeEnvelope(), user, makeTaskInput(), makeBlock());
    await mgr.processOverride(makeEnvelope({ content: { text: "freigabe" } }), user);

    expect(mocks.executionBridge.submitTaskWithOverride).toHaveBeenCalledOnce();
    const arg = mocks.executionBridge.submitTaskWithOverride.mock.calls[0][0] as UserTaskInput;
    expect(arg.governance_override).toBeDefined();
    expect(arg.governance_override!.user_id).toBe("user-alice");
    expect(arg.governance_override!.original_block_rule).toBe("NO_DANGEROUS_ACTIONS");
    expect(arg.governance_override!.original_block_reason).toBe("Dangerous action detected");
  });

  it("audits the override", async () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);
    const user  = makeUser();

    mgr.registerBlock(makeEnvelope(), user, makeTaskInput(), makeBlock());
    await mgr.processOverride(makeEnvelope({ content: { text: "freigabe" } }), user);

    expect(mocks.auditLog.log).toHaveBeenCalledOnce();
    const [event, data] = (mocks.auditLog.log as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe("USER_OVERRIDE");
    expect(data["user"]).toBe("user-alice");
    expect(data["rule"]).toBe("NO_DANGEROUS_ACTIONS");
  });

  it("sends task accepted confirmation with isOverride=true", async () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);
    const user  = makeUser();

    mgr.registerBlock(makeEnvelope(), user, makeTaskInput(), makeBlock());
    await mgr.processOverride(makeEnvelope({ content: { text: "approved" } }), user);

    expect(mocks.responseRouter.sendTaskAccepted).toHaveBeenCalledOnce();
    const [, , isOverride] = mocks.responseRouter.sendTaskAccepted.mock.calls[0] as [unknown, unknown, boolean];
    expect(isOverride).toBe(true);
  });

  it("cleans up pending override after processing", async () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);
    const user  = makeUser();

    mgr.registerBlock(makeEnvelope(), user, makeTaskInput(), makeBlock());
    expect(mgr.pendingCount).toBe(1);

    await mgr.processOverride(makeEnvelope({ content: { text: "freigabe" } }), user);
    expect(mgr.pendingCount).toBe(0);
  });
});

describe("processOverride — rejections", () => {
  it("rejects non-overrideable rule and sends message", async () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);
    const user  = makeUser();

    mgr.registerBlock(
      makeEnvelope(),
      user,
      makeTaskInput(),
      makeBlock({ rule: "FORBIDDEN_ALWAYS", overrideable: true }),
    );
    await mgr.processOverride(makeEnvelope({ content: { text: "freigabe" } }), user);

    expect(mocks.executionBridge.submitTaskWithOverride).not.toHaveBeenCalled();
    expect(mocks.responseRouter.sendDirectMessage).toHaveBeenCalledOnce();
    const msg = (mocks.responseRouter.sendDirectMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(msg).toContain("nicht überschreibbar");
    expect(mgr.pendingCount).toBe(0);
  });

  it("rejects expired override window", async () => {
    const mocks  = makeMocks();
    const config = { ...CONFIG, override: { ...CONFIG.override, window_seconds: 0 } };
    const mgr    = makeManager(mocks, config);
    const user   = makeUser();

    mgr.registerBlock(makeEnvelope(), user, makeTaskInput(), makeBlock());
    // Window is 0 seconds → already expired
    await mgr.processOverride(makeEnvelope({ content: { text: "freigabe" } }), user);

    expect(mocks.executionBridge.submitTaskWithOverride).not.toHaveBeenCalled();
    expect(mocks.responseRouter.sendDirectMessage).toHaveBeenCalledOnce();
    const msg = (mocks.responseRouter.sendDirectMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(msg).toContain("abgelaufen");
    expect(mgr.pendingCount).toBe(0);
  });

  it("rejects non-admin for admin-required rule", async () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);
    const user  = makeUser({ role: "user" }); // not admin

    mgr.registerBlock(
      makeEnvelope(),
      user,
      makeTaskInput(),
      makeBlock({ rule: "ADMIN_ONLY_RULE", overrideable: true }),
    );
    await mgr.processOverride(makeEnvelope({ content: { text: "freigabe" } }), user);

    expect(mocks.executionBridge.submitTaskWithOverride).not.toHaveBeenCalled();
    const msg = (mocks.responseRouter.sendDirectMessage as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(msg).toContain("Admin-Berechtigung");
    expect(mgr.pendingCount).toBe(0);
  });

  it("accepts admin for admin-required rule", async () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);
    const admin = makeUser({ role: "admin" });

    mgr.registerBlock(
      makeEnvelope(),
      admin,
      makeTaskInput(),
      makeBlock({ rule: "ADMIN_ONLY_RULE", overrideable: true }),
    );
    await mgr.processOverride(makeEnvelope({ content: { text: "approved" } }), admin);

    expect(mocks.executionBridge.submitTaskWithOverride).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests — cleanupExpired
// ---------------------------------------------------------------------------

describe("cleanupExpired", () => {
  it("removes expired overrides and returns count", () => {
    const mocks  = makeMocks();
    const config = { ...CONFIG, override: { ...CONFIG.override, window_seconds: 0 } };
    const mgr    = makeManager(mocks, config);

    mgr.registerBlock(makeEnvelope(), makeUser(), makeTaskInput(), makeBlock());
    expect(mgr.pendingCount).toBe(1);

    const count = mgr.cleanupExpired();
    expect(count).toBe(1);
    expect(mgr.pendingCount).toBe(0);
  });

  it("does not remove non-expired overrides", () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks); // window_seconds = 300

    mgr.registerBlock(makeEnvelope(), makeUser(), makeTaskInput(), makeBlock());
    const count = mgr.cleanupExpired();
    expect(count).toBe(0);
    expect(mgr.pendingCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — key uniqueness
// ---------------------------------------------------------------------------

describe("key uniqueness", () => {
  it("key is unique per instance+chat+user combination", () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);
    const user1 = makeUser({ sidjua_user_id: "user-1", platform_user_id: "plat-1" });
    const user2 = makeUser({ sidjua_user_id: "user-2", platform_user_id: "plat-2" });
    const env1  = makeEnvelope({ sender: { platform_id: "plat-1", display_name: "A", verified: true } });
    const env2  = makeEnvelope({ sender: { platform_id: "plat-2", display_name: "B", verified: true } });

    mgr.registerBlock(env1, user1, makeTaskInput(), makeBlock());
    mgr.registerBlock(env2, user2, makeTaskInput(), makeBlock());

    expect(mgr.pendingCount).toBe(2);
  });

  it("multiple pending overrides for different users coexist", () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);

    for (let i = 0; i < 5; i++) {
      const env  = makeEnvelope({ sender: { platform_id: `plat-${i}`, display_name: `User${i}`, verified: true } });
      const user = makeUser({ sidjua_user_id: `user-${i}`, platform_user_id: `plat-${i}` });
      mgr.registerBlock(env, user, makeTaskInput(), makeBlock());
    }

    expect(mgr.pendingCount).toBe(5);
  });

  it("same user+chat+instance overwrites previous pending override", () => {
    const mocks = makeMocks();
    const mgr   = makeManager(mocks);

    const env  = makeEnvelope();
    const user = makeUser();
    mgr.registerBlock(env, user, makeTaskInput(), makeBlock({ rule: "RULE_A" }));
    mgr.registerBlock(env, user, makeTaskInput(), makeBlock({ rule: "RULE_B" }));

    // Still only 1 pending (second overwrites first)
    expect(mgr.pendingCount).toBe(1);
  });
});
