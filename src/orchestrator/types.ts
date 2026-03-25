// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 9: Orchestrator types
 *
 * All interfaces, enums, and type definitions for the Orchestrator.
 * Architecture: 3-tier hierarchy (T1→T2→T3), sequential event processing,
 * no LLM calls in orchestrator (pure coordination).
 */

import type { AgentDefinition, AgentProcess } from "../agents/index.js";
import type { Task, TaskStatus } from "../tasks/types.js";
import type { PipelineConfig } from "../pipeline/types.js";
import type { SandboxConfig } from "../core/sandbox/types.js";

// Re-export for convenience
export type { Task, TaskStatus };


export interface OrchestratorConfig {
  /** Total agent subprocess limit */
  max_agents: number;
  /** Per-tier limits: { 1: 2, 2: 5, 3: 20 } */
  max_agents_per_tier: Record<number, number>;
  /** Fallback poll interval when no IPC notification (ms, default: 500) */
  event_poll_interval_ms: number;
  /** How long to wait for agent acceptance of a task (ms) */
  delegation_timeout_ms: number;
  /** How long to wait for all sub-results during synthesis (ms) */
  synthesis_timeout_ms: number;
  /** Maximum delegation depth; V1 = 3 (T1→T2→T3) */
  max_tree_depth: number;
  /** Max sub-tasks per decomposition step */
  max_tree_breadth: number;
  /** Fallback division for root tasks */
  default_division: string;
  /** All configured agent definitions */
  agent_definitions: AgentDefinition[];
  /** Path to governance/ directory */
  governance_root: string;
  /** Delegation rules (tier hierarchy) */
  delegation_rules?: DelegationRule[];
  /** Phase 9.5 Task Pipeline configuration (optional — enables priority queuing). */
  pipeline?: PipelineConfig;
  /** Phase 19 Sandbox configuration (optional — enables process isolation). */
  sandbox?: SandboxConfig;
}


export type OrchestratorState =
  | "STOPPED"       // not running
  | "STARTING"      // spawning agents, loading config
  | "RUNNING"       // processing events
  | "PAUSING"       // draining current tasks, no new accepts
  | "PAUSED"        // all agents idle, no processing
  | "RESUMING"      // restarting from paused state
  | "SHUTTING_DOWN" // graceful shutdown, completing in-flight
  | "ERROR";        // unrecoverable error, needs restart

export interface OrchestratorStatus {
  state: OrchestratorState;
  uptime_seconds: number;
  agents: {
    total: number;
    by_tier: Record<number, number>;
    by_status: Record<string, number>;
  };
  tasks: {
    total: number;
    by_status: Record<string, number>;
    active_trees: number;
  };
  costs: {
    total_usd: number;
    by_division: Record<string, number>;
  };
}


export interface DelegationRule {
  from_tier: number;
  to_tier: number;
  allowed: boolean;
  requires_classification_match: boolean;
  budget_cascade: "proportional" | "fixed" | "remaining";
}

export interface DelegationDecision {
  allowed: boolean;
  reason: string;
  rule: DelegationRule | null;
}

export interface TaskDecomposition {
  title: string;
  description: string;
  tier: number;
  priority: number;
  token_budget?: number;            // if not specified, use proportional
  cost_budget?: number;
  capabilities_required: string[];
}

export interface BudgetAllocation {
  child_index: number;
  token_budget: number;
  cost_budget: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}


export interface AgentInstance {
  definition: AgentDefinition;
  process: AgentProcess;
  status: "idle" | "busy" | "overloaded" | "crashed" | "restarting";
  active_task_count: number;
  total_tasks_completed: number;
  total_tokens_used: number;
  total_cost_usd: number;
  last_heartbeat: string;           // ISO 8601
  started_at: string;
}


export interface WorkAssignment {
  task_id: string;
  agent_id: string;
  reason: string;
  alternatives_considered: number;
}

export interface AgentLoad {
  agent_id: string;
  active_tasks: number;
  max_tasks: number;
  utilization: number;              // 0.0 - 1.0
  tokens_used_this_hour: number;
  cost_used_this_hour: number;
}

export interface RebalanceResult {
  imbalanced: boolean;
  recommendations: Array<{
    task_id: string;
    from_agent: string;
    to_agent: string;
    reason: string;
  }>;
}


export type EscalationReason =
  | "max_retries_exceeded"
  | "budget_exceeded"
  | "timeout"
  | "capability_mismatch"
  | "agent_requested"     // agent explicitly says "I can't do this"
  | "repeated_crashes"
  | "quality_concern";    // parent reviews result, deems insufficient

export interface EscalationRecord {
  task_id: string;
  from_agent: string;
  from_tier: number;
  to_tier: number;
  reason: EscalationReason;
  timestamp: string;
  resolution: "reassigned" | "human_required" | "cancelled" | null;
}

export interface EscalationResult {
  action: "reassigned" | "escalated_to_parent" | "human_required" | "retrying";
  target_agent: string | null;
  target_tier: number | null;
  record: EscalationRecord;
}

export interface HumanDecision {
  action: "retry" | "cancel" | "reassign" | "resolve";
  guidance?: string;
  target_agent?: string;
  result?: string;
}


export interface ChildSummary {
  task_id: string;
  title: string;
  summary: string;
  confidence: number;
  result_file: string;
  status: "DONE" | "FAILED";
}

export interface SynthesisStatus {
  ready: boolean;
  parent_task_id: string;
  total_children: number;
  completed_children: number;
  remaining: number;
  child_summaries: ChildSummary[];  // only populated when ready === true
}

export interface TreeStatus {
  root_task_id: string;
  total_tasks: number;
  by_status: Record<string, number>;
  by_tier: Record<number, { total: number; done: number }>;
  estimated_completion: number;     // 0.0 - 1.0
  total_tokens: number;
  total_cost: number;
}

export type PartialFailureAction = "WAIT" | "SYNTHESIZE_PARTIAL" | "CANCEL_ALL";


export interface PeerRouteResult {
  routed: boolean;
  peer_agent: string | null;
  reason: string;
}


export interface TaskTreeNode {
  task: Task;
  children: TaskTreeNode[];
  depth: number;
}

export interface CancelResult {
  cancelled_count: number;
  already_terminal: number;         // tasks that were already DONE/FAILED/CANCELLED
  tasks_cancelled: string[];        // list of cancelled task IDs
}


export const DEFAULT_DELEGATION_RULES: DelegationRule[] = [
  // T1 → T2: allowed (delegation)
  {
    from_tier: 1,
    to_tier: 2,
    allowed: true,
    requires_classification_match: true,
    budget_cascade: "proportional",
  },
  // T2 → T3: allowed (delegation)
  {
    from_tier: 2,
    to_tier: 3,
    allowed: true,
    requires_classification_match: true,
    budget_cascade: "proportional",
  },
  // T1 → T3: allowed (skip-level for simple tasks)
  {
    from_tier: 1,
    to_tier: 3,
    allowed: true,
    requires_classification_match: true,
    budget_cascade: "fixed",
  },
  // T3 → T2: NOT allowed (escalation only)
  {
    from_tier: 3,
    to_tier: 2,
    allowed: false,
    requires_classification_match: false,
    budget_cascade: "proportional",
  },
  // T2 → T1: NOT allowed (escalation only)
  {
    from_tier: 2,
    to_tier: 1,
    allowed: false,
    requires_classification_match: false,
    budget_cascade: "proportional",
  },
  // Peer consultation T1 ↔ T1 (same tier)
  {
    from_tier: 1,
    to_tier: 1,
    allowed: true,
    requires_classification_match: true,
    budget_cascade: "fixed",
  },
  // Peer consultation T2 ↔ T2
  {
    from_tier: 2,
    to_tier: 2,
    allowed: true,
    requires_classification_match: true,
    budget_cascade: "fixed",
  },
  // Peer consultation T3 ↔ T3
  {
    from_tier: 3,
    to_tier: 3,
    allowed: true,
    requires_classification_match: true,
    budget_cascade: "fixed",
  },
];


/** SQL for Phase 9 schema additions (appended to existing migrations). */
export const PHASE9_SCHEMA_SQL = `
-- Orchestrator state persistence (crash recovery)
CREATE TABLE IF NOT EXISTS orchestrator_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL DEFAULT 'STOPPED',
  started_at TEXT,
  last_heartbeat TEXT,
  config_hash TEXT,
  updated_at TEXT NOT NULL
);

-- Escalation history
CREATE TABLE IF NOT EXISTS escalation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  from_agent TEXT NOT NULL,
  from_tier INTEGER NOT NULL,
  to_tier INTEGER NOT NULL,
  reason TEXT NOT NULL,
  resolution TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

-- Agent instance runtime tracking
CREATE TABLE IF NOT EXISTS agent_instances (
  agent_id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  pid INTEGER,
  active_task_count INTEGER NOT NULL DEFAULT 0,
  total_tasks_completed INTEGER NOT NULL DEFAULT 0,
  total_tokens_used INTEGER NOT NULL DEFAULT 0,
  total_cost_millicents INTEGER NOT NULL DEFAULT 0,
  last_heartbeat TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Human decision queue (T1 escalations requiring human intervention)
CREATE TABLE IF NOT EXISTS human_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  options TEXT NOT NULL,
  decision TEXT,
  guidance TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_escalation_task ON escalation_log(task_id);
CREATE INDEX IF NOT EXISTS idx_escalation_created ON escalation_log(created_at);
CREATE INDEX IF NOT EXISTS idx_human_decisions_pending ON human_decisions(decided_at) WHERE decided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agent_instances_status ON agent_instances(status);
`;


/** Raw YAML shape for governance/orchestrator.yaml */
export interface OrchestratorConfigRaw {
  max_agents?: number;
  max_agents_per_tier?: Record<string, number>;
  event_poll_interval_ms?: number;
  delegation_timeout_ms?: number;
  synthesis_timeout_ms?: number;
  max_tree_depth?: number;
  max_tree_breadth?: number;
  default_division?: string;
  governance_root?: string;
  /** HTTP API port for the built-in server (default: 3000). */
  api_port?: number;
  agents?: AgentDefinitionRaw[];
  delegation_rules?: DelegationRule[];
  /** Runtime deployment configuration (checkpoint interval, mode). */
  runtime?: {
    /** Deployment mode: "auto" (default), "server", or "desktop". */
    mode?: "auto" | "server" | "desktop";
    /** Checkpoint interval in seconds. Overrides mode-based default when set. */
    checkpoint_interval?: number;
  };
}

export interface AgentDefinitionRaw {
  id: string;
  name: string;
  tier: number;
  provider: string;
  model: string;
  skill_file: string;
  division: string;
  capabilities: string[];
  max_concurrent_tasks?: number;
  token_budget_per_task?: number;
  cost_limit_per_hour?: number;
  checkpoint_interval_ms?: number;
  ttl_default_seconds?: number;
  heartbeat_interval_ms?: number;
  max_retries?: number;
}
