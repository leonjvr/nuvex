// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * SIDJUA — V1.1: Discord Messaging Adapter
 *
 * Implements MessagingAdapterPlugin for Discord using discord.js Gateway.
 * Multiple instances = multiple bots; each needs its own token and
 * MessageContent intent enabled in the Discord Developer Portal.
 */

import {
  Client,
  GatewayIntentBits,
  type Message,
  type TextBasedChannel,
  type MessageCreateOptions,
} from "discord.js";
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
// Envelope conversion
// ---------------------------------------------------------------------------

function toEnvelope(instanceId: string, msg: Message, guildIds: string[]): MessageEnvelope | null {
  // Ignore bot messages (prevent loops)
  if (msg.author.bot) return null;

  // Guild filter
  if (guildIds.length > 0 && msg.guildId !== null && !guildIds.includes(msg.guildId)) return null;

  const attachments: Attachment[] = Array.from(msg.attachments.values()).map((a) => ({
    filename:   a.name,
    mime_type:  a.contentType ?? "application/octet-stream",
    size_bytes: a.size,
    url:        a.url,
  }));

  return {
    id:          msg.id,
    instance_id: instanceId,
    channel:     "discord",
    sender: {
      platform_id:  msg.author.id,
      display_name: msg.author.displayName ?? msg.author.username,
      verified:     false,
    },
    content: {
      text:        msg.content,
      attachments: attachments.length > 0 ? attachments : undefined,
      reply_to:    msg.reference?.messageId,
    },
    metadata: {
      timestamp:    msg.createdAt.toISOString(),
      chat_id:      msg.channelId,
      thread_id:    msg.channel.isThread() ? msg.channelId : undefined,
      platform_raw: msg,
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: MessagingAdapterPlugin = {
  meta: {
    name:         "discord",
    version:      "1.0.0",
    description:  "Discord Bot adapter using the Gateway API",
    channel:      "discord",
    configSchema,
    capabilities: ["text", "attachments", "threads", "rich_text"],
  },

  createInstance(instanceId: string, config: Record<string, unknown>, callbacks: AdapterCallbacks): AdapterInstance {
    let client:  Client | null = null;
    let running: boolean       = false;

    const guildIds = Array.isArray(config["guild_ids"])
      ? (config["guild_ids"] as string[])
      : [];

    return {
      instanceId,
      channel: "discord",

      async start(): Promise<void> {
        const token = await callbacks.getSecret(config["bot_token_secret"] as string);

        client = new Client({
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
          ],
        });

        client.on("messageCreate", async (msg: Message) => {
          const envelope = toEnvelope(instanceId, msg, guildIds);
          if (envelope === null) return;
          await callbacks.onMessage(envelope);
        });

        await client.login(token);
        running = true;
        callbacks.logger.info("discord_started", `Discord adapter [${instanceId}] started`);
      },

      async stop(): Promise<void> {
        client?.destroy();
        client  = null;
        running = false;
      },

      async sendResponse(chatId: string, text: string, options?: ResponseOptions): Promise<void> {
        if (client === null) return;

        const channel = await client.channels.fetch(chatId) as TextBasedChannel | null;
        if (channel === null || !("send" in channel)) return;

        const payload: MessageCreateOptions = { content: text };
        if (options?.reply_to_message_id !== undefined) {
          payload.reply = { messageReference: options.reply_to_message_id };
        }

        await (channel as { send(opts: MessageCreateOptions): Promise<unknown> }).send(payload);
      },

      isHealthy(): boolean {
        return running && client !== null && client.ws.status === 0;
      },

      formatText(text: string): string {
        // Discord Markdown is lenient — return as-is
        return text;
      },
    };
  },
};

export default plugin;
