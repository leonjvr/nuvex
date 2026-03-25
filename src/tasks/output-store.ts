// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 14: Task Output Store
 *
 * Lossless storage for all agent outputs in SQLite.
 * Supports text (UTF-8) and binary (BLOB) content.
 * SHA-256 hash computed on create for integrity verification.
 */

import { randomUUID } from "node:crypto";
import { sha256hex } from "../core/crypto-utils.js";
import type { Database } from "../utils/db.js";
import { createLogger }  from "../core/logger.js";
import { SidjuaError }   from "../core/error-codes.js";

const logger = createLogger("output-store");


export type OutputType = "file" | "report" | "analysis" | "code" | "data" | "summary";

export interface TaskOutput {
  id:               string;
  task_id:          string;
  agent_id:         string;
  division_id:      string | null;
  output_type:      OutputType;
  filename:         string | null;
  mime_type:        string | null;
  content_text:     string | null;
  content_binary:   Buffer | null;
  content_hash:     string;          // SHA-256 hex
  classification:   string;
  metadata:         Record<string, unknown>;
  created_at:       string;
  updated_at:       string;
}

export interface CreateOutputInput {
  task_id:          string;
  agent_id:         string;
  division_id?:     string;
  output_type:      OutputType;
  filename?:        string;
  mime_type?:       string;
  content_text?:    string;
  content_binary?:  Buffer;
  classification?:  string;
  metadata?:        Record<string, unknown>;
}

export interface OutputQuery {
  task_id?:        string;
  agent_id?:       string;
  division_id?:    string;
  output_type?:    OutputType;
  classification?: string;
  limit?:          number;
  offset?:         number;
  order_by?:       "created_at" | "output_type";
  order_dir?:      "ASC" | "DESC";
}


interface OutputRow {
  id:             string;
  task_id:        string;
  agent_id:       string;
  division_id:    string | null;
  output_type:    string;
  filename:       string | null;
  mime_type:      string | null;
  content_text:   string | null;
  content_binary: Buffer | null;
  content_hash:   string;
  classification: string;
  metadata:       string;
  created_at:     string;
  updated_at:     string;
}

function rowToOutput(row: OutputRow): TaskOutput {
  return {
    id:             row.id,
    task_id:        row.task_id,
    agent_id:       row.agent_id,
    division_id:    row.division_id,
    output_type:    row.output_type as OutputType,
    filename:       row.filename,
    mime_type:      row.mime_type,
    content_text:   row.content_text,
    content_binary: row.content_binary,
    content_hash:   row.content_hash,
    classification: row.classification,
    metadata:       JSON.parse(row.metadata) as Record<string, unknown>,
    created_at:     row.created_at,
    updated_at:     row.updated_at,
  };
}

function computeHash(text?: string, binary?: Buffer): string {
  if (binary !== undefined) return sha256hex(binary);
  if (text  !== undefined) return sha256hex(text);
  return sha256hex("");
}


export class TaskOutputStore {
  constructor(private readonly db: Database) {
    this.initialize();
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_outputs (
        id             TEXT PRIMARY KEY,
        task_id        TEXT NOT NULL,
        agent_id       TEXT NOT NULL,
        division_id    TEXT,
        output_type    TEXT NOT NULL CHECK (output_type IN ('file','report','analysis','code','data','summary')),
        filename       TEXT,
        mime_type      TEXT,
        content_text   TEXT,
        content_binary BLOB,
        content_hash   TEXT NOT NULL,
        classification TEXT NOT NULL DEFAULT 'INTERNAL',
        metadata       TEXT NOT NULL DEFAULT '{}',
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_outputs_task_id       ON task_outputs(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_outputs_agent_id      ON task_outputs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_task_outputs_type          ON task_outputs(output_type);
      CREATE INDEX IF NOT EXISTS idx_task_outputs_created       ON task_outputs(created_at);
      CREATE INDEX IF NOT EXISTS idx_task_outputs_classification ON task_outputs(classification);

      -- FIX-457: FTS5 virtual table for efficient full-text search in fallback mode.
      -- Uses content= (external content table) so text is stored only once.
      CREATE VIRTUAL TABLE IF NOT EXISTS task_outputs_fts USING fts5(
        task_id,
        agent_id,
        content_text,
        content='task_outputs',
        content_rowid='rowid'
      );

      -- Triggers to keep FTS index in sync with the source table
      CREATE TRIGGER IF NOT EXISTS task_outputs_ai
        AFTER INSERT ON task_outputs BEGIN
          INSERT INTO task_outputs_fts(rowid, task_id, agent_id, content_text)
          VALUES (new.rowid, new.task_id, new.agent_id, new.content_text);
        END;

      CREATE TRIGGER IF NOT EXISTS task_outputs_ad
        AFTER DELETE ON task_outputs BEGIN
          INSERT INTO task_outputs_fts(task_outputs_fts, rowid, task_id, agent_id, content_text)
          VALUES ('delete', old.rowid, old.task_id, old.agent_id, old.content_text);
        END;

      CREATE TRIGGER IF NOT EXISTS task_outputs_au
        AFTER UPDATE ON task_outputs BEGIN
          INSERT INTO task_outputs_fts(task_outputs_fts, rowid, task_id, agent_id, content_text)
          VALUES ('delete', old.rowid, old.task_id, old.agent_id, old.content_text);
          INSERT INTO task_outputs_fts(rowid, task_id, agent_id, content_text)
          VALUES (new.rowid, new.task_id, new.agent_id, new.content_text);
        END;
    `);
  }

  create(input: CreateOutputInput): TaskOutput {
    if (!input.content_text && !input.content_binary) {
      throw SidjuaError.from("OUTPUT-001");
    }

    const id         = randomUUID();
    const now        = new Date().toISOString();
    const hash       = computeHash(input.content_text, input.content_binary);
    const classif    = input.classification ?? "INTERNAL";
    const metadata   = JSON.stringify(input.metadata ?? {});

    this.db.prepare<unknown[], void>(`
      INSERT INTO task_outputs
        (id, task_id, agent_id, division_id, output_type, filename, mime_type,
         content_text, content_binary, content_hash, classification, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.task_id,
      input.agent_id,
      input.division_id ?? null,
      input.output_type,
      input.filename ?? null,
      input.mime_type ?? null,
      input.content_text ?? null,
      input.content_binary ?? null,
      hash,
      classif,
      metadata,
      now,
      now,
    );

    logger.info("output_created", `Output ${id} created for task ${input.task_id}`, {
      metadata: { id, task_id: input.task_id, agent_id: input.agent_id, output_type: input.output_type },
    });

    return this.getById(id)!;
  }

  getById(id: string): TaskOutput | null {
    const row = this.db
      .prepare<[string], OutputRow>("SELECT * FROM task_outputs WHERE id = ?")
      .get(id);
    return row !== undefined ? rowToOutput(row) : null;
  }

  getByTaskId(taskId: string): TaskOutput[] {
    const rows = this.db
      .prepare<[string], OutputRow>(
        "SELECT * FROM task_outputs WHERE task_id = ? ORDER BY created_at ASC",
      )
      .all(taskId);
    return rows.map(rowToOutput);
  }

  getByAgentId(agentId: string, limit = 50): TaskOutput[] {
    const rows = this.db
      .prepare<[string, number], OutputRow>(
        "SELECT * FROM task_outputs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(agentId, limit);
    return rows.map(rowToOutput);
  }

  query(q: OutputQuery): TaskOutput[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (q.task_id)        { conditions.push("task_id = ?");        params.push(q.task_id); }
    if (q.agent_id)       { conditions.push("agent_id = ?");       params.push(q.agent_id); }
    if (q.division_id)    { conditions.push("division_id = ?");    params.push(q.division_id); }
    if (q.output_type)    { conditions.push("output_type = ?");    params.push(q.output_type); }
    if (q.classification) { conditions.push("classification = ?"); params.push(q.classification); }

    const where  = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const col    = q.order_by  ?? "created_at";
    const dir    = q.order_dir ?? "ASC";
    const limit  = Math.min(q.limit  ?? 50, 500);
    const offset = q.offset ?? 0;

    const sql  = `SELECT * FROM task_outputs ${where} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`;
    const rows = this.db.prepare<unknown[], OutputRow>(sql).all(...params, limit, offset);
    return rows.map(rowToOutput);
  }

  delete(id: string): void {
    this.db.prepare<[string], void>("DELETE FROM task_outputs WHERE id = ?").run(id);
    logger.info("output_deleted", `Output ${id} deleted`, { metadata: { id } });
  }

  deleteByTaskId(taskId: string): void {
    const count = this.db
      .prepare<[string], void>("DELETE FROM task_outputs WHERE task_id = ?")
      .run(taskId);
    logger.info("outputs_deleted_by_task", `Outputs deleted for task ${taskId}`, {
      metadata: { task_id: taskId, count: count.changes },
    });
  }

  /**
   * Full-text search across task outputs.
   *
   * Uses the FTS5 `task_outputs_fts` virtual table when available (fast O(log n)
   * lookup via inverted index). Falls back to in-memory LIKE filtering when the
   * FTS table is absent — e.g. on databases created before v0.9.7.
   *
   * @param term  - Search term (FTS5 MATCH syntax supported in FTS path).
   * @param limit - Maximum results to return.
   * @returns Matching task outputs ordered by relevance (FTS) or insertion order (fallback).
   */
  searchText(term: string, limit = 10): TaskOutput[] {
    // Check whether FTS table exists (safe guard for pre-0.9.7 databases)
    const ftsExists = this.db
      .prepare<[string], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      )
      .get("task_outputs_fts");

    if (ftsExists !== undefined) {
      try {
        // FTS5 path: join via shared rowid for full column access
        const rows = this.db
          .prepare<[string, number], OutputRow>(
            `SELECT t.* FROM task_outputs t
             JOIN task_outputs_fts f ON t.rowid = f.rowid
             WHERE task_outputs_fts MATCH ?
             ORDER BY rank
             LIMIT ?`,
          )
          .all(term, limit);
        return rows.map(rowToOutput);
      } catch (e: unknown) {
        logger.warn("output-store", "FTS search failed — falling back to LIKE search", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    // LIKE fallback for pre-0.9.7 databases without FTS table
    const lower   = term.toLowerCase();
    const rows    = this.db
      .prepare<[number], OutputRow>("SELECT * FROM task_outputs LIMIT ?")
      .all(limit * 10); // over-fetch, then filter in JS
    return rows
      .filter(
        (r) =>
          (r.content_text?.toLowerCase().includes(lower) ?? false) ||
          (r.filename?.toLowerCase().includes(lower) ?? false),
      )
      .slice(0, limit)
      .map(rowToOutput);
  }

  verifyHash(id: string): boolean {
    const output = this.getById(id);
    if (output === null) return false;
    const expected = computeHash(output.content_text ?? undefined, output.content_binary ?? undefined);
    return expected === output.content_hash;
  }

  count(q: Partial<OutputQuery> = {}): number {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (q.task_id)        { conditions.push("task_id = ?");        params.push(q.task_id); }
    if (q.agent_id)       { conditions.push("agent_id = ?");       params.push(q.agent_id); }
    if (q.output_type)    { conditions.push("output_type = ?");    params.push(q.output_type); }
    if (q.classification) { conditions.push("classification = ?"); params.push(q.classification); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db
      .prepare<unknown[], { n: number }>(`SELECT COUNT(*) as n FROM task_outputs ${where}`)
      .get(...params);
    return row?.n ?? 0;
  }
}
