// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * SIDJUA — V1.1: WebSocket Messaging Adapter
 *
 * Implements MessagingAdapterPlugin as a standalone WebSocket server.
 * Designed for GUI (PWA) integration, custom scripts, and automation.
 *
 * JSON message protocol (client → server):
 *   { "text": "...", "attachments"?: [...], "reply_to"?: "id", "thread_id"?: "..." }
 *
 * JSON response protocol (server → client):
 *   { "type": "response", "text": "...", "reply_to"?: "...", "format"?: "..." }
 *
 * Auth: URL query param ?token=<session_token> (configurable, can be disabled)
 */

import { WebSocketServer, WebSocket, type RawData } from "ws";
import { parse as parseUrl } from "node:url";
import { randomUUID } from "node:crypto";
import type {
  MessagingAdapterPlugin,
  AdapterInstance,
  AdapterCallbacks,
  MessageEnvelope,
  ResponseOptions,
} from "../../../src/messaging/adapter-plugin.js";
import configSchema from "./config.schema.json" assert { type: "json" };

// ---------------------------------------------------------------------------
// Protocol types
// ---------------------------------------------------------------------------

interface InboundWsMessage {
  text:         string;
  attachments?: Array<{ filename: string; mime_type: string; size_bytes: number; url?: string }>;
  reply_to?:    string;
  thread_id?:   string;
}

interface OutboundWsMessage {
  type:      "response";
  text:      string;
  reply_to?: string;
  format?:   string;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: MessagingAdapterPlugin = {
  meta: {
    name:         "websocket",
    version:      "1.0.0",
    description:  "WebSocket adapter for GUI (PWA) and custom client integration",
    channel:      "websocket",
    configSchema,
    capabilities: ["text", "attachments"],
  },

  createInstance(instanceId: string, config: Record<string, unknown>, callbacks: AdapterCallbacks): AdapterInstance {
    let wss:     WebSocketServer | null                 = null;
    let running: boolean                                = false;
    const clients = new Map<string, WebSocket>();

    const port     = typeof config["port"] === "number" ? config["port"] : 4201;
    const authMode = typeof config["auth_mode"] === "string" ? config["auth_mode"] : "token";
    const token    = typeof config["auth_token"] === "string" ? config["auth_token"] : "";

    return {
      instanceId,
      channel: "websocket",

      async start(): Promise<void> {
        wss = new WebSocketServer({ port });

        wss.on("connection", (ws: WebSocket, req) => {
          // Auth check
          if (authMode === "token") {
            const qs = parseUrl(req.url ?? "").query ?? "";
            const params = new URLSearchParams(typeof qs === "string" ? qs : "");
            const provided = params.get("token") ?? "";
            if (token !== "" && provided !== token) {
              ws.close(4001, "Unauthorized");
              return;
            }
          }

          const sessionId = randomUUID();
          clients.set(sessionId, ws);

          ws.on("message", async (raw: RawData) => {
            let parsed: InboundWsMessage;
            try {
              parsed = JSON.parse(raw.toString()) as InboundWsMessage;
            } catch (e: unknown) {
              void e; // cleanup-ignore: malformed JSON from client is silently dropped
              return;
            }

            if (typeof parsed.text !== "string" || parsed.text.trim() === "") return;

            const envelope: MessageEnvelope = {
              id:          randomUUID(),
              instance_id: instanceId,
              channel:     "websocket",
              sender: {
                platform_id:  sessionId,
                display_name: `WebSocket/${sessionId.slice(0, 8)}`,
                verified:     false,
              },
              content: {
                text:        parsed.text,
                attachments: parsed.attachments,
                reply_to:    parsed.reply_to,
              },
              metadata: {
                timestamp:    new Date().toISOString(),
                chat_id:      sessionId,
                thread_id:    parsed.thread_id,
                platform_raw: parsed,
              },
            };

            await callbacks.onMessage(envelope);
          });

          ws.on("close", () => {
            clients.delete(sessionId);
          });
        });

        running = true;
        callbacks.logger.info("websocket_started", `WebSocket adapter [${instanceId}] listening on port ${port}`);
      },

      async stop(): Promise<void> {
        running = false;
        for (const ws of clients.values()) {
          ws.close();
        }
        clients.clear();
        await new Promise<void>((resolve) => {
          if (wss === null) { resolve(); return; }
          wss.close(() => { resolve(); });
        });
        wss = null;
      },

      async sendResponse(chatId: string, text: string, options?: ResponseOptions): Promise<void> {
        const ws = clients.get(chatId);
        if (ws === undefined || ws.readyState !== WebSocket.OPEN) return;

        const msg: OutboundWsMessage = { type: "response", text };
        if (options?.reply_to_message_id !== undefined) msg.reply_to = options.reply_to_message_id;
        if (options?.format !== undefined)              msg.format   = options.format;

        ws.send(JSON.stringify(msg));
      },

      isHealthy(): boolean {
        return running && wss !== null;
      },

      formatText(text: string): string {
        return text;
      },
    };
  },
};

export default plugin;
