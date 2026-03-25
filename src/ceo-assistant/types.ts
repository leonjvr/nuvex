// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — CEO Assistant: Types
 *
 * Data model for the CEO Assistant agent — task queue, briefing tiers,
 * and session state.
 */


export type AssistantTaskPriority = "P1" | "P2" | "P3" | "P4";
export type AssistantTaskStatus   = "open" | "in_progress" | "done" | "cancelled";

export interface AssistantTask {
  id:            number;
  agent_id:      string;
  title:         string;
  priority:      AssistantTaskPriority;
  status:        AssistantTaskStatus;
  deadline?:     string;          // ISO-8601 date or datetime
  context_notes?: string;
  created_at:    string;
  updated_at:    string;
  completed_at?: string;
}

export interface CreateTaskInput {
  agent_id:       string;
  title:          string;
  priority?:      AssistantTaskPriority;
  deadline?:      string;
  context_notes?: string;
}

export interface UpdateTaskInput {
  title?:          string;
  priority?:       AssistantTaskPriority;
  status?:         AssistantTaskStatus;
  deadline?:       string;
  context_notes?:  string;
}

export interface TaskListFilter {
  status?:    AssistantTaskStatus;
  priority?:  AssistantTaskPriority;
  overdue?:   boolean;
}


export type BriefingTier = "free" | "upgraded";

export interface SessionBriefing {
  tier:           BriefingTier;
  text:           string;
  open_count:     number;
  overdue_count:  number;
  last_session?:  string;   // summary from last session checkpoint
}


export type TaskIntentType =
  | "add_task"
  | "list_tasks"
  | "complete_task"
  | "cancel_task"
  | "overdue_tasks"
  | "update_priority"
  | "dienstschluss"
  | "unknown";

export interface ParsedTaskIntent {
  type:      TaskIntentType;
  title?:    string;       // for add/complete/cancel
  deadline?: string;       // for add_task (natural language date)
  priority?: AssistantTaskPriority;
  filter?:   TaskListFilter;
}


export interface DienstschlussSummary {
  session_summary:     string;
  tasks_created:       number;
  tasks_completed:     number;
  open_tasks_snapshot: AssistantTask[];
  sign_off:            string;
}
