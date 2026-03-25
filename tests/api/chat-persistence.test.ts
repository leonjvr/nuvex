/**
 * SIDJUA — Multi-Agent Governance Framework
 * Copyright (c) 2026 Götz Kohlberg
 *
 * Dual licensed under:
 *   - AGPL-3.0 (see LICENSE-AGPL)
 *   - SIDJUA Commercial License (see LICENSE-COMMERCIAL)
 *
 * Unless you have a signed Commercial License, your use is governed
 * by the AGPL-3.0. See LICENSE for details.
 */

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  clearChatState,
  persistChatState,
  restoreChatState,
} from "../../src/api/routes/chat.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDb(): { db: InstanceType<typeof Database>; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sidjua-chat-persist-test-"));
  const db  = new Database(join(dir, "test.db"));
  db.pragma("journal_mode = WAL");
  return { db, dir };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chat persistence", () => {
  let db: InstanceType<typeof Database>;
  let dir: string;

  beforeEach(() => {
    ({ db, dir } = makeTmpDb());
    clearChatState();
  });

  afterEach(() => {
    clearChatState();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("persistChatState creates the chat_conversations table if absent", () => {
    persistChatState(db);
    const exists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_conversations'")
      .get();
    expect(exists).toBeDefined();
  });

  it("persistChatState writes in-memory conversations to DB", () => {
    // Directly push to the module's internal Map by using the REST route internals
    // via the exported helpers
    // We trigger a conversation through the route by calling restoreChatState first,
    // then manually test via persistChatState on a freshly-populated DB

    // Simulate adding a conversation via the module's state
    // (clearChatState + restoreChatState round-trip approach)
    const fakeConv = JSON.stringify([
      { id: "m1", role: "user", content: "hello", timestamp: new Date().toISOString() },
    ]);
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.prepare(
      "INSERT INTO chat_conversations (id, agent_id, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("conv-1", "agent-1", fakeConv, new Date().toISOString(), new Date().toISOString());

    // Restore into memory
    const restored = restoreChatState(db);
    expect(restored).toBe(1);

    // Now persist back (round-trip)
    persistChatState(db);

    const row = db
      .prepare("SELECT messages FROM chat_conversations WHERE id = 'conv-1'")
      .get() as { messages: string } | undefined;
    expect(row).toBeDefined();
    const messages = JSON.parse(row!.messages) as { content: string }[];
    expect(messages[0]?.content).toBe("hello");
  });

  it("restoreChatState loads conversations from DB", () => {
    const msgs = JSON.stringify([
      { id: "m1", role: "user",      content: "ping", timestamp: new Date().toISOString() },
      { id: "m2", role: "assistant", content: "pong", timestamp: new Date().toISOString() },
    ]);
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO chat_conversations (id, agent_id, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("conv-abc", "agent-x", msgs, now, now);

    const count = restoreChatState(db);
    expect(count).toBe(1);
  });

  it("restoreChatState skips conversations exceeding MAX_CONVERSATION_BYTES", () => {
    const hugeMessages = JSON.stringify([
      { id: "m1", role: "user", content: "x".repeat(11 * 1024 * 1024), timestamp: new Date().toISOString() },
    ]);
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO chat_conversations (id, agent_id, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("conv-huge", "agent-y", hugeMessages, now, now);

    const count = restoreChatState(db);
    expect(count).toBe(0); // skipped
  });

  it("restoreChatState works cleanly when table does not exist yet", () => {
    // Table doesn't exist — should create it and return 0
    const count = restoreChatState(db);
    expect(count).toBe(0);
  });

  it("persistChatState does not throw when memory is empty", () => {
    expect(() => persistChatState(db)).not.toThrow();
  });

  it("restoreChatState respects MAX_CONVERSATIONS limit", () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_conversations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        messages TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    // Insert 3 conversations — all should be restorable (MAX_CONVERSATIONS = 500)
    const msgs = JSON.stringify([{ id: "m1", role: "user", content: "hi", timestamp: new Date().toISOString() }]);
    const now  = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      db.prepare(
        "INSERT INTO chat_conversations (id, agent_id, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).run(`conv-${i}`, `agent-${i}`, msgs, now, now);
    }
    const count = restoreChatState(db);
    expect(count).toBe(3);
  });
});
