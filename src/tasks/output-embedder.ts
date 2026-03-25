// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 14: Task Output Embedder
 *
 * Embeds task outputs into a SQLite vector table for semantic search.
 * Follows the same pattern as Phase 10.6 HybridRetriever — Float32Array
 * stored as BLOB, cosine similarity computed in-memory.
 *
 * Graceful degradation: if no embedder is configured (embedder === null),
 * all embed calls log COMM-001 and return without error.
 */

import { randomUUID } from "node:crypto";
import type { Database }  from "../utils/db.js";
import type { Embedder }  from "../knowledge-pipeline/types.js";
import { createLogger }   from "../core/logger.js";
import { SidjuaError }    from "../core/error-codes.js";
import type { TaskOutput, OutputType } from "./output-store.js";

const logger = createLogger("output-embedder");


export interface OutputEmbeddingPayload {
  pg_id:          string;    // FK to task_outputs.id
  task_id:        string;
  agent_id:       string;
  division_id:    string | null;
  output_type:    string;
  filename:       string | null;
  summary_snippet: string;   // first 200 chars of content_text
  classification: string;
  created_at:     string;
}

export interface SearchResult {
  pg_id:          string;    // use to fetch full output from TaskOutputStore
  task_id:        string;
  agent_id:       string;
  output_type:    string;
  summary_snippet: string;
  score:          number;
  classification: string;
}

export interface SearchOptions {
  task_id?:        string;
  agent_id?:       string;
  division_id?:    string;
  output_type?:    OutputType;
  classification?: string;
  limit?:          number;
  score_threshold?: number;
}


interface VectorRow {
  id:             string;
  output_id:      string;
  task_id:        string;
  agent_id:       string;
  division_id:    string | null;
  output_type:    string;
  filename:       string | null;
  summary_snippet: string;
  classification: string;
  created_at:     string;
  embedding:      Buffer;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function bufferToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}


export class TaskOutputEmbedder {
  constructor(
    private readonly db:       Database,
    private readonly embedder: Embedder | null,
  ) {
    this.initialize();
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_output_vectors (
        id             TEXT PRIMARY KEY,
        output_id      TEXT NOT NULL,
        task_id        TEXT NOT NULL,
        agent_id       TEXT NOT NULL,
        division_id    TEXT,
        output_type    TEXT NOT NULL,
        filename       TEXT,
        summary_snippet TEXT NOT NULL DEFAULT '',
        classification TEXT NOT NULL DEFAULT 'INTERNAL',
        created_at     TEXT NOT NULL,
        embedding      BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tov_output_id ON task_output_vectors(output_id);
      CREATE INDEX IF NOT EXISTS idx_tov_task_id   ON task_output_vectors(task_id);
      CREATE INDEX IF NOT EXISTS idx_tov_agent_id  ON task_output_vectors(agent_id);
    `);
  }

  /** True if a real embedder is configured (graceful degradation check). */
  isAvailable(): boolean { return this.embedder !== null; }

  /** Embed a task output and store the vector. Returns the row ID, or '' if unavailable. */
  async embedOutput(output: TaskOutput): Promise<string> {
    if (this.embedder === null) {
      logger.warn(
        "comm_001_no_embedder",
        SidjuaError.from("COMM-001").message,
        { metadata: { output_id: output.id } },
      );
      return "";
    }

    const snippet = output.content_text?.substring(0, 200)
      ?? output.filename
      ?? "binary content";

    const textToEmbed = [
      output.output_type,
      output.filename ?? "",
      output.classification,
      snippet,
    ].join(" ");

    try {
      const [vec] = await this.embedder.embed([textToEmbed]);
      if (vec === undefined) return "";

      const id  = randomUUID();
      const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);

      this.db.prepare<unknown[], void>(`
        INSERT INTO task_output_vectors
          (id, output_id, task_id, agent_id, division_id, output_type,
           filename, summary_snippet, classification, created_at, embedding)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        output.id,
        output.task_id,
        output.agent_id,
        output.division_id ?? null,
        output.output_type,
        output.filename ?? null,
        snippet,
        output.classification,
        output.created_at,
        buf,
      );

      logger.debug("output_embedded", `Embedded output ${output.id}`, {
        metadata: { output_id: output.id, vector_id: id },
      });
      return id;
    } catch (err) {
      logger.warn("output_embed_failed", `Failed to embed output ${output.id}: ${String(err)}`, {
        metadata: { output_id: output.id },
      });
      return "";
    }
  }

  /** Semantic search across task outputs. Falls back gracefully if no embedder. */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    if (this.embedder === null) {
      logger.warn(
        "comm_001_search_fallback",
        SidjuaError.from("COMM-001").message,
        { metadata: { query } },
      );
      return [];
    }

    const limit     = options.limit          ?? 5;
    const threshold = options.score_threshold ?? 0.0;

    let queryVec: Float32Array;
    try {
      const [vec] = await this.embedder.embed([query]);
      if (vec === undefined) return [];
      queryVec = vec;
    } catch (err) {
      logger.warn("output_search_embed_failed", `Failed to embed query: ${String(err)}`, {
        metadata: { query },
      });
      return [];
    }

    // Build filter conditions
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.task_id)        { conditions.push("task_id = ?");        params.push(options.task_id); }
    if (options.agent_id)       { conditions.push("agent_id = ?");       params.push(options.agent_id); }
    if (options.division_id)    { conditions.push("division_id = ?");    params.push(options.division_id); }
    if (options.output_type)    { conditions.push("output_type = ?");    params.push(options.output_type); }
    if (options.classification) { conditions.push("classification = ?"); params.push(options.classification); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows  = this.db
      .prepare<unknown[], VectorRow>(`SELECT * FROM task_output_vectors ${where}`)
      .all(...params);

    const scored: SearchResult[] = [];
    for (const row of rows) {
      const vec   = bufferToFloat32(row.embedding);
      const score = cosineSimilarity(queryVec, vec);
      if (score >= threshold) {
        scored.push({
          pg_id:          row.output_id,
          task_id:        row.task_id,
          agent_id:       row.agent_id,
          output_type:    row.output_type,
          summary_snippet: row.summary_snippet,
          score,
          classification: row.classification,
        });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Remove all vectors for a task. */
  deleteByTaskId(taskId: string): void {
    const r = this.db
      .prepare<[string], void>("DELETE FROM task_output_vectors WHERE task_id = ?")
      .run(taskId);
    logger.debug("vectors_deleted_by_task", `Vectors deleted for task ${taskId}`, {
      metadata: { task_id: taskId, count: r.changes },
    });
  }

  /** Remove vector for a specific output. */
  deleteByOutputId(outputId: string): void {
    this.db
      .prepare<[string], void>("DELETE FROM task_output_vectors WHERE output_id = ?")
      .run(outputId);
  }
}
