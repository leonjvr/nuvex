// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Delegation Bridge: ResultAggregator
 *
 * Subscribes to TaskEventBus RESULT_READY and TASK_FAILED events.
 * When a delegation subtask completes or fails, it:
 *   1. Marks the delegation as completed/failed in DelegationService
 *   2. Checks if the root task is messaging-originated (has source_metadata)
 *   3. If the root task has received all expected subtasks, routes the aggregated
 *      response back via ResponseRouter
 *
 * Only tasks with type="delegation" and a parent_id are processed here.
 * Root-task completion for messaging tasks is handled by TaskLifecycleRouter.
 */

import type { Task } from "../tasks/types.js";
import type { MessageEnvelope, MessagingTaskHandle } from "../messaging/types.js";
import type { ResponseRouter } from "../messaging/response-router.js";
import type { DelegationService } from "./delegation-service.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("result-aggregator");


export interface EventBusLike {
  on(event: string, handler: (data: unknown) => void): void;
}

export interface TaskStoreLike {
  get(taskId: string): Task | null;
  update(taskId: string, fields: { sub_tasks_received?: number }): { id: string };
  getByParent(parentId: string): Task[];
}


export class ResultAggregator {
  constructor(
    private readonly eventBus:          EventBusLike,
    private readonly taskStore:         TaskStoreLike,
    private readonly delegationService: DelegationService,
    private readonly responseRouter:    ResponseRouter,
  ) {}

  /**
   * Subscribe to task lifecycle events.
   * Must be called once to activate delegation result routing.
   */
  start(): void {
    this.eventBus.on("RESULT_READY", (data) => { void this._onResultReady(data); });
    this.eventBus.on("TASK_FAILED",  (data) => { void this._onTaskFailed(data); });

    logger.info("result-aggregator", "Delegation result aggregator active", {
      metadata: { subscribed: ["RESULT_READY", "TASK_FAILED"] },
    });
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private async _onResultReady(data: unknown): Promise<void> {
    const taskId = this._extractTaskId(data);
    if (taskId === null) return;

    const task = this.taskStore.get(taskId);
    if (task === null || task.parent_id === null || task.type !== "delegation") return;

    // Mark delegation as completed in DelegationService
    this.delegationService.markCompleted(
      taskId,
      task.result_summary ?? "",
      task.cost_used,
    );

    logger.info("result-aggregator", "Delegation subtask completed", {
      metadata: {
        subtask_id: taskId,
        parent_id:  task.parent_id,
        cost_used:  task.cost_used,
      },
    });

    // Check if parent task expects messaging response
    await this._checkParentComplete(task.parent_id);
  }

  private async _onTaskFailed(data: unknown): Promise<void> {
    const taskId = this._extractTaskId(data);
    if (taskId === null) return;

    const task = this.taskStore.get(taskId);
    if (task === null || task.parent_id === null || task.type !== "delegation") return;

    const error = this._extractError(data);

    // Mark delegation as failed in DelegationService
    this.delegationService.markFailed(taskId, error);

    logger.warn("result-aggregator", "Delegation subtask failed", {
      metadata: {
        subtask_id: taskId,
        parent_id:  task.parent_id,
        error,
      },
    });

    // Still check parent — may still route partial results or failure notice
    await this._checkParentComplete(task.parent_id);
  }

  // ---------------------------------------------------------------------------
  // Parent completion check
  // ---------------------------------------------------------------------------

  /**
   * When a subtask finishes, check if the parent task has messaging origin
   * and if all expected subtasks have now completed. If so, route aggregated
   * result back via ResponseRouter.
   *
   * Note: root-task RESULT_READY is handled by TaskLifecycleRouter. This
   * method only handles the case where parent task has sub_tasks_expected > 0
   * and all delegated subtasks have been received.
   */
  private async _checkParentComplete(parentId: string): Promise<void> {
    const parent = this.taskStore.get(parentId);
    if (parent === null) return;

    // Only route if parent is messaging-originated
    if (parent.source_metadata === undefined) return;

    // Count received subtasks
    const siblings    = this.taskStore.getByParent(parentId);
    const terminal    = siblings.filter((t) =>
      t.status === "DONE" || t.status === "FAILED" || t.status === "CANCELLED",
    ).length;
    const expected    = parent.sub_tasks_expected;

    if (expected === 0 || terminal < expected) {
      // Not all subtasks done yet
      return;
    }

    // Aggregate subtask summaries
    const completedSummaries = siblings
      .filter((t) => t.status === "DONE" && t.result_summary !== undefined)
      .map((t, i) => `[${i + 1}] ${t.result_summary ?? ""}`)
      .join("\n");

    const failedCount = siblings.filter((t) => t.status === "FAILED").length;
    const summary     = failedCount > 0
      ? `${terminal - failedCount}/${expected} subtasks completed, ${failedCount} failed.\n${completedSummaries}`
      : (completedSummaries || parent.result_summary) ?? "";

    const envelope = this._reconstructEnvelope(parent.source_metadata);
    if (envelope === null) return;

    const handle: MessagingTaskHandle = {
      id:          parent.id,
      description: parent.description,
      agent_id:    parent.assigned_agent,
      budget_usd:  parent.cost_budget,
      status:      parent.status,
    };

    const durationSec = this._durationSec(parent);

    try {
      if (failedCount > 0 && terminal === failedCount) {
        // All subtasks failed
        await this.responseRouter.sendTaskFailed(envelope, handle, summary);
      } else {
        await this.responseRouter.sendTaskCompleted(
          envelope,
          handle,
          summary,
          durationSec,
          parent.cost_used,
        );
      }
      logger.info("result-aggregator", "Routed delegated task result to messaging", {
        metadata: {
          parent_id:    parentId,
          subtasks_done: terminal,
          subtasks_fail: failedCount,
          channel:      parent.source_metadata.source_channel,
        },
      });
    } catch (err: unknown) {
      logger.warn("result-aggregator", "Failed to route delegated task result", {
        metadata: {
          parent_id: parentId,
          error:     err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _extractTaskId(data: unknown): string | null {
    if (data === null || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;
    return typeof d["task_id"] === "string" ? d["task_id"] : null;
  }

  private _extractError(data: unknown): string {
    if (data !== null && typeof data === "object") {
      const payload = (data as Record<string, unknown>)["data"];
      if (payload !== null && typeof payload === "object") {
        const p = payload as Record<string, unknown>;
        if (typeof p["error"] === "string")  return p["error"];
        if (typeof p["reason"] === "string") return p["reason"];
      }
    }
    return "unknown_error";
  }

  private _reconstructEnvelope(
    meta: NonNullable<Task["source_metadata"]>,
  ): MessageEnvelope | null {
    return {
      id:          meta.source_message_id,
      instance_id: meta.source_instance_id,
      channel:     meta.source_channel,
      sender:      { platform_id: meta.source_user, display_name: "", verified: false },
      content:     { text: "" },
      metadata:    {
        timestamp:    new Date().toISOString(),
        chat_id:      meta.source_chat_id,
        platform_raw: {},
      },
    };
  }

  private _durationSec(task: Task): number {
    const start = new Date(task.created_at).getTime();
    const end   = task.completed_at !== null
      ? new Date(task.completed_at).getTime()
      : Date.now();
    return Math.max(0, Math.floor((end - start) / 1000));
  }
}
