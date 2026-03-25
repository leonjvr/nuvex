// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA GUI — Formatting utilities
 * Single source of truth for display formatting across all pages.
 */

/** Format a USD amount as "$0.00". */
export function formatCurrency(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** Format a duration in milliseconds as "2h 34m" or "45m" or "12s". */
export function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0)   return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Format an ISO timestamp as "HH:MM" (local time).
 * Returns "—" for invalid/empty inputs.
 */
export function formatTime(isoString: string | undefined | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Format an ISO timestamp as relative time ("2m ago", "1h ago").
 * Returns "—" for invalid inputs.
 */
export function formatRelative(isoString: string | undefined | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';

  const diffMs = Date.now() - d.getTime();
  const diffS  = Math.floor(diffMs / 1000);

  if (diffS < 60)   return 'just now';
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  return `${Math.floor(diffS / 86400)}d ago`;
}

/** Return ISO string for today at midnight (UTC). */
export function todayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Derive a human-readable description from an SSE event type and data.
 */
export function describeEvent(type: string, data: Record<string, unknown>): string {
  const agent = String(data['agentId'] ?? data['agent_id'] ?? '');
  const task  = String(data['taskId']  ?? data['task_id']  ?? '');

  switch (type) {
    case 'agent:started':   return `Agent ${agent} started`;
    case 'agent:stopped':   return `Agent ${agent} stopped`;
    case 'agent:crashed':   return `Agent ${agent} crashed`;
    case 'agent:restarted': return `Agent ${agent} restarted`;
    case 'agent:heartbeat': return `Agent ${agent} heartbeat`;
    case 'task:created':    return `Task created${task ? ` (${task.slice(0, 8)})` : ''}`;
    case 'task:assigned':   return `Task assigned to ${agent}`;
    case 'task:progress':   return `Task in progress`;
    case 'task:completed':  return `Task completed`;
    case 'task:failed':     return `Task failed`;
    case 'task:cancelled':  return `Task cancelled`;
    case 'governance:blocked':           return 'Governance: action blocked';
    case 'governance:approval_needed':   return 'Governance: approval required';
    case 'governance:rollback_started':  return 'Governance: rollback started';
    case 'governance:rollback_complete': return 'Governance: rollback complete';
    case 'cost:budget_warning':  return 'Budget warning';
    case 'cost:budget_exceeded': return 'Budget exceeded';
    case 'system:health_changed': return 'System health changed';
    case 'system:error':          return 'System error';
    default: return type;
  }
}
