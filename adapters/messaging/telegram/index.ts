// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * SIDJUA — V1.1: Telegram Messaging Adapter
 *
 * Implements MessagingAdapterPlugin for the Telegram Bot API.
 * Uses long-polling (no webhook required) via telegraf.
 *
 * One plugin instance can back multiple independent bot instances
 * (different tokens, different rate limits, different user mappings).
 */

import { Telegraf, type Context } from "telegraf";
import type { Message } from "telegraf/types";
import type {
  MessagingAdapterPlugin,
  AdapterInstance,
  AdapterCallbacks,
  MessageEnvelope,
  ResponseOptions,
} from "../../../src/messaging/adapter-plugin.js";
import type { Attachment } from "../../../src/messaging/types.js";
import configSchema from "./config.schema.json" assert { type: "json" };

// ---------------------------------------------------------------------------
// Markdown escaping
// ---------------------------------------------------------------------------

function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// Attachment extraction
// ---------------------------------------------------------------------------

function extractAttachments(msg: Message.TextMessage | Message): Attachment[] {
  const attachments: Attachment[] = [];
  const m = msg as Record<string, unknown>;

  if (m["document"] !== undefined && m["document"] !== null) {
    const doc = m["document"] as Record<string, unknown>;
    attachments.push({
      filename:   typeof doc["file_name"] === "string" ? doc["file_name"] : "document",
      mime_type:  typeof doc["mime_type"] === "string" ? doc["mime_type"] : "application/octet-stream",
      size_bytes: typeof doc["file_size"] === "number" ? doc["file_size"] : 0,
    });
  }

  if (Array.isArray(m["photo"]) && m["photo"].length > 0) {
    const photos = m["photo"] as Array<Record<string, unknown>>;
    const largest = photos[photos.length - 1]!;
    attachments.push({
      filename:   "photo.jpg",
      mime_type:  "image/jpeg",
      size_bytes: typeof largest["file_size"] === "number" ? largest["file_size"] : 0,
    });
  }

  return attachments;
}

// ---------------------------------------------------------------------------
// Envelope conversion
// ---------------------------------------------------------------------------

function toEnvelope(instanceId: string, ctx: Context): MessageEnvelope | null {
  const msg = ctx.message;
  if (msg === undefined || !("text" in msg)) return null;

  const textMsg = msg as Message.TextMessage;
  const raw = msg as Record<string, unknown>;

  return {
    id:          String(textMsg.message_id),
    instance_id: instanceId,
    channel:     "telegram",
    sender: {
      platform_id:  String(textMsg.from?.id ?? ""),
      display_name: [textMsg.from?.first_name, textMsg.from?.last_name]
        .filter(Boolean)
        .join(" ") || "Unknown",
      verified: false,
    },
    content: {
      text:        textMsg.text,
      attachments: extractAttachments(textMsg),
      reply_to:    (raw["reply_to_message"] as Record<string, unknown> | undefined)
        ? String((raw["reply_to_message"] as Record<string, unknown>)["message_id"])
        : undefined,
    },
    metadata: {
      timestamp:    new Date(textMsg.date * 1000).toISOString(),
      chat_id:      String(textMsg.chat.id),
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
    name:         "telegram",
    version:      "1.0.0",
    description:  "Telegram Bot API adapter using long-polling",
    channel:      "telegram",
    configSchema,
    capabilities: ["text", "attachments", "threads", "rich_text", "typing"],
  },

  createInstance(instanceId: string, config: Record<string, unknown>, callbacks: AdapterCallbacks): AdapterInstance {
    let bot:     Telegraf | null = null;
    let running: boolean         = false;

    return {
      instanceId,
      channel: "telegram",

      async start(): Promise<void> {
        const token = await callbacks.getSecret(config["bot_token_secret"] as string);
        bot = new Telegraf(token);

        bot.on("message", async (ctx: Context) => {
          const envelope = toEnvelope(instanceId, ctx);
          if (envelope === null) return;
          await callbacks.onMessage(envelope);
        });

        await bot.launch({ dropPendingUpdates: (config["drop_pending_updates"] as boolean) ?? true });
        running = true;
        callbacks.logger.info("telegram_started", `Telegram adapter [${instanceId}] started`);
      },

      async stop(): Promise<void> {
        bot?.stop("SIGTERM");
        bot     = null;
        running = false;
      },

      async sendResponse(chatId: string, text: string, options?: ResponseOptions): Promise<void> {
        if (bot === null) return;

        const extra: Record<string, unknown> = {};

        if (options?.reply_to_message_id !== undefined) {
          extra["reply_parameters"] = { message_id: parseInt(options.reply_to_message_id, 10) };
        }

        if (options?.format === "markdown") {
          extra["parse_mode"] = "MarkdownV2";
          text = escapeMarkdownV2(text);
        }

        await bot.telegram.sendMessage(chatId, text, extra as Parameters<typeof bot.telegram.sendMessage>[2]);
      },

      isHealthy(): boolean {
        return running;
      },

      formatText(text: string): string {
        return escapeMarkdownV2(text);
      },
    };
  },
};

export default plugin;
