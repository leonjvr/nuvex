// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * SIDJUA — V1.1: Email Messaging Adapter
 *
 * Implements MessagingAdapterPlugin for email via IMAP (inbound) and
 * SMTP (outbound). Uses IMAP IDLE for real-time delivery — no polling.
 *
 * Compatible with any standard provider: Gmail, Outlook, Mailcow,
 * Posteo, Fastmail, or self-hosted SMTP/IMAP servers.
 */

import { ImapFlow, type ImapFlowOptions } from "imapflow";
import nodemailer from "nodemailer";
import type {
  MessagingAdapterPlugin,
  AdapterInstance,
  AdapterCallbacks,
  MessageEnvelope,
  ResponseOptions,
} from "../../../src/messaging/adapter-plugin.js";
import configSchema from "./config.schema.json" assert { type: "json" };

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function extractPlainText(source: Buffer | string): string {
  const str = Buffer.isBuffer(source) ? source.toString("utf8") : source;

  // Try to extract text/plain MIME part
  const textMatch = str.match(
    /Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\z)/i,
  );
  if (textMatch?.[1] !== undefined) return textMatch[1].trim();

  // Fallback: strip HTML
  return stripHtml(str);
}

// ---------------------------------------------------------------------------
// Envelope conversion
// ---------------------------------------------------------------------------

function emailToEnvelope(instanceId: string, email: Record<string, unknown>): MessageEnvelope | null {
  const envelope = email["envelope"] as Record<string, unknown> | undefined;
  const fromList = envelope?.["from"] as Array<Record<string, unknown>> | undefined;
  const from     = fromList?.[0];
  if (from === undefined) return null;

  const fromAddr = typeof from["address"] === "string" ? from["address"] : "";
  const fromName = typeof from["name"]    === "string" ? from["name"]    : fromAddr;

  const refs = envelope?.["references"] as string[] | undefined;

  return {
    id:          (typeof envelope?.["messageId"] === "string" ? envelope["messageId"] : null) ?? crypto.randomUUID(),
    instance_id: instanceId,
    channel:     "email",
    sender: {
      platform_id:  fromAddr,
      display_name: fromName || fromAddr || "Unknown",
      verified:     false,
    },
    content: {
      text:      extractPlainText(email["source"] as Buffer | string | undefined ?? ""),
      reply_to:  typeof envelope?.["inReplyTo"] === "string" ? envelope["inReplyTo"] : undefined,
    },
    metadata: {
      timestamp:   (envelope?.["date"] instanceof Date ? envelope["date"].toISOString() : null) ?? new Date().toISOString(),
      chat_id:     fromAddr,
      thread_id:   refs?.[0],
      platform_raw: email,
    },
  };
}

// ---------------------------------------------------------------------------
// IMAP IDLE listener
// ---------------------------------------------------------------------------

async function listenForMail(
  instanceId: string,
  imap:       ImapFlow,
  config:     Record<string, unknown>,
  callbacks:  AdapterCallbacks,
  isRunning:  () => boolean,
): Promise<void> {
  const mailbox = typeof config["mailbox"] === "string" ? config["mailbox"] : "INBOX";
  const lock    = await imap.getMailboxLock(mailbox);

  try {
    // Fetch any unseen messages that arrived while offline
    await fetchUnseen(instanceId, imap, callbacks, isRunning);

    imap.on("exists", async () => {
      await fetchUnseen(instanceId, imap, callbacks, isRunning);
    });

    while (isRunning()) {
      await imap.idle();
    }
  } finally {
    lock.release();
  }
}

async function fetchUnseen(
  instanceId: string,
  imap:       ImapFlow,
  callbacks:  AdapterCallbacks,
  isRunning:  () => boolean,
): Promise<void> {
  for await (const msg of imap.fetch({ seen: false }, { source: true, envelope: true })) {
    if (!isRunning()) break;
    const envelope = emailToEnvelope(instanceId, msg as unknown as Record<string, unknown>);
    if (envelope !== null) {
      await callbacks.onMessage(envelope);
    }
    // Mark seen to avoid re-processing
    await imap.messageFlagsAdd({ uid: (msg as unknown as Record<string, unknown>)["uid"] as number }, ["\\Seen"], { uid: true });
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: MessagingAdapterPlugin = {
  meta: {
    name:         "email",
    version:      "1.0.0",
    description:  "Email adapter via IMAP (inbound) and SMTP (outbound)",
    channel:      "email",
    configSchema,
    capabilities: ["text", "attachments", "threads", "rich_text"],
  },

  createInstance(instanceId: string, config: Record<string, unknown>, callbacks: AdapterCallbacks): AdapterInstance {
    let imapClient:    ImapFlow | null = null;
    let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
    let running:       boolean = false;

    return {
      instanceId,
      channel: "email",

      async start(): Promise<void> {
        const imapHost = await callbacks.getSecret(config["imap_host_secret"] as string);
        const imapUser = await callbacks.getSecret(config["imap_user_secret"] as string);
        const imapPass = await callbacks.getSecret(config["imap_pass_secret"] as string);
        const smtpHost = await callbacks.getSecret(config["smtp_host_secret"] as string);
        const smtpUser = await callbacks.getSecret(config["smtp_user_secret"] as string);
        const smtpPass = await callbacks.getSecret(config["smtp_pass_secret"] as string);

        smtpTransport = nodemailer.createTransport({
          host:   smtpHost,
          port:   (config["smtp_port"] as number | undefined) ?? 587,
          secure: (config["smtp_tls"] as boolean | undefined) ?? true,
          auth:   { user: smtpUser, pass: smtpPass },
        });

        const imapOptions: ImapFlowOptions = {
          host:   imapHost,
          port:   (config["imap_port"] as number | undefined) ?? 993,
          secure: (config["imap_tls"] as boolean | undefined) ?? true,
          auth:   { user: imapUser, pass: imapPass },
          logger: false,
        };

        imapClient = new ImapFlow(imapOptions);
        await imapClient.connect();
        running = true;
        callbacks.logger.info("email_started", `Email adapter [${instanceId}] started`);

        // Run IDLE listener in background — do not await
        const capturedImap = imapClient;
        void listenForMail(instanceId, capturedImap, config, callbacks, () => running).catch(
          (e: unknown) => {
            callbacks.logger.warn(
              "email_idle_error",
              `Email IDLE loop error for [${instanceId}]`,
              { metadata: { error: e instanceof Error ? e.message : String(e) } },
            );
          },
        );
      },

      async stop(): Promise<void> {
        running = false;
        try {
          await imapClient?.logout();
        } catch (e: unknown) {
          void e; // cleanup-ignore: best-effort IMAP logout on shutdown
        }
        smtpTransport?.close();
        imapClient    = null;
        smtpTransport = null;
      },

      async sendResponse(chatId: string, text: string, options?: ResponseOptions): Promise<void> {
        if (smtpTransport === null) return;

        const mailOpts: Record<string, unknown> = {
          from:    config["from_address"] as string,
          to:      chatId,
          subject: (config["response_subject"] as string | undefined) ?? "SIDJUA Response",
          text,
        };

        if (options?.format === "html") {
          mailOpts["html"] = text;
          mailOpts["text"] = stripHtml(text);
        }

        if (options?.reply_to_message_id !== undefined) {
          mailOpts["inReplyTo"]  = options.reply_to_message_id;
          mailOpts["references"] = [options.reply_to_message_id];
        }

        await smtpTransport.sendMail(mailOpts);
      },

      isHealthy(): boolean {
        return running;
      },

      formatText(text: string): string {
        return `<div style="font-family: sans-serif;">${text.replace(/\n/g, "<br>")}</div>`;
      },
    };
  },
};

export default plugin;
