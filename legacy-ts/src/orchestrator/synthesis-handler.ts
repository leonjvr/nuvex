// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 13c: SynthesisHandler
 *
 * Monitors sub-task completion events and re-queues parent tasks for synthesis
 * when all children are done.
 *
 * Flow:
 *   1. Subscribe to task_events for RESULT_READY and TASK_FAILED events
 *   2. When a child task reaches a terminal state, check if all siblings done
 *   3. If yes → emit SYNTHESIS_READY → parent AgentLoop enters synthesis mode
 *   4. Handle partial failures: synthesize available results, note failures
 *
 * This wraps Phase 9 SynthesisCollector. It adds:
 *   - Subscription-based trigger (not just poll-based)
 *   - Synthesis prompt building for partial failures
 *   - Budget-aware synthesis (skip if budget exhausted)
 */

import { createLogger }        from "../core/logger.js";
import { SynthesisCollector }  from "./synthesis.js";
import { TaskStore }           from "../tasks/store.js";
import { TaskEventBus }        from "../tasks/event-bus.js";
import type { Database }       from "../utils/db.js";
import type { ChildSummary }   from "./types.js";

const logger = createLogger("synthesis-handler");


export interface SynthesisReadyEvent {
  parent_task_id:  string;
  child_summaries: ChildSummary[];
  all_succeeded:   boolean;
  failed_count:    number;
}

export type SynthesisReadyCallback = (event: SynthesisReadyEvent) => void | Promise<void>;


export class SynthesisHandler {
  private readonly store:     TaskStore;
  private readonly collector: SynthesisCollector;
  private _started            = false;
  private _callbacks: SynthesisReadyCallback[] = [];

  constructor(private readonly db: Database, private readonly eventBus: TaskEventBus) {
    this.store     = new TaskStore(db);
    this.collector = new SynthesisCollector(db, eventBus);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Start listening for child completion events. */
  start(): void {
    if (this._started) return;
    this._started = true;

    // Subscribe via the string-event API (emitTask broadcasts to on() handlers
    // by event_type, so all RESULT_READY / TASK_FAILED events are received here).
    // The subscribe(agentId, ...) API keys by agent_to field and would never
    // fire for synthesis-scoped events.
    this.eventBus.on("RESULT_READY", async (raw) => {
      if (!this._started) return;
      const event = raw as { task_id: string };
      await this._handleChildComplete(event.task_id);
    });
    this.eventBus.on("TASK_FAILED", async (raw) => {
      if (!this._started) return;
      const event = raw as { task_id: string };
      await this._handleChildComplete(event.task_id);
    });

    logger.info("synthesis_handler_started", "SynthesisHandler listening for child completions");
  }

  /** Stop listening. */
  stop(): void {
    if (!this._started) return;
    this._started = false;
    // on() handlers are guarded by _started — they become no-ops after stop().
    logger.info("synthesis_handler_stopped", "SynthesisHandler stopped");
  }

  /** Register a callback for when a parent task is ready for synthesis. */
  onSynthesisReady(cb: SynthesisReadyCallback): void {
    this._callbacks.push(cb);
  }

  // ---------------------------------------------------------------------------
  // Core logic
  // ---------------------------------------------------------------------------

  /**
   * Called when a child task reaches DONE or FAILED.
   * Uses SynthesisCollector to check if parent is ready.
   */
  async handleChildComplete(taskId: string): Promise<SynthesisReadyEvent | null> {
    return this._handleChildComplete(taskId);
  }

  private async _handleChildComplete(taskId: string): Promise<SynthesisReadyEvent | null> {
    const task = this.store.get(taskId);
    if (task === null) return null;

    // Only process child tasks (parent_id !== null)
    if (task.parent_id === null) return null;

    // Skip tasks that aren't terminal
    if (task.status !== "DONE" && task.status !== "FAILED" && task.status !== "CANCELLED") return null;

    logger.debug("synthesis_check", `Checking synthesis readiness for parent of ${taskId}`, {
      metadata: { child_id: taskId, parent_id: task.parent_id, status: task.status },
    });

    const synthStatus = this.collector.registerResult(task);

    if (!synthStatus.ready) {
      logger.debug("synthesis_not_ready", `Synthesis not yet ready`, {
        metadata: {
          parent_id: task.parent_id,
          completed: synthStatus.completed_children,
          total:     synthStatus.total_children,
          remaining: synthStatus.remaining,
        },
      });
      return null;
    }

    // All children done — build synthesis event
    const summaries    = synthStatus.child_summaries;
    const failedCount  = summaries.filter((s) => s.status === "FAILED").length;
    const allSucceeded = failedCount === 0;

    const event: SynthesisReadyEvent = {
      parent_task_id:  synthStatus.parent_task_id,
      child_summaries: summaries,
      all_succeeded:   allSucceeded,
      failed_count:    failedCount,
    };

    logger.info("synthesis_ready", `All children done — triggering parent synthesis`, {
      metadata: {
        parent_id:   synthStatus.parent_task_id,
        total:       summaries.length,
        failed:      failedCount,
        all_success: allSucceeded,
      },
    });

    // Trigger parent synthesis via SynthesisCollector
    await this.collector.triggerParentSynthesis(synthStatus.parent_task_id, summaries);

    // Call registered callbacks
    for (const cb of this._callbacks) {
      try {
        await cb(event);
      } catch (err) {
        logger.warn("synthesis_callback_error", `Synthesis callback failed: ${String(err)}`, {
          metadata: { parent_id: synthStatus.parent_task_id },
        });
      }
    }

    return event;
  }

  // ---------------------------------------------------------------------------
  // Synthesis prompt helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a synthesis prompt from child summaries for the parent agent.
   * Includes management summaries + flags any failures.
   */
  buildSynthesisPrompt(parentTitle: string, summaries: ChildSummary[]): string {
    const successList = summaries.filter((s) => s.status === "DONE");
    const failedList  = summaries.filter((s) => s.status === "FAILED");

    const lines: string[] = [
      `You are synthesizing the results of your delegated sub-tasks for: "${parentTitle}"`,
      "",
      `Completed sub-tasks (${successList.length}/${summaries.length}):`,
    ];

    for (const s of successList) {
      lines.push(`\n### ${s.title}`);
      lines.push(`Confidence: ${(s.confidence * 100).toFixed(0)}%`);
      lines.push(`Summary: ${s.summary}`);
    }

    if (failedList.length > 0) {
      lines.push("");
      lines.push(`Failed sub-tasks (${failedList.length}):`, "");
      for (const s of failedList) {
        lines.push(`- ${s.title}: ${s.summary}`);
      }
      lines.push("");
      lines.push("Note: Incorporate available results and clearly note what could not be completed.");
    }

    lines.push("");
    lines.push("Synthesize the above results into a coherent, complete deliverable.");
    lines.push("Call execute_result with your synthesized output.");

    return lines.join("\n");
  }
}
