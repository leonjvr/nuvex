// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 9.5: Task Pipeline Types
 *
 * Priority queuing, ACK tracking, and backpressure types for the
 * TaskPipeline broker that sits between the Orchestrator and agents.
 *
 * Note: This file is in src/pipeline/ alongside the Phase 5 Pre-Action
 * Governance Pipeline. These are separate concerns that share the directory.
 */


/**
 * Task priority levels. Lower numeric value = higher priority.
 * ORDER BY priority ASC gives CRITICAL first.
 */
export enum TaskPriority {
  CRITICAL   = 0, // human escalation responses, system emergencies
  URGENT     = 1, // time-sensitive, producer explicitly flags
  REGULAR    = 2, // default for all tasks
  LOW        = 3, // background analysis, non-blocking
  BACKGROUND = 4, // housekeeping, cleanup, optional work
}


/**
 * ACK state machine for a queued task.
 *
 * Valid transitions:
 *   QUEUED    → ACCEPTED, EXPIRED, CANCELLED
 *   ACCEPTED  → RUNNING, REJECTED, CANCELLED, FAILED
 *   RUNNING   → COMPLETED, FAILED, CANCELLED
 *   FAILED    → QUEUED  (retry)
 *   REJECTED  → QUEUED  (requeue)
 */
export enum AckState {
  QUEUED    = "QUEUED",    // received by pipeline, waiting for agent
  ACCEPTED  = "ACCEPTED",  // agent picked up task
  RUNNING   = "RUNNING",   // agent actively working
  COMPLETED = "COMPLETED", // agent finished, result available
  FAILED    = "FAILED",    // agent failed, may retry
  REJECTED  = "REJECTED",  // agent cannot handle (capability mismatch)
  CANCELLED = "CANCELLED", // cancelled by parent or human
  EXPIRED   = "EXPIRED",   // TTL exceeded while in QUEUED state
}

/** Terminal states — no further transitions allowed. */
export const TERMINAL_ACK_STATES = new Set<AckState>([
  AckState.COMPLETED,
  AckState.CANCELLED,
  AckState.EXPIRED,
]);

/** Valid state transitions. */
export const VALID_TRANSITIONS: ReadonlyMap<AckState, ReadonlySet<AckState>> = new Map([
  [AckState.QUEUED,    new Set([AckState.ACCEPTED, AckState.EXPIRED, AckState.CANCELLED])],
  [AckState.ACCEPTED,  new Set([AckState.RUNNING,  AckState.REJECTED, AckState.CANCELLED, AckState.FAILED])],
  [AckState.RUNNING,   new Set([AckState.COMPLETED, AckState.FAILED, AckState.CANCELLED])],
  [AckState.FAILED,    new Set([AckState.QUEUED])],
  [AckState.REJECTED,  new Set([AckState.QUEUED])],
  [AckState.COMPLETED, new Set()],
  [AckState.CANCELLED, new Set()],
  [AckState.EXPIRED,   new Set()],
]);


export interface PipelineConfig {
  /** Max tasks queued per consumer agent (default: 50). */
  max_queue_size_per_agent: number;
  /** Max total tasks in the pipeline across all agents (default: 500). */
  max_queue_size_global: number;
  /** Promote REGULAR→URGENT after N ms waiting (default: 300_000 = 5 min). */
  priority_boost_after_ms: number;
  /** Default TTL for queued tasks in ms (default: 600_000 = 10 min). */
  ttl_default_ms: number;
  /** Override TTL per priority level. */
  ttl_by_priority: Record<TaskPriority, number>;
  /** How long to wait for ACCEPTED after delivery (default: 10_000 ms). */
  ack_timeout_ms: number;
  /** Retry delivery if agent doesn't ACK (default: 5_000 ms). */
  delivery_retry_interval_ms: number;
  /** Max delivery attempts before requeue to different agent (default: 3). */
  max_delivery_retries: number;
  /** Interval for starvation check (default: 60_000 ms). */
  starvation_check_interval_ms: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  max_queue_size_per_agent:     50,
  max_queue_size_global:        500,
  priority_boost_after_ms:      300_000,
  ttl_default_ms:               600_000,
  ttl_by_priority: {
    [TaskPriority.CRITICAL]:   60_000,
    [TaskPriority.URGENT]:     300_000,
    [TaskPriority.REGULAR]:    600_000,
    [TaskPriority.LOW]:        1_800_000,
    [TaskPriority.BACKGROUND]: 3_600_000,
  },
  ack_timeout_ms:               10_000,
  delivery_retry_interval_ms:   5_000,
  max_delivery_retries:         3,
  starvation_check_interval_ms: 60_000,
};


export interface QueueEntry {
  task_id:           string;
  producer_agent_id: string;       // who submitted this task
  consumer_agent_id: string | null; // assigned consumer (null = unassigned)
  priority:          TaskPriority;
  original_priority: TaskPriority; // before any automatic boost
  ack_state:         AckState;
  queued_at:         string;       // ISO 8601
  accepted_at:       string | null;
  started_at:        string | null;
  completed_at:      string | null;
  ttl_expires_at:    string;       // task expires if not picked up
  delivery_attempts: number;
  last_delivery_at:  string | null;
  excluded_agents:   string[];     // agent IDs to skip during assignment
  metadata:          Record<string, string>;
}


export interface PipelineNotification {
  task_id:           string;
  producer_agent_id: string;
  consumer_agent_id: string | null;
  previous_state:    AckState;
  new_state:         AckState;
  timestamp:         string;
  details:           string;
}


export interface BackpressureStatus {
  agent_id:       string;
  capacity:       number;        // max_concurrent_tasks
  active:         number;        // currently running
  queued:         number;        // waiting in pipeline for this agent
  utilization:    number;        // 0.0 – 1.0 (active / capacity)
  queue_pressure: number;        // 0.0 – 1.0 (queued / max_queue_size_per_agent)
  accepting:      boolean;       // false when utilization >= 1.0
  recommendation: BackpressureRecommendation;
}

export type BackpressureRecommendation = "accept" | "queue" | "redirect";


export interface SubmitResult {
  accepted:          boolean;
  task_id:           string;
  queue_position:    number | null;  // position within priority lane
  estimated_wait_ms: number | null;  // rough estimate
  reason?:           string;         // if not accepted
}

export interface QueueStatus {
  total_queued:        number;
  by_priority:         Record<TaskPriority, number>;
  oldest_queued_ms:    number;              // age of oldest QUEUED task
  throughput_per_minute: number;           // COMPLETED in last minute
  agents_accepting:    number;
  agents_at_capacity:  number;
}

export interface TaskPosition {
  task_id:           string;
  priority:          TaskPriority;
  position_in_lane:  number;         // 1-based within priority lane
  total_ahead:       number;         // tasks ahead across all higher-priority lanes
  consumer_agent_id: string | null;
  ack_state:         AckState;
  queued_since_ms:   number;
}


export interface TransitionResult {
  valid:          boolean;
  reason?:        string;
  notification?:  PipelineNotification;
}

export interface AckTransition {
  task_id:    string;
  from_state: AckState;
  to_state:   AckState;
  agent_id:   string;
  details:    string;
  timestamp:  string;
}

export interface TimedOutTask {
  task_id:          string;
  ack_state:        AckState;
  delivery_attempts: number;
  last_delivery_at: string;
  age_ms:           number;
}


export interface ExpiredTask {
  task_id:           string;
  producer_agent_id: string;
  priority:          TaskPriority;
  queued_at:         string;
  ttl_expires_at:    string;
}


export const PIPELINE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS pipeline_queue (
    task_id           TEXT PRIMARY KEY,
    producer_agent_id TEXT NOT NULL,
    consumer_agent_id TEXT,
    priority          INTEGER NOT NULL DEFAULT 2,
    original_priority INTEGER NOT NULL DEFAULT 2,
    ack_state         TEXT NOT NULL DEFAULT 'QUEUED',
    queued_at         TEXT NOT NULL,
    accepted_at       TEXT,
    started_at        TEXT,
    completed_at      TEXT,
    ttl_expires_at    TEXT NOT NULL,
    delivery_attempts INTEGER NOT NULL DEFAULT 0,
    last_delivery_at  TEXT,
    excluded_agents   TEXT,
    metadata          TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE TABLE IF NOT EXISTS pipeline_ack_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state   TEXT NOT NULL,
    agent_id   TEXT NOT NULL,
    details    TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pipeline_state
    ON pipeline_queue(ack_state);
  CREATE INDEX IF NOT EXISTS idx_pipeline_priority
    ON pipeline_queue(priority, queued_at);
  CREATE INDEX IF NOT EXISTS idx_pipeline_consumer
    ON pipeline_queue(consumer_agent_id, ack_state);
  CREATE INDEX IF NOT EXISTS idx_pipeline_producer
    ON pipeline_queue(producer_agent_id, ack_state);
  CREATE INDEX IF NOT EXISTS idx_pipeline_ttl
    ON pipeline_queue(ttl_expires_at) WHERE ack_state = 'QUEUED';
  CREATE INDEX IF NOT EXISTS idx_ack_history_task
    ON pipeline_ack_history(task_id);
`;
