// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for TokenMonitor — Phase 186
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { TokenMonitor } from "../../src/session/token-monitor.js";
import { runSessionMigrations } from "../../src/session/migration.js";
import { runMigrations105 } from "../../src/agent-lifecycle/migration.js";

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  runMigrations105(db);
  runSessionMigrations(db);
  // Seed a minimal agent_definitions row so FK passes
  db.prepare(`
    INSERT OR IGNORE INTO agent_definitions
      (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
    VALUES ('agent-1', 'Test Agent', 2, 'default', 'anthropic', 'claude-sonnet-4-6',
            'agents/skills/test.md', '{}', 'hash', 'stopped', datetime('now'), 'test', datetime('now'))
  `).run();
  return db;
}

let monitor: TokenMonitor;

beforeEach(() => {
  monitor = new TokenMonitor(makeDb());
});

// ---------------------------------------------------------------------------
// startSession
// ---------------------------------------------------------------------------

describe("TokenMonitor.startSession", () => {
  it("returns a UUID session ID", () => {
    const sid = monitor.startSession("agent-1", "task-1", "claude-sonnet-4-6");
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("resolves known model context window", () => {
    const sid   = monitor.startSession("agent-1", "task-1", "claude-sonnet-4-6");
    const state = monitor.getState(sid);
    expect(state).not.toBeNull();
    expect(state!.context_limit).toBe(200_000);
  });

  it("uses override context window when provided", () => {
    const sid   = monitor.startSession("agent-1", "task-1", "claude-sonnet-4-6", 50_000);
    const state = monitor.getState(sid);
    expect(state!.context_limit).toBe(50_000);
  });

  it("falls back to DEFAULT_CONTEXT_WINDOW for unknown model", () => {
    const sid   = monitor.startSession("agent-1", "task-1", "unknown-model-xyz");
    const state = monitor.getState(sid);
    expect(state!.context_limit).toBe(32_768);
  });

  it("initial state has tokens_used=0 and status=active", () => {
    const sid   = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const state = monitor.getState(sid);
    expect(state!.tokens_used).toBe(0);
    expect(state!.turn_count).toBe(0);
    expect(state!.status).toBe("active");
  });

  it("initial percent_used is 0", () => {
    const sid   = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const state = monitor.getState(sid);
    expect(state!.percent_used).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// recordTokens
// ---------------------------------------------------------------------------

describe("TokenMonitor.recordTokens", () => {
  it("accumulates tokens across turns", () => {
    const sid = monitor.startSession("agent-1", "task-1", "claude-sonnet-4-6");
    monitor.recordTokens(sid, 1_000);
    monitor.recordTokens(sid, 2_000);
    const state = monitor.getState(sid);
    expect(state!.tokens_used).toBe(3_000);
  });

  it("increments turn_count on each call", () => {
    const sid = monitor.startSession("agent-1", "task-1", "claude-sonnet-4-6");
    monitor.recordTokens(sid, 500);
    monitor.recordTokens(sid, 500);
    const state = monitor.getState(sid);
    expect(state!.turn_count).toBe(2);
  });

  it("calculates percent_used correctly", () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o"); // 128_000 limit
    monitor.recordTokens(sid, 64_000);
    const state = monitor.getState(sid)!;
    expect(state.percent_used).toBeCloseTo(50, 1);
  });

  it("returns null for unknown session ID", () => {
    const result = monitor.recordTokens("no-such-session", 100);
    expect(result).toBeNull();
  });

  it("returns null for rotated session (no further updates)", () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    monitor.closeSession(sid);
    const result = monitor.recordTokens(sid, 100);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getState
// ---------------------------------------------------------------------------

describe("TokenMonitor.getState", () => {
  it("returns null for unknown session", () => {
    expect(monitor.getState("nonexistent")).toBeNull();
  });

  it("returns full state shape", () => {
    const sid   = monitor.startSession("agent-1", "task-abc", "claude-sonnet-4-6");
    const state = monitor.getState(sid)!;
    expect(state.session_id).toBe(sid);
    expect(state.agent_id).toBe("agent-1");
    expect(state.task_id).toBe("task-abc");
    expect(state.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// markWarned / markRotating / closeSession
// ---------------------------------------------------------------------------

describe("TokenMonitor lifecycle transitions", () => {
  it("markWarned changes status to warned", () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    monitor.markWarned(sid);
    expect(monitor.getState(sid)!.status).toBe("warned");
  });

  it("markWarned is a no-op if already warned", () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    monitor.markWarned(sid);
    monitor.markWarned(sid); // second call — should not throw
    expect(monitor.getState(sid)!.status).toBe("warned");
  });

  it("markRotating returns true and sets status to rotating", () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const result = monitor.markRotating(sid);
    expect(result).toBe(true);
    expect(monitor.getState(sid)!.status).toBe("rotating");
  });

  it("markRotating returns false for already-rotated session", () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    monitor.closeSession(sid);
    const result = monitor.markRotating(sid);
    expect(result).toBe(false);
  });

  it("closeSession sets status to rotated", () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    monitor.closeSession(sid);
    expect(monitor.getState(sid)!.status).toBe("rotated");
  });
});

// ---------------------------------------------------------------------------
// getSessionCount
// ---------------------------------------------------------------------------

describe("TokenMonitor.getSessionCount", () => {
  it("returns 0 before any sessions", () => {
    expect(monitor.getSessionCount("agent-1", "task-1")).toBe(0);
  });

  it("counts sessions including rotated ones", () => {
    const sid1 = monitor.startSession("agent-1", "task-1", "gpt-4o");
    monitor.closeSession(sid1);
    monitor.startSession("agent-1", "task-1", "gpt-4o");
    expect(monitor.getSessionCount("agent-1", "task-1")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getAuditLog
// ---------------------------------------------------------------------------

describe("TokenMonitor.getAuditLog", () => {
  it("records session_started event", () => {
    const sid  = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const log  = monitor.getAuditLog(sid);
    const evt  = log.find((e) => e.event === "session_started");
    expect(evt).toBeDefined();
  });

  it("records tokens_recorded events", () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    monitor.recordTokens(sid, 1_000);
    monitor.recordTokens(sid, 2_000);
    const log   = monitor.getAuditLog(sid);
    const evts  = log.filter((e) => e.event === "tokens_recorded");
    expect(evts).toHaveLength(2);
  });

  it("records warn_threshold_reached when markWarned called", () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    monitor.markWarned(sid);
    const log = monitor.getAuditLog(sid);
    expect(log.some((e) => e.event === "warn_threshold_reached")).toBe(true);
  });
});
