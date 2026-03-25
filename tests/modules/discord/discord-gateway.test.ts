// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import {
  DiscordGateway,
  GATEWAY_INTENTS,
  type WsLike,
  type WsFactory,
} from "../../../src/modules/discord/discord-gateway.js";
import { GatewayOpcode } from "../../../src/modules/discord/discord-types.js";

// ---------------------------------------------------------------------------
// MockWebSocket — injectable WsLike for tests
// ---------------------------------------------------------------------------

class MockWebSocket extends EventEmitter implements WsLike {
  readonly sent: unknown[] = [];
  readyState = 1; // OPEN

  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown);
  }

  close(code = 1000): void {
    this.readyState = 3;
    process.nextTick(() => {
      this.emit("close", code, Buffer.from(""));
    });
  }

  terminate(): void {
    this.readyState = 3;
    process.nextTick(() => {
      this.emit("close", 1006, Buffer.from(""));
    });
  }

  /** Helper to simulate an incoming Gateway payload. */
  simulateMessage(payload: unknown): void {
    this.emit("message", JSON.stringify(payload));
  }

  /** Helper to simulate WS open. */
  simulateOpen(): void {
    this.emit("open");
  }

  /** Helper to emit a close event synchronously. */
  simulateClose(code: number): void {
    this.readyState = 3;
    this.emit("close", code, Buffer.from(""));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopSleep = async (_ms: number): Promise<void> => undefined;

/** Flush the microtask queue N levels deep. */
async function flush(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function makeFetchGateway(url = "wss://gateway.discord.gg"): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok:   true,
    json: async () => ({ url }),
  }) as unknown as typeof fetch;
}

function helloPayload(interval = 41250): unknown {
  return { op: GatewayOpcode.Hello, d: { heartbeat_interval: interval }, s: null, t: null };
}

function readyPayload(sessionId = "sess123", resumeUrl = "wss://resume.discord.gg"): unknown {
  return {
    op: GatewayOpcode.Dispatch,
    d:  { session_id: sessionId, resume_gateway_url: resumeUrl, user: { id: "bot1", username: "TestBot" } },
    s:  1,
    t:  "READY",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DiscordGateway", () => {
  let mockWs: MockWebSocket;
  let wsFactory: WsFactory;

  beforeEach(() => {
    mockWs    = new MockWebSocket();
    wsFactory = () => mockWs;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Test 1: Connect + IDENTIFY ────────────────────────────────────────────

  it("fetches gateway URL and sends IDENTIFY after HELLO", async () => {
    const fetchFn = makeFetchGateway();
    const gateway = new DiscordGateway("mytoken", { WsFactory: wsFactory, fetchFn, sleep: noopSleep });

    await gateway.connect();
    mockWs.simulateOpen();
    mockWs.simulateMessage(helloPayload());

    expect(fetchFn).toHaveBeenCalledWith(
      "https://discord.com/api/v10/gateway/bot",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bot mytoken" }) }),
    );

    const identify = mockWs.sent.find(
      (p) => (p as { op: number }).op === GatewayOpcode.Identify,
    );
    expect(identify).toBeDefined();
    expect(identify).toMatchObject({
      op: GatewayOpcode.Identify,
      d: {
        token:   "mytoken",
        intents: GATEWAY_INTENTS,
        properties: { os: "linux", browser: "sidjua" },
      },
    });
  });

  // ── Test 2: Heartbeat loop ────────────────────────────────────────────────

  it("starts heartbeat loop at specified interval", async () => {
    vi.useFakeTimers();

    const gateway = new DiscordGateway("tok", { WsFactory: wsFactory, fetchFn: makeFetchGateway(), sleep: noopSleep });
    // Must await connect() so event handlers are registered before we emit
    // Run with fake timers; fetchFn is sync mock so this resolves immediately
    await gateway.connect();

    // Simulate open + HELLO manually
    mockWs.simulateOpen();
    mockWs.simulateMessage({ op: GatewayOpcode.Hello, d: { heartbeat_interval: 1000 }, s: null, t: null });

    const sentBefore = mockWs.sent.length;

    // Advance time by 1 interval
    vi.advanceTimersByTime(1000);

    const heartbeats = mockWs.sent.slice(sentBefore).filter(
      (p) => (p as { op: number }).op === GatewayOpcode.Heartbeat,
    );
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);

    // Also simulate ACK so next heartbeat fires
    mockWs.simulateMessage({ op: GatewayOpcode.HeartbeatACK, d: null, s: null, t: null });
    vi.advanceTimersByTime(1000);

    const totalHeartbeats = mockWs.sent.filter(
      (p) => (p as { op: number }).op === GatewayOpcode.Heartbeat,
    ).length;
    expect(totalHeartbeats).toBeGreaterThanOrEqual(2);

    vi.useRealTimers();
    gateway.disconnect();
  });

  // ── Test 3: Reconnect on code 4000 ───────────────────────────────────────

  it("reconnects with resume on close code 4000", async () => {
    const wsInstances: MockWebSocket[] = [];
    const sleepDelays: number[] = [];

    const multiFactory: WsFactory = () => {
      const ws = new MockWebSocket();
      wsInstances.push(ws);
      return ws;
    };

    const sleep = async (ms: number): Promise<void> => { sleepDelays.push(ms); };

    const gateway = new DiscordGateway("tok", {
      WsFactory: multiFactory,
      fetchFn:   makeFetchGateway(),
      sleep,
    });

    await gateway.connect(); // creates wsInstances[0]
    expect(wsInstances).toHaveLength(1);

    // Trigger close with code 4000 (RESUME code)
    wsInstances[0]!.simulateClose(4000);

    // Drain: sleep microtask + fetchGatewayUrl microtask + connect setup
    await flush();

    expect(wsInstances.length).toBeGreaterThanOrEqual(2);
    expect(sleepDelays[0]).toBe(1000); // first backoff = 1000ms

    gateway.disconnect();
  });

  // ── Test 4: Stop on code 4004 (fatal — auth failed) ──────────────────────

  it("emits error and does not reconnect on close code 4004", async () => {
    const wsInstances: MockWebSocket[] = [];
    const multiFactory: WsFactory = () => {
      const ws = new MockWebSocket();
      wsInstances.push(ws);
      return ws;
    };

    const errors: Error[] = [];
    const gateway = new DiscordGateway("badtoken", {
      WsFactory: multiFactory,
      fetchFn:   makeFetchGateway(),
      sleep:     noopSleep,
    });

    gateway.on("error", (err: Error) => errors.push(err));

    await gateway.connect();
    wsInstances[0]!.simulateClose(4004);

    await Promise.resolve();
    await Promise.resolve();

    // Only one WS should have been created (no reconnect)
    expect(wsInstances).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("4004");
  });

  // ── Test 5: Resume with session_id + sequence ─────────────────────────────

  it("sends RESUME (op 6) after reconnect when session_id is stored", async () => {
    const wsInstances: MockWebSocket[] = [];
    const multiFactory: WsFactory = () => {
      const ws = new MockWebSocket();
      wsInstances.push(ws);
      return ws;
    };

    const sleep = async (_ms: number): Promise<void> => undefined;

    const gateway = new DiscordGateway("tok", {
      WsFactory: multiFactory,
      fetchFn:   makeFetchGateway(),
      sleep,
    });

    // ── First connect ──
    await gateway.connect(); // wsInstances[0]
    wsInstances[0]!.simulateOpen();
    wsInstances[0]!.simulateMessage(helloPayload());       // → IDENTIFY sent
    wsInstances[0]!.simulateMessage(readyPayload());       // → session_id stored

    expect(gateway.isConnected()).toBe(true);

    // ── Trigger resume-eligible close ──
    wsInstances[0]!.simulateClose(4000);

    // Drain: sleep + fetchGatewayUrl + connect setup
    await flush();

    // ── Second connect (resume) ──
    expect(wsInstances.length).toBeGreaterThanOrEqual(2);
    const ws2 = wsInstances[wsInstances.length - 1]!;
    ws2.simulateOpen();
    ws2.simulateMessage(helloPayload());

    const resume = ws2.sent.find(
      (p) => (p as { op: number }).op === GatewayOpcode.Resume,
    );
    expect(resume).toBeDefined();
    expect(resume).toMatchObject({
      op: GatewayOpcode.Resume,
      d:  { token: "tok", session_id: "sess123" },
    });

    gateway.disconnect();
  });

  // ── Test 6: Exponential backoff ───────────────────────────────────────────

  it("uses exponential backoff on repeated failures", async () => {
    const wsInstances: MockWebSocket[] = [];
    const sleepDelays: number[] = [];

    const multiFactory: WsFactory = () => {
      const ws = new MockWebSocket();
      wsInstances.push(ws);
      return ws;
    };

    const sleep = async (ms: number): Promise<void> => { sleepDelays.push(ms); };

    const gateway = new DiscordGateway("tok", {
      WsFactory: multiFactory,
      fetchFn:   makeFetchGateway(),
      sleep,
    });

    await gateway.connect(); // wsInstances[0]

    // Trigger 3 consecutive failures (code 1006 = unexpected disconnect)
    wsInstances[0]!.simulateClose(1006);
    await flush();

    wsInstances[1]!.simulateClose(1006);
    await flush();

    wsInstances[2]!.simulateClose(1006);
    await flush();

    expect(sleepDelays[0]).toBe(1000);  // 1000 * 2^0
    expect(sleepDelays[1]).toBe(2000);  // 1000 * 2^1
    expect(sleepDelays[2]).toBe(4000);  // 1000 * 2^2

    gateway.disconnect();
  });
});
