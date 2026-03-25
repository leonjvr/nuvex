// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: TaskLifecycleRouter
 *
 * Subscribes to task RESULT_READY and TASK_FAILED events from TaskEventBus.
 * When a task that originated from a messaging channel completes or fails,
 * the originating user is notified via ResponseRouter.
 *
 * Only tasks with source_metadata (set by submitMessageTask) are routed.
 * Non-messaging tasks are silently ignored.
 */

import type { Task } from "../tasks/types.js";
import type { MessageEnvelope, MessagingTaskHandle } from "./types.js";
import type { ResponseRouter } from "./response-router.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("task-lifecycle-router");


export interface EventBusLike {
  on(event: string, handler: (data: unknown) => void): void;
}

export interface TaskStoreLike {
  get(taskId: string): Task | null;
}


export class TaskLifecycleRouter {
  constructor(
    private readonly eventBus:       EventBusLike,
    private readonly taskStore:      TaskStoreLike,
    private readonly responseRouter: ResponseRouter,
  ) {}

  /**
   * Subscribe to task lifecycle events.
   * Must be called once to activate response routing for messaging tasks.
   */
  start(): void {
    this.eventBus.on("RESULT_READY", (data) => { void this._onResultReady(data); });
    this.eventBus.on("TASK_FAILED",  (data) => { void this._onTaskFailed(data); });

    logger.info("task-lifecycle-router", "Task lifecycle routing active", {
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
    if (task === null || task.source_metadata === undefined) return;

    const envelope = this._reconstructEnvelope(task.source_metadata);
    if (envelope === null) return;

    const handle: MessagingTaskHandle = {
      id:          task.id,
      description: task.description,
      agent_id:    task.assigned_agent,
      budget_usd:  task.cost_budget,
      status:      task.status,
    };

    const durationSec = this._durationSec(task);

    try {
      await this.responseRouter.sendTaskCompleted(
        envelope,
        handle,
        task.result_summary ?? "",
        durationSec,
        task.cost_used,
      );
      logger.info("task-lifecycle-router", "Sent task completion notification", {
        metadata: { task_id: task.id, channel: task.source_metadata.source_channel },
      });
    } catch (err: unknown) {
      logger.warn("task-lifecycle-router", "Failed to send completion notification", {
        metadata: {
          task_id: task.id,
          error:   err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private async _onTaskFailed(data: unknown): Promise<void> {
    const taskId = this._extractTaskId(data);
    if (taskId === null) return;

    const task = this.taskStore.get(taskId);
    if (task === null || task.source_metadata === undefined) return;

    const envelope = this._reconstructEnvelope(task.source_metadata);
    if (envelope === null) return;

    const handle: MessagingTaskHandle = {
      id:          task.id,
      description: task.description,
      agent_id:    task.assigned_agent,
      budget_usd:  task.cost_budget,
      status:      task.status,
    };

    const errorMsg = this._extractError(data);

    try {
      await this.responseRouter.sendTaskFailed(envelope, handle, errorMsg);
      logger.info("task-lifecycle-router", "Sent task failure notification", {
        metadata: { task_id: task.id, channel: task.source_metadata.source_channel },
      });
    } catch (err: unknown) {
      logger.warn("task-lifecycle-router", "Failed to send failure notification", {
        metadata: {
          task_id: task.id,
          error:   err instanceof Error ? err.message : String(err),
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
        if (typeof p["error"] === "string") return p["error"];
        if (typeof p["reason"] === "string") return p["reason"];
      }
    }
    return "Unbekannter Fehler";
  }

  /**
   * Reconstruct a minimal MessageEnvelope from task source_metadata.
   * Only instance_id, channel, and chat_id matter for response routing.
   */
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
