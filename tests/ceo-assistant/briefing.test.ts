// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for CEO Assistant session briefing — Phase 187
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { generateBriefing, detectTier } from "../../src/ceo-assistant/briefing.js";
import { runCeoAssistantMigrations }     from "../../src/ceo-assistant/migration.js";
import { runMigrations105 }              from "../../src/agent-lifecycle/migration.js";
import { runSessionMigrations }          from "../../src/session/migration.js";
import { AssistantTaskQueue }            from "../../src/ceo-assistant/task-queue.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(":memory:");
  runMigrations105(db);
  runSessionMigrations(db);
  runCeoAssistantMigrations(db);
  // Seed a cloudflare agent definition for tier detection
  db.prepare(`
    INSERT OR IGNORE INTO agent_definitions
      (id, name, tier, division, provider, model, skill_path, config_yaml, config_hash, status, created_at, created_by, updated_at)
    VALUES ('ceo-assistant', 'CEO Assistant', 2, 'executive', 'cloudflare', '@cf/meta/llama-4-scout-17b-16e-instruct',
            'agents/skills/ceo-assistant.md', '{}', 'hash', 'stopped', datetime('now'), 'init', datetime('now'))
  `).run();
  return db;
}

let db: ReturnType<typeof makeDb>;

beforeEach(() => {
  db = makeDb();
});

// ---------------------------------------------------------------------------
// detectTier
// ---------------------------------------------------------------------------

describe("detectTier", () => {
  it("returns 'free' for cloudflare provider", () => {
    expect(detectTier(db, "ceo-assistant")).toBe("free");
  });

  it("returns 'upgraded' for non-cloudflare provider", () => {
    db.prepare(`UPDATE agent_definitions SET provider = 'openai' WHERE id = 'ceo-assistant'`).run();
    expect(detectTier(db, "ceo-assistant")).toBe("upgraded");
  });

  it("returns 'free' when agent not found (safe default)", () => {
    expect(detectTier(db, "nonexistent")).toBe("free");
  });

  it("returns 'upgraded' for anthropic provider", () => {
    db.prepare(`UPDATE agent_definitions SET provider = 'anthropic' WHERE id = 'ceo-assistant'`).run();
    expect(detectTier(db, "ceo-assistant")).toBe("upgraded");
  });
});

// ---------------------------------------------------------------------------
// generateBriefing — free tier
// ---------------------------------------------------------------------------

describe("generateBriefing — free tier", () => {
  it("returns free tier briefing for cloudflare provider", () => {
    const b = generateBriefing(db, "ceo-assistant", "free");
    expect(b.tier).toBe("free");
  });

  it("starts with 'Welcome back'", () => {
    const b = generateBriefing(db, "ceo-assistant", "free");
    expect(b.text).toContain("Welcome back");
  });

  it("reports zero tasks when none exist", () => {
    const b = generateBriefing(db, "ceo-assistant", "free");
    expect(b.open_count).toBe(0);
    expect(b.text).toContain("no open tasks");
  });

  it("reports open task count", () => {
    const q = new AssistantTaskQueue(db);
    q.addTask({ agent_id: "ceo-assistant", title: "Task A" });
    q.addTask({ agent_id: "ceo-assistant", title: "Task B" });
    const b = generateBriefing(db, "ceo-assistant", "free");
    expect(b.open_count).toBe(2);
    expect(b.text).toContain("2 open tasks");
  });

  it("mentions overdue count when present", () => {
    const q = new AssistantTaskQueue(db);
    q.addTask({ agent_id: "ceo-assistant", title: "Overdue", deadline: "2020-01-01" });
    const b = generateBriefing(db, "ceo-assistant", "free");
    expect(b.overdue_count).toBe(1);
    expect(b.text).toContain("overdue");
  });
});

// ---------------------------------------------------------------------------
// generateBriefing — upgraded tier
// ---------------------------------------------------------------------------

describe("generateBriefing — upgraded tier", () => {
  it("returns upgraded tier briefing", () => {
    const b = generateBriefing(db, "ceo-assistant", "upgraded");
    expect(b.tier).toBe("upgraded");
  });

  it("includes open task priority breakdown when tasks exist", () => {
    const q = new AssistantTaskQueue(db);
    q.addTask({ agent_id: "ceo-assistant", title: "P1 task", priority: "P1" });
    q.addTask({ agent_id: "ceo-assistant", title: "P3 task", priority: "P3" });
    const b = generateBriefing(db, "ceo-assistant", "upgraded");
    expect(b.text).toContain("P1");
  });

  it("shows overdue section when tasks are overdue", () => {
    const q = new AssistantTaskQueue(db);
    q.addTask({ agent_id: "ceo-assistant", title: "Past due", deadline: "2020-01-01" });
    const b = generateBriefing(db, "ceo-assistant", "upgraded");
    expect(b.text).toContain("Overdue");
  });
});
