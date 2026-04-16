// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Delegation Bridge: Core Types
 *
 * Types for the inter-agent delegation system.
 * Agents use these via the delegate_task / list_available_agents /
 * check_delegation_status tools.
 */


export interface DelegationRequest {
  /** ID of the parent (delegating) task. */
  parent_task_id:  string;
  /** Agent ID creating the delegation. */
  source_agent_id: string;
  /** Agent ID that will execute the subtask. */
  target_agent_id: string;
  /** What the worker should do. */
  description:     string;
  priority:        number;
  /** Budget in USD allocated from parent task. */
  budget_usd:      number;
  /** ISO timestamp; inherited from parent if absent. */
  deadline_at?:    string;
  /** Additional context from parent task. */
  context?:        string;
  /** When true, parent waits for result before continuing. */
  require_result:  boolean;
}


export interface DelegationResult {
  subtask_id:       string;
  parent_task_id:   string;
  target_agent_id:  string;
  status:           "completed" | "failed" | "timeout" | "rejected";
  /** Worker output, first 2000 characters. */
  result_summary:   string;
  cost_usd:         number;
  duration_ms:      number;
  completed_at:     string;
}


export interface DelegationPolicy {
  agent_id:         string;
  can_delegate_to:  string[];  // agent IDs this agent may delegate to
  max_subtasks:     number;    // max concurrent subtasks (default 5)
  max_depth:        number;    // max delegation depth (V1.0: always 1)
  budget_share_max: number;    // max fraction of parent budget per subtask (0.5 = 50%)
  require_approval: boolean;   // human must approve (V1.0 default: false)
}


export type DelegationEvent =
  | { type: "delegation_created";   request: DelegationRequest; subtask_id: string }
  | { type: "delegation_completed"; result: DelegationResult }
  | { type: "delegation_failed";    result: DelegationResult }
  | { type: "delegation_rejected";  request: DelegationRequest; reason: string }
  | { type: "delegation_timeout";   subtask_id: string; parent_task_id: string };


export interface DelegationConfig {
  enabled:                boolean;
  max_depth:              number;   // V1.0: 1
  max_subtasks_per_task:  number;   // default 5
  default_timeout_seconds: number;  // default 300
  budget_share_max:       number;   // default 0.5
  require_approval:       boolean;  // default false
  tier_permissions: {
    T1: string[];
    T2: string[];
    T3: string[];
  };
}

export const DEFAULT_DELEGATION_CONFIG: DelegationConfig = {
  enabled:                true,
  max_depth:              1,
  max_subtasks_per_task:  5,
  default_timeout_seconds: 300,
  budget_share_max:       0.5,
  require_approval:       false,
  tier_permissions: {
    T1: ["delegate_task", "list_available_agents", "check_delegation_status"],
    T2: ["delegate_task", "list_available_agents", "check_delegation_status"],
    T3: ["list_available_agents"],
  },
};
