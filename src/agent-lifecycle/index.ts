// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: Agent Lifecycle — Public API
 */

// Types
export type {
  AgentLifecycleDefinition,
  AgentBudgetConfig,
  ScheduleConfig,
  KnowledgeRef,
  ToolRef,
  ProviderModelConfig,
  ProviderRateLimits,
  ProviderLifecycleConfig,
  ProvidersYaml,
  DivisionBudgetConfig,
  HardLimitAction,
  BudgetLevel,
  BudgetCheckDetail,
  BudgetResolution,
  BudgetAlert,
  AlertLevel,
  SkillSection,
  SkillValidationResult,
  AgentValidationResult,
  AgentTemplate,
  ReconfigureField,
  FieldChange,
  HotReconfigureResult,
  RegistryFilters,
  AgentDefinitionRow,
  AgentLifecycleStatus,
} from "./types.js";

// Core components
export { AgentRegistry }    from "./agent-registry.js";
export { AgentValidator }   from "./agent-validator.js";
export { SkillValidator, parseSections, injectVariables } from "./skill-validator.js";
export { SkillLoaderV2 }    from "./skill-loader-v2.js";
export { BudgetResolver }   from "./budget-resolver.js";
export { BudgetTracker }    from "./budget-tracker.js";
export { ProviderSetup }    from "./provider-setup.js";
export { AgentTemplateLoader } from "./agent-template.js";
export { HotReconfigure }   from "./hot-reconfigure.js";

// Migration
export { runMigrations105, LIFECYCLE_MIGRATIONS } from "./migration.js";

// CLI registration
export { registerAgentCommands }    from "./cli-agent.js";
export { registerProviderCommands } from "./cli-provider.js";

// Phase 10.5c: Communication Abstraction Layer
export type { MessageType, MessageEnvelope } from "./communication/types.js";
export type { CommunicationChannel } from "./communication/channel.js";
export { LocalIPCChannel } from "./communication/local-ipc-channel.js";

// Phase 10.5c: Checkpoint / WAL
export type { WALEntry, AppendWALInput } from "./checkpoint/wal-manager.js";
export { WALManager } from "./checkpoint/wal-manager.js";
export type {
  CheckpointType,
  CheckpointRecord,
  CreateCheckpointInput,
  RecoveryMode,
  RecoveryResult,
} from "./checkpoint/checkpoint-manager.js";
export { CheckpointManager } from "./checkpoint/checkpoint-manager.js";

// Phase 10.5c: Supervisor
export type {
  SupervisorAgentConfig,
  AgentHealthState,
  AgentHealthStatus,
} from "./supervisor/process-supervisor.js";
export { ProcessSupervisor } from "./supervisor/process-supervisor.js";
export type {
  GracefulShutdownConfig,
  ShutdownReason,
  ShutdownStatus,
} from "./supervisor/graceful-shutdown.js";
export { GracefulShutdownHandler } from "./supervisor/graceful-shutdown.js";
export type { RecoveryReport } from "./supervisor/startup-recovery.js";
export { StartupRecoveryManager } from "./supervisor/startup-recovery.js";
