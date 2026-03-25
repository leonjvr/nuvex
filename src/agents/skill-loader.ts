// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8: SkillLoader
 *
 * Parses skill.md files into SkillDefinition objects.
 *
 * skill.md format:
 *   - YAML frontmatter (between --- markers) defines metadata + behavior config
 *   - Markdown body becomes the system_prompt field
 *
 * Defaults are applied for missing optional fields (review_behavior,
 * delegation_style, output_format, constraints, tools).
 */

import { readFile, stat } from "node:fs/promises";
import { existsSync, statSync, readFileSync } from "node:fs";
import { sha256hex } from "../core/crypto-utils.js";
import { parse as parseYaml } from "yaml";
import { createLogger } from "../core/logger.js";

const logger = createLogger("skill-loader");
import type {
  SkillDefinition,
  ReviewBehavior,
  DelegationStyle,
  AgentValidationResult,
  EnrichedSkillDefinition,
  DeepKnowledgeEntry,
  SkillHealthReport,
  SkillCompactionRules,
  SkillCompactionResult,
} from "./types.js";


const DEFAULT_REVIEW_BEHAVIOR: ReviewBehavior = {
  strategy: "summary_then_selective",
  confidence_threshold: 0.8,
  max_full_reviews_per_synthesis: 3,
};

const DEFAULT_DELEGATION_STYLE: DelegationStyle = {
  max_sub_tasks: 10,
  prefer_parallel: true,
  require_plan_approval: false,
};


interface RawFrontmatter {
  agent_id?: unknown;
  role?: unknown;
  tier?: unknown;
  review_behavior?: {
    strategy?: unknown;
    confidence_threshold?: unknown;
    max_full_reviews_per_synthesis?: unknown;
  };
  delegation_style?: {
    max_sub_tasks?: unknown;
    prefer_parallel?: unknown;
    require_plan_approval?: unknown;
  };
  output_format?: unknown;
  constraints?: unknown;
  tools?: unknown;
}


/** Minimal Qdrant client interface for deep knowledge queries. */
export interface QdrantClient {
  /** Search a collection by vector similarity. */
  search(
    collection: string,
    query: { vector: number[]; limit: number },
  ): Promise<
    Array<{
      id: string;
      score: number;
      payload: Record<string, unknown>;
    }>
  >;
  /** Upsert vectors into a collection. */
  upsert(
    collection: string,
    points: Array<{
      id: string;
      vector: number[];
      payload: Record<string, unknown>;
    }>,
  ): Promise<void>;
}


export class SkillLoader {
  constructor(
    /** Optional Qdrant client. When absent, gracefully falls back (no deep knowledge). */
    private readonly qdrantClient?: QdrantClient,
  ) {}

  /**
   * Load and parse a skill.md file from disk.
   * Applies defaults for optional fields.
   *
   * @throws Error if the file does not exist or required fields are missing.
   */
  async load(skillPath: string): Promise<SkillDefinition> {
    if (!existsSync(skillPath)) {
      throw new Error(`Skill file not found: ${skillPath}`);
    }

    const raw = await readFile(skillPath, "utf-8");
    return this.parse(raw, skillPath);
  }

  /**
   * Parse skill.md content (useful for testing without file I/O).
   */
  parse(content: string, sourcePath = "<inline>"): SkillDefinition {
    const { frontmatter, body } = splitFrontmatter(content, sourcePath);
    const skill = buildSkillDefinition(frontmatter, body, sourcePath);
    return skill;
  }

  /**
   * Validate a SkillDefinition for required fields and valid values.
   */
  validate(skill: SkillDefinition): AgentValidationResult {
    const errors: string[] = [];

    if (!skill.agent_id || skill.agent_id.trim() === "") {
      errors.push("agent_id is required");
    }
    if (!skill.role || skill.role.trim() === "") {
      errors.push("role is required");
    }
    if (!skill.system_prompt || skill.system_prompt.trim() === "") {
      errors.push("system_prompt (skill.md body) is required");
    }

    const validStrategies = ["summary_only", "summary_then_selective", "always_full"];
    if (!validStrategies.includes(skill.review_behavior.strategy)) {
      errors.push(`review_behavior.strategy must be one of: ${validStrategies.join(", ")}`);
    }

    const ct = skill.review_behavior.confidence_threshold;
    if (ct < 0 || ct > 1) {
      errors.push("review_behavior.confidence_threshold must be between 0.0 and 1.0");
    }

    if (skill.delegation_style.max_sub_tasks < 1 || skill.delegation_style.max_sub_tasks > 20) {
      errors.push("delegation_style.max_sub_tasks must be between 1 and 20");
    }

    return { valid: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------------
  // Deep Knowledge Integration
  // ---------------------------------------------------------------------------

  /**
   * Load skill with deep knowledge context from Qdrant.
   * Compact skill.md = always loaded (operational context).
   * Qdrant = queried on-demand for task-relevant deep knowledge.
   * If Qdrant is unavailable → graceful fallback (empty deep_knowledge).
   */
  async loadWithContext(
    skillPath: string,
    taskContext?: string,
    maxDeepKnowledgeTokens = 500,
  ): Promise<EnrichedSkillDefinition> {
    const skill = await this.load(skillPath);

    let deepKnowledge: DeepKnowledgeEntry[] = [];

    if (taskContext !== undefined && taskContext.trim().length > 0 && this.qdrantClient !== undefined) {
      try {
        // V1: placeholder vector (full embedding requires EmbeddingProvider in V1.1)
        const placeholderVector = new Array<number>(1536).fill(0);
        const collection = `skill_knowledge_${skill.agent_id}`;
        const limit = Math.max(1, Math.floor(maxDeepKnowledgeTokens / 100));

        const results = await this.qdrantClient.search(collection, {
          vector: placeholderVector,
          limit,
        });

        deepKnowledge = results
          .filter((r) => typeof r.payload["content"] === "string")
          .map((r) => ({
            id: r.id,
            content: r.payload["content"] as string,
            relevance_score: r.score,
            source: "qdrant" as const,
            content_type: (r.payload["content_type"] as string | undefined) ?? "unknown",
            created_at: (r.payload["created_at"] as string | undefined) ?? new Date().toISOString(),
          }));
      } catch (e: unknown) {
        logger.warn("skill-loader", "Qdrant unavailable — deep knowledge section will be empty", { metadata: { error: e instanceof Error ? e.message : String(e) } });
        deepKnowledge = [];
      }
    }

    const deepKnowledgeTokens = deepKnowledge.reduce(
      (sum, e) => sum + Math.ceil(e.content.length / 4),
      0,
    );

    return {
      ...skill,
      deep_knowledge: deepKnowledge,
      deep_knowledge_tokens: deepKnowledgeTokens,
    };
  }

  /**
   * Check skill.md health (size, freshness, section classification).
   */
  getSkillHealth(skillPath: string): SkillHealthReport {
    if (!existsSync(skillPath)) {
      return {
        skill_path: skillPath,
        size_kb: 0,
        status: "critical",
        last_modified: new Date().toISOString(),
        sections: [],
        recommendations: [],
      };
    }

    let sizeKb = 0;
    let lastModified = new Date().toISOString();

    try {
      const s = statSync(skillPath);
      sizeKb = s.size / 1024;
      lastModified = new Date(s.mtimeMs).toISOString();
    } catch (e: unknown) {
      logger.debug("skill-loader", "Skill file stat failed — skipping file", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    }

    const status: SkillHealthReport["status"] =
      sizeKb >= 12 ? "critical" : sizeKb >= 6 ? "warning" : "healthy";

    // Parse sections from file (sync read since it's a small file)
    const sections: SkillHealthReport["sections"] = [];
    const recommendations: SkillHealthReport["recommendations"] = [];

    try {
      const content = readFileSync(skillPath, "utf-8");
      const headerMatches = [...content.matchAll(/^## (.+)$/gm)];

      for (const match of headerMatches) {
        const sectionName = match[1]!;
        const lower = sectionName.toLowerCase();

        let category: "operational" | "reference" | "archive_candidate";
        if (lower.includes("role") || lower.includes("constraint") || lower.includes("tool")) {
          category = "operational";
        } else if (lower.includes("history") || lower.includes("training") || lower.includes("pattern")) {
          category = "archive_candidate";
        } else {
          category = "reference";
        }

        sections.push({ name: sectionName, size_kb: 0.5, category });

        if (category === "archive_candidate" && sizeKb > 6) {
          recommendations.push({
            section: sectionName,
            action: "migrate_to_qdrant",
            reason: `Section "${sectionName}" is an archive candidate and skill.md is over warn threshold`,
          });
        }
      }
    } catch (e: unknown) {
      logger.warn("skill-loader", "Skill file parse failed — skipping skill", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    }

    return { skill_path: skillPath, size_kb: sizeKb, status, last_modified: lastModified, sections, recommendations };
  }

  /**
   * Migrate stable content from skill.md to Qdrant.
   * Returns updated skill.md content (compact) and migrated entries.
   * V1: if Qdrant unavailable, returns result with 0 migrated entries.
   */
  async compactSkill(
    skillPath: string,
    rules: SkillCompactionRules,
  ): Promise<SkillCompactionResult> {
    const content = await readFile(skillPath, "utf-8");
    const fileStats = await stat(skillPath);
    const beforeKb = fileStats.size / 1024;

    // Parse sections
    const sections = parseSections(content);
    const keptSections: string[] = [];
    const migratedEntries: SkillCompactionResult["migrated_entries"] = [];

    for (const section of sections) {
      const sectionLower = section.name.toLowerCase();

      // Always keep explicitly listed sections
      const forceKeep = rules.keep_sections.some((k) => sectionLower.includes(k.toLowerCase()));
      if (forceKeep) {
        keptSections.push(section.raw);
        continue;
      }

      // Migrate if category matches migrate_categories
      const shouldMigrate = rules.migrate_categories.some(
        (cat) => sectionLower.includes(cat.toLowerCase()),
      );

      if (shouldMigrate && this.qdrantClient !== undefined) {
        try {
          const id = `skill-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const contentHash = sha256hex(section.content);

          // V1: placeholder embedding vector
          await this.qdrantClient.upsert(`skill_knowledge_unknown`, [
            {
              id,
              vector: new Array<number>(1536).fill(0),
              payload: {
                content: section.content,
                section_name: section.name,
                content_type: "reference",
                content_hash: contentHash,
                created_at: new Date().toISOString(),
              },
            },
          ]);

          migratedEntries.push({
            section_name: section.name,
            qdrant_id: id,
            content_hash: contentHash,
          });
        } catch (e: unknown) {
          logger.warn("skill-loader", "Qdrant unavailable — keeping full skill section", { metadata: { error: e instanceof Error ? e.message : String(e) } });
          keptSections.push(section.raw);
        }
      } else {
        keptSections.push(section.raw);
      }
    }

    // Build new skill.md content from kept sections
    const newContent = keptSections.join("\n\n");
    const afterKb = Buffer.byteLength(newContent, "utf-8") / 1024;

    return {
      before_size_kb: beforeKb,
      after_size_kb: afterKb,
      migrated_sections: migratedEntries.length,
      migrated_entries: migratedEntries,
      new_skill_content: newContent,
    };
  }
}


/**
 * Split skill.md content into YAML frontmatter and Markdown body.
 * Frontmatter is between the first and second `---` markers.
 */
function splitFrontmatter(
  content: string,
  sourcePath: string,
): { frontmatter: RawFrontmatter; body: string } {
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") {
    throw new Error(`${sourcePath}: skill.md must start with --- (YAML frontmatter)`);
  }

  // Find closing ---
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closingIdx = i;
      break;
    }
  }

  if (closingIdx === -1) {
    throw new Error(`${sourcePath}: skill.md frontmatter is not closed with ---`);
  }

  const yamlText = lines.slice(1, closingIdx).join("\n");
  const bodyText = lines.slice(closingIdx + 1).join("\n").trim();

  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err) {
    throw new Error(`${sourcePath}: invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${sourcePath}: frontmatter must be a YAML object`);
  }

  return { frontmatter: parsed as RawFrontmatter, body: bodyText };
}

/**
 * Build SkillDefinition from raw frontmatter + body, applying defaults.
 */
function buildSkillDefinition(
  fm: RawFrontmatter,
  body: string,
  sourcePath: string,
): SkillDefinition {
  if (typeof fm.agent_id !== "string" || fm.agent_id.trim() === "") {
    throw new Error(`${sourcePath}: frontmatter.agent_id is required (string)`);
  }
  if (typeof fm.role !== "string" || fm.role.trim() === "") {
    throw new Error(`${sourcePath}: frontmatter.role is required (string)`);
  }

  const review_behavior: ReviewBehavior = {
    strategy:
      isValidStrategy(fm.review_behavior?.strategy)
        ? (fm.review_behavior!.strategy as ReviewBehavior["strategy"])
        : DEFAULT_REVIEW_BEHAVIOR.strategy,
    confidence_threshold:
      typeof fm.review_behavior?.confidence_threshold === "number"
        ? fm.review_behavior.confidence_threshold
        : DEFAULT_REVIEW_BEHAVIOR.confidence_threshold,
    max_full_reviews_per_synthesis:
      typeof fm.review_behavior?.max_full_reviews_per_synthesis === "number"
        ? fm.review_behavior.max_full_reviews_per_synthesis
        : DEFAULT_REVIEW_BEHAVIOR.max_full_reviews_per_synthesis,
  };

  const delegation_style: DelegationStyle = {
    max_sub_tasks:
      typeof fm.delegation_style?.max_sub_tasks === "number"
        ? fm.delegation_style.max_sub_tasks
        : DEFAULT_DELEGATION_STYLE.max_sub_tasks,
    prefer_parallel:
      typeof fm.delegation_style?.prefer_parallel === "boolean"
        ? fm.delegation_style.prefer_parallel
        : DEFAULT_DELEGATION_STYLE.prefer_parallel,
    require_plan_approval:
      typeof fm.delegation_style?.require_plan_approval === "boolean"
        ? fm.delegation_style.require_plan_approval
        : DEFAULT_DELEGATION_STYLE.require_plan_approval,
  };

  return {
    agent_id: fm.agent_id.trim(),
    role: fm.role.trim(),
    system_prompt: body,
    review_behavior,
    delegation_style,
    output_format:
      typeof fm.output_format === "string" ? fm.output_format : "markdown",
    constraints:
      Array.isArray(fm.constraints)
        ? fm.constraints.filter((c): c is string => typeof c === "string")
        : [],
    tools:
      Array.isArray(fm.tools)
        ? fm.tools.filter((t): t is string => typeof t === "string")
        : [],
  };
}

function isValidStrategy(s: unknown): s is ReviewBehavior["strategy"] {
  return s === "summary_only" || s === "summary_then_selective" || s === "always_full";
}


interface SkillSection {
  name: string;
  content: string;
  raw: string;
}

/**
 * Parse skill.md content into sections delimited by ## headers.
 * The frontmatter (--- ... ---) is always preserved as the first section.
 */
function parseSections(content: string): SkillSection[] {
  const sections: SkillSection[] = [];
  const lines = content.split("\n");

  // Extract frontmatter block first
  if (lines[0]?.trim() === "---") {
    let closingIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        closingIdx = i;
        break;
      }
    }
    if (closingIdx !== -1) {
      const frontmatter = lines.slice(0, closingIdx + 1).join("\n");
      sections.push({ name: "frontmatter", content: frontmatter, raw: frontmatter });
      lines.splice(0, closingIdx + 1);
    }
  }

  // Parse ## sections from remaining content
  let current: { name: string; lines: string[] } | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^## (.+)$/);
    if (headerMatch) {
      if (current !== null) {
        const raw = `## ${current.name}\n${current.lines.join("\n")}`;
        sections.push({ name: current.name, content: current.lines.join("\n").trim(), raw });
      }
      current = { name: headerMatch[1]!, lines: [] };
    } else if (current !== null) {
      current.lines.push(line);
    }
  }

  if (current !== null) {
    const raw = `## ${current.name}\n${current.lines.join("\n")}`;
    sections.push({ name: current.name, content: current.lines.join("\n").trim(), raw });
  }

  return sections;
}
