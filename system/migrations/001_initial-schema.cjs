// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.
//
// Migration 001: Initial agent state schema
// Version: 0.9.0
// Description: Creates the base agent_state table (skip-if-exists idempotent)

/** @type {import('../../src/core/update/migration-framework.js').Migration} */
const migration = {
  id: "001_initial-schema",
  version: "0.9.0",
  description: "Initial agent state schema",

  async up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  },

  async down(db) {
    db.exec("DROP TABLE IF EXISTS agent_state");
  },
};

module.exports = migration;
