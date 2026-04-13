// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: SkillValidator
 *
 * Validates Phase 10.5 skill.md files (pure Markdown, no frontmatter).
 * Required sections: Identity, Decision Authority, Quality Standards,
 * Supervision Expectations.
 * Recommended: Work Style, Error Handling, Communication Style.
 * Max size: 50KB.
 * Variable placeholders: {agent_name}, {organization}, {reports_to}.
 */

import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { SkillValidationResult, SkillSection } from "./types.js";


const REQUIRED_SECTIONS = [
  "Identity",
  "Decision Authority",
  "Quality Standards",
  "Supervision Expectations",
] as const;

const RECOMMENDED_SECTIONS = [
  "Work Style",
  "Error Handling",
  "Communication Style",
] as const;

const REQUIRED_VARIABLES = ["{agent_name}", "{organization}", "{reports_to}"] as const;

const MAX_SIZE_BYTES = 50 * 1024; // 50KB

// Decision Authority must have these subsections/keywords
const DECISION_AUTHORITY_REQUIRED = ["MAY", "MAY NOT", "ESCALATE"] as const;


/**
 * Validates skill.md files for Phase 10.5 agent definitions.
 * Handles both the new pure-Markdown format and the old frontmatter format.
 */
export class SkillValidator {
  /**
   * Validate a skill.md file at the given path.
   * @throws Never — returns validation errors instead.
   */
  async validateFile(skillPath: string): Promise<SkillValidationResult> {
    if (!existsSync(skillPath)) {
      return {
        valid: false,
        errors: [`Skill file not found: ${skillPath}`],
        warnings: [],
        sections_found: [],
        size_bytes: 0,
        has_variables: { agent_name: false, organization: false, reports_to: false },
      };
    }

    let content = "";
    let sizeBytes = 0;

    try {
      const [text, stats] = await Promise.all([
        readFile(skillPath, "utf-8"),
        stat(skillPath),
      ]);
      content = text;
      sizeBytes = stats.size;
    } catch (err) {
      return {
        valid: false,
        errors: [
          `Cannot read skill file: ${err instanceof Error ? err.message : String(err)}`,
        ],
        warnings: [],
        sections_found: [],
        size_bytes: 0,
        has_variables: { agent_name: false, organization: false, reports_to: false },
      };
    }

    return this.validate(content, sizeBytes);
  }

  /**
   * Validate skill.md content (for testing without file I/O).
   */
  validate(content: string, sizeBytes?: number): SkillValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const actualSize = sizeBytes ?? Buffer.byteLength(content, "utf-8");

    // 1. Size check
    if (actualSize > MAX_SIZE_BYTES) {
      errors.push(
        `Skill file exceeds 50KB limit (${(actualSize / 1024).toFixed(1)}KB). Use knowledge base for large content.`,
      );
    }

    // 2. Format check — must be plain Markdown (YAML frontmatter not allowed)
    if (content.trimStart().startsWith("---")) {
      warnings.push(
        "Skill file appears to use YAML frontmatter. Phase 10.5 skill files should be pure Markdown (no frontmatter). File will be parsed as legacy format.",
      );
    }

    // 3. Parse sections
    const sections = parseSections(content);
    const sectionNames = sections.map((s) => s.name);

    // 4. Required section checks
    for (const required of REQUIRED_SECTIONS) {
      if (!sectionNames.includes(required)) {
        errors.push(`Missing required section: "## ${required}"`);
      }
    }

    // 5. Recommended section checks
    for (const recommended of RECOMMENDED_SECTIONS) {
      if (!sectionNames.includes(recommended)) {
        warnings.push(`Missing recommended section: "## ${recommended}"`);
      }
    }

    // 6. Identity section must reference variables
    const identitySection = sections.find((s) => s.name === "Identity");
    const hasAgentName = content.includes("{agent_name}");
    const hasOrganization = content.includes("{organization}");
    const hasReportsTo = content.includes("{reports_to}");

    if (identitySection !== undefined) {
      if (!hasAgentName) {
        warnings.push(
          'Identity section should reference {agent_name} for runtime variable injection.',
        );
      }
      if (!hasOrganization) {
        warnings.push(
          'Identity section should reference {organization} for runtime variable injection.',
        );
      }
    }

    // 7. Decision Authority must have MAY / MAY NOT / ESCALATE
    const decisionSection = sections.find((s) => s.name === "Decision Authority");
    if (decisionSection !== undefined) {
      for (const keyword of DECISION_AUTHORITY_REQUIRED) {
        if (!decisionSection.content.includes(keyword)) {
          errors.push(
            `Decision Authority section must include "${keyword}" subsection or keyword.`,
          );
        }
      }
    }

    // 8. Supervision Expectations must mention result file and management summary
    const supervisionSection = sections.find((s) => s.name === "Supervision Expectations");
    if (supervisionSection !== undefined) {
      const lower = supervisionSection.content.toLowerCase();
      if (!lower.includes("result") && !lower.includes("summary")) {
        warnings.push(
          'Supervision Expectations should define result file content and management summary format.',
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sections_found: sectionNames,
      size_bytes: actualSize,
      has_variables: {
        agent_name: hasAgentName,
        organization: hasOrganization,
        reports_to: hasReportsTo,
      },
    };
  }
}


/**
 * Parse ## sections from Markdown content.
 * Returns sections in document order, skipping the title (# heading).
 */
export function parseSections(content: string): SkillSection[] {
  const sections: SkillSection[] = [];
  const lines = content.split("\n");

  let current: { name: string; lines: string[] } | null = null;

  for (const line of lines) {
    // Match ## Section Name (not # or ###)
    const headerMatch = line.match(/^## (.+)$/);
    if (headerMatch) {
      if (current !== null) {
        sections.push({
          name: current.name,
          content: current.lines.join("\n").trim(),
        });
      }
      current = { name: headerMatch[1]!.trim(), lines: [] };
    } else if (current !== null) {
      current.lines.push(line);
    }
  }

  if (current !== null) {
    sections.push({
      name: current.name,
      content: current.lines.join("\n").trim(),
    });
  }

  return sections;
}

/**
 * Inject runtime variables into skill.md content.
 * Replaces {agent_name}, {organization}, {reports_to} with actual values.
 */
export function injectVariables(
  content: string,
  vars: { agent_name: string; organization: string; reports_to: string },
): string {
  return content
    .replaceAll("{agent_name}", vars.agent_name)
    .replaceAll("{organization}", vars.organization)
    .replaceAll("{reports_to}", vars.reports_to);
}
