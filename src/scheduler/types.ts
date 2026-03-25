// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: Scheduler Types
 *
 * Types for the CronScheduler, DeadlineWatcher, and scheduling governance.
 */


export interface ScheduleDefinition {
  id:              string;
  agent_id:        string;
  division:        string;
  cron_expression: string;
  task_template: {
    description:    string;
    priority:       number;
    budget_tokens?: number;
    budget_usd?:    number;
    ttl_seconds?:   number;
  };
  enabled:  boolean;
  governance: {
    max_cost_per_run:  number;
    max_runs_per_day:  number;
    require_approval:  boolean;
  };
  last_run_at:    string | null;
  next_run_at:    string;
  total_runs:     number;
  total_cost_usd: number;
}

export interface ScheduleCreateInput {
  agent_id:        string;
  division:        string;
  cron_expression: string;
  task_template:   ScheduleDefinition["task_template"];
  enabled?:        boolean;
  governance?:     Partial<ScheduleDefinition["governance"]>;
}


export interface EscalationEvent {
  task_id:   string;
  type:      "approaching_deadline" | "deadline_passed" | "budget_exhausted";
  severity:  "warning" | "critical";
  details:   string;
  timestamp: string;
}


export interface SchedulingGovernance {
  enabled: boolean;
  global_limits: {
    max_schedules_per_agent:           number;
    max_schedules_per_division:        number;
    max_total_scheduled_cost_per_day:  number;
    min_cron_interval_minutes:         number;
  };
  deadline_watcher: {
    enabled:                    boolean;
    check_interval_ms:          number;
    warning_threshold_percent:  number;
  };
}


export interface AgentScheduleEntry {
  id:              string;
  cron_expression: string;
  task_template: {
    description:    string;
    priority?:      number;
    budget_tokens?: number;
    budget_usd?:    number;
    ttl_seconds?:   number;
  };
  enabled?:    boolean;
  governance?: Partial<ScheduleDefinition["governance"]>;
}

export interface AgentConfig {
  id:        string;
  division:  string;
  schedules?: AgentScheduleEntry[];
}


export interface BudgetTrackerLike {
  canAfford(amountUsd: number): boolean;
}
