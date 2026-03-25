// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 7: TaskRouter
 *
 * Routes completed sub-task results to the correct parent agent.
 * Handles both delegation results (increment counter) and consultation
 * responses (no counter increment — advisory only).
 */

import type { Task, ManagementSummary } from "./types.js";
import type { TaskStore } from "./store.js";
import type { TaskEventBus } from "./event-bus.js";
import type { ResultStore } from "./result-store.js";
import type { ResultFrontmatter } from "./types.js";

export class TaskRouter {
  constructor(
    private readonly store: TaskStore,
    private readonly eventBus: TaskEventBus,
    private readonly resultStore: ResultStore,
  ) {}

  /**
   * Route a completed (non-consultation) task's result to its parent.
   *
   * Flow:
   *   1. Write result file via ResultStore
   *   2. Increment parent's sub_tasks_received
   *   3. Emit RESULT_READY to parent's agent
   *   4. Check if parent now has all expected sub-tasks
   */
  async routeResult(completedTask: Task, summary: ManagementSummary): Promise<void> {
    if (completedTask.parent_id === null) return; // root task — no parent to notify

    // 1. Write result file
    const frontmatter: ResultFrontmatter = {
      task_id: completedTask.id,
      parent_task: completedTask.parent_id,
      root_task: completedTask.root_id,
      agent: summary.agent_id,
      division: completedTask.division,
      tier: completedTask.tier,
      type: completedTask.type,
      confidence: summary.confidence,
      status: "complete",
      tokens_used: summary.tokens_used,
      cost_usd: summary.cost_usd,
      timestamp: summary.completed_at,
      classification: completedTask.classification,
    };

    const filePath = await this.resultStore.writeResult(
      completedTask.id,
      completedTask.division,
      frontmatter,
      summary.key_findings,
    );

    // Update task with result file path
    this.store.update(completedTask.id, { result_file: filePath });

    // 2. Increment parent's sub_tasks_received
    const parent = this.store.get(completedTask.parent_id);
    if (parent === null) return;

    const newReceived = parent.sub_tasks_received + 1;
    const updatedParent = this.store.update(parent.id, {
      sub_tasks_received: newReceived,
    });

    // 3. Emit RESULT_READY to parent's agent
    await this.eventBus.emitTask({
      event_type: "RESULT_READY",
      task_id: completedTask.id,
      parent_task_id: completedTask.parent_id,
      agent_from: completedTask.assigned_agent,
      agent_to: parent.assigned_agent,
      division: completedTask.division,
      data: {
        result_file: filePath,
        summary: summary.key_findings,
        confidence: summary.confidence,
        tokens_used: summary.tokens_used,
        cost_usd: summary.cost_usd,
      },
    });

    // 4. Check if parent has all expected results
    const completion = await this.checkParentCompletion(parent.id);
    if (completion.complete && updatedParent.assigned_agent !== null) {
      await this.eventBus.emitTask({
        event_type: "TASK_PROGRESS",
        task_id: parent.id,
        parent_task_id: parent.parent_id,
        agent_from: null,
        agent_to: updatedParent.assigned_agent,
        division: parent.division,
        data: {
          message: "All sub-tasks complete — ready for synthesis",
          received: completion.received,
          expected: completion.expected,
        },
      });
    }
  }

  /**
   * Route a consultation response back to the requester.
   * Does NOT increment sub_tasks_received on the parent.
   */
  async routeConsultation(consultationTask: Task, response: string): Promise<void> {
    if (consultationTask.parent_id === null) return;

    const parent = this.store.get(consultationTask.parent_id);
    if (parent === null) return;

    await this.eventBus.emitTask({
      event_type: "CONSULTATION_RESPONSE",
      task_id: consultationTask.id,
      parent_task_id: consultationTask.parent_id,
      agent_from: consultationTask.assigned_agent,
      agent_to: parent.assigned_agent,
      division: consultationTask.division,
      data: {
        consultation_task_id: consultationTask.id,
        response,
      },
    });
  }

  /**
   * Check if a parent task has received all expected sub-task results.
   */
  async checkParentCompletion(parentId: string): Promise<{
    complete: boolean;
    received: number;
    expected: number;
    pending: Task[];
  }> {
    const parent = this.store.get(parentId);
    if (parent === null) {
      return { complete: false, received: 0, expected: 0, pending: [] };
    }

    const children = this.store.getByParent(parentId);
    const pending = children.filter(
      (c) =>
        c.status !== "DONE" &&
        c.status !== "CANCELLED" &&
        c.type !== "consultation",
    );

    const expected = parent.sub_tasks_expected;
    const received = parent.sub_tasks_received;
    const complete = expected > 0 && received >= expected;

    return { complete, received, expected, pending };
  }
}
