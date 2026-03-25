// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: SkillLoaderV2
 *
 * Extended SkillLoader that handles Phase 10.5 pure-Markdown skill files.
 * Backwards compatible: if skill.md has YAML frontmatter (--- ... ---), it
 * delegates to the Phase 8 SkillLoader.
 *
 * New capability:
 *   - Resolves {agent_name}, {organization}, {reports_to} variables
 *   - Builds system prompt from governance + skill + (optional) knowledge context
 *   - Validates with SkillValidator before loading
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { SkillLoader } from "../agents/skill-loader.js";
import type { QdrantClient } from "../agents/skill-loader.js";
import type { SkillDefinition, EnrichedSkillDefinition } from "../agents/types.js";
import { SkillValidator, injectVariables } from "./skill-validator.js";
import type { SkillValidationResult } from "./types.js";


export interface SkillLoaderV2Options {
  /** Qdrant client for deep knowledge (optional). */
  qdrantClient?: QdrantClient;
  /** Organization name for variable injection. */
  organization?: string;
}

export interface ResolvedSkill {
  /** The Phase 8 SkillDefinition (for backwards compat with AgentLoop). */
  definition: SkillDefinition;
  /** Full resolved system prompt with variables injected. */
  system_prompt: string;
  /** Whether the new (non-frontmatter) format was used. */
  format: "v1_frontmatter" | "v2_markdown";
  /** Validation result from SkillValidator. */
  validation: SkillValidationResult;
}

export class SkillLoaderV2 {
  private readonly v1Loader: SkillLoader;
  private readonly skillValidator: SkillValidator;

  constructor(private readonly options: SkillLoaderV2Options = {}) {
    this.v1Loader = new SkillLoader(options.qdrantClient);
    this.skillValidator = new SkillValidator();
  }

  /**
   * Load a skill file. Auto-detects format (v1 frontmatter vs v2 markdown).
   */
  async load(
    skillPath: string,
    context: {
      agentId: string;
      agentName: string;
      reportsTo?: string;
    },
  ): Promise<ResolvedSkill> {
    if (!existsSync(skillPath)) {
      throw new Error(`Skill file not found: ${skillPath}`);
    }

    const content = await readFile(skillPath, "utf-8");
    const format = detectFormat(content);

    if (format === "v1_frontmatter") {
      return this.loadV1(skillPath, content, context);
    }

    return this.loadV2(skillPath, content, context);
  }

  /**
   * Load and enrich with deep knowledge context (task-specific).
   */
  async loadWithContext(
    skillPath: string,
    context: {
      agentId: string;
      agentName: string;
      reportsTo?: string;
      taskContext?: string;
    },
    maxDeepKnowledgeTokens = 500,
  ): Promise<EnrichedSkillDefinition & { format: "v1_frontmatter" | "v2_markdown" }> {
    const format = await this.detectFormatFromFile(skillPath);

    if (format === "v1_frontmatter") {
      const enriched = await this.v1Loader.loadWithContext(
        skillPath,
        context.taskContext,
        maxDeepKnowledgeTokens,
      );
      return { ...enriched, format };
    }

    // V2: load, inject variables, return as enriched skill
    const resolved = await this.load(skillPath, context);
    return {
      ...resolved.definition,
      system_prompt: resolved.system_prompt,
      deep_knowledge: [],
      deep_knowledge_tokens: 0,
      format,
    };
  }

  /**
   * Validate a skill file without fully loading it.
   */
  async validate(skillPath: string): Promise<SkillValidationResult> {
    return this.skillValidator.validateFile(skillPath);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async loadV1(
    skillPath: string,
    content: string,
    context: { agentId: string; agentName: string; reportsTo?: string },
  ): Promise<ResolvedSkill> {
    const definition = await this.v1Loader.load(skillPath);
    const validation = this.v1Loader.validate(definition);

    // V1 format: agent_id in frontmatter may differ from context — override if needed
    const resolvedDefinition: SkillDefinition = {
      ...definition,
      agent_id: context.agentId,
    };

    // Inject variables into system_prompt
    const system_prompt = injectVariables(resolvedDefinition.system_prompt, {
      agent_name: context.agentName,
      organization: this.options.organization ?? "the organization",
      reports_to: context.reportsTo ?? "the supervisor",
    });

    const skillValidation: SkillValidationResult = {
      valid: validation.valid,
      errors: validation.errors,
      warnings: [],
      sections_found: [],
      size_bytes: Buffer.byteLength(content, "utf-8"),
      has_variables: {
        agent_name: content.includes("{agent_name}"),
        organization: content.includes("{organization}"),
        reports_to: content.includes("{reports_to}"),
      },
    };

    return {
      definition: resolvedDefinition,
      system_prompt,
      format: "v1_frontmatter",
      validation: skillValidation,
    };
  }

  private async loadV2(
    skillPath: string,
    content: string,
    context: { agentId: string; agentName: string; reportsTo?: string },
  ): Promise<ResolvedSkill> {
    const validation = this.skillValidator.validate(content);

    // Inject variables into the Markdown content
    const resolvedContent = injectVariables(content, {
      agent_name: context.agentName,
      organization: this.options.organization ?? "the organization",
      reports_to: context.reportsTo ?? "the supervisor",
    });

    // Build a Phase 8 compatible SkillDefinition from the Markdown
    const definition: SkillDefinition = {
      agent_id: context.agentId,
      role: extractTitle(content) ?? context.agentName,
      system_prompt: resolvedContent,
      review_behavior: {
        strategy: "summary_then_selective",
        confidence_threshold: 0.8,
        max_full_reviews_per_synthesis: 3,
      },
      delegation_style: {
        max_sub_tasks: 10,
        prefer_parallel: true,
        require_plan_approval: false,
      },
      output_format: "markdown",
      constraints: [],
      tools: [],
    };

    return {
      definition,
      system_prompt: resolvedContent,
      format: "v2_markdown",
      validation,
    };
  }

  private async detectFormatFromFile(
    skillPath: string,
  ): Promise<"v1_frontmatter" | "v2_markdown"> {
    const content = await readFile(skillPath, "utf-8");
    return detectFormat(content);
  }
}


function detectFormat(content: string): "v1_frontmatter" | "v2_markdown" {
  return content.trimStart().startsWith("---") ? "v1_frontmatter" : "v2_markdown";
}

/**
 * Extract the document title (# Heading) from Markdown content.
 */
function extractTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}
