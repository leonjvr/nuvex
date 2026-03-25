// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * SIDJUA — V1.1: WhatsApp Messaging Adapter
 *
 * Implements MessagingAdapterPlugin using baileys (WhatsApp Web client).
 * First-time authentication via QR code; subsequent starts reuse saved state.
 *
 * IMPORTANT: baileys is an unofficial, reverse-engineered WhatsApp Web client.
 * Use at your own risk. WhatsApp may restrict accounts using unofficial clients.
 * For production enterprise use, consider the official WhatsApp Business Cloud API.
 */

import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
  type proto,
} from "baileys";
import { Boom } from "@hapi/boom";
import type {
  MessagingAdapterPlugin,
  AdapterInstance,
  AdapterCallbacks,
  MessageEnvelope,
  ResponseOptions,
} from "../../../src/messaging/adapter-plugin.js";
import configSchema from "./config.schema.json" assert { type: "json" };

// ---------------------------------------------------------------------------
// JID helpers
// ---------------------------------------------------------------------------

/** Strip WhatsApp JID suffix: "15551234567@s.whatsapp.net" → "15551234567" */
function jidToPlatformId(jid: string): string {
  return jid.split("@")[0] ?? jid;
}

// ---------------------------------------------------------------------------
// Envelope conversion
// ---------------------------------------------------------------------------

function messageToEnvelope(
  instanceId: string,
  msg:        proto.IWebMessageInfo,
): MessageEnvelope | null {
  // Ignore own messages
  if (msg.key.fromMe === true) return null;

  const jid         = msg.key.remoteJid ?? "";
  const text        = msg.message?.conversation
    ?? msg.message?.extendedTextMessage?.text
    ?? "";

  if (!text) return null;

  const senderJid   = msg.key.participant ?? jid;
  const platformId  = jidToPlatformId(senderJid);
  const timestamp   = typeof msg.messageTimestamp === "number"
    ? new Date(msg.messageTimestamp * 1000).toISOString()
    : new Date().toISOString();

  return {
    id:          msg.key.id ?? crypto.randomUUID(),
    instance_id: instanceId,
    channel:     "whatsapp",
    sender: {
      platform_id:  platformId,
      display_name: platformId,
      verified:     false,
    },
    content: {
      text,
      reply_to: msg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? undefined,
    },
    metadata: {
      timestamp,
      chat_id:      jid,
      thread_id:    undefined,
      platform_raw: msg,
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: MessagingAdapterPlugin = {
  meta: {
    name:         "whatsapp",
    version:      "1.0.0",
    description:  "WhatsApp adapter using baileys (WhatsApp Web client)",
    channel:      "whatsapp",
    configSchema,
    capabilities: ["text", "threads"],
  },

  createInstance(instanceId: string, config: Record<string, unknown>, callbacks: AdapterCallbacks): AdapterInstance {
    let sock:    WASocket | null = null;
    let running: boolean         = false;

    const authDir        = typeof config["auth_dir"] === "string"
      ? config["auth_dir"]
      : "./data/whatsapp-auth";
    const printQr        = (config["print_qr_terminal"] as boolean | undefined) ?? true;

    async function connect(): Promise<void> {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      sock = makeWASocket({
        auth:             state,
        printQRInTerminal: printQr,
        logger:           { level: "silent" } as never,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
          running = true;
          callbacks.logger.info("whatsapp_connected", `WhatsApp adapter [${instanceId}] connected`);
        }

        if (connection === "close") {
          running = false;
          const reason = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          if (reason !== DisconnectReason.loggedOut) {
            callbacks.logger.warn(
              "whatsapp_reconnecting",
              `WhatsApp adapter [${instanceId}] disconnected, reconnecting...`,
            );
            await connect();
          } else {
            callbacks.logger.warn(
              "whatsapp_logged_out",
              `WhatsApp adapter [${instanceId}] logged out — delete auth state to re-authenticate`,
            );
          }
        }
      });

      sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
          const envelope = messageToEnvelope(instanceId, msg);
          if (envelope === null) continue;
          await callbacks.onMessage(envelope);
        }
      });
    }

    return {
      instanceId,
      channel: "whatsapp",

      async start(): Promise<void> {
        await connect();
      },

      async stop(): Promise<void> {
        running = false;
        try {
          await sock?.logout();
        } catch (e: unknown) {
          void e; // cleanup-ignore: best-effort logout on shutdown; socket may already be closed
        }
        sock = null;
      },

      async sendResponse(chatId: string, text: string, options?: ResponseOptions): Promise<void> {
        if (sock === null) return;

        const content: Record<string, unknown> = { text };

        if (options?.reply_to_message_id !== undefined) {
          content["contextInfo"] = { stanzaId: options.reply_to_message_id };
        }

        await sock.sendMessage(chatId, content);
      },

      isHealthy(): boolean {
        return running;
      },

      formatText(text: string): string {
        // WhatsApp uses its own markdown: *bold*, _italic_, ~strikethrough~, ```mono```
        return text;
      },
    };
  },
};

export default plugin;
