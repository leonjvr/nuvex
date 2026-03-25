// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 186: Session Lifecycle DB Migration (V1.9)
 *
 * Adds three tables for token-aware session management:
 *   session_token_usage  — live token tracking per session
 *   session_checkpoints  — briefings generated at session rotation
 *   session_audit_log    — audit trail for all session lifecycle events
 *
 * Applied lazily by runSessionMigrations() before any session operation.
 */

import type { Database, DbMigration } from "../utils/db.js";
import { runMigrations } from "../utils/db.js";


const V1_9_SESSION_LIFECYCLE: DbMigration = {
  version: "1.9",
  description: "Phase 186 — session lifecycle: token tracking, checkpoints, audit log",
  up: `
    -- Live token tracking per agent session
    CREATE TABLE IF NOT EXISTS session_token_usage (
      session_id      TEXT PRIMARY KEY,
      agent_id        TEXT NOT NULL,
      task_id         TEXT NOT NULL,
      tokens_used     INTEGER NOT NULL DEFAULT 0,
      context_limit   INTEGER NOT NULL,
      turn_count      INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'active',
      started_at      TEXT NOT NULL,
      last_updated    TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agent_definitions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_session_agent
      ON session_token_usage(agent_id, status);

    CREATE INDEX IF NOT EXISTS idx_session_task
      ON session_token_usage(task_id);

    -- Briefings generated at session rotation (preserved for memory continuity)
    CREATE TABLE IF NOT EXISTS session_checkpoints (
      id                TEXT PRIMARY KEY,
      session_id        TEXT NOT NULL,
      agent_id          TEXT NOT NULL,
      task_id           TEXT NOT NULL,
      briefing          TEXT NOT NULL,
      tokens_at_rotation INTEGER NOT NULL,
      turn_at_rotation  INTEGER NOT NULL,
      session_number    INTEGER NOT NULL DEFAULT 1,
      created_at        TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES session_token_usage(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sesscp_agent_task
      ON session_checkpoints(agent_id, task_id, created_at DESC);

    -- Audit trail: one row per session lifecycle event
    CREATE TABLE IF NOT EXISTS session_audit_log (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL,
      agent_id         TEXT NOT NULL,
      event            TEXT NOT NULL,
      tokens_at_event  INTEGER NOT NULL DEFAULT 0,
      percent_at_event REAL NOT NULL DEFAULT 0,
      detail           TEXT,
      created_at       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessaudit_session
      ON session_audit_log(session_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_sessaudit_agent
      ON session_audit_log(agent_id, created_at DESC);
  `,
  down: `
    DROP INDEX IF EXISTS idx_sessaudit_agent;
    DROP INDEX IF EXISTS idx_sessaudit_session;
    DROP TABLE IF EXISTS session_audit_log;

    DROP INDEX IF EXISTS idx_sesscp_agent_task;
    DROP TABLE IF EXISTS session_checkpoints;

    DROP INDEX IF EXISTS idx_session_task;
    DROP INDEX IF EXISTS idx_session_agent;
    DROP TABLE IF EXISTS session_token_usage;
  `,
};

export const SESSION_MIGRATIONS: DbMigration[] = [V1_9_SESSION_LIFECYCLE];


/**
 * Ensure Phase 186 session tables exist.
 * Idempotent — safe to call multiple times.
 */
export function runSessionMigrations(db: Database): void {
  runMigrations(db, SESSION_MIGRATIONS);
}
