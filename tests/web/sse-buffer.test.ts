// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * SSE event buffer and reconnect-hardening tests.
 *
 *   - SseEventBuffer ring buffer semantics
 *   - EventStreamManager buffer integration
 *   - Heartbeat and Last-Event-ID source inspection
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SseEventBuffer, DEFAULT_BUFFER_SIZE } from "../../src/api/sse/event-buffer.js";
import { EventStreamManager } from "../../src/api/sse/event-stream.js";
import type { SSEEvent } from "../../src/api/sse/event-filter.js";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEvent(id: number, type = "task:created"): SSEEvent {
  return {
    id,
    type,
    data:      { taskId: `task-${id}` },
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// DEFAULT_BUFFER_SIZE
// ---------------------------------------------------------------------------

describe("DEFAULT_BUFFER_SIZE", () => {
  it("is 100", () => {
    expect(DEFAULT_BUFFER_SIZE).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// SseEventBuffer — basic operations
// ---------------------------------------------------------------------------

describe("SseEventBuffer — basic operations", () => {
  let buf: SseEventBuffer;

  beforeEach(() => {
    buf = new SseEventBuffer(10);
  });

  it("starts empty", () => {
    expect(buf.size).toBe(0);
  });

  it("size increases as events are added", () => {
    buf.add(makeEvent(1));
    expect(buf.size).toBe(1);
    buf.add(makeEvent(2));
    expect(buf.size).toBe(2);
  });

  it("since(0) returns all buffered events", () => {
    buf.add(makeEvent(1));
    buf.add(makeEvent(2));
    buf.add(makeEvent(3));
    const result = buf.since(0);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("since(id) filters to events with id > lastEventId", () => {
    for (let i = 1; i <= 5; i++) buf.add(makeEvent(i));
    const result = buf.since(3);
    expect(result.map((e) => e.id)).toEqual([4, 5]);
  });

  it("since(maxId) returns empty array when all events are older", () => {
    buf.add(makeEvent(1));
    buf.add(makeEvent(2));
    const result = buf.since(99);
    expect(result).toHaveLength(0);
  });

  it("clear() empties the buffer", () => {
    buf.add(makeEvent(1));
    buf.add(makeEvent(2));
    buf.clear();
    expect(buf.size).toBe(0);
    expect(buf.since(0)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SseEventBuffer — ring buffer overflow
// ---------------------------------------------------------------------------

describe("SseEventBuffer — ring buffer overflow", () => {
  it("size is capped at maxSize", () => {
    const buf = new SseEventBuffer(5);
    for (let i = 1; i <= 10; i++) buf.add(makeEvent(i));
    expect(buf.size).toBe(5);
  });

  it("oldest events are evicted when buffer is full", () => {
    const buf = new SseEventBuffer(3);
    for (let i = 1; i <= 5; i++) buf.add(makeEvent(i));
    // Buffer holds events 3, 4, 5 (oldest 1, 2 evicted)
    const all = buf.since(0);
    expect(all.map((e) => e.id)).toEqual([3, 4, 5]);
  });

  it("since(id) works correctly after overflow", () => {
    const buf = new SseEventBuffer(3);
    for (let i = 1; i <= 6; i++) buf.add(makeEvent(i));
    // Buffer holds 4, 5, 6
    const result = buf.since(4);
    expect(result.map((e) => e.id)).toEqual([5, 6]);
  });

  it("throws RangeError when maxSize < 1", () => {
    expect(() => new SseEventBuffer(0)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// SseEventBuffer — ordering invariant
// ---------------------------------------------------------------------------

describe("SseEventBuffer — event ordering", () => {
  it("events are returned in insertion order (ascending id)", () => {
    const buf = new SseEventBuffer(20);
    const ids = [10, 5, 20, 1, 15];
    for (const id of ids) buf.add(makeEvent(id));
    const result = buf.since(0);
    expect(result.map((e) => e.id)).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// EventStreamManager buffer integration
// ---------------------------------------------------------------------------

describe("EventStreamManager — buffer integration", () => {
  it("has a buffer property", () => {
    const mgr = new EventStreamManager();
    expect(mgr.buffer).toBeInstanceOf(SseEventBuffer);
    mgr.shutdown();
  });

  it("broadcast adds event to buffer", async () => {
    const mgr   = new EventStreamManager(50);
    const event = makeEvent(42);
    await mgr.broadcast(event);
    expect(mgr.buffer.size).toBe(1);
    const buffered = mgr.buffer.since(41);
    expect(buffered).toHaveLength(1);
    expect(buffered[0]!.id).toBe(42);
    mgr.shutdown();
  });

  it("buffer size is configurable via constructor", () => {
    const mgr = new EventStreamManager(25);
    expect(mgr.buffer.maxSize).toBe(25);
    mgr.shutdown();
  });

  it("buffer default size is DEFAULT_BUFFER_SIZE", () => {
    const mgr = new EventStreamManager();
    expect(mgr.buffer.maxSize).toBe(DEFAULT_BUFFER_SIZE);
    mgr.shutdown();
  });
});

// ---------------------------------------------------------------------------
// SSE Reconnect hardening — source inspection
// ---------------------------------------------------------------------------

describe("SSE Reconnect — Last-Event-ID and heartbeat (source inspection)", () => {
  it("events.ts uses manager.buffer.since() for reconnection replay", () => {
    const src = readFileSync(
      new URL("../../src/api/routes/events.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("manager.buffer.since");
  });

  it("events.ts sends keepalive pings in a loop", () => {
    const src = readFileSync(
      new URL("../../src/api/routes/events.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("ping");
    expect(src).toContain("keepaliveIntervalMs");
    expect(src).toContain("stream.sleep");
  });

  it("events.ts reads Last-Event-ID header on reconnect", () => {
    const src = readFileSync(
      new URL("../../src/api/routes/events.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("Last-Event-ID");
    expect(src).toContain("lastEventId");
  });

  it("event-stream.ts exports EventStreamManager with buffer", () => {
    const src = readFileSync(
      new URL("../../src/api/sse/event-stream.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("SseEventBuffer");
    expect(src).toContain("buffer.add");
  });
});

// ---------------------------------------------------------------------------
// Client-side reconnect (source inspection)
// ---------------------------------------------------------------------------

describe("SSE Client — reconnect with exponential backoff (source inspection)", () => {
  it("sse.ts client schedules reconnect with exponential backoff", () => {
    const src = readFileSync(
      new URL("../../sidjua-gui/src/api/sse.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("scheduleReconnect");
    expect(src).toContain("backoffMs * 2");
    expect(src).toContain("maxBackoffMs");
  });

  it("sse.ts client resets backoff on successful connect", () => {
    const src = readFileSync(
      new URL("../../sidjua-gui/src/api/sse.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("initialBackoffMs"); // reset on onopen
  });

  it("sse.ts client sends lastEventId on reconnect", () => {
    const src = readFileSync(
      new URL("../../sidjua-gui/src/api/sse.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("lastEventId");
    expect(src).toContain("lastEventId");
  });

  it("SseStatusIndicator component exists with correct statuses", () => {
    const src = readFileSync(
      new URL("../../sidjua-gui/src/components/shared/SseStatusIndicator.tsx", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("connected");
    expect(src).toContain("connecting");
    expect(src).toContain("disconnected");
    expect(src).toContain("error");
  });
});
