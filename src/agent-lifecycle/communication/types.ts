// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5c: Communication Abstraction Layer — Types
 *
 * MessageEnvelope and MessageType definitions for the CAL.
 * Tier 1 (V1) implementation wraps Phase 8 AgentProcess stdio IPC.
 * Swap point: replace LocalIPCChannel with NATSChannel for V2.
 */


export type MessageType =
  | "heartbeat"
  | "heartbeat_ack"
  | "task_assign"
  | "shutdown_request"
  | "shutdown_complete"
  | "checkpoint_request"
  | "checkpoint_complete"
  | "config_update"
  | "config_ack"
  | "error";


export interface ConfigUpdatePayload {
  /** The new agent definition fields (partial — only changed fields required). */
  config: Record<string, unknown>;
  /** SHA-256 hash of the full new config (first 16 hex chars). */
  config_hash: string;
  /** Whether the change set requires a process restart. */
  requires_restart: boolean;
}


export interface MessageEnvelope {
  /** Unique message ID (UUID v4). */
  id: string;
  /** Message type. */
  type: MessageType;
  /** Sender agent/component ID. */
  from: string;
  /** Recipient agent/component ID. */
  to: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Arbitrary payload (type-specific). */
  payload: Record<string, unknown>;
}
