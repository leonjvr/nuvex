// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 14: CommunicationManager
 *
 * Orchestrates the three retrieval paths for inter-agent communication:
 *   Path 1: Semantic Search (Qdrant/SQLite vectors — exploratory)
 *   Path 2: Direct Query (exact, by task_id)
 *   Path 3: Summary Only (hierarchical management view)
 *
 * Auto-embeds outputs on creation. Falls back gracefully when no embedder.
 */

import { createLogger }            from "../core/logger.js";
import { SidjuaError }             from "../core/error-codes.js";
import { TaskOutputStore }         from "./output-store.js";
import { TaskSummaryStore }        from "./summary-store.js";
import { TaskOutputEmbedder }      from "./output-embedder.js";
import { SummaryPolicyValidator }  from "../governance/policies/summary-policy.js";
import type { TaskOutput, CreateOutputInput, OutputType } from "./output-store.js";
import type { TaskSummary, CreateSummaryInput }  from "./summary-store.js";
import type { SearchResult, SearchOptions }       from "./output-embedder.js";

export type { TaskOutput, TaskSummary, SearchResult };

const logger = createLogger("communication");


export class CommunicationManager {
  private readonly validator: SummaryPolicyValidator;

  constructor(
    private readonly outputStore:  TaskOutputStore,
    private readonly summaryStore: TaskSummaryStore,
    private readonly embedder:     TaskOutputEmbedder | null,
    policyOverrides?: import("../governance/policies/summary-policy.js").SummaryPolicy,
  ) {
    this.validator = new SummaryPolicyValidator(policyOverrides);
  }

  // -------------------------------------------------------------------------
  // Store operations
  // -------------------------------------------------------------------------

  /** Store an agent output. Auto-embeds in SQLite vector store if embedder available. */
  async storeOutput(input: CreateOutputInput): Promise<TaskOutput> {
    const output = this.outputStore.create(input);

    if (this.embedder !== null && this.embedder.isAvailable()) {
      // Fire-and-forget embedding — failure is non-fatal
      this.embedder.embedOutput(output).catch((err: unknown) => {
        logger.warn("embed_failed", `Embedding failed for output ${output.id}: ${String(err)}`, {
          metadata: { output_id: output.id },
        });
      });
    }

    return output;
  }

  /** Validate against summary policy and store if valid. */
  async storeSummary(input: CreateSummaryInput): Promise<TaskSummary> {
    const result = this.validator.validate(input);
    if (!result.valid) {
      const first = result.errors[0]!;
      throw SidjuaError.from(first.code, first.message);
    }

    // Warn if output_refs reference non-existent outputs (SUMMARY-004)
    if (input.output_refs && input.output_refs.length > 0) {
      for (const ref of input.output_refs) {
        if (this.outputStore.getById(ref) === null) {
          logger.warn(
            "summary_004_dangling_ref",
            SidjuaError.from("SUMMARY-004", `Output ref ${ref} not found`).message,
            { metadata: { ref } },
          );
        }
      }
    }

    return this.summaryStore.create(input);
  }

  // -------------------------------------------------------------------------
  // Path 1: Semantic Search
  // -------------------------------------------------------------------------

  /**
   * Semantic search across task outputs.
   * Falls back to direct DB text query when no embedder is available.
   */
  async searchOutputs(
    query: string,
    options: SearchOptions & { include_full_content?: boolean } = {},
  ): Promise<(SearchResult & { full_output?: TaskOutput })[]> {
    const { include_full_content, ...searchOpts } = options;

    if (this.embedder !== null && this.embedder.isAvailable()) {
      const results = await this.embedder.search(query, searchOpts);
      if (include_full_content) {
        return results.map((r) => {
          const full = this.outputStore.getById(r.pg_id);
          return full != null ? { ...r, full_output: full } : { ...r };
        });
      }
      return results;
    }

    // Use FTS5-backed searchText() for efficient full-text lookup.
    // Falls back to LIKE-scan automatically on pre-0.9.7 databases without FTS.
    logger.warn(
      "comm_001_search_fallback",
      SidjuaError.from("COMM-001").message,
      { metadata: { query } },
    );

    const limit   = searchOpts.limit ?? 5;
    const outputs = this.outputStore.searchText(query, limit);

    const matched = outputs.map((o) => ({
      pg_id:           o.id,
      task_id:         o.task_id,
      agent_id:        o.agent_id,
      output_type:     o.output_type,
      summary_snippet: o.content_text?.substring(0, 200) ?? o.filename ?? "binary",
      score:           0.5, // nominal fallback score
      classification:  o.classification,
      ...(include_full_content ? { full_output: o } : {}),
    }));

    return matched;
  }

  // -------------------------------------------------------------------------
  // Path 2: Direct Query
  // -------------------------------------------------------------------------

  /** Get all outputs for a task (lossless, exact). */
  getTaskOutputs(taskId: string): TaskOutput[] {
    return this.outputStore.getByTaskId(taskId);
  }

  // -------------------------------------------------------------------------
  // Path 3: Summary Only
  // -------------------------------------------------------------------------

  /** Get the latest governed summary for a task. */
  getTaskSummary(taskId: string): TaskSummary | null {
    return this.summaryStore.getLatestByTaskId(taskId);
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  /** Delete all outputs, summaries, and embeddings for a task. */
  deleteTaskData(taskId: string): void {
    this.outputStore.deleteByTaskId(taskId);
    if (this.embedder !== null) {
      this.embedder.deleteByTaskId(taskId);
    }
    // Delete summaries
    const summaries = this.summaryStore.getByTaskId(taskId);
    for (const s of summaries) {
      this.summaryStore.delete(s.id);
    }
    logger.info("task_data_deleted", `All data deleted for task ${taskId}`, {
      metadata: { task_id: taskId },
    });
  }

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------

  getStats(): {
    total_outputs:             number;
    total_summaries:           number;
    outputs_by_type:           Record<string, number>;
    outputs_by_classification: Record<string, number>;
  } {
    const total_outputs   = this.outputStore.count();
    const total_summaries = this.summaryStore.count();

    const types: Record<string, number> = {};
    const classifs: Record<string, number> = {};

    for (const t of ["file", "report", "analysis", "code", "data", "summary"] as const) {
      const n = this.outputStore.count({ output_type: t });
      if (n > 0) types[t] = n;
    }
    for (const cl of ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "SECRET", "FYEO"]) {
      const n = this.outputStore.count({ classification: cl });
      if (n > 0) classifs[cl] = n;
    }

    return {
      total_outputs,
      total_summaries,
      outputs_by_type:           types,
      outputs_by_classification: classifs,
    };
  }
}
