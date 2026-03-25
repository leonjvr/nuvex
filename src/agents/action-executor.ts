// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8: ActionExecutor
 *
 * Every agent action that touches external systems goes through the ActionExecutor.
 * It enforces the Pre-Action Governance Pipeline (Phase 5) before every LLM call
 * and before every task creation.
 *
 * Flow for executeLLMCall():
 *   1. Build ActionRequest from task + agent context
 *   2. Run Pre-Action Pipeline (Forbidden → Approval → Budget → Classification → Policy)
 *   3. If BLOCK → return blocked result (agent must handle: retry or escalate)
 *   4. If PAUSE → return paused result (task enters approval-waiting state)
 *   5. If ALLOW → call ProviderRegistry.call()
 *   6. Update task token_used and cost_used
 *   7. Return LLM response
 */

import { randomUUID } from "node:crypto";
import type { AgentDefinition, LLMRequest, ActionResult } from "./types.js";
import type { Task } from "../tasks/types.js";
import type { TaskStore } from "../tasks/store.js";
import type { ProviderRegistry } from "../provider/registry.js";
import type { ProviderCallResponse, ProviderName } from "../types/provider.js";
import type { ActionRequest, PipelineResult, ActionType } from "../types/pipeline.js";


/** Pre-bound pipeline evaluator function. */
export type PipelineEvaluator = (request: ActionRequest) => PipelineResult;

/** Result of an LLM call through the executor. */
export interface LLMCallResult {
  success: boolean;
  response?: ProviderCallResponse;
  blocked?: boolean;
  paused?: boolean;
  block_reason?: string;
  approval_id?: number;
}


export class ActionExecutor {
  constructor(
    /** Pre-bound pipeline evaluator: (req) => evaluateAction(req, governance, db) */
    private readonly evaluate: PipelineEvaluator,
    /**
     * Provider registry for LLM calls.
     * Pass `null` when the executor is used only for non-LLM actions (e.g. CLI run mode).
     */
    private readonly registry: ProviderRegistry | null,
    /** Agent definition (for building ActionRequest metadata). */
    private readonly agentDef: AgentDefinition,
    /** Task store for updating token/cost usage. */
    private readonly taskStore: TaskStore,
  ) {}

  /**
   * Execute an LLM call with full governance enforcement.
   *
   * @param request - LLM request parameters (messages, system prompt, etc.)
   * @param task    - The task this call is part of (for budget + audit metadata)
   */
  async executeLLMCall(request: LLMRequest, task: Task): Promise<LLMCallResult> {
    // 1. Build Pre-Action Pipeline request
    const actionRequest = this.buildActionRequest(task, request);

    // 2. Run pipeline
    const pipelineResult = this.evaluate(actionRequest);

    // 3. Handle non-ALLOW verdicts
    if (pipelineResult.verdict === "BLOCK") {
      return {
        success: false,
        blocked: true,
        block_reason: pipelineResult.blocking_reason ?? "Blocked by governance pipeline",
      };
    }

    if (pipelineResult.verdict === "PAUSE") {
      return {
        success: false,
        paused: true,
        block_reason: `Requires approval: ${pipelineResult.blocking_reason ?? "Governance pause"}`,
        ...(pipelineResult.approval_id !== undefined ? { approval_id: pipelineResult.approval_id } : {}),
      };
    }

    // 4. ALLOW → call provider
    if (this.registry === null) {
      return {
        success: false,
        block_reason: "No provider registry configured for LLM calls",
      };
    }

    let response: ProviderCallResponse;
    try {
      response = await this.registry.call({
        agentId: this.agentDef.id,
        divisionCode: this.agentDef.division,
        provider: this.agentDef.provider as ProviderName,
        model: this.agentDef.model,
        messages: request.messages,
        ...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
        ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        taskId: task.id,
        metadata: {
          ...request.metadata,
          tier: this.agentDef.tier,
          pipeline_request_id: actionRequest.request_id,
        },
      });
    } catch (err) {
      return {
        success: false,
        block_reason: `Provider error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 5. Update task cost/token usage
    this.taskStore.update(task.id, {
      token_used: task.token_used + response.usage.totalTokens,
      cost_used: task.cost_used + response.costUsd,
    });

    return { success: true, response };
  }

  /**
   * Execute a non-LLM action with governance enforcement.
   * Used for sub-task creation, result writing, etc.
   */
  async executeAction(
    actionType: ActionType | `custom.${string}`,
    actionTarget: string,
    actionDescription: string,
    task: Task | null,
    // Pass tool parameters so governance pipeline can inspect them
    parameters?: Record<string, unknown>,
  ): Promise<ActionResult> {
    const actionRequest = this.buildActionRequest(task, null, {
      type: actionType,
      target: actionTarget,
      description: actionDescription,
      ...(parameters !== undefined ? { parameters } : {}),
    });

    const pipelineResult = this.evaluate(actionRequest);

    if (pipelineResult.verdict === "BLOCK") {
      return {
        success: false,
        blocked: true,
        block_reason: pipelineResult.blocking_reason ?? "Blocked by governance pipeline",
      };
    }

    if (pipelineResult.verdict === "PAUSE") {
      return {
        success: false,
        blocked: true,
        block_reason: `Requires approval: ${pipelineResult.blocking_reason ?? "Governance pause"}`,
      };
    }

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildActionRequest(
    task: Task | null,
    llmRequest: LLMRequest | null,
    actionOverride?: {
      type: ActionType | `custom.${string}`;
      target: string;
      description: string;
      // Tool parameters forwarded to governance pipeline
      parameters?: Record<string, unknown>;
    },
  ): ActionRequest {
    const now = new Date().toISOString();
    const isLlmCall = llmRequest !== null;

    const estimatedCost = isLlmCall
      ? estimateLLMCost(llmRequest)
      : 0;

    return {
      request_id: randomUUID(),
      timestamp: now,
      agent_id: this.agentDef.id,
      agent_tier: this.agentDef.tier,
      division_code: this.agentDef.division,
      action: actionOverride !== undefined
        ? {
            type: actionOverride.type,
            target: actionOverride.target,
            description: actionOverride.description,
            data_classification: "INTERNAL",
            ...(actionOverride.parameters !== undefined ? { parameters: actionOverride.parameters } : {}),
          }
        : {
            type: "api.call",
            target: `${this.agentDef.provider}/${this.agentDef.model}`,
            description: `LLM call for task: ${task?.title ?? "unknown"}`,
            estimated_cost_usd: estimatedCost,
            data_classification: "INTERNAL",
          },
      context: {
        ...(task !== null ? { task_id: task.id } : {}),
        division_code: this.agentDef.division,
        session_id: this.agentDef.id,
      },
    };
  }
}


/** Rough cost estimate for pre-pipeline budget check (~4 chars/token). */
function estimateLLMCost(request: LLMRequest): number {
  const totalChars =
    request.messages.reduce((s, m) => s + m.content.length, 0) +
    (request.systemPrompt?.length ?? 0);
  const estimatedTokens = Math.ceil(totalChars / 4);
  // ~$0.000003 per token (rough estimate for claude-sonnet)
  return estimatedTokens * 0.000003;
}
