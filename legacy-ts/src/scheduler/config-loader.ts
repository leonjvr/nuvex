// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: Scheduling governance config loader
 *
 * Loads SchedulingGovernance from defaults/scheduling.yaml.
 * Falls back to built-in defaults when file is absent.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SchedulingGovernance } from "./types.js";


export const DEFAULT_SCHEDULING_GOVERNANCE: SchedulingGovernance = {
  enabled: true,
  global_limits: {
    max_schedules_per_agent:          10,
    max_schedules_per_division:       50,
    max_total_scheduled_cost_per_day: 50.0,
    min_cron_interval_minutes:        5,
  },
  deadline_watcher: {
    enabled:                   true,
    check_interval_ms:         60_000,
    warning_threshold_percent: 80,
  },
};


/**
 * Load SchedulingGovernance from `<workDir>/defaults/scheduling.yaml`.
 * Returns built-in defaults when the file is absent or the key is missing.
 */
export function loadSchedulingGovernance(workDir: string): SchedulingGovernance {
  const configPath = join(workDir, "defaults", "scheduling.yaml");
  if (!existsSync(configPath)) return { ...DEFAULT_SCHEDULING_GOVERNANCE };

  try {
    const raw = readFileSync(configPath, "utf8");
    const doc = parseYaml(raw) as Record<string, unknown> | null;
    if (doc === null || typeof doc !== "object") return { ...DEFAULT_SCHEDULING_GOVERNANCE };

    const scheduling = doc["scheduling"] as Partial<SchedulingGovernance> | undefined;
    if (scheduling === undefined) return { ...DEFAULT_SCHEDULING_GOVERNANCE };

    const gl  = scheduling.global_limits   ?? DEFAULT_SCHEDULING_GOVERNANCE.global_limits;
    const dw  = scheduling.deadline_watcher ?? DEFAULT_SCHEDULING_GOVERNANCE.deadline_watcher;

    return {
      enabled: scheduling.enabled ?? DEFAULT_SCHEDULING_GOVERNANCE.enabled,
      global_limits: {
        max_schedules_per_agent:
          gl.max_schedules_per_agent          ?? DEFAULT_SCHEDULING_GOVERNANCE.global_limits.max_schedules_per_agent,
        max_schedules_per_division:
          gl.max_schedules_per_division       ?? DEFAULT_SCHEDULING_GOVERNANCE.global_limits.max_schedules_per_division,
        max_total_scheduled_cost_per_day:
          gl.max_total_scheduled_cost_per_day ?? DEFAULT_SCHEDULING_GOVERNANCE.global_limits.max_total_scheduled_cost_per_day,
        min_cron_interval_minutes:
          gl.min_cron_interval_minutes        ?? DEFAULT_SCHEDULING_GOVERNANCE.global_limits.min_cron_interval_minutes,
      },
      deadline_watcher: {
        enabled:
          dw.enabled                   ?? DEFAULT_SCHEDULING_GOVERNANCE.deadline_watcher.enabled,
        check_interval_ms:
          dw.check_interval_ms         ?? DEFAULT_SCHEDULING_GOVERNANCE.deadline_watcher.check_interval_ms,
        warning_threshold_percent:
          dw.warning_threshold_percent ?? DEFAULT_SCHEDULING_GOVERNANCE.deadline_watcher.warning_threshold_percent,
      },
    };
  } catch (_err) {
    return { ...DEFAULT_SCHEDULING_GOVERNANCE };
  }
}
