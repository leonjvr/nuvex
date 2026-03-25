/**
 * Phase 11c: SSE event stream tests
 *
 * Tests cover:
 *   - matchesFilters() predicate
 *   - EventStreamManager (broadcast, client tracking, shutdown)
 *   - getReplaySince() with in-memory SQLite
 *   - GET /api/v1/events endpoint (auth + headers)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import BetterSqlite3 from "better-sqlite3";

import { matchesFilters }                        from "../../../src/api/sse/event-filter.js";
import { EventStreamManager, SSE_LIMITS, type SSEWritable }  from "../../../src/api/sse/event-stream.js";
import { getReplaySince }                        from "../../../src/api/sse/event-replay.js";
import { registerEventRoutes }                   from "../../../src/api/routes/events.js";
import { registerSseTicketRoutes, clearTickets } from "../../../src/api/routes/sse-ticket.js";
import type { SSEEvent, SSEClientFilters }        from "../../../src/api/sse/event-filter.js";
import { TaskEventBus }                          from "../../../src/tasks/event-bus.js";
import { withAdminCtx }                          from "../../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<SSEEvent> = {}): SSEEvent {
  return {
    id:        1,
    type:      "task:created",
    data:      { taskId: "t-001", agentId: "sonnet-dev", divisionId: "engineering" },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Create a mock SSEWritable that records writes. */
function makeMockStream(): SSEWritable & { writes: string[] } {
  const writes: string[] = [];
  let _closed = false;

  return {
    writes,
    async writeSSE(msg) {
      writes.push(`event:${msg.event ?? ""},data:${msg.data}`);
    },
    async write(data) {
      writes.push(data);
    },
    get closed() { return _closed; },
    async close() { _closed = true; },
    async sleep(ms) { await new Promise((r) => setTimeout(r, ms)); },
    abort() { _closed = true; },
  };
}

// ---------------------------------------------------------------------------
// matchesFilters
// ---------------------------------------------------------------------------

describe("matchesFilters", () => {
  it("passes all events when no filters are set", () => {
    expect(matchesFilters(makeEvent(), {})).toBe(true);
  });

  it("filters by divisionId", () => {
    const filters: SSEClientFilters = { divisions: ["sales"] };
    expect(matchesFilters(makeEvent(), filters)).toBe(false);
    expect(matchesFilters(makeEvent({ data: { divisionId: "sales" } }), filters)).toBe(true);
  });

  it("filters by agentId", () => {
    const filters: SSEClientFilters = { agents: ["opus-lead"] };
    expect(matchesFilters(makeEvent(), filters)).toBe(false);
    expect(matchesFilters(makeEvent({ data: { agentId: "opus-lead" } }), filters)).toBe(true);
  });

  it("combines division AND agent with AND logic", () => {
    const filters: SSEClientFilters = {
      divisions: ["engineering"],
      agents:    ["sonnet-dev"],
    };
    // Both match → pass
    expect(matchesFilters(makeEvent(), filters)).toBe(true);

    // Only one matches → fail
    const wrongDivision: SSEClientFilters = {
      divisions: ["sales"],
      agents:    ["sonnet-dev"],
    };
    expect(matchesFilters(makeEvent(), wrongDivision)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EventStreamManager
// ---------------------------------------------------------------------------

describe("EventStreamManager", () => {
  let manager: EventStreamManager;

  beforeEach(() => {
    manager = new EventStreamManager();
  });

  it("tracks client count after add and remove", () => {
    expect(manager.getClientCount()).toBe(0);

    const stream = makeMockStream();
    manager.addClient({ id: "c1", stream, filters: {}, connectedAt: "", lastEventId: 0, pendingBytes: 0, lastBytesAddedAt: 0 });
    expect(manager.getClientCount()).toBe(1);

    manager.removeClient("c1");
    expect(manager.getClientCount()).toBe(0);
  });

  it("broadcasts to matching clients only", () => {
    const streamA = makeMockStream();
    const streamB = makeMockStream();

    manager.addClient({ id: "A", stream: streamA, filters: { divisions: ["engineering"] }, connectedAt: "", lastEventId: 0, pendingBytes: 0, lastBytesAddedAt: 0 });
    manager.addClient({ id: "B", stream: streamB, filters: { divisions: ["sales"] },       connectedAt: "", lastEventId: 0, pendingBytes: 0, lastBytesAddedAt: 0 });

    manager.broadcast(makeEvent({ data: { divisionId: "engineering" } }));

    // Give async writeSSE promises a tick to resolve
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(streamA.writes).toHaveLength(1);
        expect(streamB.writes).toHaveLength(0);
        resolve();
      }, 10);
    });
  });

  it("skips closed streams during broadcast", () => {
    const stream = makeMockStream();
    stream.abort(); // mark as closed

    manager.addClient({ id: "c1", stream, filters: {}, connectedAt: "", lastEventId: 0, pendingBytes: 0, lastBytesAddedAt: 0 });
    manager.broadcast(makeEvent());

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(stream.writes).toHaveLength(0);
        resolve();
      }, 10);
    });
  });

  it("shutdown sends close event and clears clients", async () => {
    const stream = makeMockStream();
    manager.addClient({ id: "c1", stream, filters: {}, connectedAt: "", lastEventId: 0, pendingBytes: 0, lastBytesAddedAt: 0 });

    manager.shutdown();

    // Give async close a tick
    await new Promise<void>((r) => setTimeout(r, 10));

    expect(manager.getClientCount()).toBe(0);
    expect(stream.writes.some((w) => w.includes("event:close"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getReplaySince
// ---------------------------------------------------------------------------

describe("getReplaySince", () => {
  it("returns events with rowid > lastEventId", () => {
    const db  = new BetterSqlite3(":memory:");
    const bus = new TaskEventBus(db);
    bus.initialize();

    // Insert two events synchronously via DB directly to get stable rowids
    db.prepare<unknown[], void>(
      `INSERT INTO task_events (id, event_type, task_id, parent_task_id, agent_from, agent_to, division, data, created_at, consumed, consumed_at)
       VALUES (?,?,?,NULL,NULL,NULL,?,?,?,0,NULL)`,
    ).run("e1", "TASK_CREATED", "t1", "engineering", "{}", new Date().toISOString());

    db.prepare<unknown[], void>(
      `INSERT INTO task_events (id, event_type, task_id, parent_task_id, agent_from, agent_to, division, data, created_at, consumed, consumed_at)
       VALUES (?,?,?,NULL,NULL,NULL,?,?,?,0,NULL)`,
    ).run("e2", "TASK_ASSIGNED", "t2", "engineering", "{}", new Date().toISOString());

    const all    = getReplaySince(db, 0, 1000, null);
    const second = getReplaySince(db, all[0]!.id, 1000, null);

    expect(all).toHaveLength(2);
    expect(second).toHaveLength(1);
    expect(second[0]!.type).toBe("task:assigned");
  });

  it("limits results by maxEvents", () => {
    const db  = new BetterSqlite3(":memory:");
    const bus = new TaskEventBus(db);
    bus.initialize();

    for (let i = 0; i < 5; i++) {
      db.prepare<unknown[], void>(
        `INSERT INTO task_events (id, event_type, task_id, parent_task_id, agent_from, agent_to, division, data, created_at, consumed, consumed_at)
         VALUES (?,?,?,NULL,NULL,NULL,?,?,?,0,NULL)`,
      ).run(`e${i}`, "TASK_CREATED", `t${i}`, "engineering", "{}", new Date().toISOString());
    }

    const limited = getReplaySince(db, 0, 3, null);
    expect(limited).toHaveLength(3);
  });

  it("returns empty array when table does not exist", () => {
    const db = new BetterSqlite3(":memory:");
    // table not created
    expect(getReplaySince(db, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/events
// ---------------------------------------------------------------------------

describe("GET /api/v1/events", () => {
  const API_KEY = "test-api-key-123";

  function makeApp(): Hono {
    const app = new Hono();
    app.use("*", withAdminCtx);
    registerSseTicketRoutes(app, { getApiKey: () => API_KEY });
    registerEventRoutes(app, {
      getApiKey:           () => API_KEY,
      manager:             new EventStreamManager(),
      keepaliveIntervalMs: 60_000, // long so it doesn't fire during tests
    });
    return app;
  }

  /** Obtain a fresh one-time-use ticket via the ticket endpoint. */
  async function getTicket(app: Hono): Promise<string> {
    const res = await app.request("/api/v1/sse/ticket", {
      method:  "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const body = await res.json() as { ticket: string };
    return body.ticket;
  }

  beforeEach(() => { clearTickets(); });

  it("returns 401 for missing auth", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/events");

    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("AUTH-001");
  });

  it("returns 401 and rejects deprecated token= query parameter", async () => {
    const app = makeApp();
    const res = await app.request(`/api/v1/events?token=${API_KEY}`);

    expect(res.status).toBe(401);
    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toContain("token= query parameter is not accepted");
  });

  it("returns 200 with SSE headers for valid ticket", async () => {
    const app    = makeApp();
    const ticket = await getTicket(app);
    const res    = await app.request(`/api/v1/events?ticket=${ticket}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");

    // Cancel the stream so the test can complete
    await res.body?.cancel();
  });

  it("registers and removes client from manager on connect", async () => {
    const manager = new EventStreamManager();
    const app     = new Hono();
    app.use("*", withAdminCtx);
    registerSseTicketRoutes(app, { getApiKey: () => API_KEY });
    registerEventRoutes(app, { getApiKey: () => API_KEY, manager, keepaliveIntervalMs: 60_000 });

    const ticket = await getTicket(app);
    const res    = await app.request(`/api/v1/events?ticket=${ticket}`);
    expect(res.status).toBe(200);

    // Client should be registered immediately after response is returned
    expect(manager.getClientCount()).toBe(1);

    // Clean up
    await res.body?.cancel();
  });
});

// ---------------------------------------------------------------------------
// SSE_LIMITS constants
// ---------------------------------------------------------------------------

describe("SSE_LIMITS constants", () => {
  it("CLEANUP_INTERVAL_MS is 10_000", () => {
    expect(SSE_LIMITS.CLEANUP_INTERVAL_MS).toBe(10_000);
  });

  it("WRITE_TIMEOUT_MS is 30_000", () => {
    expect(SSE_LIMITS.WRITE_TIMEOUT_MS).toBe(30_000);
  });

  it("HIGH_WATER_MARK_BYTES is 64 KiB", () => {
    expect(SSE_LIMITS.HIGH_WATER_MARK_BYTES).toBe(64 * 1024);
  });
});

// ---------------------------------------------------------------------------
// EventStreamManager — backpressure and sweep
// ---------------------------------------------------------------------------

describe("EventStreamManager — backpressure and sweep", () => {
  let manager: EventStreamManager;

  afterEach(() => {
    manager.shutdown();
  });

  it("broadcast disconnects slow client exceeding high-water mark", async () => {
    manager = new EventStreamManager();
    const stream = makeMockStream();

    manager.addClient({
      id: "slow", stream, filters: {}, connectedAt: "",
      lastEventId: 0, pendingBytes: SSE_LIMITS.HIGH_WATER_MARK_BYTES, lastBytesAddedAt: 0,
    });

    // Any broadcast will push pendingBytes over the limit
    await manager.broadcast(makeEvent({ data: { x: "y" } }));

    expect(stream.closed).toBe(true);
    expect(manager.getClientCount()).toBe(0);
  });

  it("broadcast tracks lastBytesAddedAt and pendingBytes", async () => {
    manager = new EventStreamManager();
    let resolveWrite!: () => void;

    const stream: SSEWritable & { writes: string[] } = {
      writes: [],
      async writeSSE() {
        // Simulate a slow write that we control manually
        await new Promise<void>((r) => { resolveWrite = r; });
      },
      async write() {},
      get closed() { return false; },
      async close() {},
      async sleep(ms) { await new Promise((r) => setTimeout(r, ms)); },
      abort() {},
    };

    manager.addClient({
      id: "c1", stream, filters: {}, connectedAt: "",
      lastEventId: 0, pendingBytes: 0, lastBytesAddedAt: 0,
    });

    // Start the broadcast (don't await — write is blocked)
    const broadcastDone = manager.broadcast(makeEvent());

    // Give it a tick so pendingBytes gets set
    await new Promise<void>((r) => setTimeout(r, 5));

    const client = (manager as unknown as { clients: Map<string, { pendingBytes: number; lastBytesAddedAt: number }> }).clients.get("c1");
    expect(client).toBeDefined();
    expect(client!.pendingBytes).toBeGreaterThan(0);
    expect(client!.lastBytesAddedAt).toBeGreaterThan(0);

    // Resolve the write so the promise completes
    resolveWrite();
    await broadcastDone;

    // After resolution, pendingBytes should be 0 and lastBytesAddedAt cleared
    expect(client!.pendingBytes).toBe(0);
    expect(client!.lastBytesAddedAt).toBe(0);
  });

  it("_sweepClosed evicts clients with pendingBytes > HIGH_WATER_MARK_BYTES", async () => {
    manager = new EventStreamManager();
    const stream = makeMockStream();

    manager.addClient({
      id: "slow", stream, filters: {}, connectedAt: "",
      lastEventId: 0,
      pendingBytes: SSE_LIMITS.HIGH_WATER_MARK_BYTES + 1,
      lastBytesAddedAt: Date.now(),
    });

    // Trigger sweep manually via private method
    (manager as unknown as { _sweepClosed(): void })._sweepClosed();

    expect(stream.closed).toBe(true);
    expect(manager.getClientCount()).toBe(0);
  });

  it("_sweepClosed evicts clients whose write has timed out", async () => {
    manager = new EventStreamManager();
    const stream = makeMockStream();

    // Simulate a write that started WRITE_TIMEOUT_MS + 1 ms ago
    const staleTime = Date.now() - (SSE_LIMITS.WRITE_TIMEOUT_MS + 1);
    manager.addClient({
      id: "stalled", stream, filters: {}, connectedAt: "",
      lastEventId: 0, pendingBytes: 100, lastBytesAddedAt: staleTime,
    });

    (manager as unknown as { _sweepClosed(): void })._sweepClosed();

    expect(stream.closed).toBe(true);
    expect(manager.getClientCount()).toBe(0);
  });

  it("_sweepClosed does NOT evict clients whose writes are within timeout", () => {
    manager = new EventStreamManager();
    const stream = makeMockStream();

    manager.addClient({
      id: "ok", stream, filters: {}, connectedAt: "",
      lastEventId: 0, pendingBytes: 100, lastBytesAddedAt: Date.now(),
    });

    (manager as unknown as { _sweepClosed(): void })._sweepClosed();

    expect(stream.closed).toBe(false);
    expect(manager.getClientCount()).toBe(1);
  });

  it("_sweepClosed does NOT disconnect a client with pendingBytes=0 (no outstanding writes)", () => {
    manager = new EventStreamManager();
    const stream = makeMockStream();

    manager.addClient({
      id: "idle", stream, filters: {}, connectedAt: "",
      lastEventId: 0, pendingBytes: 0, lastBytesAddedAt: 0,
    });

    (manager as unknown as { _sweepClosed(): void })._sweepClosed();

    expect(stream.closed).toBe(false);
    expect(manager.getClientCount()).toBe(1);
  });
});
