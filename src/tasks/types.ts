// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 7: Task System types
 *
 * All interfaces, enums, and type definitions for the Task System.
 * Decisions from V1-RUNTIME-DECISIONS-Q5-Q12.md:
 *   - 3 tiers (T1/T2/T3), fully async, file-based results.
 *   - UUIDs via crypto.randomUUID(). Timestamps: ISO 8601 UTC.
 *   - Peer consultation: task type "consultation", no counter increment.
 */


export type TaskStatus =
  | "CREATED"    // Task defined, not yet queued
  | "PENDING"    // In queue, waiting for assignment
  | "ASSIGNED"   // Assigned to agent, not yet started
  | "RUNNING"    // Agent actively working on task
  | "WAITING"    // Agent waiting for sub-task results
  | "REVIEW"     // Result ready, parent reviewing
  | "DONE"       // Completed successfully
  | "FAILED"     // Failed after retries exhausted
  | "ESCALATED"  // Escalated to higher tier
  | "CANCELLED"; // Cancelled by user or parent

export type TaskType =
  | "root"         // User-submitted top-level task
  | "delegation"   // Delegated from higher tier to lower tier
  | "consultation" // Peer consultation (same tier, horizontal)
  | "synthesis";   // Parent synthesizing child results


export interface Task {
  id: string;                        // UUID v4
  parent_id: string | null;          // null for root tasks
  root_id: string;                   // always points to original user task
  division: string;                  // division scope
  type: TaskType;
  tier: 1 | 2 | 3;                  // V1: 3 tiers only
  title: string;                     // short description
  description: string;               // full task description/instructions
  assigned_agent: string | null;     // agent ID
  status: TaskStatus;
  priority: number;                  // 1 (highest) - 5 (lowest)
  classification: string;            // security classification
  created_at: string;                // ISO 8601
  updated_at: string;                // ISO 8601
  started_at: string | null;
  completed_at: string | null;
  result_file: string | null;        // path to full result file
  result_summary: string | null;     // management summary text
  confidence: number | null;         // 0.0-1.0, agent self-assessment
  token_budget: number;              // max tokens for this task
  token_used: number;                // tokens consumed so far
  cost_budget: number;               // max cost USD for this task
  cost_used: number;                 // cost consumed so far
  ttl_seconds: number;               // timeout before considered hung
  retry_count: number;
  max_retries: number;               // default: 3
  checkpoint: string | null;         // serialized agent state (JSON)
  sub_tasks_expected: number;        // how many sub-task replies needed
  sub_tasks_received: number;        // how many received so far
  embedding_id: string | null;       // reserved for future embedding reference
  metadata: Record<string, unknown>; // extensible key-value store

  // Recurring schedule linkage
  recurring_schedule_id: string | null; // links back to ScheduleDefinition.id
  is_recurring: boolean;                // true for tasks created by CronScheduler

  // Messaging source metadata (populated when task originates from a message)
  source_metadata?: {
    source_channel:     string;   // adapter channel name (e.g. "telegram")
    source_instance_id: string;   // adapter instance ID
    source_message_id:  string;   // original message UUID
    source_chat_id:     string;   // platform chat/channel ID
    source_user:        string;   // sidjua_user_id
    attachments?: Array<{
      filename:   string;
      mime_type:  string;
      size_bytes: number;
      url?:       string;
    }>;
  };

  // Governance override tracking (populated when task was re-submitted after a block)
  governance_override?: {
    user_id:               string; // sidjua_user_id who granted override
    override_at:           string; // ISO 8601
    original_block_reason: string;
    original_block_rule:   string;
  };
}


export interface CreateTaskInput {
  title: string;
  description: string;
  division: string;
  type: TaskType;
  tier: 1 | 2 | 3;
  parent_id?: string;
  root_id?: string;
  priority?: number;                 // default: 3 (medium)
  classification?: string;           // default: "internal"
  assigned_agent?: string;
  token_budget: number;
  cost_budget: number;
  ttl_seconds?: number;              // default: tier-specific
  max_retries?: number;              // default: 3
  sub_tasks_expected?: number;       // default: 0
  metadata?: Record<string, unknown>;

  // Recurring schedule linkage (optional — defaults to null / false)
  recurring_schedule_id?: string;
  is_recurring?: boolean;

  // Messaging source metadata
  source_metadata?: Task["source_metadata"];

  // Governance override
  governance_override?: Task["governance_override"];
}


export type TaskEventType =
  | "TASK_CREATED"
  | "TASK_ASSIGNED"
  | "TASK_STARTED"
  | "TASK_PROGRESS"
  | "RESULT_READY"
  | "TASK_FAILED"
  | "TASK_ESCALATED"
  | "TASK_CANCELLED"
  | "CONSULTATION_REQUEST"
  | "CONSULTATION_RESPONSE"
  | "BUDGET_WARNING"
  | "BUDGET_EXHAUSTED"
  | "TTL_WARNING"
  | "PROVIDER_CALL_COMPLETE"
  | "CHECKPOINT_SAVED"
  // Phase 9: Orchestrator event types
  | "AGENT_CRASHED"
  | "AGENT_RECOVERED"
  | "HEARTBEAT_TIMEOUT"
  | "SYNTHESIS_READY"    // all children done, parent should synthesize
  // Phase 9.5: Task Pipeline ACK events
  | "PIPELINE_ACK_UPDATE"  // pipeline state change notification to producer
  // Security audit events
  | "GOVERNANCE_BYPASS";   // governance pipeline intentionally skipped (e.g. --wait mode)

export interface TaskEvent {
  id: string;                        // UUID v4
  event_type: TaskEventType;
  task_id: string;
  parent_task_id: string | null;
  agent_from: string | null;         // agent that generated event
  agent_to: string | null;           // agent that should receive event
  division: string;
  data: Record<string, unknown>;     // event-specific payload
  created_at: string;                // ISO 8601
  consumed: boolean;
  consumed_at: string | null;
}

// Input for emitting a new TaskEvent (id + timestamps auto-generated)
export type TaskEventInput = Omit<TaskEvent, "id" | "created_at" | "consumed" | "consumed_at">;


export interface ManagementSummary {
  task_id: string;
  parent_task_id: string;
  agent_id: string;
  confidence: number;                // 0.0-1.0
  key_findings: string;              // 2-5 sentence summary
  result_file: string;               // path to full result
  tokens_used: number;
  cost_usd: number;
  completed_at: string;
}


export interface ResultFrontmatter {
  task_id: string;
  parent_task: string | null;
  root_task: string;
  agent: string;
  division: string;
  tier: number;
  type: TaskType;
  confidence: number;
  status: "complete" | "partial" | "failed";
  tokens_used: number;
  cost_usd: number;
  timestamp: string;                 // ISO 8601
  classification: string;
}


export interface TaskTreeNode {
  task: Task;
  children: TaskTreeNode[];
  depth: number;
}


export interface AgentTodoList {
  agent_id: string;
  active: Task[];     // RUNNING tasks
  waiting: Task[];    // WAITING for sub-task results
  queued: Task[];     // PENDING tasks, ordered by priority
  total_token_budget: number;
  total_cost_budget: number;
}


export interface TransitionContext {
  agent_id?: string;
  reason?: string;
  error_message?: string;
  result_summary?: string;
  confidence?: number;
}


export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}


export interface IPCChannel {
  send(targetAgentId: string, event: TaskEvent): void;
  onMessage(callback: (event: TaskEvent) => void): void;
}


export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  search(query: string, limit: number): Promise<EmbeddingResult[]>;
}

export interface EmbeddingResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

/** Placeholder — Phase 8+ provides real implementation. */
export class NoOpEmbeddingProvider implements EmbeddingProvider {
  async embed(_text: string): Promise<Float32Array> { return new Float32Array(0); }
  async search(_query: string, _limit: number): Promise<EmbeddingResult[]> { return []; }
}


export const DEFAULT_TTL_SECONDS: Record<1 | 2 | 3, number> = {
  1: 3600,  // T1: 1 hour  — strategic analysis
  2: 1800,  // T2: 30 min  — management decomposition
  3: 600,   // T3: 10 min  — worker execution
};
