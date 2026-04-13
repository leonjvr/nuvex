// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: DeadlineWatcher
 *
 * Monitors active tasks for TTL deadline approaches/violations and
 * budget exhaustion. Emits typed EscalationEvents for each condition.
 *
 * Designed to run periodically (e.g., every 60 seconds) to catch deadlines
 * as they approach or pass. No side effects — only reporting.
 */

import type { TaskStore } from "../tasks/store.js";
import { createLogger }   from "../core/logger.js";
import type { EscalationEvent, SchedulingGovernance } from "./types.js";

const logger = createLogger("deadline-watcher");


export class DeadlineWatcher {
  constructor(
    private readonly taskStore:   TaskStore,
    private readonly governance:  SchedulingGovernance,
    private readonly log =        logger,
  ) {}

  /**
   * Check all active tasks for deadline violations or approaching deadlines.
   *
   * @param now  Override current time (useful in tests).
   */
  checkDeadlines(now: Date = new Date()): EscalationEvent[] {
    const events: EscalationEvent[] = [];
    const threshold = this.governance.deadline_watcher.warning_threshold_percent;

    // Query all non-terminal tasks that have a TTL set
    const activeTasks = [
      ...this.taskStore.getByStatus("RUNNING"),
      ...this.taskStore.getByStatus("ASSIGNED"),
      ...this.taskStore.getByStatus("PENDING"),
      ...this.taskStore.getByStatus("WAITING"),
    ].filter((t) => t.ttl_seconds > 0);

    for (const task of activeTasks) {
      const createdAt      = new Date(task.created_at).getTime();
      const deadlineMs     = task.ttl_seconds * 1000;
      const elapsedMs      = now.getTime() - createdAt;
      const elapsedPercent = (elapsedMs / deadlineMs) * 100;

      if (elapsedPercent >= 100) {
        events.push({
          task_id:   task.id,
          type:      "deadline_passed",
          severity:  "critical",
          details:   `Task '${task.title}' exceeded TTL of ${task.ttl_seconds}s (${Math.round(elapsedPercent)}% elapsed)`,
          timestamp: now.toISOString(),
        });
      } else if (elapsedPercent >= threshold) {
        events.push({
          task_id:   task.id,
          type:      "approaching_deadline",
          severity:  "warning",
          details:   `Task '${task.title}' is ${Math.round(elapsedPercent)}% through its TTL of ${task.ttl_seconds}s`,
          timestamp: now.toISOString(),
        });
      }
    }

    if (events.length > 0) {
      this.log.warn("deadline-watcher", "Deadline events detected", {
        metadata: { count: events.length },
      });
    }

    return events;
  }

  /**
   * Check all active tasks for budget exhaustion (cost_used >= cost_budget).
   */
  checkBudgets(): EscalationEvent[] {
    const events: EscalationEvent[] = [];
    const now = new Date();

    const activeTasks = [
      ...this.taskStore.getByStatus("RUNNING"),
      ...this.taskStore.getByStatus("ASSIGNED"),
    ].filter((t) => t.cost_budget > 0);

    for (const task of activeTasks) {
      if (task.cost_used >= task.cost_budget) {
        events.push({
          task_id:   task.id,
          type:      "budget_exhausted",
          severity:  "critical",
          details:   `Task '${task.title}' has exhausted its budget: $${task.cost_used.toFixed(4)} / $${task.cost_budget.toFixed(4)}`,
          timestamp: now.toISOString(),
        });
      }
    }

    return events;
  }

  /**
   * Run all checks (deadlines + budgets) and deduplicate by task_id + type.
   *
   * @param now  Override current time (useful in tests).
   */
  checkAll(now: Date = new Date()): EscalationEvent[] {
    const deadlineEvents = this.checkDeadlines(now);
    const budgetEvents   = this.checkBudgets();

    // Deduplicate by task_id + type
    const seen = new Set<string>();
    const result: EscalationEvent[] = [];

    for (const event of [...deadlineEvents, ...budgetEvents]) {
      const key = `${event.task_id}:${event.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(event);
      }
    }

    return result;
  }
}
