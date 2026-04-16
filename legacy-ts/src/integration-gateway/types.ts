// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Type Definitions
 *
 * Core types for the universal bridge between governed agents and
 * external services.
 */


/** Risk levels for external API actions */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Protocol types the gateway supports */
export type ProtocolType = 'rest' | 'graphql' | 'local_script' | 'cli' | 'mcp';

/** Auth types for adapter connections */
export type AuthType = 'api_key' | 'bearer' | 'basic' | 'oauth2' | 'webhook_url' | 'none';


/** Governance rules applied per adapter action */
export interface ActionGovernance {
  /** Whether human approval is required before executing */
  require_approval: boolean | 'conditional';
  /** Cost in USD charged to the division per call */
  budget_per_call: number;
  /** Rate limit string, e.g. "10/minute", "60/hour" */
  rate_limit?: string;
  /** Risk classification for audit and approval routing */
  risk_level: RiskLevel;
  /** Request timeout; defaults to executor's global default if omitted */
  timeout_seconds?: number;
}


/** Single action an adapter exposes */
export interface AdapterAction {
  /** HTTP method for REST/GraphQL adapters */
  method?: string;
  /** URL path template — use {param} placeholders */
  path?: string;
  /** Script function name for local_script adapters */
  function?: string;
  /** CLI command for cli adapters */
  command?: string;
  /** Parameter schema */
  params?: Record<string, {
    type: string;
    required: boolean;
    description?: string;
  }>;
  /** Governance rules for this action */
  governance: ActionGovernance;
}

/** Auth configuration for an adapter */
export interface AdapterAuth {
  /** Authentication mechanism */
  type: AuthType;
  /** Header name for api_key auth (default: "Authorization") */
  header?: string;
  /** Reference key used to look up the credential in the secrets manager */
  secret_ref: string;
  /** Token endpoint URL for oauth2 */
  token_url?: string;
}

/** Complete adapter definition loaded from YAML or registered programmatically */
export interface AdapterDefinition {
  /** Unique service name used in GatewayRequest.service */
  name: string;
  /** Whether this adapter uses deterministic rules or intelligent discovery */
  type: 'deterministic' | 'intelligent';
  /** Wire protocol */
  protocol: ProtocolType;
  /** Base URL for REST/GraphQL adapters */
  base_url?: string;
  /** Script path for local_script adapters */
  script_path?: string;
  /** Runtime for local_script (e.g. "node", "python3") */
  runtime?: string;
  /** Auth config; omit for public endpoints */
  auth?: AdapterAuth;
  /** Map of action name → action definition */
  actions: Record<string, AdapterAction>;
  /** Soft-disable without removing the definition */
  enabled: boolean;
}


/** Gateway request sent by an agent */
export interface GatewayRequest {
  /** Adapter name to call */
  service: string;
  /** Action within the adapter */
  action: string;
  /** Parameters passed to the action */
  params: Record<string, unknown>;
  /** Calling agent ID */
  agent_id: string;
  /** Calling agent's division code */
  division: string;
  /** Unique request correlation ID */
  request_id: string;
  /** ISO 8601 timestamp from the caller */
  timestamp: string;
}

/** Gateway response returned to the agent */
export interface GatewayResponse {
  success: boolean;
  status_code?: number;
  data?: unknown;
  error?: string;
  request_id: string;
  execution_ms: number;
  path_used: 'deterministic' | 'intelligent';
  audit_id: string;
}


/** Result of route resolution before execution */
export interface RouteResolution {
  path: 'deterministic' | 'intelligent' | 'blocked';
  adapter?: AdapterDefinition;
  action?: AdapterAction;
  /** Human-readable reason when path === 'blocked' */
  reason?: string;
}


/** Integration config section from sidjua.yaml / config */
export interface IntegrationConfig {
  gateway: {
    enabled: boolean;
    intelligent_path: {
      enabled: boolean;
      llm_provider: string;
      llm_model: string;
      max_tokens_per_discovery: number;
      cache_discovered_schemas: boolean;
    };
    deterministic_adapters: string[];
    global_rate_limit: string;
    global_budget: {
      daily: number;
      monthly: number;
    };
    credential_store: string;
    audit: {
      enabled: boolean;
      retention_days: number;
    };
    /** Maximum response body size in bytes (default: 102400 = 100 KB) */
    max_response_bytes?: number;
    /** Default timeout in seconds when action doesn't specify one (default: 30) */
    default_timeout_seconds?: number;
  };
}


/** Audit event emitted for every gateway request */
export interface IntegrationAuditEvent {
  event_type:
    | 'integration_request'
    | 'integration_success'
    | 'integration_failure'
    | 'integration_blocked'
    | 'integration_approval_required';
  request_id: string;
  agent_id: string;
  division: string;
  service: string;
  action: string;
  path_used: 'deterministic' | 'intelligent';
  risk_level: RiskLevel;
  status_code?: number;
  execution_ms?: number;
  error?: string;
  timestamp: string;
}


/** Minimal audit surface used by the gateway */
export interface GatewayAuditService {
  logIntegrationEvent(event: IntegrationAuditEvent): Promise<void>;
}

/** Minimal secrets surface used by the gateway */
export interface GatewaySecretsService {
  get(namespace: string, key: string): Promise<string | null>;
}


/** Per-division web access policy loaded from governance/boundaries/web-access-{division}.yaml */
export interface WebAccessPolicy {
  division: string;
  /** Domain patterns that are explicitly allowed (deny-by-default when base_url checking is active) */
  allowed_domains?: string[];
  /** Explicit allow-list: which services + actions are permitted */
  allowed_services: WebAccessServiceRule[];
  /** Blocked service patterns (glob-matched; checked before allow-list) */
  blocked_services: WebAccessBlockRule[];
  /** Approval rules that trigger human/operator review */
  approval_rules: WebAccessApprovalRule[];
  budget: {
    /** Max USD charged per single call */
    per_call: number;
    /** Max total USD per day for this division's gateway requests */
    daily_limit: number;
    /** Max total USD per month */
    monthly_limit: number;
  };
  rate_limits: {
    /** Rate limit per service, e.g. "10/minute" */
    per_service: string;
    /** Total gateway rate limit, e.g. "60/hour" */
    total: string;
  };
  audit: {
    log_requests: boolean;
    log_responses: boolean;
    retention_days: number;
  };
}

/** Explicit allow-list entry for a single service */
export interface WebAccessServiceRule {
  /** Service name (exact match) */
  service: string;
  /** Allowed action names; use ["*"] for all actions */
  actions: string[];
  /** n8n: allowed workflow name globs */
  workflows?: string[];
  /** Slack: allowed channel names */
  channels?: string[];
  /** GitHub: allowed repository patterns */
  repositories?: string[];
}

/** Blocked service entry — glob-matched against service names */
export interface WebAccessBlockRule {
  /** Glob pattern, e.g. "*banking*" */
  service: string;
}

/** Rule that triggers approval before a matching action executes */
export interface WebAccessApprovalRule {
  /** Glob pattern matched against the action name */
  action: string;
  /** Optional condition expression (e.g. "workflow.name matches 'delete-*'") */
  condition?: string;
  /** Who must approve */
  approver: "division_head" | "human" | "operator";
}


export interface PolicyCheckResult {
  allowed: boolean;
  /** Human-readable denial reason */
  reason?: string;
  /** True when the request is allowed but requires an explicit approval step */
  approval_required?: boolean;
  /** Approver role required when approval_required is true */
  approver?: string;
}


/** Minimal budget surface used by the PolicyEnforcer */
export interface GatewayBudgetService {
  /** Return current spend (USD) for a division in the given period */
  getCurrentSpend(division: string, period: "daily" | "monthly"): Promise<number>;
  /** Record a spend event for a completed call */
  recordSpend(division: string, amount: number, service: string): Promise<void>;
}


/** Input to HttpExecutor.execute() */
export interface ExecutorRequest {
  adapter: AdapterDefinition;
  action: AdapterAction;
  actionName: string;
  params: Record<string, unknown>;
  credentials: string | null;
  requestId: string;
  timeoutMs?: number;
  /**
   * Adapter-specific headers merged AFTER auth headers — can override defaults
   * (e.g. GitHub's `Accept: application/vnd.github+json`).
   */
  extraHeaders?: Record<string, string>;
}

/** Output from HttpExecutor.execute() */
export interface ExecutorResponse {
  success: boolean;
  statusCode: number;
  data: unknown;
  error?: string;
  executionMs: number;
}
