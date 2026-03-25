// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CEO Assistant: Task Queue
 *
 * SQLite-backed task queue for the CEO Assistant.
 * Tasks are scoped per agent_id — future agents may have their own queues.
 *
 * CRUD operations:
 *   addTask     — create a new task
 *   listTasks   — list with optional status/priority/overdue filter
 *   completeTask — mark done, set completed_at
 *   updateTask   — partial update of any field
 *   getOverdueTasks — deadline in the past and status != done/cancelled
 *   cancelTask   — shorthand for updateTask(status=cancelled)
 *   deleteTask   — hard delete (used for cleanup only)
 */

import type { Database } from "../utils/db.js";
import type {
  AssistantTask,
  AssistantTaskPriority,
  AssistantTaskStatus,
  CreateTaskInput,
  TaskListFilter,
  UpdateTaskInput,
} from "./types.js";

const VALID_PRIORITIES: AssistantTaskPriority[] = ["P1", "P2", "P3", "P4"];
const VALID_STATUSES:   AssistantTaskStatus[]   = ["open", "in_progress", "done", "cancelled"];


interface TaskRow {
  id:            number;
  agent_id:      string;
  title:         string;
  priority:      string;
  status:        string;
  deadline:      string | null;
  context_notes: string | null;
  created_at:    string;
  updated_at:    string;
  completed_at:  string | null;
}


export class AssistantTaskQueue {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // -------------------------------------------------------------------------
  // addTask
  // -------------------------------------------------------------------------

  /**
   * Create a new task.
   * Priority defaults to "P3" if not specified.
   * Throws if title is empty.
   */
  addTask(input: CreateTaskInput): AssistantTask {
    if (!input.title.trim()) {
      throw new Error("Task title cannot be empty");
    }

    const priority = input.priority ?? "P3";
    if (!VALID_PRIORITIES.includes(priority)) {
      throw new Error(`Invalid priority "${priority}". Must be one of: ${VALID_PRIORITIES.join(", ")}`);
    }

    const now = new Date().toISOString();

    const result = this.db.prepare<
      [string, string, string, string | null, string | null, string, string],
      { lastInsertRowid: number }
    >(`
      INSERT INTO assistant_tasks
        (agent_id, title, priority, status, deadline, context_notes, created_at, updated_at)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?)
    `).run(
      input.agent_id,
      input.title.trim(),
      priority,
      input.deadline ?? null,
      input.context_notes ?? null,
      now,
      now,
    );

    const task = this.db.prepare<[number], TaskRow>(
      "SELECT * FROM assistant_tasks WHERE id = ?",
    ).get(result.lastInsertRowid as number);

    if (task === undefined) throw new Error("Task insertion failed");
    return rowToTask(task);
  }

  // -------------------------------------------------------------------------
  // listTasks
  // -------------------------------------------------------------------------

  /**
   * List tasks for an agent with optional filters.
   * Ordered by priority ASC (P1 first), then created_at DESC.
   */
  listTasks(agentId: string, filter?: TaskListFilter): AssistantTask[] {
    let sql = "SELECT * FROM assistant_tasks WHERE agent_id = ?";
    const params: (string | number)[] = [agentId];

    if (filter?.status !== undefined) {
      sql += " AND status = ?";
      params.push(filter.status);
    }

    if (filter?.priority !== undefined) {
      sql += " AND priority = ?";
      params.push(filter.priority);
    }

    if (filter?.overdue === true) {
      sql += " AND deadline IS NOT NULL AND deadline < datetime('now') AND status NOT IN ('done','cancelled')";
    }

    sql += " ORDER BY priority ASC, created_at DESC";

    return this.db.prepare<(string | number)[], TaskRow>(sql).all(...params).map(rowToTask);
  }

  // -------------------------------------------------------------------------
  // completeTask
  // -------------------------------------------------------------------------

  /**
   * Mark a task as done. Returns the updated task, or null if not found.
   */
  completeTask(agentId: string, taskId: number): AssistantTask | null {
    const now = new Date().toISOString();
    const result = this.db.prepare<[string, string, number, string], void>(`
      UPDATE assistant_tasks
      SET status = 'done', completed_at = ?, updated_at = ?
      WHERE id = ? AND agent_id = ? AND status NOT IN ('done', 'cancelled')
    `).run(now, now, taskId, agentId);

    if (result.changes === 0) return null;
    const task = this.db.prepare<[number], TaskRow>(
      "SELECT * FROM assistant_tasks WHERE id = ?",
    ).get(taskId);
    return task !== undefined ? rowToTask(task) : null;
  }

  // -------------------------------------------------------------------------
  // cancelTask
  // -------------------------------------------------------------------------

  /**
   * Cancel a task. Returns the updated task, or null if not found.
   */
  cancelTask(agentId: string, taskId: number): AssistantTask | null {
    const now = new Date().toISOString();
    const result = this.db.prepare<[string, number, string], void>(`
      UPDATE assistant_tasks
      SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND agent_id = ? AND status NOT IN ('done', 'cancelled')
    `).run(now, taskId, agentId);

    if (result.changes === 0) return null;
    const task = this.db.prepare<[number], TaskRow>(
      "SELECT * FROM assistant_tasks WHERE id = ?",
    ).get(taskId);
    return task !== undefined ? rowToTask(task) : null;
  }

  // -------------------------------------------------------------------------
  // updateTask
  // -------------------------------------------------------------------------

  /**
   * Partial update — only provided fields are changed.
   * Returns updated task or null if not found.
   */
  updateTask(agentId: string, taskId: number, updates: UpdateTaskInput): AssistantTask | null {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    const now = new Date().toISOString();

    if (updates.title !== undefined) {
      if (!updates.title.trim()) throw new Error("Task title cannot be empty");
      sets.push("title = ?");
      values.push(updates.title.trim());
    }

    if (updates.priority !== undefined) {
      if (!VALID_PRIORITIES.includes(updates.priority)) {
        throw new Error(`Invalid priority "${updates.priority}"`);
      }
      sets.push("priority = ?");
      values.push(updates.priority);
    }

    if (updates.status !== undefined) {
      if (!VALID_STATUSES.includes(updates.status)) {
        throw new Error(`Invalid status "${updates.status}"`);
      }
      sets.push("status = ?");
      values.push(updates.status);
      if (updates.status === "done") {
        sets.push("completed_at = ?");
        values.push(now);
      }
    }

    if (updates.deadline !== undefined) {
      sets.push("deadline = ?");
      values.push(updates.deadline);
    }

    if (updates.context_notes !== undefined) {
      sets.push("context_notes = ?");
      values.push(updates.context_notes);
    }

    if (sets.length === 0) return this.getById(agentId, taskId);

    sets.push("updated_at = ?");
    values.push(now);
    values.push(taskId);
    values.push(agentId);

    this.db.prepare<(string | number | null)[], void>(
      `UPDATE assistant_tasks SET ${sets.join(", ")} WHERE id = ? AND agent_id = ?`,
    ).run(...values);

    return this.getById(agentId, taskId);
  }

  // -------------------------------------------------------------------------
  // getOverdueTasks
  // -------------------------------------------------------------------------

  /**
   * Return all tasks with deadline in the past and status not done/cancelled.
   */
  getOverdueTasks(agentId: string): AssistantTask[] {
    return this.db.prepare<[string], TaskRow>(`
      SELECT * FROM assistant_tasks
      WHERE agent_id = ?
        AND deadline IS NOT NULL
        AND deadline < datetime('now')
        AND status NOT IN ('done', 'cancelled')
      ORDER BY deadline ASC
    `).all(agentId).map(rowToTask);
  }

  // -------------------------------------------------------------------------
  // findByTitleFuzzy
  // -------------------------------------------------------------------------

  /**
   * Find the first open task whose title contains the given substring (case-insensitive).
   * Used by intent parser for "done with X" natural language matching.
   */
  findByTitleFuzzy(agentId: string, fragment: string): AssistantTask | null {
    const lower = fragment.toLowerCase().trim();
    const tasks = this.db.prepare<[string], TaskRow>(
      "SELECT * FROM assistant_tasks WHERE agent_id = ? AND status = 'open' ORDER BY updated_at DESC",
    ).all(agentId);

    const match = tasks.find((t) => t.title.toLowerCase().includes(lower));
    return match !== undefined ? rowToTask(match) : null;
  }

  // -------------------------------------------------------------------------
  // getById
  // -------------------------------------------------------------------------

  getById(agentId: string, taskId: number): AssistantTask | null {
    const row = this.db.prepare<[number, string], TaskRow>(
      "SELECT * FROM assistant_tasks WHERE id = ? AND agent_id = ?",
    ).get(taskId, agentId);
    return row !== undefined ? rowToTask(row) : null;
  }

  // -------------------------------------------------------------------------
  // deleteTask
  // -------------------------------------------------------------------------

  /** Hard delete — use with care. Returns true if a row was deleted. */
  deleteTask(agentId: string, taskId: number): boolean {
    const result = this.db.prepare<[number, string], void>(
      "DELETE FROM assistant_tasks WHERE id = ? AND agent_id = ?",
    ).run(taskId, agentId);
    return result.changes > 0;
  }

  // -------------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------------

  getStats(agentId: string): { open: number; overdue: number; done: number } {
    const open = this.db.prepare<[string], { cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM assistant_tasks WHERE agent_id = ? AND status = 'open'",
    ).get(agentId);
    const overdue = this.db.prepare<[string], { cnt: number }>(`
      SELECT COUNT(*) AS cnt FROM assistant_tasks
      WHERE agent_id = ? AND deadline IS NOT NULL AND deadline < datetime('now')
        AND status NOT IN ('done', 'cancelled')
    `).get(agentId);
    const done = this.db.prepare<[string], { cnt: number }>(
      "SELECT COUNT(*) AS cnt FROM assistant_tasks WHERE agent_id = ? AND status = 'done'",
    ).get(agentId);
    return {
      open:   open?.cnt    ?? 0,
      overdue: overdue?.cnt ?? 0,
      done:   done?.cnt    ?? 0,
    };
  }
}


function rowToTask(row: TaskRow): AssistantTask {
  const task: AssistantTask = {
    id:         row.id,
    agent_id:   row.agent_id,
    title:      row.title,
    priority:   row.priority as AssistantTaskPriority,
    status:     row.status   as AssistantTaskStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.deadline      !== null) task.deadline      = row.deadline;
  if (row.context_notes !== null) task.context_notes = row.context_notes;
  if (row.completed_at  !== null) task.completed_at  = row.completed_at;
  return task;
}
