// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5c: Communication Abstraction Layer — Channel Interface
 *
 * CommunicationChannel is the swap point between V1 (LocalIPCChannel) and
 * V2 (NATSChannel) implementations. All code that sends/receives messages
 * uses this interface.
 */

import type { MessageEnvelope, MessageType } from "./types.js";


export interface CommunicationChannel {
  /**
   * Send a message envelope to the remote end.
   * Must not throw if the remote is temporarily unavailable (log + no-op).
   */
  send(envelope: MessageEnvelope): void;

  /**
   * Register a handler for incoming messages.
   * Multiple subscribers are allowed; all are called for each message.
   * Optional filter: only invoke handler for the given message type.
   */
  subscribe(
    handler: (envelope: MessageEnvelope) => void,
    filter?: MessageType,
  ): void;

  /**
   * Close the channel. After close(), send() is a no-op and no new
   * messages will be delivered to subscribers.
   */
  close(): void;

  /**
   * Returns true if the underlying transport is alive and can send messages.
   */
  isHealthy(): boolean;
}
