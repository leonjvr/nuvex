// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Budget Tracker
 *
 * Tracks per-division integration spend against the limits defined in each
 * division's web access policy.
 *
 * Two implementations are provided:
 *
 *   InMemoryGatewayBudgetTracker — simple, zero-dependency tracker used in
 *     tests and single-process deployments.  Resets on process restart.
 *
 * A SQLite-backed implementation that writes to the existing `cost_ledger`
 * table (with source='integration_gateway') is the recommended production
 * approach and can be wired by callers that already hold a `Database` handle.
 *
 * Both implement the `GatewayBudgetService` interface from types.ts.
 */

import type { GatewayBudgetService } from "./types.js";


interface BucketEntry {
  /** Total spend today (UTC calendar day) */
  daily: number;
  /** Total spend this month (UTC calendar month) */
  monthly: number;
  /** ISO date string for the current tracked day (YYYY-MM-DD) */
  dayKey: string;
  /** ISO month string for the current tracked month (YYYY-MM) */
  monthKey: string;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function thisMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/**
 * In-memory implementation of `GatewayBudgetService`.
 *
 * Automatically resets per-period counters when the day or month changes.
 * Not suitable for multi-process deployments — use a DB-backed implementation
 * in production.
 */
export class InMemoryGatewayBudgetTracker implements GatewayBudgetService {
  private readonly buckets = new Map<string, BucketEntry>();

  /**
   * Return the current spend for `division` in the given `period`.
   * Returns 0 for unknown divisions.
   */
  async getCurrentSpend(division: string, period: "daily" | "monthly"): Promise<number> {
    const entry = this.getOrReset(division);
    return period === "daily" ? entry.daily : entry.monthly;
  }

  /**
   * Record a spend event.  `amount` is in USD.  `service` is informational only.
   */
  async recordSpend(division: string, amount: number, _service: string): Promise<void> {
    const entry = this.getOrReset(division);
    entry.daily   += amount;
    entry.monthly += amount;
  }

  /** Reset spend counters for a division (useful in tests). */
  resetDivision(division: string): void {
    this.buckets.delete(division);
  }

  /** Reset all counters. */
  resetAll(): void {
    this.buckets.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private getOrReset(division: string): BucketEntry {
    const day   = todayKey();
    const month = thisMonthKey();
    const existing = this.buckets.get(division);

    if (existing !== undefined) {
      // Reset counters if the period rolled over
      if (existing.dayKey !== day) {
        existing.daily  = 0;
        existing.dayKey = day;
      }
      if (existing.monthKey !== month) {
        existing.monthly  = 0;
        existing.monthKey = month;
      }
      return existing;
    }

    const fresh: BucketEntry = { daily: 0, monthly: 0, dayKey: day, monthKey: month };
    this.buckets.set(division, fresh);
    return fresh;
  }
}
