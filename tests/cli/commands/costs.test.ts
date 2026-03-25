/**
 * Tests for src/cli/commands/costs.ts
 *
 * Phase 16: reads from cost_ledger (not agent_instances).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { PHASE9_SCHEMA_SQL } from "../../../src/orchestrator/types.js";
import { TaskStore } from "../../../src/tasks/store.js";
import { runCostsCommand } from "../../../src/cli/commands/costs.js";
import { setGlobalLevel, resetLogger } from "../../../src/core/logger.js";

// ---------------------------------------------------------------------------
// Output capture
// ---------------------------------------------------------------------------

let stdout = "";
let stderr = "";

function captureOutput(): void {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((c) => { stdout += String(c); return true; });
  vi.spyOn(process.stderr, "write").mockImplementation((c) => { stderr += String(c); return true; });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let dbFile: string;

const COST_LEDGER_SQL = `
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
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

beforeEach(() => {
  setGlobalLevel("error"); // suppress debug/info logs so stdout stays clean for JSON parse
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-costs-test-"));
  dbFile = join(tmpDir, ".system", "sidjua.db");
  mkdirSync(join(tmpDir, ".system"), { recursive: true });

  const db = openDatabase(dbFile);
  db.pragma("journal_mode = WAL");
  db.exec(PHASE9_SCHEMA_SQL);
  db.exec(COST_LEDGER_SQL);
  new TaskStore(db).initialize();
  db.close();

  captureOutput();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true });
  resetLogger();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertCostRow(opts: {
  agentId: string;
  divisionCode?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  timestamp?: string;
}): void {
  const db = openDatabase(dbFile);
  db.pragma("journal_mode = WAL");
  db.prepare<unknown[], void>(`
    INSERT INTO cost_ledger
      (division_code, agent_id, provider, model, input_tokens, output_tokens, cost_usd, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.divisionCode ?? "engineering",
    opts.agentId,
    opts.provider ?? "anthropic",
    opts.model ?? "claude-haiku-4-5-20251001",
    opts.inputTokens ?? 1000,
    opts.outputTokens ?? 500,
    opts.costUsd,
    opts.timestamp ?? new Date().toISOString(),
  );
  db.close();
}

const BASE_OPTS = {
  workDir:  "",
  division: undefined as string | undefined,
  agent:    undefined as string | undefined,
  period:   "30d",
  json:     false,
};

function makeOpts(o: Partial<typeof BASE_OPTS> = {}): typeof BASE_OPTS {
  return { ...BASE_OPTS, workDir: tmpDir, ...o };
}

// ---------------------------------------------------------------------------
// Tests: no database
// ---------------------------------------------------------------------------

describe("runCostsCommand — no database", () => {
  it("returns 1 when DB not found", () => {
    const code = runCostsCommand({
      workDir: "/nonexistent", division: undefined, agent: undefined, period: "24h", json: false,
    });
    expect(code).toBe(1);
    expect(stderr).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Tests: empty cost_ledger
// ---------------------------------------------------------------------------

describe("runCostsCommand — empty cost_ledger", () => {
  it("returns 0 with 'No cost data' message", () => {
    const code = runCostsCommand(makeOpts());
    expect(code).toBe(0);
    expect(stdout).toContain("No cost data available");
  });

  it("returns 0 with 'No cost data' when table missing", () => {
    // Open fresh DB without cost_ledger
    const fresh = mkdtempSync(join(tmpdir(), "sidjua-costs-fresh-"));
    const freshDb = join(fresh, ".system", "sidjua.db");
    mkdirSync(join(fresh, ".system"), { recursive: true });
    const db = openDatabase(freshDb);
    db.exec(PHASE9_SCHEMA_SQL);
    new TaskStore(db).initialize();
    db.close();

    const code = runCostsCommand({ workDir: fresh, division: undefined, agent: undefined, period: "30d", json: false });
    expect(code).toBe(0);
    expect(stdout).toContain("No cost data");

    rmSync(fresh, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Tests: with cost data
// ---------------------------------------------------------------------------

describe("runCostsCommand — with cost_ledger data", () => {
  beforeEach(() => {
    insertCostRow({ agentId: "agent-alpha", costUsd: 1.20, inputTokens: 10000, outputTokens: 5000 });
    insertCostRow({ agentId: "agent-beta",  costUsd: 0.80, inputTokens: 8000,  outputTokens: 3000 });
  });

  it("shows COST SUMMARY header", () => {
    runCostsCommand(makeOpts());
    expect(stdout).toContain("COST SUMMARY");
  });

  it("shows correct total cost", () => {
    runCostsCommand(makeOpts());
    expect(stdout).toContain("$2.00");
  });

  it("shows period label", () => {
    runCostsCommand(makeOpts({ period: "7d" }));
    expect(stdout).toContain("7d");
  });

  it("shows both agents in table", () => {
    runCostsCommand(makeOpts());
    expect(stdout).toContain("agent-alpha");
    expect(stdout).toContain("agent-beta");
  });

  it("shows provider and model columns", () => {
    runCostsCommand(makeOpts());
    expect(stdout).toContain("anthropic");
    expect(stdout).toContain("claude-haiku-4-5-20251001");
  });

  it("--agent filter shows only that agent", () => {
    runCostsCommand(makeOpts({ agent: "agent-alpha" }));
    expect(stdout).toContain("agent-alpha");
    expect(stdout).not.toContain("agent-beta");
  });

  it("--division filter shows only matching division rows", () => {
    insertCostRow({ agentId: "agent-gamma", divisionCode: "sales", costUsd: 0.50 });
    runCostsCommand(makeOpts({ division: "engineering" }));
    expect(stdout).toContain("agent-alpha");
    expect(stdout).not.toContain("agent-gamma");
  });

  it("JSON output has correct schema", () => {
    runCostsCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    expect(typeof data.total_cost).toBe("number");
    expect(typeof data.total_tokens).toBe("number");
    expect(Array.isArray(data.by_agent)).toBe(true);
    expect(data.period).toBe("30d");
  });

  it("JSON by_agent rows have provider and model fields", () => {
    runCostsCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    const row = data.by_agent[0];
    expect(typeof row.provider).toBe("string");
    expect(typeof row.model).toBe("string");
    expect(typeof row.total_cost_usd).toBe("number");
    expect(typeof row.total_input_tokens).toBe("number");
    expect(typeof row.total_output_tokens).toBe("number");
  });

  it("aggregates correctly when same agent has multiple rows", () => {
    insertCostRow({ agentId: "agent-alpha", costUsd: 0.30 });
    runCostsCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    const alphaRow = data.by_agent.find((r: { agent_id: string }) => r.agent_id === "agent-alpha");
    expect(alphaRow).toBeDefined();
    expect(alphaRow.total_cost_usd).toBeCloseTo(1.50, 2);
  });
});

// ---------------------------------------------------------------------------
// Tests: multiple providers/models
// ---------------------------------------------------------------------------

describe("runCostsCommand — multiple providers and models", () => {
  it("shows each provider+model combination as a separate row", () => {
    insertCostRow({ agentId: "agent-1", provider: "anthropic",    model: "claude-sonnet-4-6",          costUsd: 0.60 });
    insertCostRow({ agentId: "agent-1", provider: "google-gemini", model: "gemini-2.0-flash",           costUsd: 0.40 });
    insertCostRow({ agentId: "agent-2", provider: "openai",        model: "gpt-4o-mini",                costUsd: 0.20 });

    runCostsCommand(makeOpts({ json: true }));
    const data = JSON.parse(stdout);
    // 3 unique (agent,division,provider,model) combos → 3 rows
    expect(data.by_agent.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: period filtering
// ---------------------------------------------------------------------------

describe("runCostsCommand — period filtering", () => {
  it("period=30d includes recent rows", () => {
    insertCostRow({ agentId: "agent-recent", costUsd: 1.00 });
    runCostsCommand(makeOpts({ period: "30d", json: true }));
    const data = JSON.parse(stdout);
    expect(data.total_cost).toBeGreaterThan(0);
  });

  it("period=all shows all-time label", () => {
    insertCostRow({ agentId: "agent-x", costUsd: 0.50 });
    runCostsCommand(makeOpts({ period: "all" }));
    expect(stdout).toContain("all time");
  });

  it("period=1h shows '1h' label", () => {
    insertCostRow({ agentId: "agent-x", costUsd: 0.50 });
    runCostsCommand(makeOpts({ period: "1h" }));
    expect(stdout).toContain("1h");
  });
});
