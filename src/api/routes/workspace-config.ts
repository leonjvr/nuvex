// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Workspace Config REST Routes (P188)
 *
 * GET  /api/v1/config                  — returns workspace config (firstRunCompleted, etc.)
 * POST /api/v1/config/first-run-complete — marks first run as complete (idempotent)
 */

import type { Hono } from "hono";
import type { Database } from "../../utils/db.js";
import { runWorkspaceConfigMigration } from "../workspace-config-migration.js";
import { requireScope } from "../middleware/require-scope.js";
import { isProviderConfigured } from "../../core/provider-config.js";


function ensureMigrated(db: Database): void {
  runWorkspaceConfigMigration(db);
}

function getFirstRunCompleted(db: Database): boolean {
  ensureMigrated(db);
  const row = db
    .prepare<[], { value: string }>(
      "SELECT value FROM workspace_config WHERE key = 'first_run_completed'",
    )
    .get();
  if (row?.value === "1") return true;

  // Auto-complete first run if a provider is already configured.
  // This handles the case where the user configured a provider before the
  // first-run overlay was introduced (e.g. Docker upgrade) or where they
  // configured the provider via CLI / direct API before opening the GUI.
  try {
    if (isProviderConfigured()) {
      setFirstRunCompleted(db);
      return true;
    }
  } catch {
    // Non-fatal — provider config may not be readable yet
  }

  return false;
}

function setFirstRunCompleted(db: Database): void {
  ensureMigrated(db);
  db.prepare(
    "UPDATE workspace_config SET value = '1', updated_at = datetime('now') WHERE key = 'first_run_completed'",
  ).run();
}


export interface WorkspaceConfigRouteServices {
  db: Database;
}

/**
 * Register workspace config routes on the Hono app.
 *
 * GET  /api/v1/config                   → { firstRunCompleted: boolean }
 * POST /api/v1/config/first-run-complete → { success: true }
 */
export function registerWorkspaceConfigRoutes(
  app:      Hono,
  services: WorkspaceConfigRouteServices,
): void {
  const { db } = services;

  // GET /api/v1/config
  app.get("/api/v1/config", requireScope("readonly"), (c) => {
    const firstRunCompleted = getFirstRunCompleted(db);
    return c.json({ firstRunCompleted });
  });

  // POST /api/v1/config/first-run-complete
  app.post("/api/v1/config/first-run-complete", requireScope("operator"), (c) => {
    setFirstRunCompleted(db);
    return c.json({ success: true });
  });
}
