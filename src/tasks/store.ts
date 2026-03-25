// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 7: TaskStore
 *
 * SQLite CRUD and queries for tasks. Per-division database at
 * `divisions/<division>/tasks.db`. Uses better-sqlite3 (synchronous).
 */

import type { Database } from "../utils/db.js";
import type {
  Task,
  CreateTaskInput,
  TaskStatus,
  TaskType,
} from "./types.js";
import { DEFAULT_TTL_SECONDS } from "./types.js";


interface TaskDbRow {
  id: string;
  parent_id: string | null;
  root_id: string;
  division: string;
  type: string;
  tier: number;
  title: string;
  description: string;
  assigned_agent: string | null;
  status: string;
  priority: number;
  classification: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  result_file: string | null;
  result_summary: string | null;
  confidence: number | null;
  token_budget: number;
  token_used: number;
  cost_budget: number;
  cost_used: number;
  ttl_seconds: number;
  retry_count: number;
  max_retries: number;
  checkpoint: string | null;
  sub_tasks_expected: number;
  sub_tasks_received: number;
  embedding_id: string | null;
  metadata: string; // JSON string
  recurring_schedule_id: string | null;
  is_recurring: number; // 0 or 1
  source_metadata: string | null;    // JSON
  governance_override: string | null; // JSON
}

function rowToTask(row: TaskDbRow): Task {
  const task = {
    id: row.id,
    parent_id: row.parent_id,
    root_id: row.root_id,
    division: row.division,
    type: row.type as TaskType,
    tier: row.tier as 1 | 2 | 3,
    title: row.title,
    description: row.description,
    assigned_agent: row.assigned_agent,
    status: row.status as TaskStatus,
    priority: row.priority,
    classification: row.classification,
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    result_file: row.result_file,
    result_summary: row.result_summary,
    confidence: row.confidence,
    token_budget: row.token_budget,
    token_used: row.token_used,
    cost_budget: row.cost_budget,
    cost_used: row.cost_used,
    ttl_seconds: row.ttl_seconds,
    retry_count: row.retry_count,
    max_retries: row.max_retries,
    checkpoint: row.checkpoint,
    sub_tasks_expected: row.sub_tasks_expected,
    sub_tasks_received: row.sub_tasks_received,
    embedding_id: row.embedding_id,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    recurring_schedule_id: row.recurring_schedule_id,
    is_recurring: row.is_recurring !== 0,
  } as Task;
  if (row.source_metadata !== null) {
    task.source_metadata = JSON.parse(row.source_metadata) as NonNullable<Task["source_metadata"]>;
  }
  if (row.governance_override !== null) {
    task.governance_override = JSON.parse(row.governance_override) as NonNullable<Task["governance_override"]>;
  }
  return task;
}


const ALL_STATUSES: readonly TaskStatus[] = [
  "CREATED", "PENDING", "ASSIGNED", "RUNNING", "WAITING",
  "REVIEW", "DONE", "FAILED", "ESCALATED", "CANCELLED",
];

export class TaskStore {
  constructor(private readonly db: Database) {
    this.initialize();
  }

  /** Create tables and indexes. Idempotent — uses IF NOT EXISTS. */
  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        root_id TEXT NOT NULL,
        division TEXT NOT NULL,
        type TEXT NOT NULL,
        tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        assigned_agent TEXT,
        status TEXT NOT NULL DEFAULT 'CREATED',
        priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
        classification TEXT NOT NULL DEFAULT 'internal',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        result_file TEXT,
        result_summary TEXT,
        confidence REAL,
        token_budget INTEGER NOT NULL,
        token_used INTEGER NOT NULL DEFAULT 0,
        cost_budget REAL NOT NULL,
        cost_used REAL NOT NULL DEFAULT 0.0,
        ttl_seconds INTEGER NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        checkpoint TEXT,
        sub_tasks_expected INTEGER NOT NULL DEFAULT 0,
        sub_tasks_received INTEGER NOT NULL DEFAULT 0,
        embedding_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        recurring_schedule_id TEXT,
        is_recurring INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (parent_id) REFERENCES tasks(id)
      );
    `);

    // Indexes are best-effort — they may fail on pre-existing tables with different schemas
    for (const ddl of [
      "CREATE INDEX IF NOT EXISTS idx_tasks_parent   ON tasks(parent_id)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_root     ON tasks(root_id)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_agent    ON tasks(assigned_agent)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_division ON tasks(division)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_type     ON tasks(type)",
      "CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority, status)",
    ]) {
      try { this.db.exec(ddl); } catch (_err) { /* column may not exist on legacy schema */ }
    }

    // V1.1: Add recurring schedule columns to existing tables (backward-compatible migration)
    for (const ddl of [
      "ALTER TABLE tasks ADD COLUMN recurring_schedule_id TEXT",
      "ALTER TABLE tasks ADD COLUMN is_recurring INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE tasks ADD COLUMN source_metadata TEXT",
      "ALTER TABLE tasks ADD COLUMN governance_override TEXT",
    ]) {
      try { this.db.exec(ddl); } catch (_err) { /* column already exists */ }
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /** Create a new task. Generates UUID + sets all defaults. */
  create(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const rootId = input.root_id ?? id; // root tasks self-reference

    const task: Task = {
      id,
      parent_id: input.parent_id ?? null,
      root_id: rootId,
      division: input.division,
      type: input.type,
      tier: input.tier,
      title: input.title,
      description: input.description,
      assigned_agent: input.assigned_agent ?? null,
      status: "CREATED",
      priority: input.priority ?? 3,
      classification: input.classification ?? "internal",
      created_at: now,
      updated_at: now,
      started_at: null,
      completed_at: null,
      result_file: null,
      result_summary: null,
      confidence: null,
      token_budget: input.token_budget,
      token_used: 0,
      cost_budget: input.cost_budget,
      cost_used: 0,
      ttl_seconds: input.ttl_seconds ?? DEFAULT_TTL_SECONDS[input.tier],
      retry_count: 0,
      max_retries: input.max_retries ?? 3,
      checkpoint: null,
      sub_tasks_expected: input.sub_tasks_expected ?? 0,
      sub_tasks_received: 0,
      embedding_id: null,
      metadata: input.metadata ?? {},
      recurring_schedule_id: input.recurring_schedule_id ?? null,
      is_recurring: input.is_recurring ?? false,
    } as Task;
    if (input.source_metadata !== undefined) {
      task.source_metadata = input.source_metadata;
    }
    if (input.governance_override !== undefined) {
      task.governance_override = input.governance_override;
    }

    this.db.prepare<unknown[], void>(`
      INSERT INTO tasks (
        id, parent_id, root_id, division, type, tier, title, description,
        assigned_agent, status, priority, classification, created_at, updated_at,
        started_at, completed_at, result_file, result_summary, confidence,
        token_budget, token_used, cost_budget, cost_used, ttl_seconds,
        retry_count, max_retries, checkpoint, sub_tasks_expected, sub_tasks_received,
        embedding_id, metadata, recurring_schedule_id, is_recurring,
        source_metadata, governance_override
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `).run(
      task.id, task.parent_id, task.root_id, task.division, task.type, task.tier,
      task.title, task.description,
      task.assigned_agent, task.status, task.priority, task.classification,
      task.created_at, task.updated_at,
      task.started_at, task.completed_at, task.result_file, task.result_summary,
      task.confidence,
      task.token_budget, task.token_used, task.cost_budget, task.cost_used,
      task.ttl_seconds, task.retry_count, task.max_retries, task.checkpoint,
      task.sub_tasks_expected, task.sub_tasks_received,
      task.embedding_id, JSON.stringify(task.metadata),
      task.recurring_schedule_id, task.is_recurring ? 1 : 0,
      task.source_metadata    !== undefined ? JSON.stringify(task.source_metadata)    : null,
      task.governance_override !== undefined ? JSON.stringify(task.governance_override) : null,
    );

    return task;
  }

  /** Get a task by ID. Returns null if not found. */
  get(taskId: string): Task | null {
    const row = this.db
      .prepare<[string], TaskDbRow>("SELECT * FROM tasks WHERE id = ?")
      .get(taskId);
    return row !== undefined ? rowToTask(row) : null;
  }

  /**
   * Update fields on an existing task.
   * Always sets updated_at to now. Returns the full updated task.
   */
  update(taskId: string, fields: Partial<Task>): Task {
    const now = new Date().toISOString();
    const sets: string[] = ["updated_at = ?"];
    const params: (string | number | null)[] = [now];

    // Enumerate each updatable field explicitly (type-safe, no any)
    if (fields.title !== undefined)            { sets.push("title = ?");              params.push(fields.title); }
    if (fields.description !== undefined)      { sets.push("description = ?");        params.push(fields.description); }
    if ("assigned_agent" in fields)            { sets.push("assigned_agent = ?");     params.push(fields.assigned_agent ?? null); }
    if (fields.status !== undefined)           { sets.push("status = ?");             params.push(fields.status); }
    if (fields.priority !== undefined)         { sets.push("priority = ?");           params.push(fields.priority); }
    if (fields.classification !== undefined)   { sets.push("classification = ?");     params.push(fields.classification); }
    if ("started_at" in fields)                { sets.push("started_at = ?");         params.push(fields.started_at ?? null); }
    if ("completed_at" in fields)              { sets.push("completed_at = ?");       params.push(fields.completed_at ?? null); }
    if ("result_file" in fields)               { sets.push("result_file = ?");        params.push(fields.result_file ?? null); }
    if ("result_summary" in fields)            { sets.push("result_summary = ?");     params.push(fields.result_summary ?? null); }
    if ("confidence" in fields)                { sets.push("confidence = ?");         params.push(fields.confidence ?? null); }
    if (fields.token_used !== undefined)       { sets.push("token_used = ?");         params.push(fields.token_used); }
    if (fields.cost_used !== undefined)        { sets.push("cost_used = ?");          params.push(fields.cost_used); }
    if (fields.retry_count !== undefined)      { sets.push("retry_count = ?");        params.push(fields.retry_count); }
    if ("checkpoint" in fields)                { sets.push("checkpoint = ?");         params.push(fields.checkpoint ?? null); }
    if (fields.sub_tasks_expected !== undefined) { sets.push("sub_tasks_expected = ?"); params.push(fields.sub_tasks_expected); }
    if (fields.sub_tasks_received !== undefined) { sets.push("sub_tasks_received = ?"); params.push(fields.sub_tasks_received); }
    if (fields.metadata !== undefined)         { sets.push("metadata = ?");           params.push(JSON.stringify(fields.metadata)); }
    if ("embedding_id" in fields)              { sets.push("embedding_id = ?");       params.push(fields.embedding_id ?? null); }
    if ("recurring_schedule_id" in fields)     { sets.push("recurring_schedule_id = ?"); params.push(fields.recurring_schedule_id ?? null); }
    if (fields.is_recurring !== undefined)     { sets.push("is_recurring = ?");       params.push(fields.is_recurring ? 1 : 0); }
    if ("source_metadata" in fields)           { sets.push("source_metadata = ?");    params.push(fields.source_metadata !== undefined ? JSON.stringify(fields.source_metadata) : null); }
    if ("governance_override" in fields)       { sets.push("governance_override = ?"); params.push(fields.governance_override !== undefined ? JSON.stringify(fields.governance_override) : null); }

    params.push(taskId);
    this.db.prepare<unknown[], void>(
      `UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`,
    ).run(...params);

    const updated = this.get(taskId);
    if (updated === null) throw new Error(`Task not found after update: ${taskId}`);
    return updated;
  }

  /**
   * Soft-delete a task by transitioning to CANCELLED.
   * Use TaskStateMachine.transition() for proper cascade + event emission.
   * This method only updates the status directly.
   */
  delete(taskId: string): void {
    const now = new Date().toISOString();
    this.db.prepare<unknown[], void>(
      "UPDATE tasks SET status = 'CANCELLED', completed_at = ?, updated_at = ? WHERE id = ?",
    ).run(now, now, taskId);
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** All tasks assigned to an agent (any status). */
  getByAgent(agentId: string): Task[] {
    const rows = this.db
      .prepare<[string], TaskDbRow>("SELECT * FROM tasks WHERE assigned_agent = ? ORDER BY created_at ASC")
      .all(agentId);
    return rows.map(rowToTask);
  }

  /** All tasks for a division. */
  getByDivision(division: string): Task[] {
    const rows = this.db
      .prepare<[string], TaskDbRow>("SELECT * FROM tasks WHERE division = ? ORDER BY created_at ASC")
      .all(division);
    return rows.map(rowToTask);
  }

  /** All tasks with a given status. */
  getByStatus(status: TaskStatus): Task[] {
    const rows = this.db
      .prepare<[string], TaskDbRow>("SELECT * FROM tasks WHERE status = ? ORDER BY created_at ASC")
      .all(status);
    return rows.map(rowToTask);
  }

  /** Direct children of a parent task. */
  getByParent(parentId: string): Task[] {
    const rows = this.db
      .prepare<[string], TaskDbRow>("SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at ASC")
      .all(parentId);
    return rows.map(rowToTask);
  }

  /** Entire task tree rooted at rootId. */
  getByRoot(rootId: string): Task[] {
    const rows = this.db
      .prepare<[string], TaskDbRow>("SELECT * FROM tasks WHERE root_id = ? ORDER BY created_at ASC")
      .all(rootId);
    return rows.map(rowToTask);
  }

  /** Active tasks (ASSIGNED + RUNNING + WAITING) for an agent. */
  getActiveForAgent(agentId: string): Task[] {
    const rows = this.db
      .prepare<[string], TaskDbRow>(
        "SELECT * FROM tasks WHERE assigned_agent = ? AND status IN ('ASSIGNED','RUNNING','WAITING') ORDER BY priority ASC, created_at ASC",
      )
      .all(agentId);
    return rows.map(rowToTask);
  }

  /** Queued (PENDING) tasks assigned to an agent. */
  getQueuedForAgent(agentId: string): Task[] {
    const rows = this.db
      .prepare<[string], TaskDbRow>(
        "SELECT * FROM tasks WHERE assigned_agent = ? AND status = 'PENDING' ORDER BY priority ASC, created_at ASC",
      )
      .all(agentId);
    return rows.map(rowToTask);
  }

  /** All tasks created by a recurring schedule. */
  getByScheduleId(scheduleId: string): Task[] {
    const rows = this.db
      .prepare<[string], TaskDbRow>(
        "SELECT * FROM tasks WHERE recurring_schedule_id = ? ORDER BY created_at DESC",
      )
      .all(scheduleId);
    return rows.map(rowToTask);
  }

  // ---------------------------------------------------------------------------
  // Counters
  // ---------------------------------------------------------------------------

  /** Count tasks by status. Optionally filter by division. */
  countByStatus(division?: string): Record<TaskStatus, number> {
    const result = Object.fromEntries(
      ALL_STATUSES.map((s) => [s, 0]),
    ) as Record<TaskStatus, number>;

    interface CountRow { status: string; n: number; }
    const rows = division
      ? this.db
          .prepare<[string], CountRow>(
            "SELECT status, COUNT(*) as n FROM tasks WHERE division = ? GROUP BY status",
          )
          .all(division)
      : this.db
          .prepare<[], CountRow>(
            "SELECT status, COUNT(*) as n FROM tasks GROUP BY status",
          )
          .all();

    for (const row of rows) {
      const s = row.status as TaskStatus;
      if (s in result) result[s] = row.n;
    }
    return result;
  }

  /**
   * Count completed sub-tasks for a parent (DONE children).
   * Used to check if parent can proceed to synthesis.
   */
  countSubTasksReceived(taskId: string): number {
    const row = this.db
      .prepare<[string], { n: number }>(
        "SELECT COUNT(*) as n FROM tasks WHERE parent_id = ? AND status = 'DONE'",
      )
      .get(taskId);
    return row?.n ?? 0;
  }
}
