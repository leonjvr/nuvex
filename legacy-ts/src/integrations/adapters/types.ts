// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Email Adapter Types
 *
 * Shared type definitions for the outbound (SMTP) and inbound (IMAP) email
 * communication adapters.
 */


export interface EmailAdapterConfig {
  smtp_host:    string;
  smtp_port:    number;
  smtp_user:    string;
  smtp_pass:    string;
  from_address: string;
  /** Display name for the sending agent — must contain "Agent" or "Bot". */
  from_name:    string;
  tls:          boolean;
  /** Max emails per minute per agent. Default: 10. */
  rate_limit_per_minute?: number;
  /** Send HTML-wrapped emails in addition to plain text. Default: false. */
  html?: boolean;
}

export interface EmailInboundConfig {
  imap_host:              string;
  imap_port:              number;
  imap_user:              string;
  imap_pass:              string;
  poll_interval_seconds:  number;
  tls:                    boolean;
  /** Allowed sender addresses. Empty array or omitted = accept all. */
  whitelist?:             string[];
  /** Max email body bytes accepted. Default: 100_000 (100 KB). */
  max_body_bytes?:        number;
}


export interface EmailResult {
  messageId: string;
  accepted:  string[];
  rejected:  string[];
  queued:    boolean;   // true when the email was rate-limited and deferred to queue
}


export interface InboundEmail {
  messageId:  string;
  inReplyTo?: string;
  from:       string;
  to:         string;
  subject:    string;
  body:       string;
  receivedAt: string;
}


export interface EmailThread {
  thread_id:    string;   // SIDJUA conversation ID (UUID)
  message_id:   string;   // email Message-ID of first message in thread
  in_reply_to:  string | null;
  from_address: string;
  subject:      string;
  created_at:   string;
  updated_at:   string;
}


export type EmailDirection = "outbound" | "inbound";

export interface EmailAuditEntry {
  direction:   EmailDirection;
  agentId:     string;
  messageId:   string;
  to:          string;
  from:        string;
  subject:     string;
  timestamp:   string;
  threadId?:   string;
}
