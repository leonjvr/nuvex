// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Embedding Source Registry
 *
 * The canonical source-of-truth for all embedded documents is the SQLite
 * workspace database (`data/.system/sidjua.db`).  Vectors in
 * `knowledge_vectors` are a derived artifact — always regenerable from the
 * content stored in `knowledge_chunks`.
 *
 * This module provides a streaming interface for iterating chunks that need
 * to be re-embedded during an embedding migration, without loading the entire
 * corpus into memory.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join, dirname }  from "node:path";
import { openDatabase }   from "../../utils/db.js";
import { createLogger }   from "../logger.js";

const logger = createLogger("embedding-source");


export interface EmbeddingSourceDocument {
  id:              string;
  content:         string;
  metadata:        Record<string, unknown>;
  collection:      string;
  embeddedAt?:     string;
  embeddingModel?: string;
}

export interface MigrationState {
  migration_id:         string;
  started_at:           string;
  status:               "pending" | "in_progress" | "completed" | "failed" | "partial";
  total_documents:      number;
  migrated_documents:   number;
  failed_documents:     number;
  old_model:            string;
  new_model:            string;
  old_dimensions:       number;
  new_dimensions:       number;
}

interface ChunkRow {
  id:              string;
  content:         string;
  metadata:        string;
  collection_id:   string;
  created_at:      string;
}

interface VectorRow {
  chunk_id:        string;
  embedding_model: string | null;
}

interface MigratedRow {
  chunk_id: string;
}


export class EmbeddingSourceRegistry {
  private readonly dbPath:        string;
  private readonly stateFilePath: string;

  constructor(workDir: string) {
    this.dbPath        = join(workDir, ".system", "sidjua.db");
    this.stateFilePath = join(workDir, ".system", "embedding-migration-state.json");
  }

  // --------------------------------------------------------------------------
  // getTotalDocumentCount
  // --------------------------------------------------------------------------

  async getTotalDocumentCount(): Promise<number> {
    if (!existsSync(this.dbPath)) return 0;
    const db = openDatabase(this.dbPath);
    try {
      if (!this._hasKnowledgeTable(db)) return 0;
      const row = db.prepare<[], { count: number }>(
        "SELECT COUNT(*) as count FROM knowledge_chunks",
      ).get();
      return row?.count ?? 0;
    } finally {
      db.close();
    }
  }

  // --------------------------------------------------------------------------
  // iterateDocuments (AsyncGenerator — streaming)
  // --------------------------------------------------------------------------

  async *iterateDocuments(): AsyncGenerator<EmbeddingSourceDocument> {
    if (!existsSync(this.dbPath)) return;

    const db = openDatabase(this.dbPath);
    try {
      if (!this._hasKnowledgeTable(db)) return;

      const rows = db
        .prepare<[], ChunkRow>(
          "SELECT id, content, metadata, collection_id, created_at FROM knowledge_chunks ORDER BY collection_id, id",
        )
        .all();

      for (const row of rows) {
        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(row.metadata) as Record<string, unknown>;
        } catch (e: unknown) { logger.debug("embedding-source", "Chunk metadata JSON parse failed — using empty object", { metadata: { error: e instanceof Error ? e.message : String(e), chunkId: row.id } }); }

        // Look up embedding metadata if available
        const vecRow = db
          .prepare<[string], VectorRow>(
            "SELECT chunk_id, NULL as embedding_model FROM knowledge_vectors WHERE chunk_id = ?",
          )
          .get(row.id);

        yield {
          id:         row.id,
          content:    row.content,
          metadata,
          collection: row.collection_id,
          ...(vecRow !== undefined ? { embeddedAt: row.created_at } : {}),
        };
      }
    } finally {
      db.close();
    }
  }

  // --------------------------------------------------------------------------
  // getUnmigratedDocuments
  // --------------------------------------------------------------------------

  async *getUnmigratedDocuments(migrationId: string): AsyncGenerator<EmbeddingSourceDocument> {
    if (!existsSync(this.dbPath)) return;

    const db = openDatabase(this.dbPath);
    try {
      if (!this._hasKnowledgeTable(db)) return;

      // Ensure migration tracking table exists
      this._ensureMigrationTable(db);

      const migratedRows = db
        .prepare<[string], MigratedRow>(
          "SELECT chunk_id FROM embedding_migration_log WHERE migration_id = ?",
        )
        .all(migrationId);

      const migratedIds = new Set(migratedRows.map((r) => r.chunk_id));

      const allRows = db
        .prepare<[], ChunkRow>(
          "SELECT id, content, metadata, collection_id, created_at FROM knowledge_chunks ORDER BY collection_id, id",
        )
        .all();

      for (const row of allRows) {
        if (migratedIds.has(row.id)) continue;

        let metadata: Record<string, unknown> = {};
        try {
          metadata = JSON.parse(row.metadata) as Record<string, unknown>;
        } catch (e: unknown) { logger.debug("embedding-source", "Chunk metadata JSON parse failed — using empty object", { metadata: { error: e instanceof Error ? e.message : String(e), chunkId: row.id } }); }

        yield {
          id:         row.id,
          content:    row.content,
          metadata,
          collection: row.collection_id,
        };
      }
    } finally {
      db.close();
    }
  }

  // --------------------------------------------------------------------------
  // markMigrated
  // --------------------------------------------------------------------------

  async markMigrated(documentId: string, migrationId: string): Promise<void> {
    if (!existsSync(this.dbPath)) return;
    const db = openDatabase(this.dbPath);
    try {
      this._ensureMigrationTable(db);
      db.prepare<[string, string, string]>(
        "INSERT OR IGNORE INTO embedding_migration_log (chunk_id, migration_id, migrated_at) VALUES (?, ?, ?)",
      ).run(documentId, migrationId, new Date().toISOString());
    } finally {
      db.close();
    }
  }

  // --------------------------------------------------------------------------
  // getRequiredCollections
  // --------------------------------------------------------------------------

  async getRequiredCollections(): Promise<string[]> {
    if (!existsSync(this.dbPath)) return [];
    const db = openDatabase(this.dbPath);
    try {
      if (!this._hasKnowledgeTable(db)) return [];
      const rows = db
        .prepare<[], { collection_id: string }>(
          "SELECT DISTINCT collection_id FROM knowledge_chunks ORDER BY collection_id",
        )
        .all();
      return rows.map((r) => r.collection_id);
    } finally {
      db.close();
    }
  }

  // --------------------------------------------------------------------------
  // Migration state persistence
  // --------------------------------------------------------------------------

  readMigrationState(): MigrationState | null {
    if (!existsSync(this.stateFilePath)) return null;
    try {
      return JSON.parse(readFileSync(this.stateFilePath, "utf-8")) as MigrationState;
    } catch (e: unknown) {
      logger.warn("embedding-source", "Failed to parse migration state", {
        error: { code: "PARSE_ERROR", message: e instanceof Error ? e.message : String(e) },
      });
      return null;
    }
  }

  writeMigrationState(state: MigrationState): void {
    const dir = dirname(this.stateFilePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), "utf-8");
  }

  deleteMigrationState(): void {
    if (existsSync(this.stateFilePath)) {
      unlinkSync(this.stateFilePath);
    }
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private _hasKnowledgeTable(db: ReturnType<typeof openDatabase>): boolean {
    const row = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_chunks'",
      )
      .get();
    return row !== undefined;
  }

  private _ensureMigrationTable(db: ReturnType<typeof openDatabase>): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS embedding_migration_log (
        chunk_id      TEXT NOT NULL,
        migration_id  TEXT NOT NULL,
        migrated_at   TEXT NOT NULL,
        PRIMARY KEY (chunk_id, migration_id)
      )
    `);
  }
}
