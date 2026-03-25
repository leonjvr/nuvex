// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/messaging/command-handler.ts
 *
 * Covers:
 * - /help returns list of all commands
 * - /status returns agent count, task count, budget info
 * - /agents returns agent list with status
 * - /tasks with no args returns recent tasks
 * - /tasks with ID returns single task detail
 * - /tasks with unknown ID returns not found
 * - /costs returns monthly summary
 * - /costs today returns daily summary
 * - /budget returns overall budget status
 * - /divisions returns division overview
 * - /schedule list returns configured schedules
 * - /schedule list (no args) same as /schedule list
 * - /pause requires admin role (viewer/user rejected)
 * - /pause with agent-id pauses specific agent
 * - /pause without args pauses all agents
 * - /resume requires admin role
 * - /resume with agent-id resumes specific agent
 * - /resume without args resumes all agents
 * - /cancel requires admin role
 * - /cancel without args shows usage
 * - /cancel with task-id cancels specific task
 * - unknown command returns error + help hint
 * - command handler errors caught and reported to user
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CommandHandler } from "../../src/messaging/command-handler.js";
import type {
  OrchestratorLike,
  TaskStoreLike,
  BudgetTrackerLike,
  CronSchedulerLike,
  AgentStatus,
  DivisionStatus,
  TaskSummary,
} from "../../src/messaging/command-handler.js";
import type { MessageEnvelope, UserMapping } from "../../src/messaging/types.js";
import { setGlobalLevel, resetLogger } from "../../src/core/logger.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEnvelope(text = "/help"): MessageEnvelope {
  return {
    id:          "msg-1",
    instance_id: "tg-1",
    channel:     "telegram",
    sender:      { platform_id: "plat-1", display_name: "Alice", verified: true },
    content:     { text },
    metadata:    { timestamp: new Date().toISOString(), chat_id: "chat-1", platform_raw: {} },
  };
}

function makeUser(role: "viewer" | "user" | "admin" = "user"): UserMapping {
  return {
    sidjua_user_id:   "user-alice",
    instance_id:      "tg-1",
    platform_user_id: "plat-1",
    role,
    created_at:       new Date().toISOString(),
  };
}

const AGENTS: AgentStatus[] = [
  { id: "agent-1", status: "running", tier: 1, active_tasks: 2 },
  { id: "agent-2", status: "idle",    tier: 2, active_tasks: 0 },
];

const DIVISIONS: DivisionStatus[] = [
  { name: "engineering", agent_count: 3, active_tasks: 5 },
  { name: "operations",  agent_count: 1, active_tasks: 1 },
];

const TASKS: TaskSummary[] = [
  { id: "aaaa-1111-bbbb-cccc-dddddddddddd", status: "RUNNING",  description: "Deploy service", assigned_agent: "agent-1", cost_used: 0.10 },
  { id: "eeee-2222-ffff-gggg-hhhhhhhhhhhh", status: "PENDING",  description: "Review PR",      assigned_agent: null,       cost_used: 0.00 },
];

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeMocks() {
  const orchestrator: OrchestratorLike = {
    getAgentStatuses:   vi.fn(() => AGENTS),
    getDivisionStatuses: vi.fn(() => DIVISIONS),
    pauseAgent:         vi.fn(async () => undefined),
    resumeAgent:        vi.fn(async () => undefined),
    pauseAll:           vi.fn(async () => undefined),
    resumeAll:          vi.fn(async () => undefined),
    cancelTask:         vi.fn(async () => undefined),
  };

  const taskStore: TaskStoreLike = {
    get:               vi.fn((id: string) => TASKS.find((t) => t.id === id) ?? null),
    getActiveTaskCount: vi.fn(() => 3),
    getRecentTasks:    vi.fn(() => TASKS),
  };

  const budgetTracker: BudgetTrackerLike = {
    getDailySummary:   vi.fn(() => ({ spent: 1.23, limit: 10.00, tasks_count: 5 })),
    getMonthlySummary: vi.fn(() => ({ spent: 45.67, limit: 200.00, today: 1.23, tasks_count: 42 })),
    getOverallStatus:  vi.fn(() => ({ spent: 45.67, total: 200.00, percent_used: 22.8, remaining: 154.33 })),
  };

  const cronScheduler: CronSchedulerLike = {
    listSchedules: vi.fn(() => [
      { id: "sched-11112222-3333-4444", enabled: true, cron_expression: "0 9 * * *", task_template: { description: "Daily standup" } },
    ]),
  };

  const responseRouter = {
    sendDirectMessage: vi.fn(async () => undefined),
  };

  return { orchestrator, taskStore, budgetTracker, cronScheduler, responseRouter };
}

function makeHandler(mocks: ReturnType<typeof makeMocks>): CommandHandler {
  return new CommandHandler(
    mocks.orchestrator,
    mocks.taskStore,
    mocks.budgetTracker,
    mocks.cronScheduler,
    mocks.responseRouter as never,
  );
}

function sentMessage(mocks: ReturnType<typeof makeMocks>): string {
  const calls = (mocks.responseRouter.sendDirectMessage as ReturnType<typeof vi.fn>).mock.calls;
  return (calls[0]?.[1] as string) ?? "";
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  setGlobalLevel("error");
});

afterEach(() => {
  resetLogger();
});

// ---------------------------------------------------------------------------
// Tests — help
// ---------------------------------------------------------------------------

describe("/help", () => {
  it("returns all registered commands", async () => {
    const mocks = makeMocks();
    const h = makeHandler(mocks);
    await h.handle(makeEnvelope("/help"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("Verfügbare Befehle:");
    expect(msg).toContain("/help");
    expect(msg).toContain("/status");
    expect(msg).toContain("/pause");
    expect(msg).toContain("/cancel");
  });

  it("lists all 11 commands", async () => {
    const mocks = makeMocks();
    const h = makeHandler(mocks);
    await h.handle(makeEnvelope("/help"), makeUser());
    const msg = sentMessage(mocks);
    const cmds = ["help","status","agents","tasks","costs","budget","divisions","schedule","pause","resume","cancel"];
    for (const cmd of cmds) expect(msg).toContain(`/${cmd}`);
  });
});

// ---------------------------------------------------------------------------
// Tests — /status
// ---------------------------------------------------------------------------

describe("/status", () => {
  it("returns agent counts, task count, and budget", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/status"), makeUser());
    const msg = sentMessage(mocks);
    // 1 running agent out of 2
    expect(msg).toContain("1/2 Agents aktiv");
    expect(msg).toContain("3 Tasks laufend");
    expect(msg).toContain("1.23/10.00");
  });
});

// ---------------------------------------------------------------------------
// Tests — /agents
// ---------------------------------------------------------------------------

describe("/agents", () => {
  it("returns agent list with status and tier", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/agents"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("agent-1");
    expect(msg).toContain("running");
    expect(msg).toContain("T1");
    expect(msg).toContain("Tasks: 2");
    expect(msg).toContain("agent-2");
  });

  it("returns 'Keine Agents' when list is empty", async () => {
    const mocks = makeMocks();
    (mocks.orchestrator.getAgentStatuses as ReturnType<typeof vi.fn>).mockReturnValue([]);
    await makeHandler(mocks).handle(makeEnvelope("/agents"), makeUser());
    expect(sentMessage(mocks)).toContain("Keine Agents");
  });
});

// ---------------------------------------------------------------------------
// Tests — /tasks
// ---------------------------------------------------------------------------

describe("/tasks", () => {
  it("returns recent tasks list with no args", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/tasks"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("RUNNING");
    expect(msg).toContain("Deploy service");
    expect(msg).toContain("PENDING");
  });

  it("returns single task detail with task ID arg", async () => {
    const mocks = makeMocks();
    const taskId = TASKS[0]!.id;
    await makeHandler(mocks).handle(makeEnvelope(`/tasks ${taskId}`), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("aaaa-111");
    expect(msg).toContain("RUNNING");
    expect(msg).toContain("Deploy service");
    expect(msg).toContain("agent-1");
  });

  it("returns not found for unknown task ID", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/tasks unknown-task-id"), makeUser());
    expect(sentMessage(mocks)).toContain("nicht gefunden");
  });

  it("returns 'Keine aktiven Tasks' when list is empty", async () => {
    const mocks = makeMocks();
    (mocks.taskStore.getRecentTasks as ReturnType<typeof vi.fn>).mockReturnValue([]);
    await makeHandler(mocks).handle(makeEnvelope("/tasks"), makeUser());
    expect(sentMessage(mocks)).toContain("Keine aktiven Tasks");
  });
});

// ---------------------------------------------------------------------------
// Tests — /costs
// ---------------------------------------------------------------------------

describe("/costs", () => {
  it("returns monthly summary by default", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/costs"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("45.67");
    expect(msg).toContain("200.00");
    expect(msg).toContain("Tasks: 42");
  });

  it("returns daily summary with 'today' arg", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/costs today"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("Heute:");
    expect(msg).toContain("1.23");
    expect(msg).toContain("5 Tasks");
  });
});

// ---------------------------------------------------------------------------
// Tests — /budget
// ---------------------------------------------------------------------------

describe("/budget", () => {
  it("returns overall budget status", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/budget"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("45.67");
    expect(msg).toContain("200.00");
    expect(msg).toContain("22.8%");
    expect(msg).toContain("154.33");
  });
});

// ---------------------------------------------------------------------------
// Tests — /divisions
// ---------------------------------------------------------------------------

describe("/divisions", () => {
  it("returns division overview", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/divisions"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("engineering");
    expect(msg).toContain("3 Agents");
    expect(msg).toContain("5 Tasks");
    expect(msg).toContain("operations");
  });

  it("returns 'Keine Divisions' when empty", async () => {
    const mocks = makeMocks();
    (mocks.orchestrator.getDivisionStatuses as ReturnType<typeof vi.fn>).mockReturnValue([]);
    await makeHandler(mocks).handle(makeEnvelope("/divisions"), makeUser());
    expect(sentMessage(mocks)).toContain("Keine Divisions");
  });
});

// ---------------------------------------------------------------------------
// Tests — /schedule
// ---------------------------------------------------------------------------

describe("/schedule", () => {
  it("returns configured schedules for 'list' arg", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/schedule list"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("ON");
    expect(msg).toContain("0 9 * * *");
    expect(msg).toContain("Daily standup");
  });

  it("returns configured schedules with no args", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/schedule"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("0 9 * * *");
  });

  it("returns usage hint for unknown subcommand", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/schedule delete"), makeUser());
    expect(sentMessage(mocks)).toContain("Nutzung:");
  });

  it("returns 'Keine Schedules' when empty", async () => {
    const mocks = makeMocks();
    (mocks.cronScheduler.listSchedules as ReturnType<typeof vi.fn>).mockReturnValue([]);
    await makeHandler(mocks).handle(makeEnvelope("/schedule"), makeUser());
    expect(sentMessage(mocks)).toContain("Keine Schedules");
  });
});

// ---------------------------------------------------------------------------
// Tests — /pause (admin only)
// ---------------------------------------------------------------------------

describe("/pause", () => {
  it("rejects viewer role", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/pause"), makeUser("viewer"));
    expect(sentMessage(mocks)).toContain("Keine Berechtigung");
    expect(mocks.orchestrator.pauseAll).not.toHaveBeenCalled();
  });

  it("rejects user role", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/pause"), makeUser("user"));
    expect(sentMessage(mocks)).toContain("Keine Berechtigung");
  });

  it("pauses all agents when no agent-id given", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/pause"), makeUser("admin"));
    expect(mocks.orchestrator.pauseAll).toHaveBeenCalledOnce();
    expect(sentMessage(mocks)).toContain("Alle Agents pausiert");
  });

  it("pauses specific agent when agent-id given", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/pause agent-42"), makeUser("admin"));
    expect(mocks.orchestrator.pauseAgent).toHaveBeenCalledWith("agent-42");
    expect(sentMessage(mocks)).toContain("agent-42");
    expect(sentMessage(mocks)).toContain("pausiert");
  });
});

// ---------------------------------------------------------------------------
// Tests — /resume (admin only)
// ---------------------------------------------------------------------------

describe("/resume", () => {
  it("rejects viewer role", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/resume"), makeUser("viewer"));
    expect(sentMessage(mocks)).toContain("Keine Berechtigung");
  });

  it("resumes all agents when no agent-id given", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/resume"), makeUser("admin"));
    expect(mocks.orchestrator.resumeAll).toHaveBeenCalledOnce();
    expect(sentMessage(mocks)).toContain("Alle Agents fortgesetzt");
  });

  it("resumes specific agent when agent-id given", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/resume agent-7"), makeUser("admin"));
    expect(mocks.orchestrator.resumeAgent).toHaveBeenCalledWith("agent-7");
    expect(sentMessage(mocks)).toContain("agent-7");
  });
});

// ---------------------------------------------------------------------------
// Tests — /cancel (admin only)
// ---------------------------------------------------------------------------

describe("/cancel", () => {
  it("rejects non-admin roles", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/cancel"), makeUser("user"));
    expect(sentMessage(mocks)).toContain("Keine Berechtigung");
    expect(mocks.orchestrator.cancelTask).not.toHaveBeenCalled();
  });

  it("returns usage when no task-id given", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/cancel"), makeUser("admin"));
    expect(sentMessage(mocks)).toContain("Nutzung: /cancel");
    expect(mocks.orchestrator.cancelTask).not.toHaveBeenCalled();
  });

  it("cancels specific task", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/cancel task-abc"), makeUser("admin"));
    expect(mocks.orchestrator.cancelTask).toHaveBeenCalledWith("task-abc");
    expect(sentMessage(mocks)).toContain("task-abc");
    expect(sentMessage(mocks)).toContain("abgebrochen");
  });
});

// ---------------------------------------------------------------------------
// Tests — unknown command + error handling
// ---------------------------------------------------------------------------

describe("unknown command and error handling", () => {
  it("sends error message for unknown command", async () => {
    const mocks = makeMocks();
    await makeHandler(mocks).handle(makeEnvelope("/unknowncmd"), makeUser());
    const msg = sentMessage(mocks);
    expect(msg).toContain("Unbekannter Befehl");
    expect(msg).toContain("/unknowncmd");
    expect(msg).toContain("/help");
  });

  it("catches handler errors and reports them to user", async () => {
    const mocks = makeMocks();
    (mocks.orchestrator.pauseAll as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("service unavailable"));
    await makeHandler(mocks).handle(makeEnvelope("/pause"), makeUser("admin"));
    const msg = sentMessage(mocks);
    expect(msg).toContain("Fehler bei /pause");
    expect(msg).toContain("service unavailable");
  });
});

// ---------------------------------------------------------------------------
// Tests — getCommands() introspection
// ---------------------------------------------------------------------------

describe("getCommands()", () => {
  it("returns all 11 registered commands", () => {
    const mocks = makeMocks();
    const cmds = makeHandler(mocks).getCommands();
    expect(cmds).toHaveLength(11);
    const names = cmds.map((c) => c.name);
    expect(names).toContain("help");
    expect(names).toContain("pause");
    expect(names).toContain("cancel");
  });
});
