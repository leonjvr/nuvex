// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 14: OutputBridge
 *
 * Integration point for the agent execution flow.
 * Wraps CommunicationManager with ergonomic task-completion helpers.
 */

import { createLogger }         from "../core/logger.js";
import type { CommunicationManager, TaskOutput, TaskSummary } from "./communication-manager.js";
import type { OutputType }     from "./output-store.js";
import type { SummaryStatus }  from "./summary-store.js";

const logger = createLogger("output-bridge");


export interface OnTaskCompleteParams {
  task_id:            string;
  agent_id:           string;
  division_id?:       string;
  output_text:        string;
  output_type:        OutputType;
  key_facts:          string[];
  decisions?:         string[];
  metrics?:           Record<string, unknown>;
  status:             SummaryStatus;
  escalation_needed?: boolean;
}

export interface ChildResults {
  summaries: TaskSummary[];
  outputs?:  TaskOutput[];
}


export class OutputBridge {
  constructor(private readonly cm: CommunicationManager) {}

  /**
   * Called when an agent completes a task.
   * Stores the output, then creates a governed summary referencing it.
   */
  async onTaskComplete(params: OnTaskCompleteParams): Promise<{
    output:  TaskOutput;
    summary: TaskSummary;
  }> {
    logger.info("on_task_complete", `Storing output+summary for task ${params.task_id}`, {
      metadata: { task_id: params.task_id, agent_id: params.agent_id, status: params.status },
    });

    const output = await this.cm.storeOutput({
      task_id:        params.task_id,
      agent_id:       params.agent_id,
      output_type:    params.output_type,
      content_text:   params.output_text,
      classification: "INTERNAL",
      ...(params.division_id !== undefined && { division_id: params.division_id }),
    });

    const summary = await this.cm.storeSummary({
      task_id:      params.task_id,
      agent_id:     params.agent_id,
      summary_text: params.output_text.substring(0, 2000),
      key_facts:    params.key_facts,
      output_refs:  [output.id],
      status:       params.status,
      ...(params.decisions         !== undefined && { decisions:         params.decisions }),
      ...(params.metrics           !== undefined && { metrics:           params.metrics }),
      ...(params.escalation_needed !== undefined && { escalation_needed: params.escalation_needed }),
    });

    return { output, summary };
  }

  /**
   * Called by a parent agent to retrieve child task results.
   * Path 3 (summaries) is always returned; full outputs are optional.
   */
  async getChildResults(
    childTaskIds: string[],
    options: { include_outputs?: boolean } = {},
  ): Promise<ChildResults> {
    const summaries: TaskSummary[] = [];
    const outputs:   TaskOutput[]  = [];

    for (const taskId of childTaskIds) {
      const s = this.cm.getTaskSummary(taskId);
      if (s !== null) summaries.push(s);

      if (options.include_outputs) {
        outputs.push(...this.cm.getTaskOutputs(taskId));
      }
    }

    return options.include_outputs ? { summaries, outputs } : { summaries };
  }
}
