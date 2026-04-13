// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8: CheckpointManager
 *
 * Periodic state serialization + recovery for agent subprocesses.
 * Uses system-level SQLite at system/checkpoints.db.
 *
 * Strategy:
 *   - Save every checkpoint_interval_ms (default: 30s)
 *   - Also save: on task completion, before shutdown, on CHECKPOINT_REQUEST
 *   - Keep last 5 checkpoints per agent, delete older
 *   - On crash → Bootstrap loads latest checkpoint → injects via INIT message
 */

import type { Database } from "../utils/db.js";
import type { Checkpoint } from "./types.js";


interface CheckpointRow {
  id: number;
  agent_id: string;
  version: number;
  timestamp: string;
  state: string;            // JSON: AgentState
  task_states: string;      // JSON: TaskCheckpoint[]
  memory_snapshot: string;
  memory_lifecycle: string; // JSON: Checkpoint["memory_lifecycle"] | null
  created_at: string;
}


export class CheckpointManager {
  constructor(private readonly db: Database) {}

  /**
   * Initialize the checkpoint database schema.
   * Idempotent — safe to call on every startup.
   */
  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id         TEXT NOT NULL,
        version          INTEGER NOT NULL,
        timestamp        TEXT NOT NULL,
        state            TEXT NOT NULL,
        task_states      TEXT NOT NULL,
        memory_snapshot  TEXT NOT NULL,
        memory_lifecycle TEXT,
        created_at       TEXT NOT NULL,
        UNIQUE(agent_id, version)
      );

      CREATE INDEX IF NOT EXISTS idx_checkpoints_agent
        ON checkpoints(agent_id, version DESC);
    `);
  }

  /**
   * Save a checkpoint. Returns the checkpoint version.
   * Version auto-increments per agent (max existing + 1).
   */
  async save(checkpoint: Checkpoint): Promise<number> {
    // Determine next version
    const version = this.nextVersion(checkpoint.agent_id);
    const now = new Date().toISOString();

    this.db
      .prepare<
        [string, number, string, string, string, string, string | null, string],
        void
      >(
        `INSERT INTO checkpoints
           (agent_id, version, timestamp, state, task_states, memory_snapshot, memory_lifecycle, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        checkpoint.agent_id,
        version,
        checkpoint.timestamp,
        JSON.stringify(checkpoint.state),
        JSON.stringify(checkpoint.task_states),
        checkpoint.memory_snapshot,
        checkpoint.memory_lifecycle !== undefined
          ? JSON.stringify(checkpoint.memory_lifecycle)
          : null,
        now,
      );

    return version;
  }

  /**
   * Load the latest checkpoint for an agent.
   * Returns null if no checkpoints exist.
   */
  async loadLatest(agentId: string): Promise<Checkpoint | null> {
    const row = this.db
      .prepare<[string], CheckpointRow>(
        `SELECT * FROM checkpoints
         WHERE agent_id = ?
         ORDER BY version DESC
         LIMIT 1`,
      )
      .get(agentId);

    if (row === undefined) return null;
    return rowToCheckpoint(row);
  }

  /**
   * Load a specific checkpoint version for an agent.
   * Returns null if the version does not exist.
   */
  async loadVersion(agentId: string, version: number): Promise<Checkpoint | null> {
    const row = this.db
      .prepare<[string, number], CheckpointRow>(
        `SELECT * FROM checkpoints
         WHERE agent_id = ? AND version = ?
         LIMIT 1`,
      )
      .get(agentId, version);

    if (row === undefined) return null;
    return rowToCheckpoint(row);
  }

  /**
   * List checkpoints for an agent, ordered by version descending.
   */
  async list(agentId: string, limit = 10): Promise<Checkpoint[]> {
    const rows = this.db
      .prepare<[string, number], CheckpointRow>(
        `SELECT * FROM checkpoints
         WHERE agent_id = ?
         ORDER BY version DESC
         LIMIT ?`,
      )
      .all(agentId, limit);

    return rows.map(rowToCheckpoint);
  }

  /**
   * Delete old checkpoints, keeping the most recent `keepLast` versions.
   * Returns the number of deleted rows.
   */
  async cleanup(agentId: string, keepLast: number): Promise<number> {
    // Find the version threshold
    const threshold = this.db
      .prepare<[string, number], { version: number }>(
        `SELECT version FROM checkpoints
         WHERE agent_id = ?
         ORDER BY version DESC
         LIMIT 1 OFFSET ?`,
      )
      .get(agentId, keepLast - 1);

    if (threshold === undefined) return 0; // fewer than keepLast checkpoints

    const result = this.db
      .prepare<[string, number], void>(
        `DELETE FROM checkpoints
         WHERE agent_id = ? AND version < ?`,
      )
      .run(agentId, threshold.version);

    return result.changes;
  }

  /**
   * Delete ALL checkpoints for an agent (used on graceful shutdown).
   */
  async deleteAll(agentId: string): Promise<void> {
    this.db
      .prepare<[string], void>(`DELETE FROM checkpoints WHERE agent_id = ?`)
      .run(agentId);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private nextVersion(agentId: string): number {
    const row = this.db
      .prepare<[string], { max_version: number | null }>(
        `SELECT MAX(version) AS max_version FROM checkpoints WHERE agent_id = ?`,
      )
      .get(agentId);

    return (row?.max_version ?? 0) + 1;
  }
}


function rowToCheckpoint(row: CheckpointRow): Checkpoint {
  const base = {
    agent_id: row.agent_id,
    timestamp: row.timestamp,
    version: row.version,
    state: JSON.parse(row.state) as Checkpoint["state"],
    task_states: JSON.parse(row.task_states) as Checkpoint["task_states"],
    memory_snapshot: row.memory_snapshot,
  };

  if (row.memory_lifecycle !== null && row.memory_lifecycle !== undefined) {
    return Object.assign(base, {
      memory_lifecycle: JSON.parse(row.memory_lifecycle) as NonNullable<Checkpoint["memory_lifecycle"]>,
    });
  }

  return base;
}
