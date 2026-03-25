// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for SessionRotateHandler — Phase 186
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SessionRotateHandler } from "../../src/session/session-rotate-handler.js";
import { TokenMonitor }         from "../../src/session/token-monitor.js";
import { runSessionMigrations } from "../../src/session/migration.js";
import { runMigrations105 }     from "../../src/agent-lifecycle/migration.js";
import type { BriefingMessage } from "../../src/session/memory-briefing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  runMigrations105(db);
  runSessionMigrations(db);
  db.prepare(`
    INSERT OR IGNORE INTO agent_definitions
      (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
    VALUES ('agent-1', 'Test Agent', 2, 'default', 'anthropic', 'claude-sonnet-4-6',
            'agents/skills/test.md', '{}', 'hash', 'stopped', datetime('now'), 'test', datetime('now'))
  `).run();
  return db;
}

const SAMPLE_MESSAGES: BriefingMessage[] = [
  { role: "system",    content: "You are a helpful assistant." },
  { role: "user",      content: "Analyse Q1 sales and write a report." },
  { role: "assistant", content: "I will start by loading the sales data." },
  { role: "user",      content: "Tool result: data loaded, 1200 rows." },
  { role: "assistant", content: "Decided to group by region. Q1 total = $4.2M." },
];

let db: ReturnType<typeof makeDb>;
let rotateHandler: SessionRotateHandler;
let monitor: TokenMonitor;

beforeEach(() => {
  db            = makeDb();
  rotateHandler = new SessionRotateHandler(db);
  monitor       = new TokenMonitor(db);
});

// ---------------------------------------------------------------------------
// rotate()
// ---------------------------------------------------------------------------

describe("SessionRotateHandler.rotate", () => {
  it("returns a SessionRotationResult", async () => {
    const oldSid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    monitor.recordTokens(oldSid, 100_000);

    const result = await rotateHandler.rotate(
      oldSid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES,
    );

    expect(result).toBeDefined();
    expect(result.checkpoint).toBeDefined();
    expect(result.new_session_id).toBeDefined();
    expect(result.fresh_messages).toBeDefined();
  });

  it("new_session_id is a different UUID than oldSessionId", async () => {
    const oldSid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const result = await rotateHandler.rotate(
      oldSid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES,
    );
    expect(result.new_session_id).not.toBe(oldSid);
  });

  it("closes old session to 'rotated' status", async () => {
    const oldSid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    await rotateHandler.rotate(oldSid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES);
    expect(monitor.getState(oldSid)!.status).toBe("rotated");
  });

  it("new session is in 'active' status", async () => {
    const oldSid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const result = await rotateHandler.rotate(
      oldSid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES,
    );
    expect(monitor.getState(result.new_session_id)!.status).toBe("active");
  });

  it("persists checkpoint to DB", async () => {
    const oldSid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    await rotateHandler.rotate(oldSid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES);

    const cp = rotateHandler.getLastCheckpoint("agent-1", "task-1");
    expect(cp).not.toBeNull();
    expect(cp!.agent_id).toBe("agent-1");
    expect(cp!.task_id).toBe("task-1");
  });

  it("checkpoint briefing is non-empty", async () => {
    const oldSid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const result = await rotateHandler.rotate(
      oldSid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES,
    );
    expect(result.checkpoint.briefing.length).toBeGreaterThan(50);
  });

  it("fresh_messages starts with system prompt when messages include one", async () => {
    const oldSid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const result = await rotateHandler.rotate(
      oldSid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES,
    );
    expect(result.fresh_messages[0]?.role).toBe("system");
  });

  it("fresh_messages includes a user briefing message", async () => {
    const oldSid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const result = await rotateHandler.rotate(
      oldSid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES,
    );
    const userMsg = result.fresh_messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toContain("Session Continuity Briefing");
  });

  it("respects SessionConfig briefing_level", async () => {
    const oldSid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const result = await rotateHandler.rotate(
      oldSid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES,
      { briefing_level: "minimal" },
    );
    // Minimal briefing should be shorter than detailed
    const detailedSid = monitor.startSession("agent-1", "task-2", "gpt-4o");
    const resultDetailed = await rotateHandler.rotate(
      detailedSid, "agent-1", "task-2", "gpt-4o", SAMPLE_MESSAGES,
      { briefing_level: "detailed" },
    );
    expect(result.checkpoint.briefing.length).toBeLessThan(resultDetailed.checkpoint.briefing.length + 200);
  });

  it("checkpoint session_number increments on repeated rotations", async () => {
    const sid1 = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const r1   = await rotateHandler.rotate(sid1, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES);

    const sid2 = r1.new_session_id;
    const r2   = await rotateHandler.rotate(sid2, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES);

    expect(r2.checkpoint.session_number).toBeGreaterThan(r1.checkpoint.session_number);
  });
});

// ---------------------------------------------------------------------------
// getLastCheckpoint
// ---------------------------------------------------------------------------

describe("SessionRotateHandler.getLastCheckpoint", () => {
  it("returns null when no rotations have occurred", () => {
    expect(rotateHandler.getLastCheckpoint("agent-1", "task-x")).toBeNull();
  });

  it("returns the checkpoint after a rotation", async () => {
    const sid = monitor.startSession("agent-1", "task-1", "gpt-4o");
    await rotateHandler.rotate(sid, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES);
    expect(rotateHandler.getLastCheckpoint("agent-1", "task-1")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listCheckpoints
// ---------------------------------------------------------------------------

describe("SessionRotateHandler.listCheckpoints", () => {
  it("returns empty array before any rotation", () => {
    expect(rotateHandler.listCheckpoints("agent-1", "task-1")).toHaveLength(0);
  });

  it("returns all checkpoints in order", async () => {
    const sid1 = monitor.startSession("agent-1", "task-1", "gpt-4o");
    const r1   = await rotateHandler.rotate(sid1, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES);
    const sid2 = r1.new_session_id;
    await rotateHandler.rotate(sid2, "agent-1", "task-1", "gpt-4o", SAMPLE_MESSAGES);

    const checkpoints = rotateHandler.listCheckpoints("agent-1", "task-1");
    expect(checkpoints).toHaveLength(2);
  });
});
