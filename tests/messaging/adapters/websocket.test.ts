/**
 * V1.1 — WebSocket adapter unit tests
 *
 * Uses real ws server on random ports — no external service mocking needed.
 * Each test gets its own port via config to avoid conflicts.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { WebSocket } from "ws";
import type { MessagingAdapterPlugin, AdapterCallbacks, AdapterInstance } from "../../../src/messaging/adapter-plugin.js";

// ---------------------------------------------------------------------------
// Import adapter (no mocks needed — uses built-in ws)
// ---------------------------------------------------------------------------

async function getPlugin(): Promise<MessagingAdapterPlugin> {
  const mod = await import("../../../adapters/messaging/websocket/index.js");
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

let portCounter = 14200;
function nextPort(): number { return ++portCounter; }

function makeConfig(port: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { port, auth_mode: "none", ...overrides };
}

async function connectWs(port: number, token?: string): Promise<WebSocket> {
  const url = token ? `ws://localhost:${port}?token=${token}` : `ws://localhost:${port}`;
  const ws  = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open",  resolve);
    ws.once("error", reject);
  });
  return ws;
}

async function waitForMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

// ---------------------------------------------------------------------------
// Tests — meta
// ---------------------------------------------------------------------------

describe("WebSocket adapter — meta", () => {
  it("has correct name and channel", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.name).toBe("websocket");
    expect(plugin.meta.channel).toBe("websocket");
  });

  it("declares text and attachments capabilities", async () => {
    const plugin = await getPlugin();
    expect(plugin.meta.capabilities).toContain("text");
    expect(plugin.meta.capabilities).toContain("attachments");
  });

  it("configSchema has no required fields", async () => {
    const plugin  = await getPlugin();
    const schema  = plugin.meta.configSchema as { required?: string[] };
    expect(schema.required ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — lifecycle
// ---------------------------------------------------------------------------

describe("WebSocket adapter — lifecycle", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
  });

  it("createInstance returns AdapterInstance", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-ws", makeConfig(nextPort()), makeCallbacks());
    expect(instance.instanceId).toBe("inst-ws");
    expect(instance.channel).toBe("websocket");
  });

  it("isHealthy returns false before start", async () => {
    const plugin = await getPlugin();
    instance     = plugin.createInstance("inst-1", makeConfig(nextPort()), makeCallbacks());
    expect(instance.isHealthy()).toBe(false);
  });

  it("isHealthy returns true after start", async () => {
    const plugin = await getPlugin();
    const port   = nextPort();
    instance     = plugin.createInstance("inst-1", makeConfig(port), makeCallbacks());
    await instance.start();
    expect(instance.isHealthy()).toBe(true);
  });

  it("isHealthy returns false after stop", async () => {
    const plugin = await getPlugin();
    const port   = nextPort();
    const inst   = plugin.createInstance("inst-1", makeConfig(port), makeCallbacks());
    await inst.start();
    await inst.stop();
    expect(inst.isHealthy()).toBe(false);
    instance = null;
  });
});

// ---------------------------------------------------------------------------
// Tests — inbound messages (real WebSocket connections)
// ---------------------------------------------------------------------------

describe("WebSocket adapter — inbound messages", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
  });

  it("converts client message to MessageEnvelope", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const port      = nextPort();
    instance        = plugin.createInstance("inst-ws", makeConfig(port), callbacks);
    await instance.start();

    const ws = await connectWs(port);
    ws.send(JSON.stringify({ text: "hello from browser" }));
    await new Promise((r) => setTimeout(r, 30));
    ws.close();

    expect(callbacks.onMessage).toHaveBeenCalledOnce();
    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.instance_id).toBe("inst-ws");
    expect(env.channel).toBe("websocket");
    expect(env.content.text).toBe("hello from browser");
    expect(typeof env.metadata.chat_id).toBe("string"); // session UUID
  });

  it("ignores messages with empty text", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const port      = nextPort();
    instance        = plugin.createInstance("inst-1", makeConfig(port), callbacks);
    await instance.start();

    const ws = await connectWs(port);
    ws.send(JSON.stringify({ text: "" }));
    await new Promise((r) => setTimeout(r, 20));
    ws.close();

    expect(callbacks.onMessage).not.toHaveBeenCalled();
  });

  it("ignores malformed JSON", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const port      = nextPort();
    instance        = plugin.createInstance("inst-1", makeConfig(port), callbacks);
    await instance.start();

    const ws = await connectWs(port);
    ws.send("not-json}}}");
    await new Promise((r) => setTimeout(r, 20));
    ws.close();

    expect(callbacks.onMessage).not.toHaveBeenCalled();
  });

  it("includes reply_to and thread_id in envelope", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const port      = nextPort();
    instance        = plugin.createInstance("inst-1", makeConfig(port), callbacks);
    await instance.start();

    const ws = await connectWs(port);
    ws.send(JSON.stringify({ text: "reply message", reply_to: "orig-id", thread_id: "thread-1" }));
    await new Promise((r) => setTimeout(r, 30));
    ws.close();

    const env = vi.mocked(callbacks.onMessage).mock.calls[0]![0];
    expect(env.content.reply_to).toBe("orig-id");
    expect(env.metadata.thread_id).toBe("thread-1");
  });
});

// ---------------------------------------------------------------------------
// Tests — sendResponse
// ---------------------------------------------------------------------------

describe("WebSocket adapter — sendResponse()", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
  });

  it("sends response JSON to the correct client", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const port      = nextPort();
    instance        = plugin.createInstance("inst-1", makeConfig(port), callbacks);
    await instance.start();

    // Connect client, send a message (to get session ID), then expect response
    const ws      = await connectWs(port);
    ws.send(JSON.stringify({ text: "ping" }));

    // Wait for onMessage to be called — session ID is in chat_id
    await new Promise((r) => setTimeout(r, 30));
    const sessionId = vi.mocked(callbacks.onMessage).mock.calls[0]![0].metadata.chat_id;

    // Now send a response to that session
    const responsePromise = waitForMessage(ws);
    await instance.sendResponse(sessionId, "pong");
    const received = await responsePromise;
    ws.close();

    expect(received).toMatchObject({ type: "response", text: "pong" });
  });

  it("includes reply_to in response when set", async () => {
    const plugin    = await getPlugin();
    const callbacks = makeCallbacks();
    const port      = nextPort();
    instance        = plugin.createInstance("inst-1", makeConfig(port), callbacks);
    await instance.start();

    const ws = await connectWs(port);
    ws.send(JSON.stringify({ text: "hi" }));
    await new Promise((r) => setTimeout(r, 30));
    const sessionId = vi.mocked(callbacks.onMessage).mock.calls[0]![0].metadata.chat_id;

    const responsePromise = waitForMessage(ws);
    await instance.sendResponse(sessionId, "reply", { reply_to_message_id: "orig-42" });
    const received = await responsePromise as Record<string, unknown>;
    ws.close();

    expect(received["reply_to"]).toBe("orig-42");
  });

  it("is a no-op for unknown session ID", async () => {
    const plugin   = await getPlugin();
    const port     = nextPort();
    instance       = plugin.createInstance("inst-1", makeConfig(port), makeCallbacks());
    await instance.start();
    // Should not throw
    await expect(instance.sendResponse("nonexistent-session", "text")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — token auth
// ---------------------------------------------------------------------------

describe("WebSocket adapter — token authentication", () => {
  let instance: AdapterInstance | null = null;

  afterEach(async () => {
    await instance?.stop();
    instance = null;
  });

  it("accepts connection with correct token", async () => {
    const plugin = await getPlugin();
    const port   = nextPort();
    instance     = plugin.createInstance(
      "inst-1",
      makeConfig(port, { auth_mode: "token", auth_token: "secret123" }),
      makeCallbacks(),
    );
    await instance.start();

    const ws = await connectWs(port, "secret123");
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("rejects connection with wrong token", async () => {
    const plugin = await getPlugin();
    const port   = nextPort();
    instance     = plugin.createInstance(
      "inst-1",
      makeConfig(port, { auth_mode: "token", auth_token: "correct-token" }),
      makeCallbacks(),
    );
    await instance.start();

    const ws = new WebSocket(`ws://localhost:${port}?token=wrong-token`);
    await new Promise<void>((resolve) => {
      ws.once("close", (code) => {
        expect(code).toBe(4001);
        resolve();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — multi-instance
// ---------------------------------------------------------------------------

describe("WebSocket adapter — multiple instances", () => {
  it("two instances on different ports are independent", async () => {
    const plugin = await getPlugin();
    const portA  = nextPort();
    const portB  = nextPort();
    const cb1    = makeCallbacks();
    const cb2    = makeCallbacks();
    const instA  = plugin.createInstance("inst-A", makeConfig(portA), cb1);
    const instB  = plugin.createInstance("inst-B", makeConfig(portB), cb2);

    await instA.start();
    await instB.start();

    const wsA = await connectWs(portA);
    const wsB = await connectWs(portB);

    wsA.send(JSON.stringify({ text: "to A" }));
    wsB.send(JSON.stringify({ text: "to B" }));
    await new Promise((r) => setTimeout(r, 30));

    wsA.close();
    wsB.close();

    const envA = vi.mocked(cb1.onMessage).mock.calls[0]?.[0];
    const envB = vi.mocked(cb2.onMessage).mock.calls[0]?.[0];

    expect(envA?.content.text).toBe("to A");
    expect(envA?.instance_id).toBe("inst-A");
    expect(envB?.content.text).toBe("to B");
    expect(envB?.instance_id).toBe("inst-B");

    await instA.stop();
    await instB.stop();
  });
});
