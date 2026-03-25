/**
 * V1.1 — ResponseRouter unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResponseRouter } from "../../src/messaging/response-router.js";
import type { AdapterRegistry } from "../../src/messaging/adapter-registry.js";
import type { AdapterInstance } from "../../src/messaging/adapter-plugin.js";
import type { MessageEnvelope, MessagingGovernance } from "../../src/messaging/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnvelope(instanceId = "inst-1", chatId = "chat-42", msgId = "msg-1"): MessageEnvelope {
  return {
    id:          msgId,
    instance_id: instanceId,
    channel:     "test",
    sender: {
      platform_id:  "user-1",
      display_name: "Test User",
      verified:     false,
    },
    content: { text: "hi" },
    metadata: {
      timestamp:    new Date().toISOString(),
      chat_id:      chatId,
      platform_raw: {},
    },
  };
}

function makeInstance(instanceId = "inst-1", formatText?: (t: string) => string): AdapterInstance {
  const inst: AdapterInstance = {
    instanceId,
    channel:      "test",
    start:        vi.fn().mockResolvedValue(undefined),
    stop:         vi.fn().mockResolvedValue(undefined),
    sendResponse: vi.fn().mockResolvedValue(undefined),
    isHealthy:    vi.fn().mockReturnValue(true),
  };
  if (formatText !== undefined) {
    (inst as AdapterInstance & { formatText: (t: string) => string }).formatText = formatText;
  }
  return inst;
}

function makeRegistry(instance: AdapterInstance | null = makeInstance()): AdapterRegistry {
  return {
    getInstance: vi.fn().mockReturnValue(instance ?? undefined),
  } as unknown as AdapterRegistry;
}

function makeGovernance(overrides: Partial<MessagingGovernance> = {}): MessagingGovernance {
  return {
    require_mapping:             false,
    allow_self_register:         false,
    response_max_length:         4000,
    include_task_id_in_response: false,
    typing_indicator:            false,
    max_inbound_per_hour:        0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ResponseRouter — registerTaskOrigin + routeResponse", () => {
  it("routes response to correct adapter instance", async () => {
    const inst     = makeInstance("inst-1");
    const registry = makeRegistry(inst);
    const router   = new ResponseRouter(registry, makeGovernance());

    router.registerTaskOrigin("task-1", makeEnvelope("inst-1", "chat-99", "msg-42"));
    await router.routeResponse("task-1", "Hello from SIDJUA");

    expect(inst.sendResponse).toHaveBeenCalledWith(
      "chat-99",
      "Hello from SIDJUA",
      expect.objectContaining({ reply_to_message_id: "msg-42" }),
    );
  });

  it("uses adapter formatText when available", async () => {
    const formatText = vi.fn((t: string) => `**${t}**`);
    const inst       = makeInstance("inst-1", formatText);
    const registry   = makeRegistry(inst);
    const router     = new ResponseRouter(registry, makeGovernance());

    router.registerTaskOrigin("task-2", makeEnvelope());
    await router.routeResponse("task-2", "Raw text");

    expect(formatText).toHaveBeenCalledWith("Raw text");
    expect(inst.sendResponse).toHaveBeenCalledWith(
      expect.any(String),
      "**Raw text**",
      expect.anything(),
    );
  });

  it("truncates response at response_max_length", async () => {
    const inst     = makeInstance();
    const registry = makeRegistry(inst);
    const router   = new ResponseRouter(registry, makeGovernance({ response_max_length: 10 }));

    router.registerTaskOrigin("task-3", makeEnvelope());
    await router.routeResponse("task-3", "This is a very long response");

    const sentText = vi.mocked(inst.sendResponse).mock.calls[0]?.[1] as string;
    expect(sentText.length).toBe(10);
    expect(sentText.endsWith("...")).toBe(true);
  });

  it("does not truncate when text is within limit", async () => {
    const inst     = makeInstance();
    const registry = makeRegistry(inst);
    const router   = new ResponseRouter(registry, makeGovernance({ response_max_length: 100 }));

    router.registerTaskOrigin("task-4", makeEnvelope());
    await router.routeResponse("task-4", "Short");

    const sentText = vi.mocked(inst.sendResponse).mock.calls[0]?.[1] as string;
    expect(sentText).toBe("Short");
  });

  it("prepends task ID when include_task_id_in_response = true", async () => {
    const inst     = makeInstance();
    const registry = makeRegistry(inst);
    const router   = new ResponseRouter(registry, makeGovernance({ include_task_id_in_response: true }));

    const taskId   = "abcdef12-0000-0000-0000-000000000000";
    router.registerTaskOrigin(taskId, makeEnvelope());
    await router.routeResponse(taskId, "Response body");

    const sentText = vi.mocked(inst.sendResponse).mock.calls[0]?.[1] as string;
    expect(sentText.startsWith("[abcdef12]")).toBe(true);
    expect(sentText).toContain("Response body");
  });

  it("handles missing origin gracefully (no-op)", async () => {
    const inst     = makeInstance();
    const registry = makeRegistry(inst);
    const router   = new ResponseRouter(registry, makeGovernance());

    await expect(router.routeResponse("nonexistent-task", "Text")).resolves.toBeUndefined();
    expect(inst.sendResponse).not.toHaveBeenCalled();
  });

  it("handles missing adapter instance gracefully", async () => {
    const registry = makeRegistry(null); // no instance
    const router   = new ResponseRouter(registry, makeGovernance());

    router.registerTaskOrigin("task-5", makeEnvelope());
    await expect(router.routeResponse("task-5", "Text")).resolves.toBeUndefined();
  });

  it("cleans up origin after sending response", async () => {
    const inst     = makeInstance();
    const registry = makeRegistry(inst);
    const router   = new ResponseRouter(registry, makeGovernance());

    router.registerTaskOrigin("task-6", makeEnvelope());
    expect(router.pendingOrigins).toBe(1);
    await router.routeResponse("task-6", "Done");
    expect(router.pendingOrigins).toBe(0);
  });

  it("cleans up origin even when adapter instance is missing", async () => {
    const registry = makeRegistry(null);
    const router   = new ResponseRouter(registry, makeGovernance());

    router.registerTaskOrigin("task-7", makeEnvelope());
    await router.routeResponse("task-7", "Text");
    expect(router.pendingOrigins).toBe(0);
  });

  it("cleans up origin even when sendResponse throws", async () => {
    const inst = makeInstance();
    vi.mocked(inst.sendResponse).mockRejectedValue(new Error("network error"));
    const registry = makeRegistry(inst);
    const router   = new ResponseRouter(registry, makeGovernance());

    router.registerTaskOrigin("task-8", makeEnvelope());
    await expect(router.routeResponse("task-8", "Text")).resolves.toBeUndefined();
    expect(router.pendingOrigins).toBe(0);
  });
});

describe("ResponseRouter — response_max_length = 0 (unlimited)", () => {
  it("does not truncate when max_length is 0", async () => {
    const inst     = makeInstance();
    const registry = makeRegistry(inst);
    const router   = new ResponseRouter(registry, makeGovernance({ response_max_length: 0 }));
    const long     = "x".repeat(10_000);

    router.registerTaskOrigin("task-9", makeEnvelope());
    await router.routeResponse("task-9", long);

    const sentText = vi.mocked(inst.sendResponse).mock.calls[0]?.[1] as string;
    expect(sentText.length).toBe(10_000);
  });
});

describe("ResponseRouter — multiple origins", () => {
  it("routes each task to the correct instance", async () => {
    const inst1 = makeInstance("inst-1");
    const inst2 = makeInstance("inst-2");
    const registry: AdapterRegistry = {
      getInstance: vi.fn().mockImplementation((id: string) =>
        id === "inst-1" ? inst1 : id === "inst-2" ? inst2 : undefined,
      ),
    } as unknown as AdapterRegistry;

    const router = new ResponseRouter(registry, makeGovernance());
    router.registerTaskOrigin("task-A", makeEnvelope("inst-1", "chat-1"));
    router.registerTaskOrigin("task-B", makeEnvelope("inst-2", "chat-2"));

    await router.routeResponse("task-A", "Reply A");
    await router.routeResponse("task-B", "Reply B");

    expect(inst1.sendResponse).toHaveBeenCalledWith("chat-1", "Reply A", expect.anything());
    expect(inst2.sendResponse).toHaveBeenCalledWith("chat-2", "Reply B", expect.anything());
  });
});
