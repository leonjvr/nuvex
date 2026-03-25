// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 9: Orchestrator barrel exports
 */

export { OrchestratorProcess }  from "./orchestrator.js";
export { DelegationEngine }     from "./delegation.js";
export { WorkDistributor }      from "./distributor.js";
export { SynthesisCollector }   from "./synthesis.js";
export { EscalationManager }    from "./escalation.js";
export { PeerRouter }           from "./peer-router.js";
export { TaskTreeManager }      from "./tree-manager.js";

export type {
  OrchestratorConfig,
  OrchestratorState,
  OrchestratorStatus,
  DelegationRule,
  DelegationDecision,
  TaskDecomposition,
  BudgetAllocation,
  ValidationResult,
  AgentInstance,
  WorkAssignment,
  AgentLoad,
  RebalanceResult,
  EscalationReason,
  EscalationRecord,
  EscalationResult,
  HumanDecision,
  ChildSummary,
  SynthesisStatus,
  TreeStatus,
  PartialFailureAction,
  PeerRouteResult,
  TaskTreeNode,
  CancelResult,
  OrchestratorConfigRaw,
  AgentDefinitionRaw,
} from "./types.js";

export { DEFAULT_DELEGATION_RULES, PHASE9_SCHEMA_SQL } from "./types.js";
export { bootstrapOrchestrator } from "./bootstrap.js";
export type { OrchestratorBootstrapDeps } from "./bootstrap.js";
