/**
 * Phase 16 → P268: Budget enforcement delegation tests
 *
 * P268 removed executeTaskInline entirely. Budget enforcement is now the
 * orchestrator's responsibility. These tests verify P268 compliance:
 * run.ts no longer performs inline budget checks or inline LLM execution.
 *
 * The original inline budget tests were deleted by P268 because they tested
 * a code path that was removed to fix governance bypass (B6 #519).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase } from "../../src/utils/db.js";
import { PHASE9_SCHEMA_SQL } from "../../src/orchestrator/types.js";
import { TaskStore } from "../../src/tasks/store.js";
import { runMigrations105, AgentRegistry } from "../../src/agent-lifecycle/index.js";

// ---------------------------------------------------------------------------
// Hoist mock state so factories can capture by reference
// ---------------------------------------------------------------------------

const { mockExecuteTask } = vi.hoisted(() => ({
  mockExecuteTask: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks — only AgentReasoningLoop and its deps to prevent LLM calls
// ---------------------------------------------------------------------------

vi.mock("../../src/agents/reasoning-loop.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AgentReasoningLoop: vi.fn().mockImplementation(function(this: any) {
    this.executeTask = mockExecuteTask;
  }),
  DEFAULT_REASONING_CONFIG: {
    1: { max_turns_per_task: 20, max_tool_calls_per_task: 50, checkpoint_every_n_turns: 5, turn_timeout_ms: 120_000, context_window_limit: 150_000 },
    2: { max_turns_per_task: 15, max_tool_calls_per_task: 50, checkpoint_every_n_turns: 5, turn_timeout_ms: 120_000, context_window_limit: 150_000 },
    3: { max_turns_per_task: 10, max_tool_calls_per_task: 50, checkpoint_every_n_turns: 5, turn_timeout_ms: 120_000, context_window_limit: 150_000 },
  },
}));

vi.mock("../../src/providers/adapters/anthropic-adapter.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AnthropicAdapter: vi.fn().mockImplementation(function(this: any) {
    this.chatWithTools  = vi.fn();
    this.getModels      = vi.fn().mockReturnValue([]);
    this.estimateTokens = vi.fn().mockReturnValue(100);
  }),
}));

vi.mock("../../src/providers/tool-response-parser.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ToolResponseParser:   vi.fn().mockImplementation(function(this: any) { void this; }),
  AGENT_DECISION_TOOLS: [],
}));

vi.mock("../../src/agents/prompt-builder.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PromptBuilder: vi.fn().mockImplementation(function(this: any) {
    this.buildSystemPrompt = vi.fn().mockReturnValue("system");
    this.buildTaskPrompt   = vi.fn().mockReturnValue("task");
  }),
}));

vi.mock("../../src/agents/memory.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MemoryManager: vi.fn().mockImplementation(function(this: any) {
    this.getRelevantMemories = vi.fn().mockResolvedValue("");
    this.appendShortTerm     = vi.fn().mockResolvedValue(undefined);
    this.serialize           = vi.fn().mockReturnValue("");
  }),
}));

vi.mock("../../src/agents/checkpoint.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CheckpointManager: vi.fn().mockImplementation(function(this: any) {
    this.save = vi.fn().mockResolvedValue(undefined);
  }),
}));

// Import SUT after mocks
import { runRunCommand } from "../../src/cli/commands/run.js";

// ---------------------------------------------------------------------------
// Output capture
// ---------------------------------------------------------------------------

let stdout = "";
let stderr = "";
let stdoutSpy: ReturnType<typeof vi.spyOn> | null = null;
let stderrSpy: ReturnType<typeof vi.spyOn> | null = null;

function captureOutput(): void {
  stdout = "";
  stderr = "";
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((c) => { stdout += String(c); return true; });
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((c) => { stderr += String(c); return true; });
}

function restoreOutput(): void {
  stdoutSpy?.mockRestore();
  stderrSpy?.mockRestore();
  stdoutSpy = null;
  stderrSpy = null;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let dbFile: string;

const COST_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS cost_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    division_code TEXT NOT NULL DEFAULT '',
    agent_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    task_id TEXT,
    cost_type TEXT NOT NULL DEFAULT 'llm_call',
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS cost_budgets (
    division_code TEXT PRIMARY KEY,
    monthly_limit_usd REAL,
    daily_limit_usd REAL,
    alert_threshold_percent REAL NOT NULL DEFAULT 80
  );
`;

function createTestAgent(db: ReturnType<typeof openDatabase>): void {
  const registry = new AgentRegistry(db);
  registry.create({
    schema_version: "1.0",
    id:             "test-agent",
    name:           "Test Agent",
    tier:           2,
    division:       "engineering",
    provider:       "anthropic",
    model:          "claude-haiku-4-5-20251001",
    skill:          "agents/skills/test.md",
    capabilities:   [],
    budget:         { per_task_usd: 2.00, per_month_usd: 50.00 },
    max_concurrent_tasks:        1,
    checkpoint_interval_seconds: 60,
    ttl_default_seconds:         3600,
    heartbeat_interval_seconds:  30,
    created_at: new Date().toISOString(),
    created_by: "test",
    tags:       [],
  });
}

/** Insert a daily budget limit that has already been exceeded. */
function setDailyBudget(db: ReturnType<typeof openDatabase>, division: string, limitUsd: number): void {
  db.prepare<unknown[], void>(
    `INSERT OR REPLACE INTO cost_budgets (division_code, daily_limit_usd) VALUES (?, ?)`,
  ).run(division, limitUsd);
}

/** Insert a cost row that counts against today's spend. */
function insertTodayCost(db: ReturnType<typeof openDatabase>, division: string, costUsd: number): void {
  db.prepare<unknown[], void>(`
    INSERT INTO cost_ledger (division_code, agent_id, provider, model, input_tokens, output_tokens, cost_usd)
    VALUES (?, 'test-agent', 'anthropic', 'claude-haiku-4-5-20251001', 100, 50, ?)
  `).run(division, costUsd);
}

function openTestDb(): ReturnType<typeof openDatabase> {
  const db = openDatabase(dbFile);
  db.pragma("journal_mode = WAL");
  return db;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-run-budget-"));
  dbFile = join(tmpDir, ".system", "sidjua.db");
  mkdirSync(join(tmpDir, ".system"), { recursive: true });

  const db = openTestDb();
  db.exec(PHASE9_SCHEMA_SQL);
  db.exec(COST_TABLE_SQL);
  new TaskStore(db).initialize();
  runMigrations105(db);
  createTestAgent(db);
  db.close();

  mockExecuteTask.mockResolvedValue({
    success:        true,
    decision:       { type: "execute_result", result: "done", summary: "Task done", confidence: 0.9 },
    turns_taken:    1,
    total_tokens:   100,
    total_cost_usd: 0.001,
    messages:       [],
  });

  captureOutput();
  process.env["ANTHROPIC_API_KEY"] = "test-key";
});

afterEach(() => {
  // Only clear call history — do NOT restore implementations (vi.fn() mocks lose mockImplementation)
  vi.clearAllMocks();
  // Explicitly restore the stdout/stderr spies
  restoreOutput();
  delete process.env["ANTHROPIC_API_KEY"];
  rmSync(tmpDir, { recursive: true });
});

const BASE_OPTS = {
  workDir:     "",
  description: "Test task",
  file:        undefined as string | undefined,
  priority:    "regular",
  division:    "engineering",
  budget:      undefined as number | undefined,
  costLimit:   undefined as number | undefined,
  tier:        2,
  wait:        true,
  timeout:     30,
  json:        false,
};

function makeOpts(o: Partial<typeof BASE_OPTS> = {}): typeof BASE_OPTS {
  return { ...BASE_OPTS, workDir: tmpDir, ...o };
}

// ---------------------------------------------------------------------------
// P268 compliance: inline execution and inline budget checks are gone
// ---------------------------------------------------------------------------

describe("P268: run.ts delegates budget enforcement to orchestrator", () => {
  it("run.ts does not import AgentReasoningLoop (no inline execution)", () => {
    const src = readFileSync(resolve("src/cli/commands/run.ts"), "utf-8");
    expect(src).not.toContain("AgentReasoningLoop");
    expect(src).not.toContain("reasoning-loop");
  });

  it("run.ts does not import CostTracker (budget enforcement delegated to orchestrator)", () => {
    const src = readFileSync(resolve("src/cli/commands/run.ts"), "utf-8");
    expect(src).not.toContain("CostTracker");
    expect(src).not.toContain("cost-tracker");
  });

  it("run.ts does not import AnthropicAdapter (provider calls routed through orchestrator)", () => {
    const src = readFileSync(resolve("src/cli/commands/run.ts"), "utf-8");
    expect(src).not.toContain("AnthropicAdapter");
    expect(src).not.toContain("anthropic-adapter");
  });

  it("run.ts requires orchestrator pid file for --wait mode", () => {
    const src = readFileSync(resolve("src/cli/commands/run.ts"), "utf-8");
    expect(src).toContain("orchestrator.pid");
    expect(src).toContain("isProcessAlive");
  });

  it("run.ts polls task store for completion instead of running inline", () => {
    const src = readFileSync(resolve("src/cli/commands/run.ts"), "utf-8");
    expect(src).toContain("pollTaskCompletion");
    expect(src).toContain("store.get(taskId)");
  });
});
