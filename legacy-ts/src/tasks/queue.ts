// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 7: TaskQueue
 *
 * Per-agent priority queue. Wraps TaskStore queries.
 * Priority ordering: lower number = higher priority.
 * Within same priority, FIFO by created_at.
 */

import type { Task } from "./types.js";
import type { AgentTodoList } from "./types.js";
import type { TaskStore } from "./store.js";

export class TaskQueue {
  constructor(private readonly store: TaskStore) {}

  /**
   * Enqueue a task: set status to PENDING.
   * Caller should ensure task is in CREATED status first.
   */
  enqueue(task: Task): void {
    this.store.update(task.id, { status: "PENDING" });
  }

  /**
   * Dequeue the highest-priority PENDING task for an agent.
   * Transitions the task to ASSIGNED and returns it.
   * Returns null if no tasks are queued.
   */
  dequeue(agentId: string): Task | null {
    const queued = this.store.getQueuedForAgent(agentId);
    const first = queued[0];
    if (first === undefined) return null;
    return this.store.update(first.id, {
      status: "ASSIGNED",
      assigned_agent: agentId,
    });
  }

  /**
   * Peek at the next task without changing its state.
   * Returns null if nothing is queued.
   */
  peek(agentId: string): Task | null {
    const queued = this.store.getQueuedForAgent(agentId);
    return queued[0] ?? null;
  }

  /**
   * Build the agent's full todo list, categorizing tasks by state.
   */
  getTodoList(agentId: string): AgentTodoList {
    const active = this.store.getActiveForAgent(agentId);
    const queued = this.store.getQueuedForAgent(agentId);

    const running = active.filter((t) => t.status === "RUNNING");
    const waiting = active.filter((t) => t.status === "WAITING");

    const allTasks = [...active, ...queued];
    const totalTokenBudget = allTasks.reduce((sum, t) => sum + t.token_budget, 0);
    const totalCostBudget  = allTasks.reduce((sum, t) => sum + t.cost_budget, 0);

    return {
      agent_id: agentId,
      active: running,
      waiting,
      queued,
      total_token_budget: totalTokenBudget,
      total_cost_budget: totalCostBudget,
    };
  }

  /**
   * Requeue a task after failure/retry: reset status to PENDING.
   * Optionally adjust priority.
   */
  requeue(taskId: string, newPriority?: number): void {
    const fields: Partial<Task> = { status: "PENDING" };
    if (newPriority !== undefined) fields.priority = newPriority;
    this.store.update(taskId, fields);
  }

  /** Number of PENDING tasks for an agent. */
  getQueueDepth(agentId: string): number {
    return this.store.getQueuedForAgent(agentId).length;
  }

  /** Number of PENDING tasks across an entire division. */
  getQueueDepthByDivision(division: string): number {
    return this.store
      .getByDivision(division)
      .filter((t) => t.status === "PENDING").length;
  }
}
