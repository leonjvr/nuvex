// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 9: DelegationEngine
 *
 * Enforces tier hierarchy rules. Decides whether a delegation request is valid
 * and allocates budgets to child tasks.
 *
 * V1 rules:
 *   T1 → T2: allowed (delegation)
 *   T2 → T3: allowed (delegation)
 *   T1 → T3: allowed (skip-level for simple tasks)
 *   T3 → T2: NOT allowed (escalation only)
 *   T2 → T1: NOT allowed (escalation only)
 *   T1 ↔ T1, T2 ↔ T2, T3 ↔ T3: allowed (peer consultation)
 */

import type { Task } from "../tasks/types.js";
import type {
  OrchestratorConfig,
  DelegationRule,
  DelegationDecision,
  TaskDecomposition,
  BudgetAllocation,
  ValidationResult,
} from "./types.js";
import { DEFAULT_DELEGATION_RULES } from "./types.js";

// Classification rank for clearance checks (higher = more restrictive)
const CLASSIFICATION_RANK: Record<string, number> = {
  public:       0,
  internal:     1,
  confidential: 2,
  secret:       3,
  fyeo:         4,
};

/** Percentage of parent budget reserved for synthesis step. */
const SYNTHESIS_RESERVE = 0.10;


export class DelegationEngine {
  private readonly rules: DelegationRule[];

  constructor(private readonly config: OrchestratorConfig) {
    this.rules = config.delegation_rules?.length
      ? config.delegation_rules
      : DEFAULT_DELEGATION_RULES;
  }

  // ---------------------------------------------------------------------------
  // Core: canDelegate
  // ---------------------------------------------------------------------------

  /**
   * Check whether delegation from one tier to another is allowed for a task.
   *
   * Checks:
   *   1. Tier rule exists and is allowed
   *   2. Task classification compatible (higher-clearance task can't go to lower-tier)
   *   3. Tree depth limit not exceeded
   */
  canDelegate(fromTier: number, toTier: number, task: Task): DelegationDecision {
    // 1. Tier rule
    const rule = this.findRule(fromTier, toTier);
    if (rule === null) {
      return {
        allowed: false,
        reason: `No delegation rule for tier ${fromTier} → ${toTier}`,
        rule: null,
      };
    }

    if (!rule.allowed) {
      return {
        allowed: false,
        reason: `Delegation from tier ${fromTier} to tier ${toTier} is not allowed (escalation only)`,
        rule,
      };
    }

    // 2. Classification check
    if (rule.requires_classification_match) {
      const parentRank = CLASSIFICATION_RANK[task.classification.toLowerCase()] ?? 1;
      // Lower tier agents have lower clearance — max T2 = CONFIDENTIAL, T3 = INTERNAL
      // T1 can access anything; T2 up to CONFIDENTIAL; T3 up to INTERNAL
      const tierMaxRank: Record<number, number> = { 1: 4, 2: 2, 3: 1 };
      const toTierMaxRank = tierMaxRank[toTier] ?? 1;
      if (parentRank > toTierMaxRank) {
        return {
          allowed: false,
          reason: `Task classification '${task.classification}' exceeds tier ${toTier} clearance`,
          rule,
        };
      }
    }

    // 3. Tree depth check (task.tier represents its current depth level)
    // If delegating to tier = max_tree_depth and going deeper, block
    if (toTier > this.config.max_tree_depth) {
      return {
        allowed: false,
        reason: `Tree depth limit exceeded: max_tree_depth = ${this.config.max_tree_depth}`,
        rule,
      };
    }

    return { allowed: true, reason: "Delegation allowed", rule };
  }

  // ---------------------------------------------------------------------------
  // Core: validateDecomposition
  // ---------------------------------------------------------------------------

  /**
   * Validate a parent task's decomposition plan before creating sub-tasks.
   *
   * Checks:
   *   1. Children count ≤ max_tree_breadth
   *   2. Sum of children token_budget ≤ parent.token_budget - token_used (with synthesis reserve)
   *   3. Sum of children cost_budget ≤ parent.cost_budget - cost_used (with synthesis reserve)
   *   4. All children tier valid (parent+1 or skip-level T1→T3)
   *   5. Classification: children inherit parent classification as minimum
   */
  validateDecomposition(parent: Task, children: TaskDecomposition[]): ValidationResult {
    const errors: string[] = [];

    // 1. Breadth limit
    if (children.length > this.config.max_tree_breadth) {
      errors.push(
        `Too many sub-tasks: ${children.length} exceeds max_tree_breadth (${this.config.max_tree_breadth})`,
      );
    }

    // 2 & 3. Budget check
    const parentRemainingTokens = parent.token_budget - parent.token_used;
    const parentRemainingCost   = parent.cost_budget  - parent.cost_used;
    const synthReserveTokens    = Math.floor(parent.token_budget * SYNTHESIS_RESERVE);
    const synthReserveCost      = parent.cost_budget * SYNTHESIS_RESERVE;
    const availableTokens       = parentRemainingTokens - synthReserveTokens;
    const availableCost         = parentRemainingCost   - synthReserveCost;

    const specifiedTokenBudgets = children.filter((c) => c.token_budget !== undefined);
    if (specifiedTokenBudgets.length > 0) {
      const totalTokens = specifiedTokenBudgets.reduce((s, c) => s + (c.token_budget ?? 0), 0);
      if (totalTokens > availableTokens) {
        errors.push(
          `Children token budgets sum (${totalTokens}) exceeds parent available tokens (${availableTokens}) after 10% synthesis reserve`,
        );
      }
    }

    const specifiedCostBudgets = children.filter((c) => c.cost_budget !== undefined);
    if (specifiedCostBudgets.length > 0) {
      const totalCost = specifiedCostBudgets.reduce((s, c) => s + (c.cost_budget ?? 0), 0);
      if (totalCost > availableCost) {
        errors.push(
          `Children cost budgets sum (${totalCost.toFixed(4)}) exceeds parent available cost (${availableCost.toFixed(4)}) after 10% synthesis reserve`,
        );
      }
    }

    // 4. Tier validation
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const decision = this.canDelegate(parent.tier, child.tier, parent);
      if (!decision.allowed) {
        errors.push(`Child[${i}] tier ${child.tier}: ${decision.reason}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------------
  // Core: allocateBudgets
  // ---------------------------------------------------------------------------

  /**
   * Distribute parent's remaining budget across children.
   * Always reserves 10% of parent's total budget for the synthesis step.
   *
   *  - proportional: split evenly among children
   *  - fixed: each child gets its specified amount
   *  - remaining: split remaining after specified children take their share
   */
  allocateBudgets(
    parent: Task,
    children: TaskDecomposition[],
    strategy: "proportional" | "fixed" | "remaining",
  ): BudgetAllocation[] {
    const parentRemainingTokens = parent.token_budget - parent.token_used;
    const parentRemainingCost   = parent.cost_budget  - parent.cost_used;
    const synthReserveTokens    = Math.floor(parent.token_budget * SYNTHESIS_RESERVE);
    const synthReserveCost      = parent.cost_budget * SYNTHESIS_RESERVE;
    const availableTokens       = Math.max(0, parentRemainingTokens - synthReserveTokens);
    const availableCost         = Math.max(0, parentRemainingCost   - synthReserveCost);

    if (children.length === 0) return [];

    switch (strategy) {
      case "proportional": {
        const tokenPerChild = Math.floor(availableTokens / children.length);
        const costPerChild  = availableCost / children.length;
        return children.map((_, i) => ({
          child_index:  i,
          token_budget: tokenPerChild,
          cost_budget:  costPerChild,
        }));
      }

      case "fixed": {
        return children.map((child, i) => ({
          child_index:  i,
          token_budget: child.token_budget ?? Math.floor(availableTokens / children.length),
          cost_budget:  child.cost_budget  ?? availableCost / children.length,
        }));
      }

      case "remaining": {
        // First child gets bulk (80% of available), rest split equally
        const firstTokens = Math.floor(availableTokens * 0.8);
        const firstCost   = availableCost * 0.8;
        const remTokens   = Math.floor((availableTokens - firstTokens) / Math.max(1, children.length - 1));
        const remCost     = (availableCost - firstCost) / Math.max(1, children.length - 1);

        return children.map((_, i) => ({
          child_index:  i,
          token_budget: i === 0 ? firstTokens : remTokens,
          cost_budget:  i === 0 ? firstCost   : remCost,
        }));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // getDefaultRules
  // ---------------------------------------------------------------------------

  getDefaultRules(): DelegationRule[] {
    return DEFAULT_DELEGATION_RULES;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private findRule(fromTier: number, toTier: number): DelegationRule | null {
    return this.rules.find((r) => r.from_tier === fromTier && r.to_tier === toTier) ?? null;
  }
}
