// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CEO Assistant: DB Migration (V2.0)
 *
 * Adds the `assistant_tasks` table for the CEO Assistant task queue.
 * Applied lazily before any CEO Assistant operation.
 */

import type { Database, DbMigration } from "../utils/db.js";
import { runMigrations } from "../utils/db.js";

const V2_0_CEO_ASSISTANT: DbMigration = {
  version: "2.0",
  description: "CEO Assistant — assistant_tasks table",
  up: `
    CREATE TABLE IF NOT EXISTS assistant_tasks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id      TEXT NOT NULL,
      title         TEXT NOT NULL,
      priority      TEXT NOT NULL DEFAULT 'P3',
      status        TEXT NOT NULL DEFAULT 'open',
      deadline      TEXT,
      context_notes TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_asst_tasks_agent_status
      ON assistant_tasks(agent_id, status);

    CREATE INDEX IF NOT EXISTS idx_asst_tasks_deadline
      ON assistant_tasks(deadline)
      WHERE deadline IS NOT NULL;
  `,
  down: `
    DROP INDEX IF EXISTS idx_asst_tasks_deadline;
    DROP INDEX IF EXISTS idx_asst_tasks_agent_status;
    DROP TABLE IF EXISTS assistant_tasks;
  `,
};

export const CEO_ASSISTANT_MIGRATIONS: DbMigration[] = [V2_0_CEO_ASSISTANT];

/**
 * Ensure CEO Assistant tables exist.
 * Idempotent — safe to call multiple times.
 */
export function runCeoAssistantMigrations(db: Database): void {
  runMigrations(db, CEO_ASSISTANT_MIGRATIONS);
}
