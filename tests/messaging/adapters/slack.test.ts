/**
 * V1.1 — Slack adapter unit tests
 *
 * All @slack/bolt interactions are mocked — no real Slack connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MessagingAdapterPlugin, AdapterCallbacks, AdapterInstance } from "../../../src/messaging/adapter-plugin.js";

// ---------------------------------------------------------------------------
// Mock @slack/bolt
// ---------------------------------------------------------------------------

const mockAppStart   = vi.fn().mockResolvedValue(undefined);
const mockAppStop    = vi.fn().mockResolvedValue(undefined);
const mockPostMsg    = vi.fn().mockResolvedValue({ ok: true });
const mockAppMessage = vi.fn();
const mockAppEvent   = vi.fn();

class MockApp {
  client = { chat: { postMessage: mockPostMsg } };
  message = mockAppMessage;
  event   = mockAppEvent;
  start   = mockAppStart;
  stop    = mockAppStop;
}

vi.mock("@slack/bolt", () => ({
  App: MockApp,
}));

// ---------------------------------------------------------------------------
// Import adapter after mock
// ---------------------------------------------------------------------------

async function getPlugin(): Promise<MessagingAdapterPlugin> {
  const mod = await import("../../../adapters/messaging/slack/index.js");
  return mod.default;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCallbacks(): AdapterCallbacks {
  return {
    onMessage: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockImplementation(async (k: string) => `resolved-${k}`),
    logger:    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never,
  };
}

function makeSlackMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type:    "message",
    ts:      "1234567890.000100",
    channel: "C12345",
    user:    "U99999",
    text:    "hello from slack",
    ...overrides,
  };
}

/** Capture the message handler registered via app.message() */
function captureMessageHandler(): (args: { event: Record<string, unknown> }) => Promise<void> {
  return vi.mocked(mockAppMessage).mock.calls[0]?.[0] as (args: { event: Record<string, unknown> }) => Promise<void>;
}

/** Capture the app_mention handler registered via app.event() */
function captureMentionHandler(): (args: { event: Record<string, unknown> }) => Promise<void> {
  return vi.mocked(mockAppEvent).mock.calls[0]?.[1] as (args: { event: Record<string, unknown> }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Tests — meta
// ---------------------------------------------------------------------------

describe("Slack adapter — meta", () => {
  it("has correct name and channel", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.name).toBe("slack");
    expect(plugin.meta.channel).toBe("slack");
  });

  it("declares expected capabilities", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.capabilities).toContain("text");
    expect(plugin.meta.capabilities).toContain("attachments");
    expect(plugin.meta.capabilities).toContain("threads");
    expect(plugin.meta.capabilities).toContain("typing");
  });

  it("configSchema requires bot_token_secret and app_token_secret", async () => {
    const plugin = await getPlugin();
    const schema = plugin.meta.configSchema as { required?: string[] };
    expect(schema.required).toContain("bot_token_secret");
    expect(schema.required).toContain("app_token_secret");
  });
});

// ---------------------------------------------------------------------------
// Tests — lifecycle
// ---------------------------------------------------------------------------

describe("Slack adapter — lifecycle", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
    vi.clearAllMocks();
    mockAppStart.mockResolvedValue(undefined);
    mockAppStop.mockResolvedValue(undefined);
  });

  it("createInstance returns AdapterInstance", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, makeCallbacks());
    expect(instance.instanceId).toBe("inst-1");
    expect(instance.channel).toBe("slack");
  });

  it("isHealthy is false before start", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, makeCallbacks());
    expect(instance.isHealthy()).toBe(false);
  });

  it("start resolves both secrets and calls app.start()", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    instance        = plugin.createInstance(
      "inst-1",
      { bot_token_secret: "bot-key", app_token_secret: "app-key" },
      callbacks,
    );
    await instance.start();
    expect(callbacks.getSecret).toHaveBeenCalledWith("bot-key");
    expect(callbacks.getSecret).toHaveBeenCalledWith("app-key");
    expect(mockAppStart).toHaveBeenCalledOnce();
  });

  it("isHealthy returns true after start", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, makeCallbacks());
    await instance.start();
    expect(instance.isHealthy()).toBe(true);
  });

  it("stop calls app.stop() and isHealthy returns false", async () => {
    vi.clearAllMocks();
    mockAppStart.mockResolvedValue(undefined);
    mockAppStop.mockResolvedValue(undefined);
    const plugin = await getPlugin();
    const inst   = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, makeCallbacks());
    await inst.start();
    await inst.stop();
    expect(mockAppStop).toHaveBeenCalledOnce();
    expect(inst.isHealthy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — message handling
// ---------------------------------------------------------------------------

describe("Slack adapter — inbound messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppStart.mockResolvedValue(undefined);
  });

  it("converts Slack message to MessageEnvelope", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-sl", { bot_token_secret: "b", app_token_secret: "a" }, callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureMessageHandler();
    await handler({ event: makeSlackMessage() });

    expect(callbacks.onMessage).toHaveBeenCalledOnce();
    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.instance_id).toBe("inst-sl");
    expect(env.channel).toBe("slack");
    expect(env.sender.platform_id).toBe("U99999");
    expect(env.content.text).toBe("hello from slack");
    expect(env.metadata.chat_id).toBe("C12345");
    expect(env.id).toBe("1234567890.000100");
  });

  it("filters out system messages (subtype present)", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureMessageHandler();
    await handler({ event: makeSlackMessage({ subtype: "bot_message" }) });
    expect(callbacks.onMessage).not.toHaveBeenCalled();
  });

  it("preserves thread_ts as thread_id", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureMessageHandler();
    await handler({ event: makeSlackMessage({ thread_ts: "1234567890.000001" }) });
    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.metadata.thread_id).toBe("1234567890.000001");
  });

  it("strips <@BOT_ID> from app_mention text", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, callbacks);
    await instance.start();
    await instance.stop();

    const mentionHandler = captureMentionHandler();
    await mentionHandler({
      event: {
        type:    "app_mention",
        text:    "<@U0BOTID> what is the weather?",
        ts:      "1234567890.000200",
        user:    "U88888",
        channel: "C55555",
      },
    });
    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.content.text).toBe("what is the weather?");
  });

  it("includes file attachments", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureMessageHandler();
    await handler({
      event: makeSlackMessage({
        files: [{ name: "data.csv", mimetype: "text/csv", size: 4096, url_private: "https://files.slack.com/data.csv" }],
      }),
    });
    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.content.attachments).toHaveLength(1);
    expect(env.content.attachments![0]!.filename).toBe("data.csv");
    expect(env.content.attachments![0]!.url).toBe("https://files.slack.com/data.csv");
  });
});

// ---------------------------------------------------------------------------
// Tests — sendResponse
// ---------------------------------------------------------------------------

describe("Slack adapter — sendResponse()", () => {
  beforeEach(() => { vi.clearAllMocks(); mockAppStart.mockResolvedValue(undefined); });

  it("posts message to channel", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, makeCallbacks());
    await instance.start();
    await instance.sendResponse("C12345", "Hello Slack");
    expect(mockPostMsg).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "C12345", text: "Hello Slack" }),
    );
    await instance.stop();
  });

  it("includes thread_ts for reply threading", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, makeCallbacks());
    await instance.start();
    await instance.sendResponse("C12345", "Reply", { reply_to_message_id: "1234567890.000100" });
    expect(mockPostMsg).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: "1234567890.000100" }),
    );
    await instance.stop();
  });

  it("is a no-op before start()", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, makeCallbacks());
    await instance.sendResponse("C12345", "ignored");
    expect(mockPostMsg).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — formatText + multi-instance
// ---------------------------------------------------------------------------

describe("Slack adapter — formatText and multi-instance", () => {
  it("formatText returns text unchanged", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "b", app_token_secret: "a" }, makeCallbacks());
    expect(instance.formatText!("*bold* text")).toBe("*bold* text");
  });

  it("two instances with different workspaces are independent", async () => {
    vi.clearAllMocks();
    mockAppStart.mockResolvedValue(undefined);
    const plugin  = await getPlugin();
    const cb1     = makeCallbacks();
    const cb2     = makeCallbacks();
    const instA   = plugin.createInstance("inst-A", { bot_token_secret: "bot-A", app_token_secret: "app-A" }, cb1);
    const instB   = plugin.createInstance("inst-B", { bot_token_secret: "bot-B", app_token_secret: "app-B" }, cb2);
    await instA.start();
    await instB.start();
    expect(cb1.getSecret).toHaveBeenCalledWith("bot-A");
    expect(cb2.getSecret).toHaveBeenCalledWith("bot-B");
    await instA.stop();
    await instB.stop();
  });
});
