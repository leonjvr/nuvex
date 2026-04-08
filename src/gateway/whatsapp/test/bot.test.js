/**
 * 27.5 — End-to-end smoke tests: WhatsApp gateway → brain → response.
 *
 * Strategy: mock `node-fetch` globally so no real HTTP is attempted.
 * Mock the Baileys socket for send-message assertions.
 * All tests run in the same Node.js process — no Docker required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Stub heavy Baileys / QR deps before importing bot.js ─────────────────────

vi.mock("@whiskeysockets/baileys", () => ({
  default: vi.fn(),
  DisconnectReason: { loggedOut: 401 },
  fetchLatestBaileysVersion: vi.fn(async () => ({ version: [3, 0, 0] })),
  makeCacheableSignalKeyStore: vi.fn((k) => k),
  makeInMemoryStore: vi.fn(() => ({ bind: vi.fn() })),
  useMultiFileAuthState: vi.fn(async () => ({
    state: { creds: {}, keys: {} },
    saveCreds: vi.fn(),
  })),
}));

vi.mock("qrcode-terminal", () => ({ default: { generate: vi.fn() } }));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,FAKE") },
}));
vi.mock("pino", () => ({
  default: vi.fn(() => ({
    child: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  writeFileSync: vi.fn(),
}));

// Mock node-fetch so invokeAgent doesn't hit the network
vi.mock("node-fetch", () => ({
  default: vi.fn(),
}));

import fetch from "node-fetch";
import { invokeAgent } from "../src/bot.js";

// ── 1. invokeAgent ─────────────────────────────────────────────────────────

describe("invokeAgent — WhatsApp → brain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BRAIN_URL = "http://mock-brain:8100";
    process.env.NUVEX_AGENT_ID = "maya";
  });

  it("smoke: sends correct payload and returns brain reply", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: "Hello from brain!", invocation_id: "abc-123" }),
    });

    const result = await invokeAgent("Hello bot", "maya:whatsapp:123", "123@s.whatsapp.net", "whatsapp");

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("http://mock-brain:8100/invoke");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.agent_id).toBe("maya");
    expect(body.message).toBe("Hello bot");
    expect(body.thread_id).toBe("maya:whatsapp:123");
    expect(body.metadata.channel).toBe("whatsapp");
    expect(body.metadata.sender).toBe("123@s.whatsapp.net");

    expect(result.reply).toBe("Hello from brain!");
  });

  it("smoke: group messages use 'whatsapp-group' channel", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: "Group reply" }),
    });

    const result = await invokeAgent("group msg", "maya:whatsapp:grp@g.us", "member@s.whatsapp.net", "whatsapp-group");

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.metadata.channel).toBe("whatsapp-group");
    expect(result.reply).toBe("Group reply");
  });

  it("handles brain HTTP error gracefully", async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await invokeAgent("bad request", "thread-x", "sender", "whatsapp");

    // Should return an error reply, not throw
    expect(result.reply).toMatch(/error/i);
  });

  it("handles network failure gracefully", async () => {
    fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const result = await invokeAgent("timeout test", "thread-y", "sender", "whatsapp");

    expect(result.reply).toMatch(/error/i);
  });

  it("returns empty reply when brain omits reply field", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ invocation_id: "xyz" }),  // no reply key
    });

    const result = await invokeAgent("ping", "thread-z", "s", "whatsapp");
    // invokeAgent returns whatever brain sends; reply field absent means undefined/''/missing
    expect(result.reply === "" || result.reply === undefined || result.reply === null).toBe(true);
  });
});

// ── 2. handleMessage ────────────────────────────────────────────────────────

describe("handleMessage — full message → send reply", () => {
  let sockMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.BRAIN_URL = "http://mock-brain:8100";
    process.env.NUVEX_AGENT_ID = "maya";
    process.env.WA_GROUP_POLICY = "allowlist";
    process.env.WA_DM_POLICY = "pairing";

    // Set the module-level sock via the exported setter shim
    const botMod = await import("../src/bot.js");
    sockMock = { sendMessage: vi.fn(async () => {}) };
    // Overwrite the exported sock for testing
    Object.defineProperty(botMod, "sock", { value: sockMock, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("smoke: DM message → brain invoked → reply sent", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: "DM reply from brain" }),
    });

    const { handleMessage } = await import("../src/bot.js");

    const msg = {
      key: { remoteJid: "user123@s.whatsapp.net", fromMe: false },
      message: { conversation: "Help me with X" },
    };

    await handleMessage(msg);

    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.message).toBe("Help me with X");
    expect(body.metadata.channel).toBe("whatsapp");

    expect(sockMock.sendMessage).toHaveBeenCalledOnce();
    const [jid, msgPayload] = sockMock.sendMessage.mock.calls[0];
    expect(jid).toBe("user123@s.whatsapp.net");
    expect(msgPayload.text).toBe("DM reply from brain");
  });

  it("smoke: extended text message is handled", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: "Extended reply" }),
    });

    const { handleMessage } = await import("../src/bot.js");
    const msg = {
      key: { remoteJid: "user@s.whatsapp.net", fromMe: false },
      message: { extendedTextMessage: { text: "What is 2+2?" } },
    };

    await handleMessage(msg);

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.message).toBe("What is 2+2?");
  });

  it("ignores own (fromMe) messages", async () => {
    const { handleMessage } = await import("../src/bot.js");
    const msg = {
      key: { remoteJid: "user@s.whatsapp.net", fromMe: true },
      message: { conversation: "Bot sent this" },
    };

    await handleMessage(msg);
    expect(fetch).not.toHaveBeenCalled();
    expect(sockMock.sendMessage).not.toHaveBeenCalled();
  });

  it("ignores empty messages", async () => {
    const { handleMessage } = await import("../src/bot.js");
    const msg = {
      key: { remoteJid: "user@s.whatsapp.net", fromMe: false },
      message: { conversation: "   " },
    };

    await handleMessage(msg);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("audio messages include [Audio] marker", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: "Transcribed response" }),
    });

    const { handleMessage } = await import("../src/bot.js");
    const msg = {
      key: { remoteJid: "user@s.whatsapp.net", fromMe: false },
      message: { audioMessage: {} },
    };

    await handleMessage(msg);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.message).toContain("[Audio]");
  });

  it("truncates long replies to 4096 chars", async () => {
    const longReply = "A".repeat(5000);
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: longReply }),
    });

    const { handleMessage } = await import("../src/bot.js");
    const msg = {
      key: { remoteJid: "user@s.whatsapp.net", fromMe: false },
      message: { conversation: "send long" },
    };

    await handleMessage(msg);
    const [, msgPayload] = sockMock.sendMessage.mock.calls[0];
    expect(msgPayload.text.length).toBeLessThanOrEqual(4096);
  });

  it("skips send when brain returns empty reply", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ reply: "" }),
    });

    const { handleMessage } = await import("../src/bot.js");
    const msg = {
      key: { remoteJid: "user@s.whatsapp.net", fromMe: false },
      message: { conversation: "quiet" },
    };

    await handleMessage(msg);
    expect(sockMock.sendMessage).not.toHaveBeenCalled();
  });

  it("does not throw when brain call fails", async () => {
    fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { handleMessage } = await import("../src/bot.js");
    const msg = {
      key: { remoteJid: "user@s.whatsapp.net", fromMe: false },
      message: { conversation: "brain offline" },
    };

    // Should not throw
    await expect(handleMessage(msg)).resolves.toBeUndefined();
  });
});

// ── 3. Cross-channel action polling ─────────────────────────────────────────

describe("pollAndDispatch — cross-channel action delivery", () => {
  let sockMock;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.BRAIN_URL = "http://mock-brain:8100";
    const botMod = await import("../src/bot.js");
    sockMock = { sendMessage: vi.fn(async () => {}) };
    Object.defineProperty(botMod, "sock", { value: sockMock, writable: true, configurable: true });
  });

  it("dispatches pending action and acks as sent", async () => {
    const pendingActions = [
      { id: "act-1", payload: { to: "5551234@s.whatsapp.net", text: "Cross-channel msg" } },
    ];

    // First call: get actions. Second call: ack.
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => pendingActions,
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const { pollAndDispatch } = await import("../src/bot.js");
    await pollAndDispatch();

    expect(sockMock.sendMessage).toHaveBeenCalledOnce();
    const [jid, payload] = sockMock.sendMessage.mock.calls[0];
    expect(jid).toBe("5551234@s.whatsapp.net");
    expect(payload.text).toBe("Cross-channel msg");

    // Ack should be called with status=sent
    expect(fetch).toHaveBeenCalledTimes(2);
    const ackUrl = fetch.mock.calls[1][0];
    expect(ackUrl).toContain("act-1");
    expect(ackUrl).toContain("status=sent");
  });

  it("acks as failed when payload is missing jid", async () => {
    const pendingActions = [
      { id: "act-bad", payload: { text: "No jid here" } },
    ];

    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => pendingActions })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const { pollAndDispatch } = await import("../src/bot.js");
    await pollAndDispatch();

    expect(sockMock.sendMessage).not.toHaveBeenCalled();
    const ackUrl = fetch.mock.calls[1][0];
    expect(ackUrl).toContain("status=failed");
  });

  it("handles empty actions list gracefully", async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    const { pollAndDispatch } = await import("../src/bot.js");
    await expect(pollAndDispatch()).resolves.toBeUndefined();
    expect(sockMock.sendMessage).not.toHaveBeenCalled();
  });

  it("handles brain unavailable without throwing", async () => {
    fetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { pollAndDispatch } = await import("../src/bot.js");
    await expect(pollAndDispatch()).resolves.toBeUndefined();
  });
});
