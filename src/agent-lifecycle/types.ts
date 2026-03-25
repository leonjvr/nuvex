// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10.5: Agent Lifecycle Types
 *
 * All interfaces for agent definitions, provider configs, budgets, and
 * validation results used by the agent-lifecycle module.
 */


export interface AgentBudgetConfig {
  per_task_usd: number;          // max cost per single task
  per_hour_usd: number;          // max burn rate
  per_month_usd: number;         // monthly cap
  token_budget_per_task?: number; // optional token limit per task
}


export interface ScheduleConfig {
  active_hours?: string;         // "09:00-18:00"
  active_days?: string[];        // ["mon", "tue", ...]
  timezone?: string;             // "Asia/Manila"
}


export interface KnowledgeRef {
  collection: string;            // knowledge collection name
}

export interface ToolRef {
  tool: string;                  // tool name
  permissions?: string[];        // ["read", "write", ...]
}


/**
 * Full agent definition as parsed from agents/definitions/<id>.yaml.
 * Stored verbatim (as YAML) in the agent_definitions.config_yaml column.
 */
export interface AgentLifecycleDefinition {
  schema_version?: string;

  // Identity
  id: string;
  name: string;
  description?: string;

  /** Agent role identifier (e.g. "ceo-assistant", "guide"). */
  role?: string;

  /** Who the agent is facing ("human" | "agent"). Default: "agent". */
  facing?: "human" | "agent";

  // Hierarchy
  tier: number;                   // 1-7 (V1 uses 1-3)
  division: string;               // division code
  reports_to?: string;            // agent ID of direct supervisor

  // Intelligence
  provider: string;               // e.g. "anthropic"
  model: string;                  // e.g. "claude-sonnet-4-5"
  fallback_provider?: string;
  fallback_model?: string;

  // Capabilities
  capabilities: string[];

  // Skill file
  skill: string;                  // relative path to skill.md

  // Knowledge (Phase 10.6 — optional)
  knowledge?: KnowledgeRef[];

  // Tool bindings (Phase 10.7 — optional)
  tools?: ToolRef[];

  // Budget
  budget?: Partial<AgentBudgetConfig>;

  // Operational settings
  max_concurrent_tasks?: number;
  checkpoint_interval_seconds?: number;
  ttl_default_seconds?: number;
  heartbeat_interval_seconds?: number;

  // Classification access
  max_classification?: string;   // e.g. "CONFIDENTIAL"

  // Schedule (optional)
  schedule?: ScheduleConfig;

  // Session lifecycle (Phase 186 — optional)
  session?: AgentSessionConfig;

  // Daemon loop (V1.1 — optional)
  daemon?: AgentDaemonConfig;

  // Metadata
  created_at?: string;
  created_by?: string;
  tags?: string[];
}


export interface AgentDefinitionRow {
  id: string;
  name: string;
  tier: number;
  division: string;
  provider: string;
  model: string;
  skill_path: string;
  config_yaml: string;
  config_hash: string;
  status: AgentLifecycleStatus;
  created_at: string;
  created_by: string;
  updated_at: string;
}


export interface AgentSessionConfig {
  /** Model context window limit in tokens. Defaults to model-specific value. */
  context_window_tokens?: number;
  /** Warn at this % of context window (default: 70). */
  warn_threshold_percent?: number;
  /** Rotate session at this % of context window (default: 85). */
  rotate_threshold_percent?: number;
  /** Briefing detail level on rotation (default: "standard"). */
  briefing_level?: "minimal" | "standard" | "detailed";
  /** Force rotation after this many turns, 0 = disabled (default: 0). */
  max_session_turns?: number;
}


export type AgentLifecycleStatus =
  | "stopped"
  | "starting"
  | "active"
  | "idle"
  | "stopping"
  | "error";


export interface ProviderModelConfig {
  id: string;
  tier_recommendation?: number;
  cost_per_1k_input?: number;
  cost_per_1k_output?: number;
  context_window?: number;
}

export interface ProviderRateLimits {
  requests_per_minute?: number;
  tokens_per_minute?: number;
}

export interface ProviderLifecycleConfig {
  type: string;                   // "anthropic" | "openai"
  api_base?: string;
  secret_key: string;             // reference to secrets store
  models?: ProviderModelConfig[];
  rate_limits?: ProviderRateLimits;
  health_check?: boolean;
}

export interface ProvidersYaml {
  schema_version?: string;
  providers: Record<string, ProviderLifecycleConfig>;
}


export type HardLimitAction = "pause_all_agents" | "escalate" | "queue_only";

export interface DivisionBudgetConfig {
  division: string;
  period: "daily" | "monthly";
  limits: {
    total_usd: number;
    warning_threshold_percent?: number;
    hard_limit_action?: HardLimitAction;
  };
  provider_limits?: Record<string, { max_usd: number }>;
  tier_defaults?: Record<string, { per_task_usd: number; per_hour_usd: number }>;
}


export type BudgetLevel = "org" | "division" | "agent" | "task";

export interface BudgetCheckDetail {
  level: BudgetLevel;
  allowed: boolean;
  current_usd: number;
  limit_usd: number | null;
  reason?: string;
}

export interface BudgetResolution {
  allowed: boolean;
  effective_limit_usd: number | null;  // lowest applicable limit
  blocked_by?: BudgetLevel;            // which level blocked the action
  details: BudgetCheckDetail[];
  near_limit: boolean;                 // any level ≥ 80%
}


export type AlertLevel = "warning" | "critical" | "exceeded";

export interface BudgetAlert {
  level: AlertLevel;
  scope: BudgetLevel;
  scope_id: string;                    // agent_id, division code, or "org"
  current_usd: number;
  limit_usd: number;
  percent_used: number;
  timestamp: string;
}


export interface SkillSection {
  name: string;
  content: string;
}

export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sections_found: string[];
  size_bytes: number;
  has_variables: {
    agent_name: boolean;
    organization: boolean;
    reports_to: boolean;
  };
}


export interface AgentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks_passed: string[];
  checks_failed: string[];
}


export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  tier: number;
  defaults: Partial<AgentLifecycleDefinition>;
  skill_template?: string;          // starter skill.md content
}


export type ReconfigureField =
  | "budget"
  | "model"
  | "skill"
  | "provider"
  | "division"
  | "tier"
  | "capabilities"
  | "schedule"
  | "max_concurrent_tasks";

export interface FieldChange {
  field: ReconfigureField | string;
  old_value: unknown;
  new_value: unknown;
  requires_restart: boolean;
}

export interface HotReconfigureResult {
  config_hash_changed: boolean;
  changes: FieldChange[];
  requires_restart: boolean;
  restart_reason?: string;
  immediate_fields: string[];   // fields applied immediately
  restart_fields: string[];     // fields needing restart
}


export interface RegistryFilters {
  division?: string;
  tier?: number;
  status?: AgentLifecycleStatus;
  provider?: string;
}


/** How the daemon picks up work. */
export type DaemonMode =
  | "polling"    // periodically queries the task queue
  | "event"      // wakes on task-created events (future)
  | "on-demand"; // no loop — only activated by explicit trigger

/** Operational configuration for an agent's daemon loop. */
export interface AgentDaemonConfig {
  /** Loop mode. Default: "polling". */
  mode?: DaemonMode;
  /** How often to poll the queue (ms). Default: 5000. */
  poll_interval_ms?: number;
  /** Max tasks to run concurrently. Default: 1. */
  max_concurrent?: number;
  /** Shut down the daemon after being idle this long (ms). 0 = never. Default: 0. */
  idle_timeout_ms?: number;
  /** Watchdog authority settings — only set on IT-Admin and Guide agents. */
  watchdog?: {
    /** When true, this agent performs health checks on other agents. */
    restart_authority: boolean;
  };
  /** When true, the ProactiveScanner runs on each idle iteration. */
  proactive_checks?: boolean;
}

/** Watchdog agent configuration — used by WatchdogPair to identify the two watchdog agents. */
export interface WatchdogAgentConfig {
  /** Primary watchdog agent ID. Default: "it-admin". */
  watchdog_a: string;
  /** Secondary watchdog agent ID. Default: "guide". */
  watchdog_b: string;
  /** How often each watchdog performs a health check (ms). Default: 10000. */
  heartbeat_interval_ms: number;
  /** How many missed heartbeats before acting. Default: 3. */
  missed_heartbeat_threshold: number;
  /** How long the secondary watchdog waits before overriding the primary (ms). Default: 15000. */
  grace_period_ms: number;
  /** Max restart actions per watchdog per hour. Default: 10. */
  restart_budget_per_hour: number;
}

/** Runtime status snapshot for a running daemon. */
export interface DaemonStatus {
  agent_id:           string;
  running:            boolean;
  tasks_completed:    number;
  tasks_failed:       number;
  last_task_at:       string | null;
  started_at:         string | null;
  hourly_cost_usd:    number;
}

/** Budget + rate governance limits applied to daemon execution. */
export interface DaemonGovernance {
  /** Max tasks per hour across all daemons (org-level throttle). 0 = unlimited. */
  max_tasks_per_hour?: number;
  /** Max USD to spend per hour (sliding window). 0 = unlimited. */
  max_cost_per_hour_usd?: number;
  /** Crash window for circuit-breaker evaluation (ms). Default: 300000. */
  crash_window_ms?: number;
  /** Max crashes within crash_window_ms before opening circuit. Default: 5. */
  max_crashes_in_window?: number;
}

/** Audit record emitted by the daemon loop on key lifecycle events. */
export interface DaemonAuditEvent {
  agent_id:   string;
  event:      "started" | "stopped" | "task_dequeued" | "task_done" | "task_failed"
            | "budget_blocked" | "rate_blocked" | "circuit_open" | "idle_timeout";
  task_id?:   string;
  cost_usd?:  number;
  reason?:    string;
  timestamp:  string;
}
