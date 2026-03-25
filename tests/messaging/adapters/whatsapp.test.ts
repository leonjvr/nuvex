/**
 * V1.1 — WhatsApp adapter unit tests
 *
 * baileys is mocked — no real WhatsApp connections or QR codes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MessagingAdapterPlugin, AdapterCallbacks, AdapterInstance } from "../../../src/messaging/adapter-plugin.js";

// ---------------------------------------------------------------------------
// Mock baileys
// ---------------------------------------------------------------------------

const mockSendMessage  = vi.fn().mockResolvedValue({ status: 1 });
const mockLogout       = vi.fn().mockResolvedValue(undefined);
const mockEvOn         = vi.fn();

function makeMockSock(): Record<string, unknown> {
  return {
    ev: { on: mockEvOn },
    sendMessage: mockSendMessage,
    logout: mockLogout,
  };
}

const mockMakeWASocket = vi.fn().mockImplementation(() => makeMockSock());
const mockUseMultiFileAuthState = vi.fn().mockResolvedValue({
  state:     { creds: {}, keys: {} },
  saveCreds: vi.fn(),
});

vi.mock("baileys", () => ({
  default:                   mockMakeWASocket,
  useMultiFileAuthState:     mockUseMultiFileAuthState,
  DisconnectReason:          { loggedOut: 401, connectionClosed: 428 },
}));

vi.mock("@hapi/boom", () => ({
  Boom: class MockBoom extends Error {
    output: { statusCode: number };
    constructor(msg: string, opts?: { statusCode?: number }) {
      super(msg);
      this.output = { statusCode: opts?.statusCode ?? 500 };
    }
  },
}));

// ---------------------------------------------------------------------------
// Import adapter after mocks
// ---------------------------------------------------------------------------

async function getPlugin(): Promise<MessagingAdapterPlugin> {
  const mod = await import("../../../adapters/messaging/whatsapp/index.js");
  return mod.default;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCallbacks(): AdapterCallbacks {
  return {
    onMessage: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockResolvedValue("secret"),
    logger:    { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), child: vi.fn(), startTimer: vi.fn() } as never,
  };
}

function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { auth_dir: "./test-auth", print_qr_terminal: false, ...overrides };
}

function makeWAMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: {
      id:        "msg-wa-1",
      remoteJid: "15551234567@s.whatsapp.net",
      fromMe:    false,
    },
    messageTimestamp: 1_700_000_000,
    message: { conversation: "hello from whatsapp" },
    ...overrides,
  };
}

/** Get the "messages.upsert" handler */
function captureUpsertHandler(): (args: { messages: unknown[]; type: string }) => Promise<void> {
  const calls = vi.mocked(mockEvOn).mock.calls;
  const entry  = calls.find((c) => c[0] === "messages.upsert");
  return entry?.[1] as (args: { messages: unknown[]; type: string }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Tests — meta
// ---------------------------------------------------------------------------

describe("WhatsApp adapter — meta", () => {
  it("has correct name and channel", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.name).toBe("whatsapp");
    expect(plugin.meta.channel).toBe("whatsapp");
  });

  it("declares text capability (only)", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.capabilities).toContain("text");
    expect(plugin.meta.capabilities).toContain("threads");
  });

  it("configSchema requires auth_dir", async () => {
    const plugin = await getPlugin();
    const schema = plugin.meta.configSchema as { required?: string[] };
    expect(schema.required).toContain("auth_dir");
  });
});

// ---------------------------------------------------------------------------
// Tests — lifecycle
// ---------------------------------------------------------------------------

describe("WhatsApp adapter — lifecycle", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
    vi.clearAllMocks();
    mockMakeWASocket.mockImplementation(() => makeMockSock());
    mockUseMultiFileAuthState.mockResolvedValue({ state: {}, saveCreds: vi.fn() });
    mockLogout.mockResolvedValue(undefined);
  });

  it("createInstance returns AdapterInstance", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-wa", makeConfig(), makeCallbacks());
    expect(instance.instanceId).toBe("inst-wa");
    expect(instance.channel).toBe("whatsapp");
  });

  it("isHealthy returns false before start", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    expect(instance.isHealthy()).toBe(false);
  });

  it("start calls useMultiFileAuthState and makeWASocket", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.start();
    expect(mockUseMultiFileAuthState).toHaveBeenCalledWith("./test-auth");
    expect(mockMakeWASocket).toHaveBeenCalledOnce();
  });

  it("stop attempts logout", async () => {
    vi.clearAllMocks();
    mockMakeWASocket.mockImplementation(() => makeMockSock());
    mockUseMultiFileAuthState.mockResolvedValue({ state: {}, saveCreds: vi.fn() });
    const plugin = await getPlugin();
    const inst   = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await inst.start();
    await inst.stop();
    expect(mockLogout).toHaveBeenCalledOnce();
    expect(inst.isHealthy()).toBe(false);
    instance = null;
  });
});

// ---------------------------------------------------------------------------
// Tests — message handling
// ---------------------------------------------------------------------------

describe("WhatsApp adapter — inbound messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMakeWASocket.mockImplementation(() => makeMockSock());
    mockUseMultiFileAuthState.mockResolvedValue({ state: {}, saveCreds: vi.fn() });
  });

  it("converts WhatsApp message to MessageEnvelope", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-wa", makeConfig(), callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureUpsertHandler();
    const msg     = makeWAMessage();
    await handler({ messages: [msg], type: "notify" });

    expect(callbacks.onMessage).toHaveBeenCalledOnce();
    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.instance_id).toBe("inst-wa");
    expect(env.channel).toBe("whatsapp");
    expect(env.sender.platform_id).toBe("15551234567");
    expect(env.content.text).toBe("hello from whatsapp");
    expect(env.metadata.chat_id).toBe("15551234567@s.whatsapp.net");
  });

  it("ignores own messages (fromMe = true)", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureUpsertHandler();
    await handler({ messages: [makeWAMessage({ key: { id: "x", remoteJid: "15551@s.whatsapp.net", fromMe: true } })], type: "notify" });
    expect(callbacks.onMessage).not.toHaveBeenCalled();
  });

  it("strips @s.whatsapp.net suffix from JID for platform_id", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureUpsertHandler();
    await handler({ messages: [makeWAMessage()], type: "notify" });
    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.sender.platform_id).toBe("15551234567");
    expect(env.sender.platform_id).not.toContain("@");
  });

  it("skips non-notify message types", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureUpsertHandler();
    await handler({ messages: [makeWAMessage()], type: "append" });
    expect(callbacks.onMessage).not.toHaveBeenCalled();
  });

  it("handles extended text message format", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const instance  = plugin.createInstance("inst-1", makeConfig(), callbacks);
    await instance.start();
    await instance.stop();

    const handler = captureUpsertHandler();
    const msg     = makeWAMessage({ message: { extendedTextMessage: { text: "extended text" } } });
    await handler({ messages: [msg], type: "notify" });

    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.content.text).toBe("extended text");
  });
});

// ---------------------------------------------------------------------------
// Tests — sendResponse
// ---------------------------------------------------------------------------

describe("WhatsApp adapter — sendResponse()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMakeWASocket.mockImplementation(() => makeMockSock());
    mockUseMultiFileAuthState.mockResolvedValue({ state: {}, saveCreds: vi.fn() });
  });

  it("sends text message", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.start();
    await instance.sendResponse("15551234567@s.whatsapp.net", "Hello WA");
    expect(mockSendMessage).toHaveBeenCalledWith(
      "15551234567@s.whatsapp.net",
      expect.objectContaining({ text: "Hello WA" }),
    );
    await instance.stop();
  });

  it("includes contextInfo for quoted reply", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.start();
    await instance.sendResponse("jid@s.whatsapp.net", "Reply", { reply_to_message_id: "quoted-id" });
    expect(mockSendMessage).toHaveBeenCalledWith(
      "jid@s.whatsapp.net",
      expect.objectContaining({ contextInfo: { stanzaId: "quoted-id" } }),
    );
    await instance.stop();
  });

  it("is a no-op before start()", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    await instance.sendResponse("jid", "ignored");
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — formatText + multi-instance
// ---------------------------------------------------------------------------

describe("WhatsApp adapter — formatText and multi-instance", () => {
  it("formatText returns text as-is", async () => {
    const plugin   = await getPlugin();
    const instance = plugin.createInstance("inst-1", makeConfig(), makeCallbacks());
    expect(instance.formatText!("*bold* _italic_")).toBe("*bold* _italic_");
  });

  it("two instances with different auth_dirs are independent", async () => {
    vi.clearAllMocks();
    mockMakeWASocket.mockImplementation(() => makeMockSock());
    mockUseMultiFileAuthState.mockResolvedValue({ state: {}, saveCreds: vi.fn() });
    const plugin  = await getPlugin();
    const instA   = plugin.createInstance("inst-A", makeConfig({ auth_dir: "./auth-A" }), makeCallbacks());
    const instB   = plugin.createInstance("inst-B", makeConfig({ auth_dir: "./auth-B" }), makeCallbacks());
    await instA.start();
    await instB.start();
    // Each should call useMultiFileAuthState with its own dir
    const calls = vi.mocked(mockUseMultiFileAuthState).mock.calls;
    const dirs  = calls.map((c) => c[0]);
    expect(dirs).toContain("./auth-A");
    expect(dirs).toContain("./auth-B");
    await instA.stop();
    await instB.stop();
  });
});
