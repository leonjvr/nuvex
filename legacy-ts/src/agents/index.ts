// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8: Agent Runtime
 *
 * Barrel exports for all public Phase 8 types and components.
 */

// Types
export type {
  AgentDefinition,
  AgentState,
  AgentStatus,
  AgentError,
  SkillDefinition,
  ReviewBehavior,
  DelegationStyle,
  Checkpoint,
  TaskCheckpoint,
  AgentIPCMessage,
  ProcessOptions,
  AgentAction,
  ActionResult,
  LLMRequest,
  MemoryEntry,
  BootstrapConfig,
  AgentHealthEntry,
  HealthAlert,
  HealthReport,
  AgentDecision,
  SubTaskPlan,
  AgentValidationResult,
  // Memory lifecycle types
  MemoryTier,
  CompactionStrategy,
  MemoryLifecycleConfig,
  MemoryHealthReport,
  HygieneRecommendation,
  ArchivalTag,
  ArchivalCandidate,
  ArchivalResult,
  CompactionResult,
  MigrationResult,
  DeduplicationResult,
  PersistenceCheck,
  HygieneCycleResult,
  GovernanceActionLog,
  MemoryHygieneConfig,
  RetentionConfig,
  ArchivalConfig,
  AgentMemoryHealth,
  EnrichedSkillDefinition,
  DeepKnowledgeEntry,
  SkillHealthReport,
  SkillCompactionRules,
  SkillCompactionResult,
} from "./types.js";

// Components
export { HeartbeatMonitor }        from "./heartbeat.js";
export { SkillLoader }             from "./skill-loader.js";
export { MemoryManager }           from "./memory.js";
export { MemoryLifecycleManager }  from "./memory-lifecycle.js";
export { AgentContext }        from "./context.js";
export { CheckpointManager }   from "./checkpoint.js";
export { ActionExecutor }      from "./action-executor.js";
export type { PipelineEvaluator, LLMCallResult } from "./action-executor.js";
export { AgentProcess }        from "./process.js";
export { AgentLoop }           from "./loop.js";
export type { AgentLoopProviders } from "./loop.js";
export { ITBootstrapAgent }    from "./bootstrap.js";
export { parseAgentResponse }  from "./response-parser.js";
