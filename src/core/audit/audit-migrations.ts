// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Audit Module Database Migrations
 *
 * Creates audit_events and audit_snapshots tables.
 * Called lazily by CLI commands and the audit REST API before any reads.
 */

import type Database from "better-sqlite3";


/**
 * Idempotently create the audit module tables.
 * Safe to call on every command invocation.
 */
export function runAuditMigrations(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id          TEXT    PRIMARY KEY,
      timestamp   TEXT    NOT NULL DEFAULT (datetime('now')),
      agent_id    TEXT    NOT NULL,
      division    TEXT    NOT NULL DEFAULT '',
      event_type  TEXT    NOT NULL,
      rule_id     TEXT    NOT NULL DEFAULT '',
      action      TEXT    NOT NULL CHECK (action IN ('allowed', 'blocked', 'escalated')),
      severity    TEXT    NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      details     TEXT    NOT NULL DEFAULT '{}',
      task_id     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_ts       ON audit_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_events_agent    ON audit_events(agent_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_division ON audit_events(division);
    CREATE INDEX IF NOT EXISTS idx_audit_events_action   ON audit_events(action);
    CREATE INDEX IF NOT EXISTS idx_audit_events_severity ON audit_events(severity);

    CREATE TABLE IF NOT EXISTS audit_snapshots (
      id            TEXT PRIMARY KEY,
      timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
      snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('report', 'summary')),
      data          TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_audit_snapshots_type ON audit_snapshots(snapshot_type);
    CREATE INDEX IF NOT EXISTS idx_audit_snapshots_ts   ON audit_snapshots(timestamp);
  `);
}
