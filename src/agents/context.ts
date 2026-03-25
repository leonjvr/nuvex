// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8: AgentContext
 *
 * Builds the full context window (system prompt + messages) for each LLM call.
 * Combines skill definition, task context, memory, and governance instructions.
 *
 * System prompt construction order (per spec):
 *   1. Governance preamble — division rules, classification, forbidden actions
 *   2. Role definition — from skill.md (who this agent is)
 *   3. Output format — structured response format (EXECUTE/DECOMPOSE)
 *   4. Task-specific instructions — actual task + parent context
 *   5. Memory injection — relevant short-term/long-term/pool memory
 *   6. Constraints — budget, TTL, escalation instructions
 *
 * Context trimming: trim memory first, then task history, never governance or role.
 */

import type { AgentDefinition, SkillDefinition, LLMRequest } from "./types.js";
import type { MemoryManager } from "./memory.js";
import type { SkillLoader } from "./skill-loader.js";
import type { Task } from "../tasks/types.js";
import type { Message } from "../types/provider.js";


export class AgentContext {
  constructor(
    private readonly definition: AgentDefinition,
    private readonly skill: SkillDefinition,
    private readonly memoryManager: MemoryManager,
  ) {}

  /**
   * Build the complete message array for an LLM call.
   * Includes system prompt (as first system message) + user message with task.
   * Memory is included in the user message if available.
   */
  async buildMessages(task: Task, additionalContext?: string): Promise<Message[]> {
    const systemPrompt = this.buildSystemPrompt();
    const memory = await this.memoryManager.getRelevantMemories(task, 1500);

    const userParts: string[] = [
      buildTaskSection(task),
    ];

    if (memory.trim().length > 0) {
      userParts.push(`## Relevant Memory\n\n${memory}`);
    }

    if (additionalContext !== undefined && additionalContext.trim().length > 0) {
      userParts.push(additionalContext.trim());
    }

    const outputFormat = buildOutputFormatInstructions(this.definition.tier, task.type);
    userParts.push(outputFormat);

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userParts.join("\n\n") },
    ];
  }

  /**
   * Build the synthesis messages when all sub-tasks are complete.
   * Different from standard messages: includes child summaries for review.
   */
  async buildSynthesisMessages(
    task: Task,
    childSummaries: string[],
  ): Promise<Message[]> {
    const systemPrompt = this.buildSystemPrompt();
    const memory = await this.memoryManager.getRelevantMemories(task, 500);

    const userParts: string[] = [
      buildTaskSection(task),
      "## Sub-Task Results\n\nAll sub-tasks are complete. Synthesize the following results:\n\n" +
        childSummaries.map((s, i) => `### Result ${i + 1}\n${s}`).join("\n\n"),
    ];

    if (memory.trim().length > 0) {
      userParts.push(`## Relevant Memory\n\n${memory}`);
    }

    userParts.push(SYNTHESIS_FORMAT_INSTRUCTIONS);

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userParts.join("\n\n") },
    ];
  }

  /**
   * Build consultation messages for a peer consultation task.
   */
  async buildConsultationMessages(task: Task): Promise<Message[]> {
    const systemPrompt = this.buildSystemPrompt();
    const userContent = [
      `## Consultation Request\n\n${task.title}\n\n${task.description}`,
      CONSULTATION_FORMAT_INSTRUCTIONS,
    ].join("\n\n");

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ];
  }

  /**
   * Build the stable system prompt from skill + governance + role.
   * This does NOT change per-task. Task-specific content goes in buildMessages().
   */
  buildSystemPrompt(): string {
    const parts: string[] = [
      buildGovernancePreamble(this.definition),
      buildRoleSection(this.skill),
      buildConstraintsSection(this.skill, this.definition),
    ];
    return parts.filter((p) => p.trim().length > 0).join("\n\n---\n\n");
  }

  /**
   * Estimate token count for a set of messages.
   * Approximation: ~4 characters per token.
   */
  estimateTokens(messages: Message[]): number {
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    return Math.ceil(totalChars / 4);
  }

  /**
   * Trim messages to fit within maxTokens.
   * Trim strategy: remove memory sections first, then shorten task history.
   * Never trim: governance preamble, role, output format, current task description.
   */
  trimToFit(messages: Message[], maxTokens: number): Message[] {
    const estimated = this.estimateTokens(messages);
    if (estimated <= maxTokens) return messages;

    // Strategy: shorten the user message (trim memory sections)
    const result: Message[] = [...messages];
    const userIdx = result.findIndex((m) => m.role === "user");
    if (userIdx === -1) return result;

    const userMsg = result[userIdx]!;
    const targetChars = maxTokens * 4;
    const currentChars = result.reduce((s, m) => s + m.content.length, 0);
    const toRemove = currentChars - targetChars;

    if (userMsg.content.length > toRemove + 200) {
      // Trim from the start of the user message (memory sections are first)
      const trimmed = userMsg.content.slice(toRemove);
      // Find next section start to avoid mid-section cut
      const nextSection = trimmed.indexOf("##");
      const cleanTrimmed =
        nextSection > 0 ? trimmed.slice(nextSection) : trimmed;
      result[userIdx] = { role: "user", content: cleanTrimmed };
    }

    return result;
  }

  /**
   * Build messages with deep knowledge from Qdrant (via SkillLoader.loadWithContext).
   * Priority: governance > role > task > deep_knowledge > short_term_memory
   * Deep knowledge is inserted between task section and short-term memory.
   */
  async buildMessagesWithDeepKnowledge(
    task: Task,
    skillLoader: SkillLoader,
    additionalContext?: string,
  ): Promise<Message[]> {
    const systemPrompt = this.buildSystemPrompt();

    // Load enriched skill definition with deep knowledge
    const enrichedSkill = this.definition.skill_file
      ? await skillLoader.loadWithContext(
          this.definition.skill_file,
          `${task.title} ${task.description.slice(0, 100)}`,
          500,
        )
      : null;

    const memory = await this.memoryManager.getRelevantMemories(task, 1000);

    const userParts: string[] = [buildTaskSection(task)];

    // Insert deep knowledge (trimmed to fit) after task section
    if (enrichedSkill !== null && enrichedSkill.deep_knowledge.length > 0) {
      const deepKnowledgeText = enrichedSkill.deep_knowledge
        .map((e) => e.content)
        .join("\n\n");
      userParts.push(`## Deep Knowledge\n\n${deepKnowledgeText}`);
    }

    if (memory.trim().length > 0) {
      userParts.push(`## Relevant Memory\n\n${memory}`);
    }

    if (additionalContext !== undefined && additionalContext.trim().length > 0) {
      userParts.push(additionalContext.trim());
    }

    const outputFormat = buildOutputFormatInstructions(this.definition.tier, task.type);
    userParts.push(outputFormat);

    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: userParts.join("\n\n") },
    ];
  }

  /**
   * Build an LLMRequest from messages (used by ActionExecutor).
   */
  buildLLMRequest(messages: Message[], task: Task): LLMRequest {
    const systemMsg = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    return {
      messages: userMessages,
      ...(systemMsg !== undefined ? { systemPrompt: systemMsg.content } : {}),
      maxTokens: Math.min(task.token_budget - task.token_used, 4096),
      taskId: task.id,
      metadata: {
        agent_id: this.definition.id,
        task_title: task.title,
        tier: this.definition.tier,
      },
    };
  }
}


function buildGovernancePreamble(definition: AgentDefinition): string {
  return `## Governance Rules

You are operating under SIDJUA governance enforcement.

- **Division:** ${definition.division}
- **Tier:** T${definition.tier} (${tierDescription(definition.tier)})
- **Agent ID:** ${definition.id}

All your actions are logged and audited. You may not bypass any governance rules.
If an action is blocked by governance, you must either find an alternative approach or escalate to a higher tier agent.

**Classification:** You handle data classified as appropriate for your tier.
**Budget:** You must stay within the token and cost budgets assigned to each task.
**Escalation:** If you encounter a blocker you cannot resolve, escalate — do not guess.`;
}

function buildRoleSection(skill: SkillDefinition): string {
  return `## Your Role\n\n**${skill.role}**\n\n${skill.system_prompt}`;
}

function buildConstraintsSection(skill: SkillDefinition, definition: AgentDefinition): string {
  const lines: string[] = [
    `## Agent Constraints`,
    `- Maximum concurrent tasks: ${definition.max_concurrent_tasks}`,
    `- Cost limit per hour: $${definition.cost_limit_per_hour.toFixed(2)} USD`,
    `- Default task TTL: ${definition.ttl_default_seconds}s`,
    `- Capabilities: ${definition.capabilities.join(", ")}`,
  ];

  if (skill.constraints.length > 0) {
    lines.push("", "**Role-specific constraints:**");
    for (const c of skill.constraints) {
      lines.push(`- ${c}`);
    }
  }

  return lines.join("\n");
}

function buildTaskSection(task: Task): string {
  return [
    `## Current Task`,
    `**Title:** ${task.title}`,
    `**Description:** ${task.description}`,
    `**Type:** ${task.type}`,
    `**Priority:** ${task.priority}`,
    `**Token budget remaining:** ${task.token_budget - task.token_used}`,
    `**Cost budget remaining:** $${(task.cost_budget - task.cost_used).toFixed(4)} USD`,
  ].join("\n");
}

function buildOutputFormatInstructions(tier: 1 | 2 | 3, taskType: string): string {
  const nextTier = Math.min(tier + 1, 3) as 1 | 2 | 3;

  if (taskType === "consultation") {
    return CONSULTATION_FORMAT_INSTRUCTIONS;
  }

  return `## Required Response Format

You MUST respond in EXACTLY this format. No other format is accepted.

DECISION: EXECUTE | DECOMPOSE

**If EXECUTE** (you can handle this task directly):
RESULT:
[Your complete result content here]

SUMMARY:
[2-5 sentences summarizing what you accomplished]

CONFIDENCE: 0.XX

**If DECOMPOSE** (task needs to be broken into sub-tasks):
PLAN:
- Sub-task 1: [title] — [description] — [tier: ${nextTier}]
- Sub-task 2: [title] — [description] — [tier: ${nextTier}]

Choose EXECUTE when: The task is specific, actionable, and within your direct capabilities.
Choose DECOMPOSE when: The task requires multiple parallel efforts, specialized expertise, or would exceed your context window.`;
}

const SYNTHESIS_FORMAT_INSTRUCTIONS = `## Required Response Format for Synthesis

DECISION: EXECUTE

RESULT:
[Your synthesized result combining all sub-task outputs]

SUMMARY:
[2-5 sentences describing the synthesized outcome]

CONFIDENCE: 0.XX`;

const CONSULTATION_FORMAT_INSTRUCTIONS = `## Required Response Format for Consultation

Provide your best advice on the consultation question.

RESULT:
[Your advice and recommendations]

SUMMARY:
[2-3 sentences summarizing your key recommendation]

CONFIDENCE: 0.XX`;

function tierDescription(tier: 1 | 2 | 3): string {
  switch (tier) {
    case 1: return "Strategic";
    case 2: return "Management";
    case 3: return "Worker";
  }
}
