// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: ProactiveScanner
 *
 * Scans for work an agent should do without being explicitly asked.
 * Runs on each idle iteration for agents with `proactive_checks: true`.
 *
 * Three scan categories:
 *   1. Overdue tasks — TTL elapsed, still RUNNING/ASSIGNED
 *   2. Stale tasks   — no progress (updated_at) for longer than stale_threshold_ms
 *   3. Recurring tasks — tasks with metadata.recurring + metadata.interval_ms
 *
 * Important: does NOT bypass governance. New tasks are submitted through
 * TaskStore.create() which runs the normal pipeline.
 * No LLM calls — pure DB queries + timestamps.
 */

import type { TaskStore } from "../tasks/store.js";
import type { TaskEventBus } from "../tasks/event-bus.js";
import type { Task } from "../tasks/types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("proactive-scanner");


/** Configuration for ProactiveScanner behavior. */
export interface ProactiveScannerConfig {
  /** How long without an update before a task is considered stale (ms). Default: 300000 (5 min). */
  stale_threshold_ms?: number;
  /** Priority to assign re-submitted overdue tasks (1=highest). Default: 1. */
  overdue_priority?: number;
}


export interface ProactiveScanResult {
  agent_id:        string;
  found_tasks:     number;
  submitted_tasks: string[];  // IDs of newly created tasks
}


interface RecurringMeta {
  recurring:    boolean;
  interval_ms:  number;
  last_run?:    string;  // ISO 8601
  template?: {
    title:       string;
    description: string;
    division:    string;
    type?:       string;
    priority?:   number;
    token_budget?: number;
    cost_budget?:  number;
  };
}


const DEFAULT_STALE_MS       = 300_000;  // 5 minutes
const DEFAULT_OVERDUE_PRIO   = 1;

export class ProactiveScanner {
  private readonly staleThresholdMs: number;
  private readonly overduePriority:  number;

  constructor(
    private readonly taskStore: TaskStore,
    private readonly eventBus:  TaskEventBus,
    config: ProactiveScannerConfig = {},
  ) {
    this.staleThresholdMs = config.stale_threshold_ms ?? DEFAULT_STALE_MS;
    this.overduePriority  = config.overdue_priority   ?? DEFAULT_OVERDUE_PRIO;
  }

  // ---------------------------------------------------------------------------
  // Main scan
  // ---------------------------------------------------------------------------

  async scan(agentId: string): Promise<ProactiveScanResult> {
    const submittedTasks: string[] = [];

    const overdue    = this._scanOverdue(agentId);
    const stale      = this._scanStale(agentId);
    const recurring  = this._scanRecurring(agentId);

    // 1. Re-submit overdue tasks with elevated priority
    for (const task of overdue) {
      const newId = await this._resubmitOverdue(task);
      if (newId !== null) submittedTasks.push(newId);
    }

    // 2. Log stale tasks (escalation is informational for V1.1)
    for (const task of stale) {
      logger.warn("proactive-scanner", "Stale task detected", {
        metadata: {
          agent_id:   agentId,
          task_id:    task.id,
          updated_at: task.updated_at,
        },
      });
    }

    // 3. Submit recurring task instances that are due
    for (const task of recurring) {
      const newId = await this._submitRecurring(task);
      if (newId !== null) submittedTasks.push(newId);
    }

    const found = overdue.length + stale.length + recurring.length;

    if (found > 0) {
      logger.info("proactive-scanner", "Scan complete", {
        metadata: {
          agent_id:  agentId,
          overdue:   overdue.length,
          stale:     stale.length,
          recurring: recurring.length,
          submitted: submittedTasks.length,
        },
      });
    }

    return {
      agent_id:        agentId,
      found_tasks:     found,
      submitted_tasks: submittedTasks,
    };
  }

  // ---------------------------------------------------------------------------
  // Scan helpers
  // ---------------------------------------------------------------------------

  private _scanOverdue(agentId: string): Task[] {
    const active = this.taskStore.getActiveForAgent(agentId);
    const now    = Date.now();
    return active.filter((t) => {
      if (t.status !== "RUNNING" && t.status !== "ASSIGNED") return false;
      const started = t.started_at ?? t.created_at;
      const elapsedMs = now - new Date(started).getTime();
      return elapsedMs > t.ttl_seconds * 1_000;
    });
  }

  private _scanStale(agentId: string): Task[] {
    const active = this.taskStore.getActiveForAgent(agentId);
    const cutoff = Date.now() - this.staleThresholdMs;
    return active.filter((t) => {
      if (t.status === "DONE" || t.status === "FAILED" ||
          t.status === "CANCELLED" || t.status === "ESCALATED") return false;
      return new Date(t.updated_at).getTime() < cutoff;
    });
  }

  private _scanRecurring(agentId: string): Task[] {
    const active = this.taskStore.getActiveForAgent(agentId);
    const queued = this.taskStore.getQueuedForAgent(agentId);
    const all    = [...active, ...queued];
    const now    = Date.now();

    return all.filter((t) => {
      const meta = t.metadata as Record<string, unknown> | null ?? {};
      if (meta["recurring"] !== true) return false;

      const intervalMs = typeof meta["interval_ms"] === "number" ? meta["interval_ms"] : 0;
      if (intervalMs <= 0) return false;

      // Only trigger if task is in a terminal state (DONE/FAILED/CANCELLED)
      // and enough time has passed since last run
      if (t.status !== "DONE" && t.status !== "FAILED" && t.status !== "CANCELLED") return false;

      const lastRunStr = typeof meta["last_run"] === "string" ? meta["last_run"] : t.completed_at;
      if (lastRunStr === null) return true;

      const elapsed = now - new Date(lastRunStr).getTime();
      return elapsed >= intervalMs;
    });
  }

  // ---------------------------------------------------------------------------
  // Task creation helpers
  // ---------------------------------------------------------------------------

  private async _resubmitOverdue(task: Task): Promise<string | null> {
    try {
      const newTask = this.taskStore.create({
        title:        `[Re-submit] ${task.title}`,
        description:  task.description,
        division:     task.division,
        type:         task.type,
        tier:         task.tier,
        ...(task.assigned_agent !== null && { assigned_agent: task.assigned_agent }),
        priority:     this.overduePriority,
        classification: task.classification,
        token_budget: task.token_budget,
        cost_budget:  task.cost_budget,
        ttl_seconds:  task.ttl_seconds,
        metadata:     {
          ...task.metadata,
          resubmitted_from: task.id,
          resubmit_reason:  "overdue",
        },
      });

      await this.eventBus.emitTask({
        event_type:    "TASK_CREATED",
        task_id:       newTask.id,
        parent_task_id: null,
        agent_from:    task.assigned_agent ?? "proactive-scanner",
        agent_to:      task.assigned_agent ?? null,
        division:      newTask.division,
        data:          { reason: "overdue_resubmit", original_task_id: task.id },
      });

      logger.info("proactive-scanner", "Overdue task resubmitted", {
        metadata: { original_id: task.id, new_id: newTask.id },
      });

      return newTask.id;
    } catch (e: unknown) {
      logger.warn("proactive-scanner", "Failed to resubmit overdue task", {
        metadata: {
          task_id: task.id,
          error:   e instanceof Error ? e.message : String(e),
        },
      });
      return null;
    }
  }

  private async _submitRecurring(task: Task): Promise<string | null> {
    const meta     = task.metadata as Record<string, unknown> | null ?? {};
    const template = meta["template"] as RecurringMeta["template"] | undefined;

    try {
      const newTask = this.taskStore.create({
        title:        template?.title       ?? `[Recurring] ${task.title}`,
        description:  template?.description ?? task.description,
        division:     template?.division    ?? task.division,
        type:         (template?.type ?? task.type) as Task["type"],
        tier:         task.tier,
        priority:     template?.priority    ?? task.priority,
        token_budget: template?.token_budget ?? task.token_budget,
        cost_budget:  template?.cost_budget  ?? task.cost_budget,
        classification: task.classification,
        metadata:     {
          recurring:           true,
          interval_ms:         meta["interval_ms"],
          last_run:            new Date().toISOString(),
          recurring_source_id: task.id,
        },
      });

      await this.eventBus.emitTask({
        event_type:    "TASK_CREATED",
        task_id:       newTask.id,
        parent_task_id: null,
        agent_from:    "proactive-scanner",
        agent_to:      null,
        division:      newTask.division,
        data:          { reason: "recurring_schedule", source_task_id: task.id },
      });

      logger.info("proactive-scanner", "Recurring task submitted", {
        metadata: { source_id: task.id, new_id: newTask.id },
      });

      return newTask.id;
    } catch (e: unknown) {
      logger.warn("proactive-scanner", "Failed to submit recurring task", {
        metadata: {
          task_id: task.id,
          error:   e instanceof Error ? e.message : String(e),
        },
      });
      return null;
    }
  }
}
