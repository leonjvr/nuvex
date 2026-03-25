// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA Discord Module — Gateway Client
 *
 * Manages a Discord Gateway v10 WebSocket connection.
 * Extends EventEmitter — emits 'message', 'ready', 'error'.
 *
 * Design: WebSocket is injected via WsFactory for testability.
 * The gateway-daemon.ts provides the real ws package factory.
 *
 * Connection flow:
 * 1. GET /gateway/bot → wss URL
 * 2. Connect WebSocket ?v=10&encoding=json
 * 3. Receive HELLO (op 10) → start heartbeat, send IDENTIFY
 * 4. Receive READY (op 0) → emit 'ready', store session_id
 * 5. Receive MESSAGE_CREATE (op 0) → emit 'message'
 *
 * Reconnect logic:
 * - Fatal (4004): stop, emit error
 * - Resume codes (4000-4003, 4005, 4007, 4009): reconnect with RESUME
 * - Fresh codes (4010-4014): reconnect with fresh IDENTIFY
 * - Other codes: exponential backoff (1s, 2s, 4s … max 60s)
 *
 * Required intents: GUILDS(1) | GUILD_MESSAGES(512) | MESSAGE_CONTENT(32768) = 33281
 * NOTE: MESSAGE_CONTENT is a privileged intent — must be enabled in Developer Portal.
 */

import { EventEmitter }    from "node:events";
import { createRequire }   from "node:module";
import {
  GatewayOpcode,
  type GatewayPayload,
  type HelloData,
  type ReadyData,
  type GatewayMessage,
} from "./discord-types.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("discord-gateway");


const DISCORD_GATEWAY_API = "https://discord.com/api/v10";
const _require            = createRequire(import.meta.url);

/**
 * Required Gateway intents bitfield:
 * GUILDS (1 << 0) = 1
 * GUILD_MESSAGES (1 << 9) = 512
 * MESSAGE_CONTENT (1 << 15) = 32768
 * Total = 33281
 */
export const GATEWAY_INTENTS = 33281;

/** Maximum time to wait for WebSocket "open" event before aborting (ms). */
const GATEWAY_CONNECT_TIMEOUT_MS = 30_000;

/** Close codes that trigger reconnect with resume */
const RESUME_CODES = new Set([4000, 4001, 4002, 4003, 4005, 4007, 4009]);

/** Close codes that abort permanently */
const FATAL_CODES = new Set([4004]);

/** Close codes that trigger fresh IDENTIFY (drop session) */
const FRESH_CODES = new Set([4010, 4011, 4012, 4013, 4014]);


/** Minimal WebSocket interface required by the gateway. */
export interface WsLike {
  on(event: "open",    handler: () => void): this;
  on(event: "message", handler: (data: string | Buffer) => void): this;
  on(event: "close",   handler: (code: number, reason: Buffer) => void): this;
  on(event: "error",   handler: (err: Error) => void): this;
  send(data: string): void;
  close(code?: number): void;
  terminate(): void;
  readonly readyState: number;
}

/** Factory that creates a WsLike connection to the given URL. */
export type WsFactory = (url: string) => WsLike;


export interface DiscordGatewayOptions {
  WsFactory?: WsFactory;
  fetchFn?:   typeof fetch;
  sleep?:     (ms: number) => Promise<void>;
}


export class DiscordGateway extends EventEmitter {
  private ws:                   WsLike | null = null;
  private sessionId:            string | null = null;
  private resumeGatewayUrl:     string | null = null;
  private sequence:             number | null = null;
  private heartbeatTimer:       NodeJS.Timeout | null = null;
  private heartbeatAckReceived: boolean = true;
  private reconnectAttempts:    number  = 0;
  private shouldReconnect:      boolean = true;
  private _connected:           boolean = false;

  private readonly fetchFn:   typeof fetch;
  private readonly wsFactory: WsFactory;
  private readonly sleepFn:   (ms: number) => Promise<void>;

  constructor(
    private readonly token: string,
    opts?: DiscordGatewayOptions,
  ) {
    super();
    this.fetchFn   = opts?.fetchFn   ?? fetch;
    this.sleepFn   = opts?.sleep     ?? defaultSleep;
    this.wsFactory = opts?.WsFactory ?? makeDefaultWsFactory();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    const baseUrl = this.resumeGatewayUrl ?? await this.fetchGatewayUrl();
    const wsUrl   = `${baseUrl}?v=10&encoding=json`;
    const ws      = this.wsFactory(wsUrl);
    this.ws       = ws;

    // Connection timeout — terminate if the WebSocket does not open in time.
    const connectTimer = setTimeout(() => {
      logger.warn("gateway_connect_timeout", "WebSocket connection timed out — terminating", {});
      ws.terminate();
    }, GATEWAY_CONNECT_TIMEOUT_MS);

    ws.on("open", () => {
      clearTimeout(connectTimer);
      this.reconnectAttempts = 0;
    });

    ws.on("message", (raw: string | Buffer) => {
      const text = typeof raw === "string" ? raw : raw.toString("utf8");
      let payload: GatewayPayload;
      try {
        payload = JSON.parse(text) as GatewayPayload;
      } catch (e: unknown) {
        logger.debug("discord-gateway", "Malformed gateway payload — skipping event", { metadata: { error: e instanceof Error ? e.message : String(e) } });
        return;
      }
      this.handlePayload(payload);
    });

    ws.on("close", (code: number) => {
      this._connected = false;
      this.stopHeartbeat();

      if (FATAL_CODES.has(code)) {
        this.shouldReconnect = false;
        this.emit("error", new Error(`Discord Gateway fatal close code ${code} (authentication failed)`));
        return;
      }

      if (FRESH_CODES.has(code)) {
        this.sessionId        = null;
        this.sequence         = null;
        this.resumeGatewayUrl = null;
      }

      if (this.shouldReconnect) {
        void this.reconnectWithBackoff();
      }
    });

    ws.on("error", (err: Error) => {
      this.emit("error", err);
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopHeartbeat();
    this.ws?.close(1000);
    this.ws         = null;
    this._connected = false;
  }

  isConnected(): boolean {
    return this._connected;
  }

  // ── Payload handling ──────────────────────────────────────────────────────

  private handlePayload(payload: GatewayPayload): void {
    if (payload.s !== null && payload.s !== undefined) {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case GatewayOpcode.Hello: {
        const hello = payload.d as HelloData;
        this.startHeartbeat(hello.heartbeat_interval);
        if (this.sessionId !== null && this.sequence !== null) {
          this.sendResume();
        } else {
          this.sendIdentify();
        }
        break;
      }

      case GatewayOpcode.HeartbeatACK: {
        this.heartbeatAckReceived = true;
        break;
      }

      case GatewayOpcode.Heartbeat: {
        this.sendHeartbeat();
        break;
      }

      case GatewayOpcode.Reconnect: {
        this.ws?.terminate();
        break;
      }

      case GatewayOpcode.InvalidSession: {
        const resumable = payload.d as boolean;
        if (!resumable) {
          this.sessionId        = null;
          this.sequence         = null;
          this.resumeGatewayUrl = null;
        }
        const delay = 1_000 + Math.random() * 4_000;
        void this.sleepFn(delay).then(() => {
          if (this.shouldReconnect) void this.connect();
        });
        break;
      }

      case GatewayOpcode.Dispatch: {
        if (payload.t !== null && payload.t !== undefined) {
          this.handleDispatch(payload.t, payload.d);
        }
        break;
      }

      default:
        break;
    }
  }

  private handleDispatch(event: string, data: unknown): void {
    if (event === "READY") {
      const ready           = data as ReadyData;
      this.sessionId        = ready.session_id;
      this.resumeGatewayUrl = ready.resume_gateway_url;
      this._connected       = true;
      this.emit("ready");
    } else if (event === "MESSAGE_CREATE") {
      this.emit("message", data as GatewayMessage);
    }
    this.emit("dispatch", event, data);
  }

  // ── Sending ───────────────────────────────────────────────────────────────

  private sendIdentify(): void {
    this.sendPayload({
      op: GatewayOpcode.Identify,
      d: {
        token:   this.token,
        intents: GATEWAY_INTENTS,
        properties: {
          os:      "linux",
          browser: "sidjua",
          device:  "sidjua",
        },
      },
    });
  }

  private sendResume(): void {
    this.sendPayload({
      op: GatewayOpcode.Resume,
      d: {
        token:      this.token,
        session_id: this.sessionId,
        seq:        this.sequence,
      },
    });
  }

  private sendHeartbeat(): void {
    this.sendPayload({ op: GatewayOpcode.Heartbeat, d: this.sequence });
  }

  private sendPayload(payload: unknown): void {
    this.ws?.send(JSON.stringify(payload));
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.heartbeatAckReceived = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.heartbeatAckReceived) {
        this.ws?.terminate();
        return;
      }
      this.heartbeatAckReceived = false;
      this.sendHeartbeat();
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // ── Reconnect ─────────────────────────────────────────────────────────────

  private async reconnectWithBackoff(): Promise<void> {
    const delay = Math.min(1_000 * Math.pow(2, this.reconnectAttempts), 60_000);
    this.reconnectAttempts++;
    await this.sleepFn(delay);
    if (this.shouldReconnect) {
      await this.connect();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async fetchGatewayUrl(): Promise<string> {
    const res = await this.fetchFn(`${DISCORD_GATEWAY_API}/gateway/bot`, {
      headers: {
        Authorization: `Bot ${this.token}`,
        "User-Agent":  "SIDJUA (https://sidjua.io, v1)",
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Gateway URL: HTTP ${res.status}`);
    }
    const body = await res.json() as { url: string };
    return body.url;
  }
}


function makeDefaultWsFactory(): WsFactory {
  let WsClass: (new (url: string) => WsLike) | null = null;
  return (url: string): WsLike => {
    if (WsClass === null) {
      const mod = _require("ws") as
        | { default: new (url: string) => WsLike }
        | (new (url: string) => WsLike);
      WsClass = typeof mod === "function"
        ? (mod as new (url: string) => WsLike)
        : (mod as { default: new (url: string) => WsLike }).default;
    }
    return new WsClass(url);
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
