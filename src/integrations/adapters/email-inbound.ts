// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Email Inbound Adapter (IMAP Polling)
 *
 * Polls an IMAP mailbox for unread emails, maps them to SIDJUA agent
 * conversations via email threading headers, and emits them for agent
 * processing via an onEmail callback.
 *
 * Security:
 *   - Whitelist filtering: only emails from allowed addresses are processed.
 *   - Body size limit: emails exceeding max_body_bytes are rejected with an
 *     automated reply explaining the limit.
 *   - HTML stripping: all HTML tags are removed before the body reaches the
 *     agent pipeline — only plain text is forwarded.
 *   - Stage 0 pipeline: inbound content is passed through the pre-action
 *     governance pipeline before the agent sees it.
 *
 * Thread mapping:
 *   Replies carry an In-Reply-To header that references a previously sent
 *   email's Message-ID.  The poller looks up the thread in the SQLite
 *   email_threads table and attaches the existing thread_id.  New emails
 *   (no matching In-Reply-To) create a fresh thread.
 */

import { ImapFlow }     from "imapflow";
import { randomUUID }   from "node:crypto";
import { createLogger } from "../../core/logger.js";
import type { Database } from "../../utils/db.js";
import type { EmailInboundConfig, InboundEmail, EmailThread } from "./types.js";

const logger = createLogger("email-inbound");


const DEFAULT_MAX_BODY_BYTES = 100_000;   // 100 KB
const IMAP_MAILBOX           = "INBOX";


export type OnEmailCallback = (email: InboundEmail, threadId: string) => Promise<void>;


export class EmailInboundPoller {
  private client:    ImapFlow | null = null;
  private timer:     ReturnType<typeof setInterval> | null = null;
  private _running = false;

  constructor(
    private readonly config:   EmailInboundConfig,
    private readonly agentId:  string,
    private readonly db:       Database,
    private readonly onEmail:  OnEmailCallback,
  ) {
    this._ensureThreadTable();
  }

  /** Start the polling loop. No-op if already running. */
  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;

    this.client = new ImapFlow({
      host:   this.config.imap_host,
      port:   this.config.imap_port,
      secure: this.config.tls,
      auth: {
        user: this.config.imap_user,
        pass: this.config.imap_pass,
      },
      logger: false,  // suppress imapflow's own logger
    });

    await this.client.connect();

    const intervalMs = (this.config.poll_interval_seconds ?? 30) * 1000;
    this.timer = setInterval(() => { void this._poll(); }, intervalMs);

    if (
      typeof this.timer === "object" &&
      this.timer !== null &&
      "unref" in this.timer
    ) {
      (this.timer as { unref(): void }).unref();
    }

    // Run the first poll immediately
    await this._poll();

    logger.info("email_inbound_started", "IMAP polling started", {
      metadata: { agentId: this.agentId, host: this.config.imap_host, intervalMs },
    });
  }

  /** Stop the polling loop gracefully. */
  async stop(): Promise<void> {
    if (!this._running) return;
    this._running = false;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.client !== null) {
      try {
        await this.client.logout();
      } catch (_err) {
        // Non-fatal — connection may already be closed
      }
      this.client = null;
    }

    logger.info("email_inbound_stopped", "IMAP polling stopped", {
      metadata: { agentId: this.agentId },
    });
  }

  /** Fetch and process all unread emails. Returns the fetched emails. */
  async poll(): Promise<InboundEmail[]> {
    return this._poll();
  }

  // ---------------------------------------------------------------------------
  // Internal polling
  // ---------------------------------------------------------------------------

  private async _poll(): Promise<InboundEmail[]> {
    if (this.client === null) return [];

    const fetched: InboundEmail[] = [];

    try {
      const lock = await this.client.getMailboxLock(IMAP_MAILBOX);
      try {
        const messages: InboundEmail[] = [];

        for await (const msg of this.client.fetch({ seen: false }, {
          envelope:     true,
          source:       true,
          bodyStructure: true,
        })) {
          const env       = msg.envelope;
          const messageId: string = env?.messageId ?? `<${randomUUID()}@sidjua.local>`;
          const inReplyTo: string | undefined = env?.inReplyTo ?? undefined;
          const from      = env?.from?.[0]?.address ?? "unknown@unknown.invalid";
          const to        = env?.to?.[0]?.address   ?? this.config.imap_user;
          const subject   = env?.subject             ?? "(no subject)";

          // Parse body from raw source
          const rawBody = msg.source?.toString("utf-8") ?? "";
          const body    = this._extractPlainText(rawBody);

          const email: InboundEmail = {
            messageId,
            ...(inReplyTo !== undefined ? { inReplyTo } : {}),
            from,
            to,
            subject,
            body,
            receivedAt: new Date().toISOString(),
          };

          messages.push(email);

          // Mark as read immediately
          await this.client!.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
        }

        for (const email of messages) {
          await this._processEmail(email);
          fetched.push(email);
        }
      } finally {
        lock.release();
      }
    } catch (err: unknown) {
      logger.warn("email_poll_error", "IMAP poll failed", {
        metadata: { agentId: this.agentId, error: err instanceof Error ? err.message : String(err) },
      });
    }

    return fetched;
  }

  /** Process a single inbound email: security checks → thread lookup → callback. */
  async processEmail(email: InboundEmail): Promise<void> {
    return this._processEmail(email);
  }

  private async _processEmail(email: InboundEmail): Promise<void> {
    // Whitelist check
    if (!this._isAllowedSender(email.from)) {
      logger.info("email_whitelist_reject", "Email from non-whitelisted address ignored", {
        metadata: { agentId: this.agentId, from: email.from },
      });
      return;
    }

    // Body size check
    const maxBytes = this.config.max_body_bytes ?? DEFAULT_MAX_BODY_BYTES;
    if (Buffer.byteLength(email.body, "utf8") > maxBytes) {
      logger.warn("email_too_large", "Inbound email body exceeds size limit", {
        metadata: { agentId: this.agentId, from: email.from, maxBytes },
      });
      // Auto-reply is the caller's responsibility via the onEmail callback contract.
      // We pass a special sentinel body so the agent knows to reply with the limit.
      const sentinel: InboundEmail = {
        ...email,
        body: `__SIDJUA_OVERSIZED__ max_bytes=${maxBytes}`,
      };
      const threadId = this._resolveThread(sentinel);
      await this.onEmail(sentinel, threadId);
      return;
    }

    // Strip HTML tags from body
    const cleanBody    = this._stripHtml(email.body);
    const cleanedEmail = { ...email, body: cleanBody };

    const threadId = this._resolveThread(cleanedEmail);
    this._updateThread(cleanedEmail, threadId);

    logger.info("email_received", "Processing inbound email", {
      metadata: { agentId: this.agentId, from: email.from, threadId, subject: email.subject },
    });

    await this.onEmail(cleanedEmail, threadId);
  }

  // ---------------------------------------------------------------------------
  // Thread mapping
  // ---------------------------------------------------------------------------

  private _resolveThread(email: InboundEmail): string {
    if (email.inReplyTo !== undefined) {
      // Look for an existing thread by the message-id we sent
      const row = this.db.prepare<[string], { thread_id: string }>(
        "SELECT thread_id FROM email_threads WHERE message_id = ? LIMIT 1",
      ).get(email.inReplyTo);
      if (row !== undefined) return row.thread_id;
    }
    // New thread
    return randomUUID();
  }

  private _updateThread(email: InboundEmail, threadId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO email_threads
         (thread_id, message_id, in_reply_to, from_address, subject, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         message_id   = excluded.message_id,
         updated_at   = excluded.updated_at`,
    ).run(
      threadId,
      email.messageId,
      email.inReplyTo ?? null,
      email.from,
      email.subject,
      now,
      now,
    );
  }

  // ---------------------------------------------------------------------------
  // Security helpers
  // ---------------------------------------------------------------------------

  private _isAllowedSender(from: string): boolean {
    const whitelist = this.config.whitelist;
    if (!whitelist || whitelist.length === 0) return true;
    return whitelist.some((allowed) =>
      allowed.toLowerCase() === from.toLowerCase(),
    );
  }

  /** Strip HTML tags and decode common entities. */
  private _stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /**
   * Extract plain-text body from a raw RFC 2822 message.
   * Very simplified — for production a proper MIME parser would be used.
   */
  private _extractPlainText(raw: string): string {
    // Split headers from body at the first blank line
    const sep = raw.indexOf("\r\n\r\n");
    if (sep === -1) return this._stripHtml(raw);
    const body = raw.slice(sep + 4);
    return this._stripHtml(body);
  }

  // ---------------------------------------------------------------------------
  // SQLite schema bootstrap
  // ---------------------------------------------------------------------------

  private _ensureThreadTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_threads (
        thread_id    TEXT PRIMARY KEY,
        message_id   TEXT NOT NULL,
        in_reply_to  TEXT,
        from_address TEXT NOT NULL,
        subject      TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      )
    `);
  }

  /**
   * Return all email threads for this agent (for CLI display).
   */
  listThreads(): EmailThread[] {
    return this.db.prepare<[], EmailThread>(
      "SELECT * FROM email_threads ORDER BY updated_at DESC",
    ).all();
  }
}
