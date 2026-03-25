// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — P270 B1: Offline Decision Fallback
 *
 * When the governance pipeline cannot get a live decision (e.g. approver
 * offline, approval service down), the decision is stored as "pending".
 * On next orchestrator startup (B2), pending decisions are replayed.
 */

import { randomUUID } from "node:crypto";
import type { Database } from "../utils/db.js";
import { createLogger } from "./logger.js";

const logger = createLogger("pending-decisions");

export interface PendingDecision {
  id:           string;
  task_id:      string;
  type:         string;
  payload:      Record<string, unknown>;
  created_at:   string;
  processed:    boolean;
  processed_at: string | null;
}

/** DDL — called lazily before any pending_decisions operation. */
export function ensurePendingDecisionsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_decisions (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL,
      type         TEXT NOT NULL,
      payload      TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      processed    INTEGER NOT NULL DEFAULT 0,
      processed_at TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pending_decisions_processed ON pending_decisions(processed)`);
}

/**
 * Save a pending decision for later processing.
 * Returns the new decision ID.
 */
export function savePendingDecision(
  db:      Database,
  taskId:  string,
  type:    string,
  payload: Record<string, unknown>,
): string {
  ensurePendingDecisionsTable(db);
  const id  = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO pending_decisions (id, task_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, taskId, type, JSON.stringify(payload), now);
  logger.info("pending-decisions", "Saved pending decision", {
    metadata: { id, task_id: taskId, type },
  });
  return id;
}

/**
 * Retrieve all unprocessed pending decisions, ordered by created_at.
 */
export function getPendingDecisions(db: Database): PendingDecision[] {
  ensurePendingDecisionsTable(db);
  const rows = db.prepare<[], {
    id: string; task_id: string; type: string;
    payload: string; created_at: string; processed: number; processed_at: string | null;
  }>(
    "SELECT id, task_id, type, payload, created_at, processed, processed_at FROM pending_decisions WHERE processed = 0 ORDER BY created_at ASC",
  ).all();
  return rows.map((r) => ({
    id:           r.id,
    task_id:      r.task_id,
    type:         r.type,
    payload:      JSON.parse(r.payload) as Record<string, unknown>,
    created_at:   r.created_at,
    processed:    r.processed === 1,
    processed_at: r.processed_at,
  }));
}

/**
 * Mark a pending decision as processed.
 */
export function markDecisionProcessed(db: Database, id: string): void {
  ensurePendingDecisionsTable(db);
  db.prepare(
    "UPDATE pending_decisions SET processed = 1, processed_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), id);
}
