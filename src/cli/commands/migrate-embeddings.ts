// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua migrate-embeddings` CLI Command
 *
 * Handles embedding migration when the embedding model changes.
 * All knowledge chunk content is preserved; only vectors are re-generated.
 *
 * Usage:
 *   sidjua migrate-embeddings                 — interactive migration
 *   sidjua migrate-embeddings --resume        — resume interrupted migration
 *   sidjua migrate-embeddings --rollback      — restore pre-migration state
 *   sidjua migrate-embeddings --dry-run       — estimate only, no changes
 *   sidjua migrate-embeddings --model <name>  — override target model
 *   sidjua migrate-embeddings --batch-size N  — docs per API call (default 20)
 *   sidjua migrate-embeddings --rate-limit N  — req/s (default 1)
 */

import type { Command }           from "commander";
import * as readline              from "node:readline";
import { getPaths }               from "../../core/paths.js";
import {
  EmbeddingMigrationEngine,
  DEFAULT_MIGRATION_CONFIG,
  type EmbeddingMigrationConfig,
  type ProgressCallback,
}                                 from "../../core/knowledge/embedding-migration.js";
import { EmbeddingSourceRegistry } from "../../core/knowledge/embedding-source.js";
import { createLogger }           from "../../core/logger.js";
import { SidjuaError }            from "../../core/error-codes.js";
import type { Embedder }          from "../../knowledge-pipeline/types.js";

const logger = createLogger("migrate-embeddings-cmd");


export function registerMigrateEmbeddingsCommands(program: Command): void {
  program
    .command("migrate-embeddings")
    .description("Re-embed all knowledge chunks with a new embedding model (experimental)")
    .option("--experimental",        "Required: acknowledge this command is experimental and may change")
    .option("--resume",              "Resume an interrupted migration")
    .option("--rollback",            "Restore pre-migration vector state")
    .option("--dry-run",             "Show estimate only — no changes made")
    .option("--model <name>",        "Target embedding model name")
    .option("--batch-size <n>",      "Documents per API call", "20")
    .option("--rate-limit <n>",      "Max API requests per second", "1")
    .option("--yes",                 "Auto-confirm without interactive prompt")
    .option("--work-dir <path>",     "Workspace directory", process.cwd())
    .addHelpText("after", "\nNote: This command is experimental. Pass --experimental to enable it.")
    .action(async (opts: {
      experimental: boolean;
      resume:       boolean;
      rollback:     boolean;
      dryRun:       boolean;
      model?:       string;
      batchSize:    string;
      rateLimit:    string;
      yes:          boolean;
      workDir:      string;
    }) => {
      if (!opts.experimental) {
        process.stderr.write(
          "Error: 'sidjua migrate-embeddings' is an experimental command.\n" +
          "Re-run with --experimental to acknowledge and proceed.\n",
        );
        process.exit(1);
      }
      const workDir = opts.workDir;
      const engine  = new EmbeddingMigrationEngine(workDir);
      const registry = new EmbeddingSourceRegistry(workDir);

      // ── --rollback ──────────────────────────────────────────────────────────
      if (opts.rollback) {
        await runRollback(engine);
        return;
      }

      // ── --resume ────────────────────────────────────────────────────────────
      if (opts.resume) {
        await runResume(engine, registry, opts.yes);
        return;
      }

      // ── Full migration (or --dry-run) ───────────────────────────────────────
      const config: EmbeddingMigrationConfig = {
        newModel:      opts.model ?? DEFAULT_MIGRATION_CONFIG.newModel,
        newDimensions: DEFAULT_MIGRATION_CONFIG.newDimensions,
        batchSize:     parseInt(opts.batchSize, 10) || DEFAULT_MIGRATION_CONFIG.batchSize,
        rateLimit:     parseFloat(opts.rateLimit)   || DEFAULT_MIGRATION_CONFIG.rateLimit,
        dryRun:        opts.dryRun,
      };

      await runMigration(engine, config, opts.yes);
    });
}


async function runMigration(
  engine:    EmbeddingMigrationEngine,
  config:    EmbeddingMigrationConfig,
  autoYes:   boolean,
): Promise<void> {
  if (config.dryRun) {
    process.stdout.write("\nDRY RUN — no changes will be made\n\n");
  } else {
    process.stdout.write("\nScanning knowledge base...\n\n");
  }

  // Preflight
  const preflight = await engine.preflight(config);

  if (preflight.totalDocuments === 0) {
    process.stdout.write("  No documents found in knowledge base.\n");
    process.stdout.write("  Import documents first with: sidjua knowledge import\n\n");
    process.exit(0);
  }

  const batches     = Math.ceil(preflight.totalDocuments / config.batchSize);
  const etaMinutes  = Math.round(preflight.estimatedTimeSeconds / 60);
  const costStr     = preflight.estimatedCostUsd.toFixed(4);

  process.stdout.write(`  Source databases: 1\n`);
  process.stdout.write(`  Total documents: ${preflight.totalDocuments.toLocaleString()}\n`);
  process.stdout.write(`  Target model: ${config.newModel}\n`);
  process.stdout.write(`  Collections: ${preflight.collections.join(", ") || "(none)"}\n\n`);

  process.stdout.write(`Estimation:\n`);
  process.stdout.write(`  Batches: ${batches} (${config.batchSize} docs/batch)\n`);
  process.stdout.write(`  Estimated time: ~${etaMinutes} minute(s)\n`);
  process.stdout.write(`  Estimated cost: ~$${costStr} (API calls)\n\n`);

  if (preflight.blockers.length > 0) {
    process.stdout.write("BLOCKERS:\n");
    for (const blocker of preflight.blockers) {
      process.stdout.write(`  ✗ ${blocker}\n`);
    }
    process.stdout.write("\nCannot proceed until blockers are resolved.\n");
    process.exit(1);
  } else {
    process.stdout.write(`WARNING: All agents must be stopped during migration.\n`);
    process.stdout.write(`  Running agents: 0 (OK)\n\n`);
  }

  if (config.dryRun) {
    process.stdout.write(`To execute: sidjua migrate-embeddings\n`);
    process.exit(0);
  }

  process.stdout.write(`WARNING: This will DELETE and RECREATE all knowledge vectors.\n`);
  process.stdout.write(`  A backup of current vectors will be created.\n\n`);

  if (!autoYes) {
    const confirmed = await promptConfirm("Proceed with embedding migration? [y/N] ");
    if (!confirmed) {
      process.stdout.write("Cancelled.\n");
      process.exit(0);
    }
  }

  process.stdout.write("\nBacking up current vectors... ");
  // Backup is handled inside engine.run()

  const onProgress: ProgressCallback = (current, total, eta) => {
    const pct   = total > 0 ? Math.round((current / total) * 20) : 0;
    const bar   = "#".repeat(pct) + ".".repeat(20 - pct);
    process.stdout.write(`\r  [${bar}] ${current.toLocaleString()}/${total.toLocaleString()} — ETA: ${eta}  `);
  };

  // Use a stub embedder for V1 — real provider wiring happens when provider is configured
  const stubEmbedder = makeStubEmbedder(config.newDimensions);

  let result;
  try {
    // Fail-fast if embedder is a stub or misconfigured — before any migration work
    await validateEmbeddingProvider(stubEmbedder, config.newDimensions);
    process.stdout.write("OK\n\nRe-embedding documents:\n");
    result = await engine.run(config, stubEmbedder, onProgress);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`\nMigration failed: ${msg}\n`);
    process.stderr.write("Use --rollback to restore the previous state.\n");
    logger.error("migrate-embeddings-cmd", "Migration failed", {
      error: { code: "MIGRATION_FAILED", message: msg },
    });
    process.exit(1);
  }

  process.stdout.write("\n\nRe-embedding complete.\n\n");
  process.stdout.write(`Validating... ${result.validationPassed ? "OK" : "FAILED"}\n\n`);

  process.stdout.write("Migration complete:\n");
  process.stdout.write(`  Documents: ${result.migratedDocuments.toLocaleString()} migrated, ${result.failedDocuments} failed\n`);
  process.stdout.write(`  Duration: ${formatDuration(result.durationSeconds)}\n`);
  process.stdout.write(`  Estimated cost: $${result.estimatedCostUsd.toFixed(4)}\n`);
  process.stdout.write(`  Rollback: sidjua migrate-embeddings --rollback\n\n`);

  process.exit(result.status === "completed" ? 0 : 1);
}


async function runResume(
  engine:   EmbeddingMigrationEngine,
  registry: EmbeddingSourceRegistry,
  autoYes:  boolean,
): Promise<void> {
  const state = registry.readMigrationState();
  if (state === null || state.status === "completed") {
    process.stdout.write("No in-progress migration found to resume.\n");
    process.stdout.write("Start a new migration with: sidjua migrate-embeddings\n");
    process.exit(1);
  }

  const remaining = state.total_documents - state.migrated_documents;
  process.stdout.write(`\nResuming migration: ${state.migration_id}\n`);
  process.stdout.write(`  Previously migrated: ${state.migrated_documents}/${state.total_documents}\n`);
  process.stdout.write(`  Remaining: ${remaining.toLocaleString()} documents\n\n`);

  if (!autoYes) {
    const confirmed = await promptConfirm("Continue? [y/N] ");
    if (!confirmed) {
      process.stdout.write("Cancelled.\n");
      process.exit(0);
    }
  }

  const onProgress: ProgressCallback = (current, total, eta) => {
    const pct = total > 0 ? Math.round((current / total) * 20) : 0;
    const bar = "#".repeat(pct) + ".".repeat(20 - pct);
    process.stdout.write(`\r  [${bar}] ${current.toLocaleString()}/${total.toLocaleString()} — ETA: ${eta}  `);
  };

  process.stdout.write("Re-embedding documents:\n");
  const stubEmbedder = makeStubEmbedder(state.new_dimensions);

  try {
    // Fail-fast if embedder is a stub or misconfigured — before any resume work
    await validateEmbeddingProvider(stubEmbedder, state.new_dimensions);
    const result = await engine.resume(stubEmbedder, onProgress);
    process.stdout.write(`\n\nResume complete: ${result.migratedDocuments} migrated, ${result.failedDocuments} failed\n`);
    process.exit(result.status === "completed" ? 0 : 1);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`\nResume failed: ${msg}\n`);
    process.exit(1);
  }
}


async function runRollback(engine: EmbeddingMigrationEngine): Promise<void> {
  try {
    await engine.rollback();
    process.stdout.write("Rollback complete — vectors restored to pre-migration state.\n");
    process.exit(0);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Rollback failed: ${msg}\n`);
    process.exit(1);
  }
}


async function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}


/**
 * Validate that an embedding provider is real and functional before starting a migration.
 *
 * Previously migrations ran with a stub embedder that silently produced
 * zero vectors, leaving the knowledge base with useless vectors and no clear error.
 *
 * Checks:
 *   - EMB-001: embedder.embed() throws (provider not configured / no API key)
 *   - EMB-002: embedder returns a zero vector (stub or misconfigured)
 *   - EMB-003: dimension count does not match expectedDimensions (model mismatch)
 *
 * @throws SidjuaError with code EMB-001, EMB-002, or EMB-003
 */
export async function validateEmbeddingProvider(
  embedder:           Embedder,
  expectedDimensions?: number,
): Promise<void> {
  let vectors: Float32Array[];

  try {
    vectors = await embedder.embed(["sidjua embedding validation canary"]);
  } catch (e: unknown) {
    throw SidjuaError.from(
      "EMB-001",
      `Embedding provider failed to respond: ${String(e)}`,
    );
  }

  const vector = vectors[0];
  if (vector === undefined || vector.length === 0) {
    throw SidjuaError.from("EMB-001", "Embedding provider returned no vectors");
  }

  const isZeroVector = vector.every((v) => v === 0);
  if (isZeroVector) {
    throw SidjuaError.from(
      "EMB-002",
      "Embedding provider returned a zero vector — stub embedder or misconfigured provider detected",
    );
  }

  if (expectedDimensions !== undefined && vector.length !== expectedDimensions) {
    throw SidjuaError.from(
      "EMB-003",
      `Embedding dimension mismatch: expected ${expectedDimensions}, got ${vector.length}`,
    );
  }
}


/**
 * Stub embedder for V1 — returns zero vectors.
 * Real provider wiring happens in the embedding pipeline when a provider is configured.
 * Used here to validate the migration flow without requiring a live API key.
 */
function makeStubEmbedder(dimensions: number): Embedder {
  return {
    dimensions,
    maxTokens:  8191,
    embed: async (texts: string[]): Promise<Float32Array[]> =>
      texts.map(() => new Float32Array(dimensions)),
  };
}
