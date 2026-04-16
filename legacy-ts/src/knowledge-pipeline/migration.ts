// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: DB Migration V1.7
 *
 * Adds knowledge pipeline tables:
 *   knowledge_collections, knowledge_chunks, knowledge_chunks_fts (FTS5),
 *   knowledge_vectors, knowledge_access_log, policy_rules
 */

import type { Database, DbMigration } from "../utils/db.js";
import { runMigrations } from "../utils/db.js";

const V1_7_KNOWLEDGE: DbMigration = {
  version: "1.7",
  description: "Phase 10.6 — knowledge pipeline tables",
  up: `
    -- Knowledge collections
    CREATE TABLE IF NOT EXISTS knowledge_collections (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      scope_json      TEXT NOT NULL,
      classification  TEXT NOT NULL DEFAULT 'INTERNAL',
      config_yaml     TEXT NOT NULL DEFAULT '',
      chunk_count     INTEGER NOT NULL DEFAULT 0,
      total_tokens    INTEGER NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'empty',
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    -- Individual chunks
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id                  TEXT PRIMARY KEY,
      collection_id       TEXT NOT NULL,
      source_file         TEXT NOT NULL,
      content             TEXT NOT NULL,
      token_count         INTEGER NOT NULL,
      position            INTEGER NOT NULL,
      section_path        TEXT NOT NULL DEFAULT '[]',
      page_number         INTEGER,
      preceding_context   TEXT NOT NULL DEFAULT '',
      metadata            TEXT NOT NULL DEFAULT '{}',
      created_at          TEXT NOT NULL,
      FOREIGN KEY (collection_id) REFERENCES knowledge_collections(id)
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_collection ON knowledge_chunks(collection_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_source ON knowledge_chunks(collection_id, source_file);

    -- FTS5 virtual table for BM25 keyword search
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
      content,
      collection_id UNINDEXED,
      content='knowledge_chunks',
      content_rowid='rowid'
    );

    -- Vector embeddings (Float32Array stored as BLOB)
    CREATE TABLE IF NOT EXISTS knowledge_vectors (
      chunk_id        TEXT PRIMARY KEY,
      collection_id   TEXT NOT NULL,
      embedding       BLOB NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES knowledge_chunks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_vectors_collection ON knowledge_vectors(collection_id);

    -- Knowledge access audit log
    CREATE TABLE IF NOT EXISTS knowledge_access_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id        TEXT NOT NULL,
      collection_id   TEXT NOT NULL,
      query           TEXT NOT NULL,
      chunks_returned INTEGER NOT NULL,
      top_score       REAL,
      cost_usd        REAL NOT NULL DEFAULT 0.0,
      timestamp       TEXT NOT NULL
    );

    -- Policy rules (parsed from governance YAML files for fast query)
    CREATE TABLE IF NOT EXISTS policy_rules (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file     TEXT NOT NULL,
      rule_type       TEXT NOT NULL,
      action_pattern  TEXT,
      condition       TEXT,
      enforcement     TEXT NOT NULL,
      escalate_to     TEXT,
      reason          TEXT,
      active          INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL
    );
  `,
  down: `
    DROP TABLE IF EXISTS policy_rules;
    DROP TABLE IF EXISTS knowledge_access_log;
    DROP TABLE IF EXISTS knowledge_vectors;
    DROP TABLE IF EXISTS knowledge_chunks_fts;
    DROP INDEX IF EXISTS idx_chunks_source;
    DROP INDEX IF EXISTS idx_chunks_collection;
    DROP TABLE IF EXISTS knowledge_chunks;
    DROP TABLE IF EXISTS knowledge_collections;
  `,
};

export const KNOWLEDGE_MIGRATIONS: DbMigration[] = [V1_7_KNOWLEDGE];

export function runKnowledgeMigrations(db: Database): void {
  runMigrations(db, KNOWLEDGE_MIGRATIONS);
}
