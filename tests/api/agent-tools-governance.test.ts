// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * P266: Agent Tools Governance Gate — audit log, budget check, file limit, WAL.
 *
 * Covers:
 *   - Tool-call blocked without operator role on mutation tools
 *   - ask_agent checks budget before LLM call
 *   - Agent creation fails at 100-file limit
 *   - openCliDatabase uses WAL journal mode
 *   - CONFIG_MUTATION event logged for create_division
 *   - TOOL_CALL audit event includes governance result
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join }   from "node:path";
import BetterSQLite3 from "better-sqlite3";
import {
  executeToolCall,
  clearToolAuditLog,
  getToolAuditLog,
} from "../../src/api/routes/agent-tools.js";
import { openCliDatabase } from "../../src/cli/utils/db-init.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sidjua-gov-"));
  clearToolAuditLog();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeCtx(overrides: Partial<Parameters<typeof executeToolCall>[3]> = {}) {
  return { workDir: tmpDir, db: null, depth: 0, ...overrides };
}

// ---------------------------------------------------------------------------
// Test 1: mutation tool blocked without operator role
// ---------------------------------------------------------------------------

describe("governance gate", () => {
  it("blocks create_agent_role when callerContext role is agent (non-operator)", async () => {
    const result = await executeToolCall(
      "hr",
      "create_agent_role",
      { role_id: "blocked", name: "Blocked", description: "Should not be created" },
      makeCtx({ callerContext: { role: "agent" } }),
    );
    expect(result.success).toBe(false);
    // Error comes from governance gate (mutation requires operator/admin)
    expect(result.error).toBeTruthy();
  });

  it("allows create_agent_role when callerContext role is operator", async () => {
    const result = await executeToolCall(
      "hr",
      "create_agent_role",
      { role_id: "allowed-agent", name: "Allowed", description: "Should be created" },
      makeCtx({ callerContext: { role: "operator" } }),
    );
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: ask_agent budget check
// ---------------------------------------------------------------------------

describe("ask_agent budget pre-check", () => {
  it("returns error when division budget is exceeded", async () => {
    // Set up an in-memory DB with a budget table capped at $0 for division "test-div"
    const db = new BetterSQLite3(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS cost_budgets (
        division_code           TEXT PRIMARY KEY,
        daily_limit_usd         REAL,
        monthly_limit_usd       REAL,
        alert_threshold_percent REAL NOT NULL DEFAULT 80
      );
      CREATE TABLE IF NOT EXISTS cost_ledger (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
        division_code TEXT NOT NULL,
        agent_id      TEXT NOT NULL DEFAULT '',
        provider      TEXT NOT NULL DEFAULT '',
        model         TEXT NOT NULL DEFAULT '',
        cost_usd      REAL NOT NULL DEFAULT 0
      );
      INSERT INTO cost_budgets (division_code, daily_limit_usd, monthly_limit_usd)
      VALUES ('test-div', 0.0, 0.0);
    `);

    const result = await executeToolCall(
      "hr",
      "ask_agent",
      { agent_id: "guide", question: "Hello?" },
      makeCtx({ db, callerContext: { role: "operator", division: "test-div" } }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/budget/i);

    db.close();
  });
});

// ---------------------------------------------------------------------------
// Test 3: 100-file limit for create_agent_role
// ---------------------------------------------------------------------------

describe("create_agent_role file limit", () => {
  it("returns LIMIT-001 error when 100 YAML files already exist", async () => {
    // Create 100 dummy YAML files in agents/definitions/
    const defDir = join(tmpDir, "agents", "definitions");
    mkdirSync(defDir, { recursive: true });
    for (let i = 0; i < 100; i++) {
      writeFileSync(join(defDir, `dummy-${i}.yaml`), `role:\n  id: dummy-${i}\n`);
    }

    const result = await executeToolCall(
      "hr",
      "create_agent_role",
      { role_id: "overflow", name: "Overflow", description: "Should be blocked" },
      makeCtx({ callerContext: { role: "operator" } }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/LIMIT-001/);
  });
});

// ---------------------------------------------------------------------------
// Test 4: openCliDatabase uses WAL journal mode
// ---------------------------------------------------------------------------

describe("openCliDatabase WAL mode", () => {
  it("opens database in WAL journal mode", () => {
    // Create a minimal DB file so openCliDatabase finds it
    const systemDir = join(tmpDir, ".system");
    mkdirSync(systemDir, { recursive: true });
    const dbPath = join(systemDir, "sidjua.db");
    // Create the file by opening with BetterSQLite3 first
    const seed = new BetterSQLite3(dbPath);
    seed.close();

    const db = openCliDatabase({ workDir: tmpDir });
    expect(db).not.toBeNull();
    if (db !== null) {
      const row = db.pragma("journal_mode") as Array<{ journal_mode: string }>;
      expect(row[0]?.journal_mode).toBe("wal");
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5: CONFIG_MUTATION audit event for create_division
// ---------------------------------------------------------------------------

describe("audit log — CONFIG_MUTATION", () => {
  it("logs CONFIG_MUTATION event after create_division succeeds", async () => {
    const result = await executeToolCall(
      "hr",
      "create_division",
      { id: "audit-test-div", name: "Audit Test", description: "Test division" },
      makeCtx({ callerContext: { role: "operator" } }),
    );
    expect(result.success).toBe(true);

    const log = getToolAuditLog();
    const mutation = log.find((e) => e.type === "CONFIG_MUTATION" && e.toolName === "create_division");
    expect(mutation).toBeDefined();
    expect(mutation?.allowed).toBe(true);
    expect(mutation?.targetId).toBe("audit-test-div");
    expect(mutation?.subtype).toBe("create_division");
  });
});

// ---------------------------------------------------------------------------
// Test 6: TOOL_CALL audit event includes governance result
// ---------------------------------------------------------------------------

describe("audit log — TOOL_CALL", () => {
  it("logs TOOL_CALL event with allowed=true for authorized call", async () => {
    await executeToolCall("hr", "list_agents", {}, makeCtx({ callerContext: { role: "operator" } }));

    const log = getToolAuditLog();
    const event = log.find((e) => e.type === "TOOL_CALL" && e.toolName === "list_agents");
    expect(event).toBeDefined();
    expect(event?.allowed).toBe(true);
    expect(event?.agentId).toBe("hr");
    expect(event?.callerRole).toBe("operator");
  });

  it("logs TOOL_CALL event with allowed=false for denied call", async () => {
    await executeToolCall(
      "finance",
      "list_agents",
      {},
      makeCtx({ callerContext: { role: "operator" } }),
    );

    const log = getToolAuditLog();
    const denied = log.find((e) => e.type === "TOOL_CALL" && e.toolName === "list_agents" && !e.allowed);
    expect(denied).toBeDefined();
    expect(denied?.agentId).toBe("finance");
    expect(denied?.allowed).toBe(false);
  });
});
