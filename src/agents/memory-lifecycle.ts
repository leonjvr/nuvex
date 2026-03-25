// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8 Amendment: MemoryLifecycleManager
 *
 * Orchestrates governance-enforced memory hygiene cycles.
 * Separate from MemoryManager to keep concerns clean:
 *   MemoryManager = CRUD + query + health (per-instance operations)
 *   MemoryLifecycleManager = governance-enforced lifecycle (has ActionExecutor)
 *
 * All archive/compact/delete operations are checked against the
 * Pre-Action Pipeline (Stage 5) before execution.
 */

import type { MemoryManager } from "./memory.js";
import type { SkillLoader } from "./skill-loader.js";
import type { ActionExecutor } from "./action-executor.js";
import type {
  MemoryHygieneConfig,
  HygieneCycleResult,
  GovernanceActionLog,
  CompactionResult,
  ArchivalResult,
  DeduplicationResult,
} from "./types.js";


export class MemoryLifecycleManager {
  constructor(
    private readonly memoryManager: MemoryManager,
    /** SkillLoader for skill.md health checks and compaction (optional in V1). */
    private readonly skillLoader: SkillLoader,
    private readonly actionExecutor: ActionExecutor,
    private readonly config: MemoryHygieneConfig,
  ) {}

  /**
   * Run a full governed hygiene cycle for the agent managed by memoryManager.
   * Every operation is checked by the Pre-Action Pipeline before execution.
   * Returns a HygieneCycleResult with governance_actions log.
   */
  async runCycle(agentId: string): Promise<HygieneCycleResult> {
    const start = Date.now();
    const governanceActions: GovernanceActionLog[] = [];

    const healthBefore = await this.memoryManager.getMemoryHealth();

    let compactionResult: CompactionResult | null = null;
    let archivalResult: ArchivalResult | null = null;
    let dedupResult: DeduplicationResult | null = null;

    // --- Step 1: Compact short-term if over threshold ---
    const stSizeKb = healthBefore.short_term.size_kb;
    if (stSizeKb >= this.config.thresholds.short_term_compact_kb) {
      const compactResult = await this.actionExecutor.executeAction(
        "memory.compact",
        `${agentId}/short_term`,
        `Compact short-term memory (${stSizeKb.toFixed(1)} KB, strategy=${this.config.compaction.strategy})`,
        null,
      );

      governanceActions.push({
        action_type: "memory.compact",
        verdict: compactResult.success ? "ALLOW" : "BLOCK",
        ...(compactResult.block_reason !== undefined ? { reason: compactResult.block_reason } : {}),
      });

      if (compactResult.success) {
        try {
          compactionResult = await this.memoryManager.compactShortTerm(
            this.config.compaction.strategy,
          );
        } catch (err) {
          governanceActions.push({
            action_type: "memory.compact",
            verdict: "BLOCK",
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // --- Step 2: Deduplication ---
    const dedupResult2 = await this.actionExecutor.executeAction(
      "memory.compact",
      `${agentId}/short_term/dedup`,
      `Deduplicate short-term memory`,
      null,
    );

    governanceActions.push({
      action_type: "memory.deduplicate",
      verdict: dedupResult2.success ? "ALLOW" : "BLOCK",
      ...(dedupResult2.block_reason !== undefined ? { reason: dedupResult2.block_reason } : {}),
    });

    if (dedupResult2.success) {
      dedupResult = await this.memoryManager.deduplicateWithin(
        "short_term",
        this.config.thresholds.dedup_threshold,
      );
    }

    // --- Step 3: Archive long-term if needed ---
    // (V1: archival is triggered by compaction; here we just record status)
    // archivalResult is populated if compaction produced archived entries
    if (compactionResult !== null && compactionResult.entries_archived > 0) {
      archivalResult = {
        archived_count: compactionResult.entries_archived,
        archived_size_kb: compactionResult.before_size_kb - compactionResult.after_size_kb,
        target: "long_term",
        entries: [],
        errors: [],
      };
    }

    const healthAfter = await this.memoryManager.getMemoryHealth();

    return {
      agent_id: agentId,
      timestamp: new Date().toISOString(),
      dry_run: false,
      duration_ms: Date.now() - start,
      short_term: compactionResult,
      archival: archivalResult,
      deduplication: dedupResult,
      health_before: healthBefore,
      health_after: healthAfter,
      governance_actions: governanceActions,
    };
  }

  /**
   * Run hygiene for all agents in a division (called by scheduler or Bootstrap).
   * Each agent's cycle is independent; failures don't block others.
   */
  async runDivisionCycle(
    _divisionCode: string,
    agents: string[],
  ): Promise<Map<string, HygieneCycleResult>> {
    const results = new Map<string, HygieneCycleResult>();

    for (const agentId of agents) {
      try {
        const result = await this.runCycle(agentId);
        results.set(agentId, result);
      } catch (err) {
        // Record failure as a minimal result
        const healthSnapshot = await this.memoryManager.getMemoryHealth();
        const failResult: HygieneCycleResult = {
          agent_id: agentId,
          timestamp: new Date().toISOString(),
          dry_run: false,
          duration_ms: 0,
          short_term: null,
          archival: null,
          deduplication: null,
          health_before: healthSnapshot,
          health_after: healthSnapshot,
          governance_actions: [
            {
              action_type: "hygiene.cycle",
              verdict: "BLOCK",
              reason: err instanceof Error ? err.message : String(err),
            },
          ],
        };
        results.set(agentId, failResult);
      }
    }

    return results;
  }

  /**
   * Dry run: report what hygiene would do without executing any operations.
   */
  async dryRun(agentId: string): Promise<HygieneCycleResult> {
    // Delegate to MemoryManager's dry run (no governance checks needed for dry run)
    return this.memoryManager.dryRunHygiene(this.config);
  }
}
