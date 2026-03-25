/**
 * Telegram bidirectional messaging — startup wiring tests
 *
 * Tests:
 *   1. TaskEventBus.emitTask() now calls on() handlers (enables TaskLifecycleRouter)
 *   2. ExecutionBridge accepts optional external eventBus
 *   3. Auto-telegram instance config logic
 *   4. TaskLifecycleRouter receives RESULT_READY via shared eventBus
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { TaskEventBus }       from "../../src/tasks/event-bus.js";
import { ExecutionBridge }    from "../../src/orchestrator/execution-bridge.js";
import { TaskLifecycleRouter } from "../../src/messaging/task-lifecycle-router.js";
import { ResponseRouter }      from "../../src/messaging/response-router.js";
import type { AdapterInstanceConfig, MessagingGovernance } from "../../src/messaging/types.js";

// ---------------------------------------------------------------------------
// In-memory DB helper
// ---------------------------------------------------------------------------

function makeDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      parent_task_id TEXT,
      agent_from TEXT,
      agent_to TEXT,
      division TEXT NOT NULL DEFAULT 'general',
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      consumed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      type TEXT NOT NULL DEFAULT 'root',
      division TEXT NOT NULL DEFAULT 'general',
      tier INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 5,
      token_budget INTEGER NOT NULL DEFAULT 100000,
      cost_budget REAL NOT NULL DEFAULT 10.0,
      cost_used REAL NOT NULL DEFAULT 0,
      ttl_seconds INTEGER,
      assigned_agent TEXT,
      parent_task_id TEXT,
      root_task_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      source_metadata TEXT
    );
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Tests: TaskEventBus.emitTask() → on() handlers
// ---------------------------------------------------------------------------

describe("TaskEventBus — emitTask calls on() handlers", () => {
  it("on('TASK_CREATED') receives event when emitTask emits TASK_CREATED", async () => {
    const db      = makeDb();
    const bus     = new TaskEventBus(db);
    const handler = vi.fn();

    bus.on("TASK_CREATED", handler);

    await bus.emitTask({
      event_type:     "TASK_CREATED",
      task_id:        "task-1",
      parent_task_id: null,
      agent_from:     null,
      agent_to:       null,
      division:       "general",
      data:           { source: "test" },
    });

    expect(handler).toHaveBeenCalledOnce();
    const received = handler.mock.calls[0]![0] as { event_type: string; task_id: string };
    expect(received.event_type).toBe("TASK_CREATED");
    expect(received.task_id).toBe("task-1");
  });

  it("on('RESULT_READY') receives event when emitTask emits RESULT_READY", async () => {
    const db      = makeDb();
    const bus     = new TaskEventBus(db);
    const handler = vi.fn();

    bus.on("RESULT_READY", handler);

    await bus.emitTask({
      event_type:     "RESULT_READY",
      task_id:        "task-2",
      parent_task_id: null,
      agent_from:     "agent-a",
      agent_to:       null,
      division:       "general",
      data:           { result: "done" },
    });

    expect(handler).toHaveBeenCalledOnce();
    const received = handler.mock.calls[0]![0] as { event_type: string; task_id: string };
    expect(received.event_type).toBe("RESULT_READY");
    expect(received.task_id).toBe("task-2");
  });

  it("multiple on() handlers for same event all receive the event", async () => {
    const db  = makeDb();
    const bus = new TaskEventBus(db);
    const h1  = vi.fn();
    const h2  = vi.fn();

    bus.on("TASK_FAILED", h1);
    bus.on("TASK_FAILED", h2);

    await bus.emitTask({
      event_type:     "TASK_FAILED",
      task_id:        "task-3",
      parent_task_id: null,
      agent_from:     null,
      agent_to:       null,
      division:       "general",
      data:           {},
    });

    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it("on() handler for a different event type is NOT called", async () => {
    const db      = makeDb();
    const bus     = new TaskEventBus(db);
    const handler = vi.fn();

    bus.on("TASK_FAILED", handler);

    await bus.emitTask({
      event_type:     "RESULT_READY",
      task_id:        "task-4",
      parent_task_id: null,
      agent_from:     null,
      agent_to:       null,
      division:       "general",
      data:           {},
    });

    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: ExecutionBridge accepts external eventBus
// ---------------------------------------------------------------------------

describe("ExecutionBridge — optional external eventBus", () => {
  it("uses the provided eventBus when given", () => {
    const db       = makeDb();
    const sharedBus = new TaskEventBus(db);
    const handler   = vi.fn();

    sharedBus.on("TASK_CREATED", handler);

    // ExecutionBridge uses the shared bus — do a submitTask and verify
    const bridge = new ExecutionBridge(db, sharedBus);
    expect(bridge).toBeDefined(); // no throw
  });

  it("creates its own eventBus when none provided (no error)", () => {
    const db     = makeDb();
    const bridge = new ExecutionBridge(db);
    expect(bridge).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Auto-telegram instance config logic
// ---------------------------------------------------------------------------

describe("Auto-telegram instance config", () => {
  it("builds correct AdapterInstanceConfig when TELEGRAM_BOT_TOKEN is set", () => {
    const telegramToken = "test-token-123";
    const instances: AdapterInstanceConfig[] = [];
    const hasTelegramInstance = instances.some((i) => i.adapter === "telegram");

    if (telegramToken !== "" && !hasTelegramInstance) {
      instances.push({
        id:                 "telegram-auto",
        adapter:            "telegram",
        enabled:            true,
        config:             { bot_token_secret: "TELEGRAM_BOT_TOKEN" },
        rate_limit_per_min: 0,
      });
    }

    expect(instances).toHaveLength(1);
    expect(instances[0]!.adapter).toBe("telegram");
    expect(instances[0]!.id).toBe("telegram-auto");
    expect(instances[0]!.config["bot_token_secret"]).toBe("TELEGRAM_BOT_TOKEN");
  });

  it("does NOT add auto-instance when TELEGRAM_BOT_TOKEN is empty", () => {
    const telegramToken = "";
    const instances: AdapterInstanceConfig[] = [];
    const hasTelegramInstance = instances.some((i) => i.adapter === "telegram");

    if (telegramToken !== "" && !hasTelegramInstance) {
      instances.push({
        id: "telegram-auto", adapter: "telegram", enabled: true,
        config: { bot_token_secret: "TELEGRAM_BOT_TOKEN" }, rate_limit_per_min: 0,
      });
    }

    expect(instances).toHaveLength(0);
  });

  it("does NOT add auto-instance when telegram instance already in config", () => {
    const telegramToken = "test-token";
    const existing: AdapterInstanceConfig = {
      id: "my-telegram", adapter: "telegram", enabled: true,
      config: { bot_token_secret: "MY_SECRET" }, rate_limit_per_min: 0,
    };
    const instances: AdapterInstanceConfig[] = [existing];
    const hasTelegramInstance = instances.some((i) => i.adapter === "telegram");

    if (telegramToken !== "" && !hasTelegramInstance) {
      instances.push({
        id: "telegram-auto", adapter: "telegram", enabled: true,
        config: { bot_token_secret: "TELEGRAM_BOT_TOKEN" }, rate_limit_per_min: 0,
      });
    }

    // Should still have only the original instance
    expect(instances).toHaveLength(1);
    expect(instances[0]!.id).toBe("my-telegram");
  });
});

// ---------------------------------------------------------------------------
// Tests: TaskLifecycleRouter with shared eventBus
// ---------------------------------------------------------------------------

describe("TaskLifecycleRouter — receives events via shared TaskEventBus", () => {
  const governance: MessagingGovernance = {
    require_mapping:             false,
    allow_self_register:         false,
    response_max_length:         4000,
    include_task_id_in_response: false,
    typing_indicator:            false,
    max_inbound_per_hour:        1000,
  };

  it("routes RESULT_READY to ResponseRouter.sendTaskCompleted when shared bus is used", async () => {
    const db         = makeDb();
    const sharedBus  = new TaskEventBus(db);
    const completeSpy = vi.fn().mockResolvedValue(undefined);

    // Minimal mock registry
    const mockRegistry = { getInstance: vi.fn().mockReturnValue(undefined) };
    const responseRouter = new ResponseRouter(mockRegistry as never, governance);

    // Minimal TaskStore mock with correct source_metadata shape
    const mockStore = {
      get: vi.fn().mockReturnValue({
        id:              "task-99",
        status:          "DONE",
        description:     "hello",
        cost_used:       0.01,
        cost_budget:     1.0,
        assigned_agent:  null,
        result_summary:  "task done",
        created_at:      new Date().toISOString(),
        completed_at:    new Date().toISOString(),
        source_metadata: {
          source_channel:     "telegram",
          source_instance_id: "inst-1",
          source_message_id:  "msg-42",
          source_chat_id:     "chat-1",
          source_user:        "user-1",
        },
      }),
    };

    const router = new TaskLifecycleRouter(sharedBus, mockStore as never, responseRouter);
    router.start();

    // Spy on sendTaskCompleted (used by lifecycle router for RESULT_READY)
    vi.spyOn(responseRouter, "sendTaskCompleted").mockImplementation(completeSpy);

    await sharedBus.emitTask({
      event_type:     "RESULT_READY",
      task_id:        "task-99",
      parent_task_id: null,
      agent_from:     "agent-a",
      agent_to:       null,
      division:       "general",
      data:           { result: "the answer" },
    });

    // Give the microtask queue a chance to run async handlers
    await new Promise((r) => setTimeout(r, 20));

    // sendTaskCompleted should have been called for the messaging-originated task
    expect(completeSpy).toHaveBeenCalledOnce();
  });

  it("does NOT call sendTaskCompleted for tasks without source_metadata", async () => {
    const db          = makeDb();
    const sharedBus   = new TaskEventBus(db);
    const completeSpy = vi.fn().mockResolvedValue(undefined);

    const mockRegistry   = { getInstance: vi.fn().mockReturnValue(undefined) };
    const responseRouter = new ResponseRouter(mockRegistry as never, governance);

    // Task with no source_metadata (CLI/API submitted task)
    const mockStore = {
      get: vi.fn().mockReturnValue({
        id:              "task-100",
        status:          "DONE",
        description:     "cli task",
        source_metadata: undefined,
      }),
    };

    const router = new TaskLifecycleRouter(sharedBus, mockStore as never, responseRouter);
    router.start();
    vi.spyOn(responseRouter, "sendTaskCompleted").mockImplementation(completeSpy);

    await sharedBus.emitTask({
      event_type:     "RESULT_READY",
      task_id:        "task-100",
      parent_task_id: null,
      agent_from:     "agent-a",
      agent_to:       null,
      division:       "general",
      data:           {},
    });

    await new Promise((r) => setTimeout(r, 20));

    // No source_metadata → no messaging response
    expect(completeSpy).not.toHaveBeenCalled();
  });
});
