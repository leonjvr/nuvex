/**
 * V1.1 — Discord adapter unit tests
 *
 * All discord.js interactions are mocked — no real Gateway connections.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MessagingAdapterPlugin, AdapterCallbacks, AdapterInstance } from "../../../src/messaging/adapter-plugin.js";

// ---------------------------------------------------------------------------
// Mock discord.js
// ---------------------------------------------------------------------------

const mockLogin   = vi.fn().mockResolvedValue("token");
const mockDestroy = vi.fn();
const mockSend    = vi.fn().mockResolvedValue({ id: "sent-msg" });
const mockFetch   = vi.fn().mockResolvedValue({ send: mockSend });
const mockOn      = vi.fn();

class MockClient {
  ws = { status: 0 };
  channels = { fetch: mockFetch };
  on = mockOn;
  login = mockLogin;
  destroy = mockDestroy;
}

vi.mock("discord.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("discord.js")>();
  return {
    ...orig,
    Client: MockClient,
  };
});

// ---------------------------------------------------------------------------
// Import adapter after mock
// ---------------------------------------------------------------------------

async function getPlugin(): Promise<MessagingAdapterPlugin> {
  const mod = await import("../../../adapters/messaging/discord/index.js");
  return mod.default;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCallbacks(): AdapterCallbacks {
  return {
    onMessage: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockResolvedValue("mock-discord-token"),
    logger:    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never,
  };
}

function makeDiscordMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id:        "msg-111",
    content:   "hello sidjua",
    createdAt: new Date("2026-01-01T12:00:00Z"),
    channelId: "chan-999",
    guildId:   "guild-123",
    reference: null,
    author: { id: "user-42", username: "alice", displayName: "Alice", bot: false },
    channel: { isThread: () => false },
    attachments: { values: () => [] },
    ...overrides,
  };
}

/** Capture the "messageCreate" handler registered via client.on() */
function captureMessageHandler(): (msg: Record<string, unknown>) => Promise<void> {
  const calls = vi.mocked(mockOn).mock.calls;
  const entry  = calls.find((c) => c[0] === "messageCreate");
  return entry?.[1] as (msg: Record<string, unknown>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Tests — meta
// ---------------------------------------------------------------------------

describe("Discord adapter — meta", () => {
  it("has correct name and channel", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.name).toBe("discord");
    expect(plugin.meta.channel).toBe("discord");
  });

  it("declares expected capabilities", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.capabilities).toContain("text");
    expect(plugin.meta.capabilities).toContain("attachments");
    expect(plugin.meta.capabilities).toContain("threads");
    expect(plugin.meta.capabilities).toContain("rich_text");
  });

  it("configSchema requires bot_token_secret", async () => {
    const plugin = await getPlugin();
    const schema = plugin.meta.configSchema as { required?: string[] };
    expect(schema.required).toContain("bot_token_secret");
  });
});

// ---------------------------------------------------------------------------
// Tests — lifecycle
// ---------------------------------------------------------------------------

describe("Discord adapter — lifecycle", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
    vi.clearAllMocks();
    mockLogin.mockResolvedValue("token");
    mockFetch.mockResolvedValue({ send: mockSend });
  });

  it("createInstance returns AdapterInstance", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    expect(instance.instanceId).toBe("inst-1");
    expect(instance.channel).toBe("discord");
    expect(typeof instance.start).toBe("function");
  });

  it("isHealthy returns false before start", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    expect(instance.isHealthy()).toBe(false);
  });

  it("start resolves the secret and calls login", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    instance        = plugin.createInstance("inst-1", { bot_token_secret: "my-secret" }, callbacks);
    await instance.start();
    expect(callbacks.getSecret).toHaveBeenCalledWith("my-secret");
    expect(mockLogin).toHaveBeenCalledWith("mock-discord-token");
  });

  it("isHealthy returns true after start (ws.status === 0)", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.start();
    expect(instance.isHealthy()).toBe(true);
  });

  it("stop calls client.destroy and isHealthy returns false", async () => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue("token");
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.start();
    await instance.stop();
    expect(mockDestroy).toHaveBeenCalledOnce();
    expect(instance.isHealthy()).toBe(false);
    instance = null;
  });
});

// ---------------------------------------------------------------------------
// Tests — message handling
// ---------------------------------------------------------------------------

describe("Discord adapter — inbound messages", () => {
  beforeEach(() => { vi.clearAllMocks(); mockLogin.mockResolvedValue("token"); });

  it("converts Discord message to MessageEnvelope", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-disc", { bot_token_secret: "s" }, callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureMessageHandler();
    const msg     = makeDiscordMessage();
    await handler(msg);

    expect(callbacks.onMessage).toHaveBeenCalledOnce();
    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.instance_id).toBe("inst-disc");
    expect(env.channel).toBe("discord");
    expect(env.sender.platform_id).toBe("user-42");
    expect(env.sender.display_name).toBe("Alice");
    expect(env.content.text).toBe("hello sidjua");
    expect(env.metadata.chat_id).toBe("chan-999");
    expect(env.id).toBe("msg-111");
  });

  it("ignores bot messages", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "s" }, callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureMessageHandler();
    await handler(makeDiscordMessage({ author: { id: "bot-1", username: "mybot", displayName: "MyBot", bot: true } }));
    expect(callbacks.onMessage).not.toHaveBeenCalled();
  });

  it("filters by guild_ids when configured", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance(
      "inst-1",
      { bot_token_secret: "s", guild_ids: ["guild-allowed"] },
      callbacks,
    );
    await instance.start();
    await instance.stop();

    const handler = captureMessageHandler();
    // Wrong guild — should be ignored
    await handler(makeDiscordMessage({ guildId: "guild-other" }));
    expect(callbacks.onMessage).not.toHaveBeenCalled();

    // Correct guild — should pass
    await handler(makeDiscordMessage({ guildId: "guild-allowed" }));
    expect(callbacks.onMessage).toHaveBeenCalledOnce();
  });

  it("includes reply_to when message has a reference", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "s" }, callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureMessageHandler();
    await handler(makeDiscordMessage({ reference: { messageId: "orig-55" } }));

    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.content.reply_to).toBe("orig-55");
  });

  it("extracts attachments from message", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", { bot_token_secret: "s" }, callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureMessageHandler();
    const attach  = new Map([["a1", { name: "report.pdf", contentType: "application/pdf", size: 2048, url: "https://cdn.example.com/report.pdf" }]]);
    await handler(makeDiscordMessage({ attachments: { values: () => attach.values() } }));

    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.content.attachments).toHaveLength(1);
    expect(env.content.attachments![0]!.filename).toBe("report.pdf");
  });
});

// ---------------------------------------------------------------------------
// Tests — sendResponse
// ---------------------------------------------------------------------------

describe("Discord adapter — sendResponse()", () => {
  beforeEach(() => { vi.clearAllMocks(); mockLogin.mockResolvedValue("token"); mockFetch.mockResolvedValue({ send: mockSend }); });

  it("sends message to channel", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.start();
    await instance.sendResponse("chan-999", "Hello Discord");
    expect(mockFetch).toHaveBeenCalledWith("chan-999");
    expect(mockSend).toHaveBeenCalledWith({ content: "Hello Discord" });
    await instance.stop();
  });

  it("adds reply reference when reply_to_message_id is set", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.start();
    await instance.sendResponse("chan-1", "Reply", { reply_to_message_id: "orig-42" });
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ reply: { messageReference: "orig-42" } }),
    );
    await instance.stop();
  });

  it("is a no-op before start()", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    await instance.sendResponse("chan-1", "ignored");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — formatText + multi-instance
// ---------------------------------------------------------------------------

describe("Discord adapter — formatText and multi-instance", () => {
  it("formatText returns text unchanged (Discord Markdown is lenient)", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", { bot_token_secret: "s" }, makeCallbacks());
    expect(instance.formatText!("**bold** and _italic_")).toBe("**bold** and _italic_");
  });

  it("two instances with different tokens are independent", async () => {
    vi.clearAllMocks();
    mockLogin.mockResolvedValue("token");
    const plugin  = await getPlugin();
    const cb1     = makeCallbacks();
    const cb2     = makeCallbacks();
    vi.mocked(cb1.getSecret).mockResolvedValue("token-A");
    vi.mocked(cb2.getSecret).mockResolvedValue("token-B");
    const instA   = plugin.createInstance("inst-A", { bot_token_secret: "secret-A" }, cb1);
    const instB   = plugin.createInstance("inst-B", { bot_token_secret: "secret-B" }, cb2);
    await instA.start();
    await instB.start();
    expect(cb1.getSecret).toHaveBeenCalledWith("secret-A");
    expect(cb2.getSecret).toHaveBeenCalledWith("secret-B");
    await instA.stop();
    await instB.stop();
  });
});
