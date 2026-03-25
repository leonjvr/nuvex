/**
 * V1.1 — Telegram adapter unit tests
 *
 * All external dependencies (telegraf) are mocked — no real API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MessagingAdapterPlugin, AdapterCallbacks } from "../../../src/messaging/adapter-plugin.js";

// ---------------------------------------------------------------------------
// Mock telegraf before importing the adapter
// ---------------------------------------------------------------------------

const mockSendMessage  = vi.fn().mockResolvedValue({ message_id: 99 });
const mockLaunch       = vi.fn().mockResolvedValue(undefined);
const mockStop         = vi.fn();
const mockOn           = vi.fn();

class MockTelegraf {
  telegram = { sendMessage: mockSendMessage };
  on       = mockOn;
  launch   = mockLaunch;
  stop     = mockStop;
}

vi.mock("telegraf", () => ({
  Telegraf: MockTelegraf,
}));

// ---------------------------------------------------------------------------
// Import adapter (after mock registration)
// ---------------------------------------------------------------------------

// Dynamic import so mock is in place before module loads
async function getPlugin(): Promise<MessagingAdapterPlugin> {
  const mod = await import("../../../adapters/messaging/telegram/index.js");
  return mod.default;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCallbacks(overrides: Partial<AdapterCallbacks> = {}): AdapterCallbacks {
  return {
    onMessage: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockResolvedValue("test-token-123"),
    logger:    {
      info:        vi.fn(),
      warn:        vi.fn(),
      error:       vi.fn(),
      debug:       vi.fn(),
      fatal:       vi.fn(),
      child:       vi.fn(),
      startTimer:  vi.fn(),
    } as never,
    ...overrides,
  };
}

function makeTelegramMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message_id: 42,
    date:       1_700_000_000,
    text:       "hello sidjua",
    from: {
      id:         12345,
      first_name: "Alice",
      last_name:  "Smith",
    },
    chat: { id: -100_999 },
    ...overrides,
  };
}

// Simulate telegraf's bot.on("message", handler) capturing
function captureHandler(): (ctx: Record<string, unknown>) => Promise<void> {
  const calls = vi.mocked(mockOn).mock.calls;
  const last  = calls[calls.length - 1];
  return last?.[1] as (ctx: Record<string, unknown>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Tests — meta
// ---------------------------------------------------------------------------

describe("Telegram adapter — meta", () => {
  it("has correct name and channel", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.name).toBe("telegram");
    expect(plugin.meta.channel).toBe("telegram");
  });

  it("declares expected capabilities", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.capabilities).toContain("text");
    expect(plugin.meta.capabilities).toContain("attachments");
    expect(plugin.meta.capabilities).toContain("threads");
    expect(plugin.meta.capabilities).toContain("rich_text");
    expect(plugin.meta.capabilities).toContain("typing");
  });

  it("has valid configSchema requiring bot_token_secret", async () => {
    const plugin = await getPlugin();
    const schema = plugin.meta.configSchema as { required?: string[] };
    expect(schema.required).toContain("bot_token_secret");
  });
});

// ---------------------------------------------------------------------------
// Tests — instance creation
// ---------------------------------------------------------------------------

describe("Telegram adapter — createInstance()", () => {
  it("returns AdapterInstance with all required methods", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "my-secret" }, makeCallbacks());
    expect(typeof instance.start).toBe("function");
    expect(typeof instance.stop).toBe("function");
    expect(typeof instance.sendResponse).toBe("function");
    expect(typeof instance.isHealthy).toBe("function");
    expect(instance.instanceId).toBe("inst-1");
    expect(instance.channel).toBe("telegram");
  });

  it("isHealthy returns false before start", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    expect(instance.isHealthy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — start / stop
// ---------------------------------------------------------------------------

describe("Telegram adapter — start()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunch.mockResolvedValue(undefined);
  });

  it("resolves secret and launches bot", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "tg-secret" }, callbacks);

    await instance.start();

    expect(callbacks.getSecret).toHaveBeenCalledWith("tg-secret");
    expect(mockLaunch).toHaveBeenCalledWith({ dropPendingUpdates: true });
  });

  it("isHealthy returns true after start", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.start();
    expect(instance.isHealthy()).toBe(true);
  });

  it("passes drop_pending_updates=false from config", async () => {
    vi.clearAllMocks();
    const plugin   = await getPlugin();
    const instance = plugin.createInstance(
      "inst-1",
      { bot_token_secret: "s", drop_pending_updates: false },
      makeCallbacks(),
    );
    await instance.start();
    expect(mockLaunch).toHaveBeenCalledWith({ dropPendingUpdates: false });
  });
});

describe("Telegram adapter — stop()", () => {
  it("calls bot.stop and isHealthy returns false", async () => {
    vi.clearAllMocks();
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.start();
    await instance.stop();
    expect(mockStop).toHaveBeenCalledWith("SIGTERM");
    expect(instance.isHealthy()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — message handling (toEnvelope)
// ---------------------------------------------------------------------------

describe("Telegram adapter — inbound message handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLaunch.mockResolvedValue(undefined);
  });

  it("converts telegram message to MessageEnvelope", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-42", { bot_token_secret: "s" }, callbacks);
    await instance.start();

    const handler = captureHandler();
    const msg     = makeTelegramMessage();
    await handler({ message: msg });

    expect(callbacks.onMessage).toHaveBeenCalledOnce();
    const envelope = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(envelope.instance_id).toBe("inst-42");
    expect(envelope.channel).toBe("telegram");
    expect(envelope.sender.platform_id).toBe("12345");
    expect(envelope.sender.display_name).toBe("Alice Smith");
    expect(envelope.content.text).toBe("hello sidjua");
    expect(envelope.metadata.chat_id).toBe("-100999");
    expect(envelope.id).toBe("42");
  });

  it("ignores non-text messages (returns null)", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "s" }, callbacks);
    await instance.start();

    const handler = captureHandler();
    // Voice message — no 'text' field
    await handler({ message: { message_id: 1, date: 0, from: { id: 1 }, chat: { id: 1 }, voice: {} } });
    expect(callbacks.onMessage).not.toHaveBeenCalled();
  });

  it("sets reply_to when message is a reply", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "s" }, callbacks);
    await instance.start();

    const handler = captureHandler();
    const msg     = makeTelegramMessage({ reply_to_message: { message_id: 7 } });
    await handler({ message: msg });

    const envelope = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(envelope.content.reply_to).toBe("7");
  });
});

// ---------------------------------------------------------------------------
// Tests — attachment extraction
// ---------------------------------------------------------------------------

describe("Telegram adapter — attachments", () => {
  beforeEach(() => { vi.clearAllMocks(); mockLaunch.mockResolvedValue(undefined); });

  it("extracts document attachments", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "s" }, callbacks);
    await instance.start();

    const handler = captureHandler();
    const msg     = makeTelegramMessage({
      document: { file_name: "report.pdf", mime_type: "application/pdf", file_size: 1024 },
    });
    await handler({ message: msg });

    const envelope = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(envelope.content.attachments).toHaveLength(1);
    expect(envelope.content.attachments![0]!.filename).toBe("report.pdf");
    expect(envelope.content.attachments![0]!.mime_type).toBe("application/pdf");
  });

  it("extracts largest photo", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "s" }, callbacks);
    await instance.start();

    const handler = captureHandler();
    const msg     = makeTelegramMessage({
      photo: [
        { file_id: "a", file_size: 500 },
        { file_id: "b", file_size: 2000 },
      ],
    });
    await handler({ message: msg });

    const envelope = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(envelope.content.attachments).toHaveLength(1);
    expect(envelope.content.attachments![0]!.filename).toBe("photo.jpg");
    expect(envelope.content.attachments![0]!.size_bytes).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// Tests — sendResponse
// ---------------------------------------------------------------------------

describe("Telegram adapter — sendResponse()", () => {
  beforeEach(() => { vi.clearAllMocks(); mockLaunch.mockResolvedValue(undefined); });

  it("sends plain text message", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.start();

    await instance.sendResponse("chat-123", "Hello there");
    expect(mockSendMessage).toHaveBeenCalledWith("chat-123", "Hello there", {});
  });

  it("applies reply_parameters when reply_to_message_id is set", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.start();

    await instance.sendResponse("chat-1", "Reply", { reply_to_message_id: "55" });
    expect(mockSendMessage).toHaveBeenCalledWith(
      "chat-1",
      "Reply",
      expect.objectContaining({ reply_parameters: { message_id: 55 } }),
    );
  });

  it("applies MarkdownV2 parse_mode and escapes text", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.start();

    await instance.sendResponse("chat-1", "Hello_world", { format: "markdown" });
    const [, sentText, opts] = mockSendMessage.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(opts["parse_mode"]).toBe("MarkdownV2");
    expect(sentText).toBe("Hello\\_world");
  });

  it("is a no-op before start() is called", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.sendResponse("chat-1", "ignored");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — formatText
// ---------------------------------------------------------------------------

describe("Telegram adapter — formatText()", () => {
  it("escapes all MarkdownV2 special characters", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    const result   = instance.formatText!("Hello_world. (test) *bold* [link]");
    expect(result).toBe("Hello\\_world\\. \\(test\\) \\*bold\\* \\[link\\]");
  });
});

// ---------------------------------------------------------------------------
// Tests — multi-instance independence
// ---------------------------------------------------------------------------

describe("Telegram adapter — multiple instances", () => {
  it("two instances with different configs are independent", async () => {
    vi.clearAllMocks();
    mockLaunch.mockResolvedValue(undefined);

    const plugin  = await getPlugin();
    const cb1     = makeCallbacks({ getSecret: vi.fn().mockResolvedValue("token-A") });
    const cb2     = makeCallbacks({ getSecret: vi.fn().mockResolvedValue("token-B") });
    const instA   = plugin.createInstance("inst-A", { bot_token_secret: "secret-A" }, cb1);
    const instB   = plugin.createInstance("inst-B", { bot_token_secret: "secret-B" }, cb2);

    await instA.start();
    await instB.start();

    expect(cb1.getSecret).toHaveBeenCalledWith("secret-A");
    expect(cb2.getSecret).toHaveBeenCalledWith("secret-B");
    expect(instA.instanceId).toBe("inst-A");
    expect(instB.instanceId).toBe("inst-B");
  });
});
