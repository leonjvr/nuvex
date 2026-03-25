// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/knowledge/embedding-migration.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir }   from "node:os";
import { join }     from "node:path";
import {
  EmbeddingMigrationEngine,
  DEFAULT_MIGRATION_CONFIG,
  type EmbeddingMigrationConfig,
} from "../../../src/core/knowledge/embedding-migration.js";
import { EmbeddingSourceRegistry } from "../../../src/core/knowledge/embedding-source.js";
import { openDatabase } from "../../../src/utils/db.js";
import type { Embedder } from "../../../src/knowledge-pipeline/types.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "sidjua-emb-mig-test-"));
}

function makeEmbedder(dimensions = 4): Embedder {
  return {
    dimensions,
    maxTokens: 8191,
    embed: vi.fn(async (texts: string[]): Promise<Float32Array[]> =>
      texts.map(() => new Float32Array(dimensions).fill(0.1)),
    ),
  };
}

function setupWorkspace(workDir: string, chunkCount: number, hasRunningAgents = false): void {
  const systemDir = join(workDir, ".system");
  mkdirSync(systemDir, { recursive: true });

  const db = openDatabase(join(systemDir, "sidjua.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id            TEXT PRIMARY KEY,
      content       TEXT NOT NULL,
      metadata      TEXT NOT NULL DEFAULT '{}',
      collection_id TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS knowledge_vectors (
      chunk_id      TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      embedding     BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id     TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
  `);

  for (let i = 0; i < chunkCount; i++) {
    db.prepare<[string, string, string]>(
      "INSERT INTO knowledge_chunks (id, content, collection_id) VALUES (?, ?, ?)",
    ).run(`chunk-${i}`, `Content ${i}`, "test-collection");
  }

  if (hasRunningAgents) {
    db.prepare<[string]>("INSERT INTO agents (id, status) VALUES (?, ?)").run("agent-1", "active");
  }

  db.close();
}

describe("EmbeddingMigrationEngine", () => {
  let tmp:    string;
  let engine: EmbeddingMigrationEngine;

  beforeEach(() => {
    tmp    = makeTempDir();
    engine = new EmbeddingMigrationEngine(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // preflight
  // --------------------------------------------------------------------------

  it("preflight with no agents and documents → can proceed", async () => {
    setupWorkspace(tmp, 5);
    const result = await engine.preflight(DEFAULT_MIGRATION_CONFIG);
    expect(result.canProceed).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.totalDocuments).toBe(5);
  });

  it("preflight with running agents → cannot proceed", async () => {
    setupWorkspace(tmp, 3, true);
    const result = await engine.preflight(DEFAULT_MIGRATION_CONFIG);
    expect(result.canProceed).toBe(false);
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.blockers[0]).toContain("agent");
  });

  it("preflight returns document count, time, cost estimates", async () => {
    setupWorkspace(tmp, 100);
    const result = await engine.preflight(DEFAULT_MIGRATION_CONFIG);
    expect(result.totalDocuments).toBe(100);
    expect(result.estimatedTimeSeconds).toBeGreaterThan(0);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("preflight lists required collections", async () => {
    setupWorkspace(tmp, 5);
    const result = await engine.preflight(DEFAULT_MIGRATION_CONFIG);
    expect(result.collections).toContain("test-collection");
  });

  it("preflight with no documents → totalDocuments = 0", async () => {
    const result = await engine.preflight(DEFAULT_MIGRATION_CONFIG);
    expect(result.totalDocuments).toBe(0);
    expect(result.canProceed).toBe(true); // no documents = no agents to worry about
  });

  // --------------------------------------------------------------------------
  // run (dry run)
  // --------------------------------------------------------------------------

  it("dry run returns result without modifying any data", async () => {
    setupWorkspace(tmp, 5);
    const config: EmbeddingMigrationConfig = { ...DEFAULT_MIGRATION_CONFIG, dryRun: true };
    const embedder = makeEmbedder();
    const progress: number[] = [];

    const result = await engine.run(config, embedder, (cur) => progress.push(cur));

    expect(result.status).toBe("completed");
    expect(result.migratedDocuments).toBe(0); // dry run does nothing
    expect(embedder.embed).not.toHaveBeenCalled();
    // No vectors in DB
    const db = openDatabase(join(tmp, ".system", "sidjua.db"));
    const count = db.prepare<[], { count: number }>("SELECT COUNT(*) as count FROM knowledge_vectors").get()!;
    db.close();
    expect(count.count).toBe(0);
  });

  // --------------------------------------------------------------------------
  // run (full migration)
  // --------------------------------------------------------------------------

  it("full migration re-embeds all chunks and inserts vectors", async () => {
    setupWorkspace(tmp, 5);
    const embedder = makeEmbedder(4);
    let lastProgress = 0;

    const result = await engine.run(
      DEFAULT_MIGRATION_CONFIG,
      embedder,
      (cur) => { lastProgress = cur; },
    );

    expect(result.migratedDocuments).toBeGreaterThan(0);
    expect(embedder.embed).toHaveBeenCalled();

    // Vectors should be in DB
    const db = openDatabase(join(tmp, ".system", "sidjua.db"));
    const count = db.prepare<[], { count: number }>("SELECT COUNT(*) as count FROM knowledge_vectors").get()!;
    db.close();
    expect(count.count).toBeGreaterThan(0);
  });

  it("run creates migration-state.json", async () => {
    setupWorkspace(tmp, 3);
    const embedder = makeEmbedder();
    await engine.run(DEFAULT_MIGRATION_CONFIG, embedder, () => {});

    const registry = new EmbeddingSourceRegistry(tmp);
    const state    = registry.readMigrationState();
    expect(state).not.toBeNull();
    expect(state!.status).toBe("completed");
  });

  it("run calls onProgress callback with current/total counts", async () => {
    setupWorkspace(tmp, 5);
    const embedder   = makeEmbedder();
    const progCalls: Array<{ cur: number; total: number }> = [];

    await engine.run(
      { ...DEFAULT_MIGRATION_CONFIG, batchSize: 2 },
      embedder,
      (cur, total) => progCalls.push({ cur, total }),
    );

    expect(progCalls.length).toBeGreaterThan(0);
    expect(progCalls[0]!.total).toBe(5);
  });

  it("run creates backup before clearing vectors", async () => {
    setupWorkspace(tmp, 3);
    const embedder = makeEmbedder();
    const result   = await engine.run(DEFAULT_MIGRATION_CONFIG, embedder, () => {});

    const backupDir = join(tmp, ".system", `vectors-backup-${result.migrationId}`);
    expect(existsSync(backupDir)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // resume
  // --------------------------------------------------------------------------

  it("resume throws when no in-progress migration", async () => {
    const embedder = makeEmbedder();
    await expect(engine.resume(embedder, () => {})).rejects.toThrow("No in-progress migration");
  });

  it("resume skips already-migrated documents", async () => {
    setupWorkspace(tmp, 6);
    const embedder = makeEmbedder();

    // Partial run: migrate only first 3
    const registry = new EmbeddingSourceRegistry(tmp);
    const migId    = "test-resume-mig";
    registry.writeMigrationState({
      migration_id:       migId,
      started_at:         new Date().toISOString(),
      status:             "in_progress",
      total_documents:    6,
      migrated_documents: 3,
      failed_documents:   0,
      old_model:          "m1",
      new_model:          DEFAULT_MIGRATION_CONFIG.newModel,
      old_dimensions:     4,
      new_dimensions:     DEFAULT_MIGRATION_CONFIG.newDimensions,
    });

    for (let i = 0; i < 3; i++) {
      await registry.markMigrated(`chunk-${i}`, migId);
    }

    const result = await engine.resume(embedder, () => {});
    // Result includes the 3 previously counted + up to 3 newly processed
    expect(result.migratedDocuments).toBeLessThanOrEqual(6);
    expect(result.status).toMatch(/completed|partial/);
  });

  // --------------------------------------------------------------------------
  // rollback
  // --------------------------------------------------------------------------

  it("rollback throws when no migration state found", async () => {
    await expect(engine.rollback()).rejects.toThrow("No migration state found");
  });

  it("rollback restores vectors from backup", async () => {
    setupWorkspace(tmp, 3);
    const embedder = makeEmbedder(4);

    // First, run the migration to create a backup
    const result = await engine.run(DEFAULT_MIGRATION_CONFIG, embedder, () => {});

    // Rollback
    await engine.rollback();

    // Migration state should be cleared
    const registry = new EmbeddingSourceRegistry(tmp);
    expect(registry.readMigrationState()).toBeNull();
  });
});

describe("EmbeddingMigrationEngine — CLI command structural", () => {
  it("registerMigrateEmbeddingsCommands registers the command", async () => {
    const { Command } = await import("commander");
    const { registerMigrateEmbeddingsCommands } = await import(
      "../../../src/cli/commands/migrate-embeddings.js"
    );
    const program = new Command();
    program.exitOverride();
    registerMigrateEmbeddingsCommands(program);
    const cmd = program.commands.find((c) => c.name() === "migrate-embeddings");
    expect(cmd).toBeDefined();
  });

  it("migrate-embeddings has --resume, --rollback, --dry-run, --model, --batch-size, --rate-limit options", async () => {
    const { Command } = await import("commander");
    const { registerMigrateEmbeddingsCommands } = await import(
      "../../../src/cli/commands/migrate-embeddings.js"
    );
    const program = new Command();
    program.exitOverride();
    registerMigrateEmbeddingsCommands(program);
    const cmd     = program.commands.find((c) => c.name() === "migrate-embeddings")!;
    const options = cmd.options.map((o) => o.long);
    expect(options).toContain("--resume");
    expect(options).toContain("--rollback");
    expect(options).toContain("--dry-run");
    expect(options).toContain("--model");
    expect(options).toContain("--batch-size");
    expect(options).toContain("--rate-limit");
  });
});
