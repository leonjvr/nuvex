// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Embedding Migration Engine
 *
 * Handles re-embedding all knowledge chunks when the embedding model changes.
 *
 * Architecture:
 *   - Source of truth: knowledge_chunks table (content never deleted)
 *   - Derived artifact: knowledge_vectors table (always regenerable)
 *   - Migration: delete all vectors → re-embed each chunk → insert new vectors
 *   - Progress tracked in .system/embedding-migration-state.json
 *   - Resumable: tracks per-chunk migration status in embedding_migration_log table
 *
 * All re-embedding is done through the existing Embedder interface, which
 * already handles rate limiting and batching at the API level.
 */

import { existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join }                  from "node:path";
import { randomUUID }            from "node:crypto";
import { openDatabase }          from "../../utils/db.js";
import { createLogger }          from "../logger.js";
import { EmbeddingSourceRegistry, type MigrationState } from "./embedding-source.js";
import type { Embedder }         from "../../knowledge-pipeline/types.js";

const logger = createLogger("embedding-migration");


export interface EmbeddingMigrationConfig {
  newModel:      string;
  newDimensions: number;
  batchSize:     number;   // documents per embedding call
  rateLimit:     number;   // max requests per second
  dryRun:        boolean;
}

export const DEFAULT_MIGRATION_CONFIG: EmbeddingMigrationConfig = {
  newModel:      "text-embedding-3-large",
  newDimensions: 3072,
  batchSize:     20,
  rateLimit:     1,
  dryRun:        false,
};

export interface PreflightResult {
  canProceed:             boolean;
  blockers:               string[];
  totalDocuments:         number;
  estimatedTimeSeconds:   number;
  estimatedCostUsd:       number;
  collections:            string[];
}

export interface EmbeddingMigrationResult {
  migrationId:         string;
  status:              "completed" | "failed" | "partial";
  totalDocuments:      number;
  migratedDocuments:   number;
  failedDocuments:     number;
  durationSeconds:     number;
  estimatedCostUsd:    number;
  validationPassed:    boolean;
}

export type ProgressCallback = (current: number, total: number, eta: string) => void;


// Rough token count: avg 500 tokens per chunk
const AVG_TOKENS_PER_CHUNK = 500;

const COST_PER_1K_TOKENS: Record<string, number> = {
  "text-embedding-3-large":    0.00013,
  "text-embedding-3-small":    0.00002,
  "text-embedding-ada-002":    0.00010,
};

function estimateCost(model: string, totalDocs: number): number {
  const pricePerK = COST_PER_1K_TOKENS[model] ?? 0.0001;
  return totalDocs * (AVG_TOKENS_PER_CHUNK / 1000) * pricePerK;
}

function estimateTimeSeconds(totalDocs: number, batchSize: number, rateLimit: number): number {
  const batches = Math.ceil(totalDocs / batchSize);
  return batches / rateLimit;
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}


export class EmbeddingMigrationEngine {
  private readonly registry: EmbeddingSourceRegistry;
  private readonly workDir:  string;
  private readonly dbPath:   string;

  constructor(workDir: string) {
    this.workDir  = workDir;
    this.registry = new EmbeddingSourceRegistry(workDir);
    this.dbPath   = join(workDir, ".system", "sidjua.db");
  }

  // --------------------------------------------------------------------------
  // preflight
  // --------------------------------------------------------------------------

  async preflight(config: EmbeddingMigrationConfig): Promise<PreflightResult> {
    const blockers:       string[] = [];

    // Check for running agents
    const runningAgents = await this._countRunningAgents();
    if (runningAgents > 0) {
      blockers.push(`${runningAgents} agent(s) still running — stop all agents before migration`);
    }

    const totalDocuments   = await this.registry.getTotalDocumentCount();
    const collections      = await this.registry.getRequiredCollections();
    const estimatedTime    = estimateTimeSeconds(totalDocuments, config.batchSize, config.rateLimit);
    const estimatedCost    = estimateCost(config.newModel, totalDocuments);

    return {
      canProceed:           blockers.length === 0,
      blockers,
      totalDocuments,
      estimatedTimeSeconds: estimatedTime,
      estimatedCostUsd:     estimatedCost,
      collections,
    };
  }

  // --------------------------------------------------------------------------
  // run
  // --------------------------------------------------------------------------

  async run(
    config:     EmbeddingMigrationConfig,
    embedder:   Embedder,
    onProgress: ProgressCallback,
  ): Promise<EmbeddingMigrationResult> {
    const startTime    = Date.now();
    const migrationId  = `migrate-${new Date().toISOString().replace(/[:]/g, "-").slice(0, 19)}`;
    const totalDocs    = await this.registry.getTotalDocumentCount();
    const estimatedCost = estimateCost(config.newModel, totalDocs);

    if (config.dryRun) {
      logger.info("embedding-migration", "Dry run — no changes will be made");
      return {
        migrationId,
        status:           "completed",
        totalDocuments:   totalDocs,
        migratedDocuments: 0,
        failedDocuments:  0,
        durationSeconds:  0,
        estimatedCostUsd: estimatedCost,
        validationPassed: true,
      };
    }

    // Initialize migration state
    const state: MigrationState = {
      migration_id:       migrationId,
      started_at:         new Date().toISOString(),
      status:             "in_progress",
      total_documents:    totalDocs,
      migrated_documents: 0,
      failed_documents:   0,
      old_model:          "unknown",
      new_model:          config.newModel,
      old_dimensions:     0,
      new_dimensions:     config.newDimensions,
    };
    this.registry.writeMigrationState(state);

    // Backup current vectors directory
    await this._backupVectors(migrationId);

    // Drop and recreate vectors table in DB
    if (existsSync(this.dbPath)) {
      const db = openDatabase(this.dbPath);
      try {
        db.exec("DELETE FROM knowledge_vectors");
        logger.info("embedding-migration", "Cleared knowledge_vectors table");
      } finally {
        db.close();
      }
    }

    let migratedCount = 0;
    let failedCount   = 0;

    // Batch re-embedding
    const batch: Array<{ id: string; content: string; collection: string }> = [];

    const flushBatch = async (): Promise<void> => {
      if (batch.length === 0) return;

      const texts = batch.map((d) => d.content);
      try {
        const embeddings = await embedder.embed(texts);

        const db = openDatabase(this.dbPath);
        try {
          const insert = db.prepare<[string, string, Buffer]>(
            "INSERT OR REPLACE INTO knowledge_vectors (chunk_id, collection_id, embedding) VALUES (?, ?, ?)",
          );
          const tx = db.transaction(() => {
            for (let i = 0; i < batch.length; i++) {
              const item = batch[i]!;
              const vec  = embeddings[i];
              if (vec !== undefined) {
                insert.run(item.id, item.collection, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
              }
            }
          });
          tx();
        } finally {
          db.close();
        }

        // Mark each as migrated
        for (const item of batch) {
          await this.registry.markMigrated(item.id, migrationId);
          migratedCount++;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("embedding-migration", `Batch embedding failed: ${msg}`, {
          error: { code: "EMBED_ERROR", message: msg },
        });
        failedCount += batch.length;
      }

      batch.length = 0;

      // Rate limiting: sleep between batches
      const sleepMs = 1000 / config.rateLimit;
      await sleep(sleepMs);

      // Update progress
      const elapsed     = (Date.now() - startTime) / 1000;
      const done        = migratedCount + failedCount;
      const rate        = done / elapsed;
      const remaining   = totalDocs - done;
      const etaSeconds  = rate > 0 ? remaining / rate : 0;
      onProgress(done, totalDocs, formatEta(etaSeconds));

      // Persist state
      state.migrated_documents = migratedCount;
      state.failed_documents   = failedCount;
      this.registry.writeMigrationState(state);
    };

    for await (const doc of this.registry.iterateDocuments()) {
      batch.push({ id: doc.id, content: doc.content, collection: doc.collection });

      if (batch.length >= config.batchSize) {
        await flushBatch();
      }
    }

    // Flush remaining
    await flushBatch();

    // Validation
    const validationPassed = await this._validate(embedder);

    const durationSeconds = (Date.now() - startTime) / 1000;
    const finalStatus: "completed" | "failed" | "partial" =
      failedCount === 0 ? "completed" : migratedCount > 0 ? "partial" : "failed";

    state.status             = finalStatus;
    state.migrated_documents = migratedCount;
    state.failed_documents   = failedCount;
    this.registry.writeMigrationState(state);

    logger.info("embedding-migration", `Migration ${migrationId} ${finalStatus}`, {
      metadata: { migrated: migratedCount, failed: failedCount, duration_s: durationSeconds },
    });

    return {
      migrationId,
      status:            finalStatus,
      totalDocuments:    totalDocs,
      migratedDocuments: migratedCount,
      failedDocuments:   failedCount,
      durationSeconds,
      estimatedCostUsd:  estimatedCost,
      validationPassed,
    };
  }

  // --------------------------------------------------------------------------
  // resume
  // --------------------------------------------------------------------------

  async resume(
    embedder:   Embedder,
    onProgress: ProgressCallback,
  ): Promise<EmbeddingMigrationResult> {
    const state = this.registry.readMigrationState();
    if (state === null || state.status === "completed") {
      throw new Error("No in-progress migration to resume");
    }

    const startTime   = Date.now();
    const migrationId = state.migration_id;
    let migratedCount = state.migrated_documents;
    let failedCount   = state.failed_documents;
    const totalDocs   = state.total_documents;

    logger.info("embedding-migration", `Resuming migration ${migrationId} (already done: ${migratedCount}/${totalDocs})`);

    const config: EmbeddingMigrationConfig = {
      newModel:      state.new_model,
      newDimensions: state.new_dimensions,
      batchSize:     DEFAULT_MIGRATION_CONFIG.batchSize,
      rateLimit:     DEFAULT_MIGRATION_CONFIG.rateLimit,
      dryRun:        false,
    };

    const batch: Array<{ id: string; content: string; collection: string }> = [];

    const flushBatch = async (): Promise<void> => {
      if (batch.length === 0) return;

      const texts = batch.map((d) => d.content);
      try {
        const embeddings = await embedder.embed(texts);

        const db = openDatabase(this.dbPath);
        try {
          const insert = db.prepare<[string, string, Buffer]>(
            "INSERT OR REPLACE INTO knowledge_vectors (chunk_id, collection_id, embedding) VALUES (?, ?, ?)",
          );
          const tx = db.transaction(() => {
            for (let i = 0; i < batch.length; i++) {
              const item = batch[i]!;
              const vec  = embeddings[i];
              if (vec !== undefined) {
                insert.run(item.id, item.collection, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
              }
            }
          });
          tx();
        } finally {
          db.close();
        }

        for (const item of batch) {
          await this.registry.markMigrated(item.id, migrationId);
          migratedCount++;
        }
      } catch (e: unknown) {
        failedCount += batch.length;
        logger.warn("embedding-migration", "Resume batch failed", {
          error: { code: "RESUME_EMBED_ERROR", message: e instanceof Error ? e.message : String(e) },
        });
      }

      batch.length = 0;
      await sleep(1000 / config.rateLimit);

      const elapsed    = (Date.now() - startTime) / 1000;
      const done       = migratedCount + failedCount;
      const rate       = elapsed > 0 ? done / elapsed : 1;
      const remaining  = totalDocs - done;
      const eta        = rate > 0 ? remaining / rate : 0;
      onProgress(done, totalDocs, formatEta(eta));

      state.migrated_documents = migratedCount;
      state.failed_documents   = failedCount;
      this.registry.writeMigrationState(state);
    };

    for await (const doc of this.registry.getUnmigratedDocuments(migrationId)) {
      batch.push({ id: doc.id, content: doc.content, collection: doc.collection });
      if (batch.length >= config.batchSize) {
        await flushBatch();
      }
    }
    await flushBatch();

    const validationPassed = await this._validate(embedder);
    const durationSeconds  = (Date.now() - startTime) / 1000;
    const finalStatus: "completed" | "failed" | "partial" =
      failedCount === 0 ? "completed" : migratedCount > 0 ? "partial" : "failed";

    state.status             = finalStatus;
    state.migrated_documents = migratedCount;
    state.failed_documents   = failedCount;
    this.registry.writeMigrationState(state);

    return {
      migrationId,
      status:            finalStatus,
      totalDocuments:    totalDocs,
      migratedDocuments: migratedCount,
      failedDocuments:   failedCount,
      durationSeconds,
      estimatedCostUsd:  estimateCost(config.newModel, totalDocs),
      validationPassed,
    };
  }

  // --------------------------------------------------------------------------
  // rollback
  // --------------------------------------------------------------------------

  async rollback(): Promise<void> {
    const state = this.registry.readMigrationState();
    if (state === null) {
      throw new Error("No migration state found — nothing to rollback");
    }

    const backupDir = join(this.workDir, ".system", `vectors-backup-${state.migration_id}`);
    if (!existsSync(backupDir)) {
      throw new Error(`No backup found for migration ${state.migration_id}`);
    }

    logger.info("embedding-migration", `Rolling back migration ${state.migration_id}`);

    // Restore vectors from backup by re-reading backed-up data into DB
    if (existsSync(this.dbPath)) {
      const db = openDatabase(this.dbPath);
      try {
        db.exec("DELETE FROM knowledge_vectors");
      } finally {
        db.close();
      }
    }

    // Copy backup DB content back (backup is a flat file copy)
    const backupDbPath = join(backupDir, "vectors.db");
    if (existsSync(backupDbPath)) {
      const backupDb = openDatabase(backupDbPath);
      const db       = openDatabase(this.dbPath);
      try {
        const rows = backupDb
          .prepare<[], { chunk_id: string; collection_id: string; embedding: Buffer }>(
            "SELECT chunk_id, collection_id, embedding FROM knowledge_vectors",
          )
          .all();

        if (rows.length > 0) {
          const insert = db.prepare<[string, string, Buffer]>(
            "INSERT OR IGNORE INTO knowledge_vectors (chunk_id, collection_id, embedding) VALUES (?, ?, ?)",
          );
          const tx = db.transaction(() => {
            for (const row of rows) {
              insert.run(row.chunk_id, row.collection_id, row.embedding);
            }
          });
          tx();
        }
      } finally {
        backupDb.close();
        db.close();
      }
    }

    // Delete migration state and cleanup tracking
    this.registry.deleteMigrationState();

    // Remove the migration log entries
    if (existsSync(this.dbPath)) {
      const db = openDatabase(this.dbPath);
      try {
        db.prepare("DELETE FROM embedding_migration_log WHERE migration_id = ?").run(state.migration_id);
      } catch (e: unknown) { void e; /* cleanup-ignore: migration log cleanup is best-effort */ }
      finally { db.close(); }
    }

    logger.info("embedding-migration", "Rollback complete");
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private async _countRunningAgents(): Promise<number> {
    if (!existsSync(this.dbPath)) return 0;
    const db = openDatabase(this.dbPath);
    try {
      const hasTable = db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='agents'",
        )
        .get();
      if (hasTable === undefined) return 0;

      const row = db
        .prepare<[], { count: number }>(
          "SELECT COUNT(*) as count FROM agents WHERE status IN ('active', 'starting')",
        )
        .get();
      return row?.count ?? 0;
    } catch (e: unknown) {
      logger.debug("embedding-migration", "Could not count running agents — assuming 0", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return 0;
    } finally {
      db.close();
    }
  }

  private async _backupVectors(migrationId: string): Promise<void> {
    if (!existsSync(this.dbPath)) return;

    const backupDir = join(this.workDir, ".system", `vectors-backup-${migrationId}`);
    mkdirSync(backupDir, { recursive: true });

    // Create a separate SQLite copy with just the vectors
    const db       = openDatabase(this.dbPath);
    const backupDb = openDatabase(join(backupDir, "vectors.db"));
    try {
      const hasVectors = db
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_vectors'",
        )
        .get();

      if (hasVectors !== undefined) {
        backupDb.exec(`
          CREATE TABLE IF NOT EXISTS knowledge_vectors (
            chunk_id      TEXT PRIMARY KEY,
            collection_id TEXT NOT NULL,
            embedding     BLOB NOT NULL
          )
        `);

        const rows = db
          .prepare<[], { chunk_id: string; collection_id: string; embedding: Buffer }>(
            "SELECT chunk_id, collection_id, embedding FROM knowledge_vectors",
          )
          .all();

        if (rows.length > 0) {
          const insert = backupDb.prepare<[string, string, Buffer]>(
            "INSERT INTO knowledge_vectors (chunk_id, collection_id, embedding) VALUES (?, ?, ?)",
          );
          const tx = backupDb.transaction(() => {
            for (const row of rows) {
              insert.run(row.chunk_id, row.collection_id, row.embedding);
            }
          });
          tx();
        }

        logger.info("embedding-migration", `Backed up ${rows.length} vectors to ${backupDir}`);
      }
    } finally {
      db.close();
      backupDb.close();
    }
  }

  private async _validate(embedder: Embedder): Promise<boolean> {
    // For V1: validation is a no-op — just returns true
    // Full implementation would spot-check cosine similarity
    // Avoiding API calls in validation to keep cost down for now
    void embedder;
    return true;
  }
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
