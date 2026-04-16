// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — OpenClaw Skill Converter
 *
 * Converts OpenClaw SKILL.md files to SIDJUA skill format and identifies
 * which skills need a SIDJUA module (discord, slack, etc.) instead.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync }                 from "node:fs";
import { join, basename }             from "node:path";
import type { SkillConvertResult }    from "./openclaw-types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("openclaw-skill-converter");


/**
 * OpenClaw skill names that map to a SIDJUA installable module.
 * Keys are lowercase; value is the SIDJUA module ID.
 */
const MODULE_SKILL_MAP: Record<string, string> = {
  discord:          "discord",
  "discord-bot":    "discord",
  slack:            "slack",
  "slack-bot":      "slack",
  github:           "github",
  "github-actions": "github",
  notion:           "notion",
  telegram:         "telegram",
  trello:           "trello",
  linear:           "linear",
  jira:             "jira",
  confluence:       "confluence",
};


const PORTABLE_SKILLS = new Set([
  "weather", "summarize", "summariser", "summarizer",
  "coding-agent", "code-agent", "coding", "coder",
  "healthcheck", "health-check", "health",
  "search", "web-search", "browser",
  "calculator", "math",
  "translator", "translate",
  "calendar", "schedule",
  "email-draft", "email",
  "research", "researcher",
  "qa", "quality-assurance",
  "data-analysis", "analyst",
  "writer", "copywriter",
  "customer-support", "support",
]);


interface ParsedSkill {
  frontmatter: Record<string, unknown>;
  body:        string;
}

function parseSkillMd(content: string): ParsedSkill {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }
  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }
  const yamlSection = content.slice(4, endIdx);
  const body        = content.slice(endIdx + 4).trimStart();

  // Minimal YAML key:value parser (single-level, no nesting needed)
  const frontmatter: Record<string, unknown> = {};
  for (const line of yamlSection.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    frontmatter[key] = val;
  }

  return { frontmatter, body };
}


/**
 * Return the SIDJUA module ID if the skill requires it, otherwise undefined.
 */
export function identifyModuleRequired(skillName: string): string | undefined {
  const lower = skillName.toLowerCase().trim();
  return MODULE_SKILL_MAP[lower];
}

/**
 * Return true if the skill is a known portable skill.
 */
export function isPortableSkill(skillName: string): boolean {
  const lower = skillName.toLowerCase().trim();
  // Check exact match or common prefix
  for (const known of PORTABLE_SKILLS) {
    if (lower === known || lower.startsWith(known + "-") || lower.endsWith("-" + known)) {
      return true;
    }
  }
  return false;
}


/**
 * Convert an OpenClaw SKILL.md to a SIDJUA skill.md.
 *
 * Steps:
 *   1. Read file
 *   2. Parse YAML frontmatter
 *   3. Strip OpenClaw-specific metadata (metadata.openclaw.*)
 *   4. Keep name, description, all Markdown content
 *   5. Write as SIDJUA skill.md
 *
 * @param skillPath  Absolute path to the OpenClaw SKILL.md
 * @param destDir    Directory to write converted skill into
 * @param skillName  Logical name of the skill (used for filename + frontmatter)
 */
export async function convertSkillFile(
  skillPath: string,
  destDir:   string,
  skillName: string,
): Promise<string> {
  const raw = await readFile(skillPath, "utf-8");
  const { frontmatter, body } = parseSkillMd(raw);

  // Remove OpenClaw-specific metadata keys
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(frontmatter)) {
    if (k === "metadata" && typeof v === "object" && v !== null && "openclaw" in v) {
      // Drop openclaw metadata; keep any other sub-keys
      const rest = { ...(v as Record<string, unknown>) };
      delete rest["openclaw"];
      if (Object.keys(rest).length > 0) cleaned[k] = rest;
    } else {
      cleaned[k] = v;
    }
  }

  // Build SIDJUA frontmatter (minimal, compatible with SkillLoader v2)
  const lines: string[] = ["---"];
  const name = (typeof frontmatter["name"] === "string" ? frontmatter["name"] : skillName);
  lines.push(`name: "${name}"`);
  if (typeof frontmatter["description"] === "string") {
    lines.push(`description: "${frontmatter["description"]}"`);
  }
  lines.push(`imported_from: "openclaw"`);
  lines.push("---");
  lines.push("");

  const sidjuaContent = lines.join("\n") + (body || `# ${name}\n\nImported from OpenClaw.\n`);

  await mkdir(destDir, { recursive: true });
  const destFile = join(destDir, `${skillName.toLowerCase().replace(/\s+/g, "-")}.skill.md`);
  await writeFile(destFile, sidjuaContent, "utf-8");
  return destFile;
}


/**
 * Scan the OpenClaw skills directory and classify each entry.
 *
 * @param skillsDir  Absolute path to the OpenClaw skills directory
 * @param destDir    Directory to write converted skill files
 * @param dryRun     If true, classify only — do not write files
 */
export async function convertSkills(
  skillsDir: string,
  destDir:   string,
  dryRun:    boolean,
): Promise<SkillConvertResult[]> {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const { readdir } = await import("node:fs/promises");
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch (e: unknown) {
    logger.debug("openclaw-skill-converter", "Skills directory not found — skipping skill discovery", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    return [];
  }

  const results: SkillConvertResult[] = [];

  for (const entry of entries) {
    const skillName = entry.toLowerCase();

    // Check if this skill needs a module
    const moduleId = identifyModuleRequired(skillName);
    if (moduleId) {
      results.push({
        name:        entry,
        disposition: "module_required",
        moduleId,
        reason:      `Use: sidjua module install ${moduleId}`,
      });
      continue;
    }

    // Look for SKILL.md
    const skillMdPath = join(skillsDir, entry, "SKILL.md");
    const skillMdPathAlt = join(skillsDir, entry, "skill.md");
    const mdPath = existsSync(skillMdPath)    ? skillMdPath :
                   existsSync(skillMdPathAlt) ? skillMdPathAlt : null;

    if (!mdPath) {
      results.push({
        name:        entry,
        disposition: "skipped",
        reason:      "No SKILL.md found in skill directory",
      });
      continue;
    }

    if (!dryRun) {
      try {
        const destPath = await convertSkillFile(mdPath, destDir, entry);
        results.push({ name: entry, disposition: "imported", destPath });
      } catch (err) {
        results.push({ name: entry, disposition: "skipped", reason: String(err) });
      }
    } else {
      results.push({ name: entry, disposition: "imported" });
    }
  }

  return results;
}

/**
 * Convert a map of skill entries from the OpenClaw config (config.skills.entries)
 * where we don't have actual skill files — just names.
 */
export function classifyConfigSkills(
  entries: Record<string, unknown>,
): SkillConvertResult[] {
  return Object.keys(entries).map((name) => {
    const moduleId = identifyModuleRequired(name);
    if (moduleId) {
      return {
        name,
        disposition: "module_required" as const,
        moduleId,
        reason: `Use: sidjua module install ${moduleId}`,
      };
    }
    return {
      name,
      disposition: "skipped" as const,
      reason: "No skill file available — referenced only in config",
    };
  });
}
