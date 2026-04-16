// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Public API
 */

export { IntegrationGateway }          from "./gateway.js";
export {
  BaseHttpAdapter,
  N8nAdapter,
  GithubAdapter,
  SlackAdapter,
  loadAdapters,
  substituteEnvVars,
} from "./adapters/index.js";

export {
  ScriptExecutor,
  CliExecutor,
  McpBridge,
} from "./executors/index.js";

export type {
  ScriptExecutionRequest,
  ScriptExecutionResult,
  CliExecutionRequest,
  McpBridgeRequest,
  McpBridgeResult,
  McpClient,
} from "./executors/index.js";
export { AdapterRegistry }             from "./adapter-registry.js";
export { RouteResolver }               from "./route-resolver.js";
export { HttpExecutor }                from "./http-executor.js";
export { WebAccessPolicyLoader }       from "./web-access-policy.js";
export { PolicyEnforcer, globMatch }   from "./policy-enforcer.js";
export { InMemoryGatewayBudgetTracker } from "./budget-tracker.js";
export { IntegrationError }            from "./errors.js";
export { SchemaStore }                 from "./schema-store.js";
export { parseOpenApiSpec }            from "./openapi-parser.js";
export { IntelligentPathResolver }     from "./intelligent-path.js";
export { AdapterPromoter }             from "./adapter-promoter.js";
export { SqliteGatewayAuditService, NoOpGatewayAuditService, INTEGRATION_AUDIT_SQL } from "./sqlite-audit-service.js";

export type {
  // Enumerations
  RiskLevel,
  ProtocolType,
  AuthType,
  // Adapter definition
  AdapterDefinition,
  AdapterAction,
  AdapterAuth,
  ActionGovernance,
  // Request / response
  GatewayRequest,
  GatewayResponse,
  RouteResolution,
  // Config
  IntegrationConfig,
  // Audit
  IntegrationAuditEvent,
  // Service interfaces
  GatewayAuditService,
  GatewaySecretsService,
  GatewayBudgetService,
  // Executor
  ExecutorRequest,
  ExecutorResponse,
  // Web access policy
  WebAccessPolicy,
  WebAccessServiceRule,
  WebAccessBlockRule,
  WebAccessApprovalRule,
  PolicyCheckResult,
} from "./types.js";

export type { ApiSchema }              from "./schema-store.js";
export type { ParsedSpec, ParsedEndpoint, ParsedParameter } from "./openapi-parser.js";
export type { IntelligentPathResult, ProviderRegistryLike } from "./intelligent-path.js";
export type { PromotionCandidate }     from "./adapter-promoter.js";
