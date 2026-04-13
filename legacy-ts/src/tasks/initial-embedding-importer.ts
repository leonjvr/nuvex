// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Amendment 001 to PROMPT-395: Initial Embedding Importer
 *
 * Bulk-imports all existing task_outputs into task_output_vectors when
 * semantic search is first activated (V0.9.5 upgrade path from V0.9.0-beta).
 *
 * Design goals:
 *   - Resumable: tracks progress via LEFT JOIN — already-embedded rows are skipped
 *   - Blocking: runImport() resolves only when all rows are processed
 *   - Progress: onProgress callback called after each batch
 *   - Metrics: logs per-batch embedding latency (for V1.2 perf analysis)
 *
 * TODO: evaluate parallelising embed batches when SQLite write lock allows
 * TODO: profile cosine-similarity scan on large vector tables; add ANN index
 */

import type { Database }         from "../utils/db.js";
import { createLogger }          from "../core/logger.js";
import { TaskOutputEmbedder }    from "./output-embedder.js";
import type { TaskOutput }       from "./output-store.js";

const logger = createLogger("embedding-importer");

const DEFAULT_BATCH_SIZE = 50;


export interface ImportProgress {
  total:      number;
  completed:  number;
  failed:     number;
  elapsed_ms: number;
}

export type ProgressCallback = (progress: ImportProgress) => void;

export interface ImportResult {
  total:      number;   // un-embedded rows found at start
  embedded:   number;   // successfully embedded this run
  failed:     number;   // rows that threw an error
  elapsed_ms: number;
}


interface PendingRow {
  id:            string;
  task_id:       string;
  agent_id:      string;
  division_id:   string | null;
  output_type:   string;
  filename:      string | null;
  content_text:  string | null;
  classification: string;
  created_at:    string;
  content_hash:  string | null;
}

function pendingToOutput(row: PendingRow): TaskOutput {
  return {
    id:              row.id,
    task_id:         row.task_id,
    agent_id:        row.agent_id,
    division_id:     row.division_id  ?? null,
    output_type:     row.output_type as TaskOutput["output_type"],
    filename:        row.filename     ?? null,
    mime_type:       null,
    content_text:    row.content_text ?? null,
    content_binary:  null,
    content_hash:    row.content_hash ?? "",
    classification:  row.classification as TaskOutput["classification"],
    metadata:        {},
    created_at:      row.created_at,
    updated_at:      row.created_at,
  };
}


export class InitialEmbeddingImporter {
  constructor(
    private readonly db:      Database,
    private readonly embedder: TaskOutputEmbedder,
  ) {}

  /**
   * Count task_outputs that do NOT yet have a corresponding vector.
   * Used to show "N messages to embed" before starting.
   */
  countPending(): number {
    const row = this.db
      .prepare<[], { n: number }>(`
        SELECT COUNT(*) AS n
        FROM task_outputs t
        LEFT JOIN task_output_vectors v ON v.output_id = t.id
        WHERE v.id IS NULL
      `)
      .get();
    return row?.n ?? 0;
  }

  /** Count all task_outputs (for progress display denominator). */
  countTotal(): number {
    const row = this.db
      .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM task_outputs")
      .get();
    return row?.n ?? 0;
  }

  /**
   * Bulk-embed all un-embedded task outputs. Resumable: rows already in
   * task_output_vectors are skipped. Blocks until complete.
   *
   * @param opts.batchSize   Rows per embed call (default 50)
   * @param opts.onProgress  Called after each batch with running totals
   */
  async runImport(opts: {
    batchSize?:   number;
    onProgress?:  ProgressCallback;
  } = {}): Promise<ImportResult> {
    const batchSize  = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    const onProgress = opts.onProgress;

    const total    = this.countPending();
    let completed  = 0;
    let failed     = 0;
    const startMs  = Date.now();

    if (total === 0) {
      logger.info("import_skip", "No un-embedded outputs found — nothing to import", {});
      return { total: 0, embedded: 0, failed: 0, elapsed_ms: 0 };
    }

    logger.info("import_start", `Starting bulk embedding of ${total} task outputs`, {
      metadata: { total, batch_size: batchSize },
    });

    // Track IDs that failed this run so they are skipped in subsequent fetches.
    // Without this, a persistently-failing embed would cause an infinite loop.
    const failedIds = new Set<string>();

    // Process in batches, re-querying after each one so interruptions are resumable.
    while (true) {
      const batch = this._fetchPendingBatch(batchSize, failedIds);
      if (batch.length === 0) break;

      // TODO: track per-batch latency distribution for percentile analysis
      const batchStart = Date.now();

      for (const output of batch) {
        // embedOutput() swallows errors internally and returns "" on failure.
        // We use the empty-string return value as the failure signal rather than try/catch.
        const vectorId = await this.embedder.embedOutput(output);
        if (vectorId !== "") {
          completed++;
        } else {
          failed++;
          failedIds.add(output.id);  // exclude from future fetches this run
          logger.warn("import_row_failed", `Embedding returned empty for output ${output.id}`, {
            metadata: { output_id: output.id },
          });
        }
      }

      const batchElapsed = Date.now() - batchStart;
      // Amendment B: basic metrics logging for V1.2 analysis
      logger.info("import_batch_done", "Batch embedded", {
        metadata: {
          batch_size:       batch.length,
          batch_ms:         batchElapsed,
          ms_per_item:      Math.round(batchElapsed / batch.length),
          completed_so_far: completed,
          failed_so_far:    failed,
        },
      });

      onProgress?.({
        total,
        completed,
        failed,
        elapsed_ms: Date.now() - startMs,
      });
    }

    const elapsed_ms = Date.now() - startMs;
    logger.info("import_done", "Bulk embedding complete", {
      metadata: { total, embedded: completed, failed, elapsed_ms },
    });

    return { total, embedded: completed, failed, elapsed_ms };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _fetchPendingBatch(limit: number, excludeIds: Set<string>): TaskOutput[] {
    if (excludeIds.size === 0) {
      const rows = this.db
        .prepare<[number], PendingRow>(`
          SELECT t.*
          FROM task_outputs t
          LEFT JOIN task_output_vectors v ON v.output_id = t.id
          WHERE v.id IS NULL
          ORDER BY t.created_at ASC
          LIMIT ?
        `)
        .all(limit);
      return rows.map(pendingToOutput);
    }

    // Exclude already-failed IDs from this run to avoid infinite retry loops
    const placeholders = [...excludeIds].map(() => "?").join(", ");
    const rows = this.db
      .prepare<unknown[], PendingRow>(`
        SELECT t.*
        FROM task_outputs t
        LEFT JOIN task_output_vectors v ON v.output_id = t.id
        WHERE v.id IS NULL
          AND t.id NOT IN (${placeholders})
        ORDER BY t.created_at ASC
        LIMIT ?
      `)
      .all(...excludeIds, limit);
    return rows.map(pendingToOutput);
  }
}
