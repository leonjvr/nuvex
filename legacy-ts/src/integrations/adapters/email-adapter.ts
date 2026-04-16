// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Email Adapter (Outbound SMTP)
 *
 * Sends emails on behalf of SIDJUA agents via SMTP (nodemailer).
 *
 * Key behaviours:
 *   - Transparency: the from_name MUST contain "Agent" or "Bot" so recipients
 *     always know they are communicating with an AI system.
 *   - Threading: sendReply() sets In-Reply-To and References headers so mail
 *     clients display replies in the same conversation thread.
 *   - Rate limiting: a per-agent sliding window allows at most
 *     rate_limit_per_minute emails per 60s window. Excess emails are queued
 *     in memory and flushed as the window advances — they are NEVER dropped.
 *   - Audit: every sent email is logged to the agent's SQLite audit table.
 *   - Footer: plain-text footer appended to every email body for transparency.
 */

import nodemailer             from "nodemailer";
import type SMTPTransport     from "nodemailer/lib/smtp-transport/index.js";
import { randomUUID }         from "node:crypto";
import { createLogger }       from "../../core/logger.js";
import type { EmailAdapterConfig, EmailResult, EmailAuditEntry } from "./types.js";

const logger = createLogger("email-adapter");


const DEFAULT_RATE_LIMIT    = 10;        // emails per minute
const WINDOW_MS             = 60_000;    // 1 minute sliding window
const QUEUE_FLUSH_INTERVAL  = 5_000;    // check queue every 5 s


interface QueuedEmail {
  to:               string;
  subject:          string;
  body:             string;
  threadId?:        string;
  inReplyTo?:       string;
  references?:      string;
  resolve:          (result: EmailResult) => void;
}


export class EmailAdapter {
  private readonly transport:   nodemailer.Transporter<SMTPTransport.SentMessageInfo>;
  private readonly config:      EmailAdapterConfig;
  private readonly agentId:     string;
  private readonly maxPerMin:   number;

  /** Timestamps (epoch ms) of recently sent emails — for rate limiting. */
  private readonly sentTimestamps: number[] = [];

  /** Emails that exceeded the rate limit and are waiting to be sent. */
  private readonly queue: QueuedEmail[] = [];

  /** Timer handle for the queue-flush loop. */
  private flushTimer:   ReturnType<typeof setInterval> | null = null;

  /** Audit log entries (appended by _logAudit, readable via getAuditLog()). */
  private readonly auditLog: EmailAuditEntry[] = [];

  constructor(config: EmailAdapterConfig, agentId: string) {
    validateConfig(config);

    this.config    = config;
    this.agentId   = agentId;
    this.maxPerMin = config.rate_limit_per_minute ?? DEFAULT_RATE_LIMIT;

    this.transport = nodemailer.createTransport({
      host:   config.smtp_host,
      port:   config.smtp_port,
      secure: config.smtp_port === 465 ? true : config.tls,
      auth: {
        user: config.smtp_user,
        pass: config.smtp_pass,
      },
    });

    // Start the queue-flush loop — unref() so it doesn't prevent process exit
    this.flushTimer = setInterval(() => { this._flushQueue(); }, QUEUE_FLUSH_INTERVAL);
    if (
      typeof this.flushTimer === "object" &&
      this.flushTimer !== null &&
      "unref" in this.flushTimer
    ) {
      (this.flushTimer as { unref(): void }).unref();
    }

    logger.info("email_adapter_ready", `Email adapter initialised for agent ${agentId}`, {
      metadata: { agentId, smtpHost: config.smtp_host, smtpPort: config.smtp_port },
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Send a new email (not a reply).
   * If the rate limit is exceeded the email is queued and sent when the window
   * allows; `queued: true` is reflected in the returned EmailResult.
   */
  async send(
    to:       string,
    subject:  string,
    body:     string,
    threadId?: string,
  ): Promise<EmailResult> {
    const template: Omit<QueuedEmail, "resolve"> = {
      to, subject, body, ...(threadId !== undefined ? { threadId } : {}),
    };

    if (!this._withinRateLimit()) {
      logger.debug("email_rate_limited", "Email queued — rate limit reached", {
        metadata: { agentId: this.agentId, to, queueLength: this.queue.length + 1 },
      });
      return new Promise<EmailResult>((resolve) => {
        this.queue.push({ ...template, resolve });
      });
    }

    return this._doSend(to, subject, body, undefined, undefined, threadId, false);
  }

  /**
   * Send a reply to an existing email thread.
   * Sets In-Reply-To and References so mail clients group it in the thread.
   */
  async sendReply(
    originalMessageId: string,
    to:                string,
    body:              string,
  ): Promise<EmailResult> {
    const subject = "Re: Agent Reply";

    const template: Omit<QueuedEmail, "resolve"> = {
      to, subject, body,
      inReplyTo:  originalMessageId,
      references: originalMessageId,
    };

    if (!this._withinRateLimit()) {
      return new Promise<EmailResult>((resolve) => {
        this.queue.push({ ...template, resolve });
      });
    }

    return this._doSend(to, subject, body, originalMessageId, originalMessageId, undefined, false);
  }

  /**
   * Return a copy of the audit log for inspection.
   */
  getAuditLog(): EmailAuditEntry[] {
    return [...this.auditLog];
  }

  /**
   * Stop the queue-flush timer (call during graceful shutdown).
   */
  destroy(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _withinRateLimit(): boolean {
    const now = Date.now();
    // Evict timestamps older than the window
    const cutoff = now - WINDOW_MS;
    while (this.sentTimestamps.length > 0 && (this.sentTimestamps[0] ?? 0) < cutoff) {
      this.sentTimestamps.shift();
    }
    return this.sentTimestamps.length < this.maxPerMin;
  }

  private async _doSend(
    to:          string,
    subject:     string,
    body:        string,
    inReplyTo:   string | undefined,
    references:  string | undefined,
    threadId:    string | undefined,
    queued:      boolean,
  ): Promise<EmailResult> {
    const fullBody = body + "\n\n" + this._footer();

    const mailOptions: nodemailer.SendMailOptions = {
      from:    `"${this.config.from_name}" <${this.config.from_address}>`,
      to,
      subject,
      text:    fullBody,
      ...(this.config.html ? { html: `<pre style="font-family:monospace">${escapeHtml(fullBody)}</pre>` } : {}),
      ...(inReplyTo  !== undefined ? { "In-Reply-To": inReplyTo }      : {}),
      ...(references !== undefined ? { References:    references }     : {}),
    };

    const info = await this.transport.sendMail(mailOptions);
    const messageId: string = (info as { messageId?: string }).messageId ?? randomUUID();

    this.sentTimestamps.push(Date.now());

    this._logAudit({
      direction: "outbound",
      agentId:   this.agentId,
      messageId,
      to,
      from:      this.config.from_address,
      subject,
      timestamp: new Date().toISOString(),
      ...(threadId !== undefined ? { threadId } : {}),
    });

    logger.info("email_sent", `Email sent to ${to}`, {
      metadata: { agentId: this.agentId, to, messageId, queued },
    });

    return {
      messageId,
      accepted: Array.isArray(info.accepted) ? (info.accepted as string[]) : [],
      rejected: Array.isArray(info.rejected) ? (info.rejected as string[]) : [],
      queued,
    };
  }

  private _footer(): string {
    return (
      "---\n" +
      `This message was sent by ${this.config.from_name} via SIDJUA. ` +
      "Reply to this email to continue the conversation."
    );
  }

  private _logAudit(entry: EmailAuditEntry): void {
    this.auditLog.push(entry);
  }

  /** Flush the head of the queue when the rate limit window has capacity. */
  private _flushQueue(): void {
    while (this.queue.length > 0 && this._withinRateLimit()) {
      const item = this.queue.shift()!;
      void this._doSend(
        item.to,
        item.subject,
        item.body,
        item.inReplyTo,
        item.references,
        item.threadId,
        true,
      ).then(item.resolve).catch(() => {
        // Re-queue on transient failure (SMTP down)
        this.queue.unshift(item);
      });
    }
  }
}


function validateConfig(config: EmailAdapterConfig): void {
  const required: Array<keyof EmailAdapterConfig> = [
    "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "from_address", "from_name",
  ];
  for (const field of required) {
    const value = config[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new Error(`EmailAdapter: missing required config field '${field}'`);
    }
  }

  // Agent transparency requirement: from_name must contain "Agent" or "Bot"
  if (!/agent|bot/i.test(config.from_name)) {
    throw new Error(
      `EmailAdapter: 'from_name' must contain "Agent" or "Bot" for AI transparency ` +
      `(got: "${config.from_name}")`,
    );
  }
}


function escapeHtml(text: string): string {
  return text
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;");
}
