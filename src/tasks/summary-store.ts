// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 14: Task Summary Store
 *
 * Structured governed summaries — compact upstream communication from agents.
 * Governance validation (SUMMARY-001..004) is enforced by TaskSummaryStore.create().
 */

import { randomUUID } from "node:crypto";
import type { Database } from "../utils/db.js";
import { createLogger }  from "../core/logger.js";
import { SidjuaError }   from "../core/error-codes.js";

const logger = createLogger("summary-store");

export type SummaryStatus = "completed" | "failed" | "partial" | "escalated";

const VALID_STATUSES = new Set<string>(["completed", "failed", "partial", "escalated"]);
const MAX_SUMMARY_LEN = 8000;
const MIN_KEY_FACTS   = 1;


export interface TaskSummary {
  id:                string;
  task_id:           string;
  agent_id:          string;
  summary_text:      string;
  key_facts:         string[];
  decisions:         string[];
  metrics:           Record<string, unknown>;
  output_refs:       string[];
  status:            SummaryStatus;
  escalation_needed: boolean;
  created_at:        string;
}

export interface CreateSummaryInput {
  task_id:            string;
  agent_id:           string;
  summary_text:       string;
  key_facts:          string[];
  decisions?:         string[];
  metrics?:           Record<string, unknown>;
  output_refs?:       string[];
  status:             SummaryStatus;
  escalation_needed?: boolean;
}

export interface SummaryQuery {
  task_id?:           string;
  agent_id?:          string;
  status?:            SummaryStatus;
  escalation_needed?: boolean;
  limit?:             number;
  offset?:            number;
}


interface SummaryRow {
  id:                string;
  task_id:           string;
  agent_id:          string;
  summary_text:      string;
  key_facts:         string;
  decisions:         string;
  metrics:           string;
  output_refs:       string;
  status:            string;
  escalation_needed: number;
  created_at:        string;
}

function rowToSummary(row: SummaryRow): TaskSummary {
  return {
    id:                row.id,
    task_id:           row.task_id,
    agent_id:          row.agent_id,
    summary_text:      row.summary_text,
    key_facts:         JSON.parse(row.key_facts)  as string[],
    decisions:         JSON.parse(row.decisions)  as string[],
    metrics:           JSON.parse(row.metrics)    as Record<string, unknown>,
    output_refs:       JSON.parse(row.output_refs) as string[],
    status:            row.status as SummaryStatus,
    escalation_needed: row.escalation_needed === 1,
    created_at:        row.created_at,
  };
}


export class TaskSummaryStore {
  constructor(private readonly db: Database) {
    this.initialize();
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_summaries (
        id                TEXT PRIMARY KEY,
        task_id           TEXT NOT NULL,
        agent_id          TEXT NOT NULL,
        summary_text      TEXT NOT NULL,
        key_facts         TEXT NOT NULL DEFAULT '[]',
        decisions         TEXT NOT NULL DEFAULT '[]',
        metrics           TEXT NOT NULL DEFAULT '{}',
        output_refs       TEXT NOT NULL DEFAULT '[]',
        status            TEXT NOT NULL CHECK (status IN ('completed','failed','partial','escalated')),
        escalation_needed INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_summaries_task_id ON task_summaries(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_summaries_agent_id ON task_summaries(agent_id);
      CREATE INDEX IF NOT EXISTS idx_task_summaries_status   ON task_summaries(status);
    `);
  }

  create(input: CreateSummaryInput): TaskSummary {
    // Governance validation
    if (!Array.isArray(input.key_facts) || input.key_facts.length < MIN_KEY_FACTS) {
      throw SidjuaError.from("SUMMARY-001", `key_facts must have at least ${MIN_KEY_FACTS} entry`);
    }
    if (!VALID_STATUSES.has(input.status)) {
      throw SidjuaError.from("SUMMARY-002", `status "${input.status}" is not valid`);
    }
    if (input.summary_text.length > MAX_SUMMARY_LEN) {
      throw SidjuaError.from(
        "SUMMARY-003",
        `summary_text is ${input.summary_text.length} chars, max ${MAX_SUMMARY_LEN}`,
      );
    }

    const id  = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare<unknown[], void>(`
      INSERT INTO task_summaries
        (id, task_id, agent_id, summary_text, key_facts, decisions, metrics,
         output_refs, status, escalation_needed, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.task_id,
      input.agent_id,
      input.summary_text,
      JSON.stringify(input.key_facts),
      JSON.stringify(input.decisions ?? []),
      JSON.stringify(input.metrics   ?? {}),
      JSON.stringify(input.output_refs ?? []),
      input.status,
      input.escalation_needed ? 1 : 0,
      now,
    );

    logger.info("summary_created", `Summary ${id} created for task ${input.task_id}`, {
      metadata: { id, task_id: input.task_id, agent_id: input.agent_id, status: input.status },
    });

    return this.getById(id)!;
  }

  getById(id: string): TaskSummary | null {
    const row = this.db
      .prepare<[string], SummaryRow>("SELECT * FROM task_summaries WHERE id = ?")
      .get(id);
    return row !== undefined ? rowToSummary(row) : null;
  }

  getByTaskId(taskId: string): TaskSummary[] {
    const rows = this.db
      .prepare<[string], SummaryRow>(
        "SELECT * FROM task_summaries WHERE task_id = ? ORDER BY created_at ASC",
      )
      .all(taskId);
    return rows.map(rowToSummary);
  }

  getLatestByTaskId(taskId: string): TaskSummary | null {
    const row = this.db
      .prepare<[string], SummaryRow>(
        "SELECT * FROM task_summaries WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(taskId);
    return row !== undefined ? rowToSummary(row) : null;
  }

  query(q: SummaryQuery): TaskSummary[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (q.task_id)  { conditions.push("task_id = ?");  params.push(q.task_id); }
    if (q.agent_id) { conditions.push("agent_id = ?"); params.push(q.agent_id); }
    if (q.status)   { conditions.push("status = ?");   params.push(q.status); }
    if (q.escalation_needed !== undefined) {
      conditions.push("escalation_needed = ?");
      params.push(q.escalation_needed ? 1 : 0);
    }

    const where  = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit  = Math.min(q.limit ?? 50, 500);
    const offset = q.offset ?? 0;

    const rows = this.db
      .prepare<unknown[], SummaryRow>(
        `SELECT * FROM task_summaries ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return rows.map(rowToSummary);
  }

  delete(id: string): void {
    this.db.prepare<[string], void>("DELETE FROM task_summaries WHERE id = ?").run(id);
    logger.info("summary_deleted", `Summary ${id} deleted`, { metadata: { id } });
  }

  count(q: Partial<SummaryQuery> = {}): number {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (q.task_id) { conditions.push("task_id = ?"); params.push(q.task_id); }
    if (q.status)  { conditions.push("status = ?");  params.push(q.status); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db
      .prepare<unknown[], { n: number }>(`SELECT COUNT(*) as n FROM task_summaries ${where}`)
      .get(...params);
    return row?.n ?? 0;
  }
}
