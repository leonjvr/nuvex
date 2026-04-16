// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.6: ScopeChecker
 * Verifies agent has access to a knowledge collection.
 */

import type { KnowledgeCollection, AgentAccessContext, ScopeCheckResult } from "../types.js";

const CLASSIFICATION_RANK: Record<string, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  SECRET: 3,
  FYEO: 4,
};

export class ScopeChecker {
  /**
   * Check if an agent is allowed to access a collection.
   */
  check(collection: KnowledgeCollection, agent: AgentAccessContext): ScopeCheckResult {
    const scope = collection.scope;

    // Division check
    if (scope.divisions !== undefined && scope.divisions.length > 0) {
      if (!scope.divisions.includes(agent.division)) {
        return {
          allowed: false,
          reason: `Agent division '${agent.division}' not in scope divisions [${scope.divisions.join(", ")}]`,
        };
      }
    }

    // Agent-specific check
    if (scope.agents !== undefined && scope.agents.length > 0) {
      if (!scope.agents.includes(agent.agent_id)) {
        return {
          allowed: false,
          reason: `Agent '${agent.agent_id}' not in allowed agents [${scope.agents.join(", ")}]`,
        };
      }
    }

    // Tier check
    if (scope.tiers !== undefined && scope.tiers.length > 0) {
      if (!scope.tiers.includes(agent.tier)) {
        return {
          allowed: false,
          reason: `Agent tier ${agent.tier} not in allowed tiers [${scope.tiers.join(", ")}]`,
        };
      }
    }

    // Classification check: agent's max_classification must be >= collection's classification
    const agentClearance = agent.max_classification ?? "PUBLIC";
    const agentRank = CLASSIFICATION_RANK[agentClearance] ?? 0;
    const collectionRank = CLASSIFICATION_RANK[scope.classification] ?? 0;

    if (agentRank < collectionRank) {
      return {
        allowed: false,
        reason: `Agent clearance '${agentClearance}' insufficient for collection classification '${scope.classification}'`,
      };
    }

    return { allowed: true };
  }

  /**
   * Filter a list of collections to only those accessible by the agent.
   */
  filterAccessible(
    collections: KnowledgeCollection[],
    agent: AgentAccessContext,
  ): KnowledgeCollection[] {
    return collections.filter((c) => this.check(c, agent).allowed);
  }
}
