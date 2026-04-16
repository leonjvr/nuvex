// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 7: DecompositionValidator
 *
 * Validates that task decomposition follows all governance rules.
 * Pure validation — does not generate tasks or make LLM calls.
 *
 * Rules:
 *   1. Tier enforcement: child tier = parent tier + 1 (T1→T2, T2→T3)
 *   2. Depth limit: V1 max depth = 3; T3 cannot create children
 *   3. Budget cascading: sum of child budgets <= parent remaining budget
 *   4. Classification inheritance: child classification >= parent (more restrictive)
 *   5. Division boundary: children must be in same division as parent
 *   6. Breadth limit: max 20 children per decomposition
 *   7. Consultation limit: max 3 peer consultations per task
 */

import type { Task, CreateTaskInput, ValidationResult } from "./types.js";

// Classification security levels (higher = more restrictive)
const CLASSIFICATION_LEVEL: Record<string, number> = {
  "public":       0,
  "internal":     1,
  "confidential": 2,
  "secret":       3,
  "top-secret":   4,
};

/** Maximum allowed children per decomposition. */
const MAX_BREADTH = 20;

/** Maximum peer consultations per task. */
const MAX_CONSULTATIONS = 3;

export class DecompositionValidator {
  /**
   * Validate a proposed decomposition.
   *
   * @param parentTask - The task being decomposed.
   * @param childTasks - The proposed child tasks.
   * @returns ValidationResult with errors (block) and warnings (inform).
   */
  validate(parentTask: Task, childTasks: CreateTaskInput[]): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (childTasks.length === 0) {
      warnings.push("Decomposition has no child tasks");
      return { valid: true, errors, warnings };
    }

    // Rule 6: Breadth limit
    if (childTasks.length > MAX_BREADTH) {
      errors.push(
        `Breadth limit exceeded: ${childTasks.length} children requested, max is ${MAX_BREADTH}`,
      );
    }

    // Rule 2: T3 cannot create children
    if (parentTask.tier === 3) {
      errors.push("T3 tasks cannot create children (V1 max depth = 3)");
      return { valid: errors.length === 0, errors, warnings };
    }

    // Count consultation tasks
    const consultationCount = childTasks.filter((c) => c.type === "consultation").length;
    if (consultationCount > MAX_CONSULTATIONS) {
      errors.push(
        `Consultation limit exceeded: ${consultationCount} consultations requested, max is ${MAX_CONSULTATIONS}`,
      );
    }

    // Track budget usage
    let totalTokenBudget = 0;
    let totalCostBudget = 0;

    for (let i = 0; i < childTasks.length; i++) {
      const child = childTasks[i];
      if (child === undefined) continue;
      const label = `Child[${i}] "${child.title}"`;

      // Rule 1: Tier enforcement (skip for consultations — same tier)
      if (child.type !== "consultation") {
        const expectedTier = (parentTask.tier + 1) as 1 | 2 | 3;
        if (child.tier !== expectedTier) {
          errors.push(
            `${label}: tier must be ${expectedTier} (parent is T${parentTask.tier}), got T${child.tier}`,
          );
        }
      } else {
        // Consultations must be same tier as parent
        if (child.tier !== parentTask.tier) {
          errors.push(
            `${label}: consultation tier must match parent T${parentTask.tier}, got T${child.tier}`,
          );
        }
      }

      // Rule 5: Division boundary
      if (child.division !== parentTask.division) {
        errors.push(
          `${label}: cross-division delegation not supported in V1 (parent: ${parentTask.division}, child: ${child.division})`,
        );
      }

      // Rule 4: Classification inheritance
      const childClass = child.classification ?? "internal";
      const parentLevel = CLASSIFICATION_LEVEL[parentTask.classification] ?? 1;
      const childLevel  = CLASSIFICATION_LEVEL[childClass] ?? 1;
      if (childLevel < parentLevel) {
        errors.push(
          `${label}: classification "${childClass}" is less restrictive than parent "${parentTask.classification}"`,
        );
      }

      // Rule 3: Budget cascading (accumulate)
      totalTokenBudget += child.token_budget;
      totalCostBudget  += child.cost_budget;
    }

    // Rule 3: Check accumulated budgets against parent remaining
    const parentTokenRemaining = parentTask.token_budget - parentTask.token_used;
    const parentCostRemaining  = parentTask.cost_budget  - parentTask.cost_used;

    if (totalTokenBudget > parentTokenRemaining) {
      errors.push(
        `Token budget overflow: children request ${totalTokenBudget} tokens, ` +
        `parent has ${parentTokenRemaining} remaining`,
      );
    }
    if (totalCostBudget > parentCostRemaining) {
      errors.push(
        `Cost budget overflow: children request $${totalCostBudget.toFixed(4)}, ` +
        `parent has $${parentCostRemaining.toFixed(4)} remaining`,
      );
    }

    // Warnings
    if (totalTokenBudget > parentTokenRemaining * 0.9) {
      warnings.push("Children consume >90% of parent's remaining token budget");
    }
    if (totalCostBudget > parentCostRemaining * 0.9) {
      warnings.push("Children consume >90% of parent's remaining cost budget");
    }

    return { valid: errors.length === 0, errors, warnings };
  }
}
