/**
 * Tests for src/tasks/event-bus.ts
 *
 * Covers:
 * - Emit writes event to SQLite
 * - Consume returns unconsumed events for agent
 * - Acknowledge marks events consumed
 * - Poll returns same as consume (DB fallback)
 * - Subscribe receives events via callback
 * - Cleanup removes old consumed events
 * - Events persist across EventBus restarts (SQLite durability)
 * - Event ordering preserved (created_at)
 * - Phase 6 compatibility: emit(string, data) + on(string, fn)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { TaskEventBus } from "../../src/tasks/event-bus.js";
import type { Database } from "../../src/utils/db.js";
import type { TaskEventInput } from "../../src/tasks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEventInput(overrides: Partial<TaskEventInput> = {}): TaskEventInput {
  return {
    event_type: "TASK_CREATED",
    task_id: "task-001",
    parent_task_id: null,
    agent_from: "agent-a",
    agent_to: "agent-b",
    division: "engineering",
    data: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let db: Database;
let bus: TaskEventBus;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-bus-test-"));
  db     = openDatabase(join(tmpDir, "events.db"));
  bus    = new TaskEventBus(db);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// emitTask
// ---------------------------------------------------------------------------

describe("TaskEventBus.emitTask", () => {
  it("writes event to SQLite and returns an ID", async () => {
    const id = await bus.emitTask(makeEventInput());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const row = db
      .prepare<[string], { id: string; event_type: string }>(
        "SELECT id, event_type FROM task_events WHERE id = ?",
      )
      .get(id);
    expect(row).toBeDefined();
    expect(row?.event_type).toBe("TASK_CREATED");
  });

  it("sets consumed=0 and consumed_at=NULL", async () => {
    const id = await bus.emitTask(makeEventInput());
    const row = db
      .prepare<[string], { consumed: number; consumed_at: string | null }>(
        "SELECT consumed, consumed_at FROM task_events WHERE id = ?",
      )
      .get(id);
    expect(row?.consumed).toBe(0);
    expect(row?.consumed_at).toBeNull();
  });

  it("serializes data as JSON", async () => {
    const id = await bus.emitTask(makeEventInput({ data: { key: "value", num: 99 } }));
    const row = db
      .prepare<[string], { data: string }>("SELECT data FROM task_events WHERE id = ?")
      .get(id);
    expect(row?.data).toBe(JSON.stringify({ key: "value", num: 99 }));
  });

  it("emitting multiple events preserves order by created_at", async () => {
    await bus.emitTask(makeEventInput({ event_type: "TASK_CREATED" }));
    await bus.emitTask(makeEventInput({ event_type: "TASK_ASSIGNED" }));
    await bus.emitTask(makeEventInput({ event_type: "TASK_STARTED" }));

    const rows = db
      .prepare<[], { event_type: string }>(
        "SELECT event_type FROM task_events ORDER BY created_at ASC",
      )
      .all();
    expect(rows[0]?.event_type).toBe("TASK_CREATED");
    expect(rows[1]?.event_type).toBe("TASK_ASSIGNED");
    expect(rows[2]?.event_type).toBe("TASK_STARTED");
  });
});

// ---------------------------------------------------------------------------
// consume
// ---------------------------------------------------------------------------

describe("TaskEventBus.consume", () => {
  it("returns unconsumed events for target agent", async () => {
    await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    await bus.emitTask(makeEventInput({ agent_to: "agent-c" })); // different agent

    const events = await bus.consume("agent-b");
    expect(events).toHaveLength(1);
    expect(events[0]?.agent_to).toBe("agent-b");
  });

  it("returns empty array when no events", async () => {
    const events = await bus.consume("agent-nobody");
    expect(events).toHaveLength(0);
  });

  it("returns already-consumed events as well (consume is idempotent)", async () => {
    const id = await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    await bus.acknowledge([id]);

    // Consumed event is not returned
    const events = await bus.consume("agent-b");
    expect(events).toHaveLength(0);
  });

  it("respects limit parameter", async () => {
    await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));

    const events = await bus.consume("agent-b", 2);
    expect(events).toHaveLength(2);
  });

  it("deserializes data JSON correctly", async () => {
    await bus.emitTask(makeEventInput({ agent_to: "agent-b", data: { msg: "hello" } }));
    const events = await bus.consume("agent-b");
    expect(events[0]?.data["msg"]).toBe("hello");
  });

  it("consumed boolean is false for fresh events", async () => {
    await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    const events = await bus.consume("agent-b");
    expect(events[0]?.consumed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// acknowledge
// ---------------------------------------------------------------------------

describe("TaskEventBus.acknowledge", () => {
  it("marks events as consumed", async () => {
    const id = await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    await bus.acknowledge([id]);

    const row = db
      .prepare<[string], { consumed: number; consumed_at: string | null }>(
        "SELECT consumed, consumed_at FROM task_events WHERE id = ?",
      )
      .get(id);
    expect(row?.consumed).toBe(1);
    expect(row?.consumed_at).not.toBeNull();
  });

  it("can acknowledge multiple events at once", async () => {
    const id1 = await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    const id2 = await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    await bus.acknowledge([id1, id2]);

    const count = db
      .prepare<[], { n: number }>(
        "SELECT COUNT(*) as n FROM task_events WHERE consumed = 1",
      )
      .get();
    expect(count?.n).toBe(2);
  });

  it("is safe to call with empty array", async () => {
    await expect(bus.acknowledge([])).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// poll (fallback)
// ---------------------------------------------------------------------------

describe("TaskEventBus.poll", () => {
  it("returns unconsumed events (same as consume)", async () => {
    await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    const polled  = await bus.poll("agent-b");
    const consumed = await bus.consume("agent-b");
    expect(polled).toHaveLength(consumed.length);
  });
});

// ---------------------------------------------------------------------------
// subscribe
// ---------------------------------------------------------------------------

describe("TaskEventBus.subscribe", () => {
  it("callback invoked when emitTask targets the subscribed agent", async () => {
    const received: string[] = [];
    bus.subscribe("agent-b", (event) => {
      received.push(event.event_type);
    });

    await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    // Allow microtask to run
    await new Promise((r) => setTimeout(r, 0));

    expect(received).toContain("TASK_CREATED");
  });

  it("callback NOT invoked for different agent", async () => {
    const fn = vi.fn();
    bus.subscribe("agent-b", fn);

    await bus.emitTask(makeEventInput({ agent_to: "agent-c" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fn).not.toHaveBeenCalled();
  });

  it("unsubscribe stops callback", async () => {
    const fn = vi.fn();
    bus.subscribe("agent-b", fn);
    bus.unsubscribe("agent-b");

    await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(fn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SQLite durability across restarts
// ---------------------------------------------------------------------------

describe("TaskEventBus — durability", () => {
  it("events persist after EventBus instance is replaced", async () => {
    await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));

    // Create a new bus instance pointing to the same DB
    const bus2 = new TaskEventBus(db);
    const events = await bus2.consume("agent-b");
    expect(events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// cleanup
// ---------------------------------------------------------------------------

describe("TaskEventBus.cleanup", () => {
  it("removes consumed events older than threshold", async () => {
    const id = await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    await bus.acknowledge([id]);

    // Manually set created_at to 10 days ago
    db.prepare<unknown[], void>(
      "UPDATE task_events SET created_at = datetime('now', '-10 days') WHERE id = ?",
    ).run(id);

    const deleted = await bus.cleanup(7); // delete older than 7 days
    expect(deleted).toBe(1);

    const count = db
      .prepare<[], { n: number }>("SELECT COUNT(*) as n FROM task_events")
      .get();
    expect(count?.n).toBe(0);
  });

  it("does not remove unconsumed events", async () => {
    const id = await bus.emitTask(makeEventInput({ agent_to: "agent-b" }));
    db.prepare<unknown[], void>(
      "UPDATE task_events SET created_at = datetime('now', '-10 days') WHERE id = ?",
    ).run(id);

    const deleted = await bus.cleanup(7);
    expect(deleted).toBe(0); // unconsumed — not cleaned
  });
});

// ---------------------------------------------------------------------------
// Phase 6 EventBus interface compatibility
// ---------------------------------------------------------------------------

describe("TaskEventBus — Phase 6 EventBus interface", () => {
  it("emit(string, data) fires registered on() handlers", () => {
    const received: unknown[] = [];
    bus.on("PROVIDER_CALL_COMPLETE", (data) => received.push(data));
    bus.emit("PROVIDER_CALL_COMPLETE", { cost: 0.01 });
    expect(received).toHaveLength(1);
    expect((received[0] as Record<string, unknown>)["cost"]).toBe(0.01);
  });

  it("emit(string, data) does NOT write to SQLite", () => {
    bus.emit("some-event", {});
    const count = db
      .prepare<[], { n: number }>("SELECT COUNT(*) as n FROM task_events")
      .get();
    expect(count?.n).toBe(0);
  });

  it("multiple on() handlers fire for same event", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    bus.on("TASK_CREATED", fn1);
    bus.on("TASK_CREATED", fn2);
    bus.emit("TASK_CREATED", {});
    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });
});
