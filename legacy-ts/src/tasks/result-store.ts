// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 7: ResultStore
 *
 * File-based task results. Each result lives at:
 *   <basePath>/<division>/results/<task-id>/result.md
 *
 * File format:
 *   ---
 *   task_id: "..."
 *   ...YAML frontmatter...
 *   ---
 *
 *   ## Markdown body
 *
 * YAML parsed using the existing `yaml` package.
 */

import { promises as fs } from "node:fs";
import { join, dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ResultFrontmatter } from "./types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("result-store");

export class ResultStore {
  /** basePath: the workspace root — results go to <basePath>/divisions/<div>/results/<id>/ */
  constructor(private readonly basePath: string) {}

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Write a result file. Creates directories as needed.
   * Returns the full path to the created file.
   */
  async writeResult(
    taskId: string,
    division: string,
    frontmatter: ResultFrontmatter,
    content: string,
  ): Promise<string> {
    const filePath = this.resultPath(taskId, division);
    await fs.mkdir(dirname(filePath), { recursive: true });

    const yamlBlock = stringifyYaml(frontmatter).trimEnd();
    const fileContent = `---\n${yamlBlock}\n---\n\n${content}`;
    await fs.writeFile(filePath, fileContent, "utf8");
    return filePath;
  }

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  /**
   * Read a result file. Returns null if the file does not exist.
   */
  async readResult(
    taskId: string,
    division: string,
  ): Promise<{ frontmatter: ResultFrontmatter; content: string } | null> {
    const filePath = this.resultPath(taskId, division);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (e: unknown) {
      logger.debug("result-store", "Result file not found — returning null", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return null;
    }
    return this.parseResultFile(raw);
  }

  /**
   * Read only the YAML frontmatter (faster — same parse cost but convenient API).
   * Returns null if the file does not exist.
   */
  async readFrontmatter(
    taskId: string,
    division: string,
  ): Promise<ResultFrontmatter | null> {
    const result = await this.readResult(taskId, division);
    return result !== null ? result.frontmatter : null;
  }

  // ---------------------------------------------------------------------------
  // List / Delete
  // ---------------------------------------------------------------------------

  /**
   * List all task IDs that have a result file for the given division.
   */
  async listResults(division: string): Promise<string[]> {
    const dir = this.divisionResultsDir(division);
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const ids: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Verify the result.md actually exists
          const resultFile = join(dir, entry.name, "result.md");
          try {
            await fs.access(resultFile);
            ids.push(entry.name);
          } catch (e: unknown) {
            logger.debug("result-store", "Result entry has no result.md — skipping", { metadata: { error: e instanceof Error ? e.message : String(e) } });
          }
        }
      }
      return ids;
    } catch (e: unknown) {
      logger.debug("result-store", "Results directory not found — returning empty list", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return [];
    }
  }

  /**
   * Delete the result directory for a task (used for cancelled tasks).
   */
  async deleteResult(taskId: string, division: string): Promise<void> {
    const dir = this.resultDir(taskId, division);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (e: unknown) {
      logger.debug("result-store", "Result directory not found — nothing to delete", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resultPath(taskId: string, division: string): string {
    return join(this.basePath, "divisions", division, "results", taskId, "result.md");
  }

  private resultDir(taskId: string, division: string): string {
    return join(this.basePath, "divisions", division, "results", taskId);
  }

  private divisionResultsDir(division: string): string {
    return join(this.basePath, "divisions", division, "results");
  }

  private parseResultFile(raw: string): { frontmatter: ResultFrontmatter; content: string } {
    // Split on --- markers
    const parts = raw.split(/^---\s*$/m);
    // parts[0] is empty (before first ---), parts[1] is YAML, parts[2]+ is body
    if (parts.length < 3) {
      throw new Error("Invalid result file: missing YAML frontmatter delimiters");
    }
    const yamlPart = parts[1] ?? "";
    const bodyParts = parts.slice(2);
    const body = bodyParts.join("---\n").trimStart();

    const frontmatter = parseYaml(yamlPart) as ResultFrontmatter;
    return { frontmatter, content: body };
  }
}
