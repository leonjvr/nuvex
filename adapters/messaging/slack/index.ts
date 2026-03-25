// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * SIDJUA — V1.1: Slack Messaging Adapter
 *
 * Implements MessagingAdapterPlugin for Slack using @slack/bolt in Socket Mode.
 * Socket Mode requires no public URL — connections are outbound from SIDJUA.
 *
 * Requires two tokens: a Bot Token (xoxb-...) and an App Token (xapp-...).
 */

import { App, type KnownEventFromType } from "@slack/bolt";
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
// Types
// ---------------------------------------------------------------------------

type SlackMessageEvent = KnownEventFromType<"message"> & {
  subtype?:    string;
  text?:       string;
  ts:          string;
  thread_ts?:  string;
  user?:       string;
  channel:     string;
  files?:      Array<{ name?: string; mimetype?: string; size?: number; url_private?: string }>;
};

type SlackMentionEvent = {
  type:       "app_mention";
  text:       string;
  ts:         string;
  thread_ts?: string;
  user:       string;
  channel:    string;
};

// ---------------------------------------------------------------------------
// Envelope conversion
// ---------------------------------------------------------------------------

function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

function messageToEnvelope(
  instanceId: string,
  event:      SlackMessageEvent,
): MessageEnvelope | null {
  // Skip system messages (subtype = message_changed, bot_message, etc.)
  if (event.subtype !== undefined) return null;

  const userId = event.user ?? "";
  const text   = event.text ?? "";

  const attachments: Attachment[] = (event.files ?? []).map((f) => ({
    filename:   f.name ?? "file",
    mime_type:  f.mimetype ?? "application/octet-stream",
    size_bytes: f.size ?? 0,
    url:        f.url_private,
  }));

  return {
    id:          event.ts,
    instance_id: instanceId,
    channel:     "slack",
    sender: {
      platform_id:  userId,
      display_name: userId,
      verified:     false,
    },
    content: {
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
    },
    metadata: {
      timestamp:    new Date(parseFloat(event.ts) * 1000).toISOString(),
      chat_id:      event.channel,
      thread_id:    event.thread_ts,
      platform_raw: event,
    },
  };
}

function mentionToEnvelope(
  instanceId: string,
  event:      SlackMentionEvent,
): MessageEnvelope {
  return {
    id:          event.ts,
    instance_id: instanceId,
    channel:     "slack",
    sender: {
      platform_id:  event.user,
      display_name: event.user,
      verified:     false,
    },
    content: {
      text: stripMention(event.text),
    },
    metadata: {
      timestamp:    new Date(parseFloat(event.ts) * 1000).toISOString(),
      chat_id:      event.channel,
      thread_id:    event.thread_ts,
      platform_raw: event,
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: MessagingAdapterPlugin = {
  meta: {
    name:         "slack",
    version:      "1.0.0",
    description:  "Slack adapter using @slack/bolt in Socket Mode",
    channel:      "slack",
    configSchema,
    capabilities: ["text", "attachments", "threads", "rich_text", "typing"],
  },

  createInstance(instanceId: string, config: Record<string, unknown>, callbacks: AdapterCallbacks): AdapterInstance {
    let app:     App | null  = null;
    let running: boolean     = false;

    return {
      instanceId,
      channel: "slack",

      async start(): Promise<void> {
        const botToken = await callbacks.getSecret(config["bot_token_secret"] as string);
        const appToken = await callbacks.getSecret(config["app_token_secret"] as string);

        app = new App({
          token:       botToken,
          appToken,
          socketMode:  true,
          logLevel:    "error" as never,
        });

        app.message(async ({ event }) => {
          const envelope = messageToEnvelope(instanceId, event as SlackMessageEvent);
          if (envelope === null) return;
          await callbacks.onMessage(envelope);
        });

        app.event("app_mention", async ({ event }) => {
          const envelope = mentionToEnvelope(instanceId, event as SlackMentionEvent);
          await callbacks.onMessage(envelope);
        });

        await app.start();
        running = true;
        callbacks.logger.info("slack_started", `Slack adapter [${instanceId}] started`);
      },

      async stop(): Promise<void> {
        try {
          await app?.stop();
        } catch (e: unknown) {
          void e; // cleanup-ignore: best-effort Slack app stop on shutdown
        }
        app     = null;
        running = false;
      },

      async sendResponse(chatId: string, text: string, options?: ResponseOptions): Promise<void> {
        if (app === null) return;

        const postOpts: Record<string, unknown> = { channel: chatId, text };
        if (options?.reply_to_message_id !== undefined) {
          postOpts["thread_ts"] = options.reply_to_message_id;
        }

        await app.client.chat.postMessage(postOpts as Parameters<typeof app.client.chat.postMessage>[0]);
      },

      isHealthy(): boolean {
        return running;
      },

      formatText(text: string): string {
        // Slack mrkdwn is permissive — return as-is for basic text
        return text;
      },
    };
  },
};

export default plugin;
