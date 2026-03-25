// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * In-memory ring buffer for SSE events.
 *
 * Holds the last N events so that reconnecting clients can be replayed
 * directly from memory without hitting the database.
 *
 * Thread-safety: single-threaded Node.js — no locking required.
 */

import type { SSEEvent } from "./event-filter.js";


/** Default number of events to retain in the in-memory buffer. */
export const DEFAULT_BUFFER_SIZE = 100;

/**
 * Fixed-capacity ring buffer for SSE events.
 *
 * When the buffer is full, the oldest event is overwritten.
 * `since(id)` returns every buffered event whose `id` is greater than
 * the supplied value — the same semantics as `getReplaySince()` in the DB.
 */
export class SseEventBuffer {
  private readonly _buf: (SSEEvent | undefined)[];
  private _head    = 0; // index to write next entry
  private _count   = 0; // number of valid entries

  constructor(readonly maxSize: number = DEFAULT_BUFFER_SIZE) {
    if (maxSize < 1) throw new RangeError("SseEventBuffer maxSize must be ≥ 1");
    this._buf = new Array<SSEEvent | undefined>(maxSize).fill(undefined);
  }

  /** Add an event to the buffer, evicting the oldest if full. */
  add(event: SSEEvent): void {
    this._buf[this._head] = event;
    this._head  = (this._head + 1) % this.maxSize;
    if (this._count < this.maxSize) this._count++;
  }

  /**
   * Return all buffered events whose `id` is strictly greater than
   * `lastEventId`, in insertion (ascending-id) order.
   */
  since(lastEventId: number): SSEEvent[] {
    if (this._count === 0) return [];

    // Reconstruct insertion order: oldest first
    const result: SSEEvent[] = [];
    const start = this._count < this.maxSize
      ? 0
      : this._head; // oldest slot when buffer is full

    for (let i = 0; i < this._count; i++) {
      const idx   = (start + i) % this.maxSize;
      const event = this._buf[idx];
      if (event !== undefined && event.id > lastEventId) {
        result.push(event);
      }
    }
    return result;
  }

  /** Number of events currently in the buffer. */
  get size(): number {
    return this._count;
  }

  /** Remove all events. */
  clear(): void {
    this._buf.fill(undefined);
    this._head  = 0;
    this._count = 0;
  }
}
