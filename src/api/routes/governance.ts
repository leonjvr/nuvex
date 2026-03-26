// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 11b: Governance REST Endpoints
 *
 * GET    /api/v1/governance/status              — current governance state
 * GET    /api/v1/governance/history             — list governance snapshots
 * POST   /api/v1/governance/rollback/:version   — trigger rollback to snapshot
 * GET    /api/v1/governance/diff/:version       — diff current vs snapshot
 */

import Database from "better-sqlite3";
import { Hono } from "hono";
import { SidjuaError }      from "../../core/error-codes.js";
import { createLogger }     from "../../core/logger.js";
import { reqId }            from "../utils/request-id.js";
import { hasTable }         from "../../core/db/helpers.js";
import { notFound }         from "../utils/responses.js";
import {
  listSnapshots,
  loadSnapshot,
  restoreSnapshot,
  diffSnapshot,
} from "../../governance/rollback.js";
import { requireScope } from "../middleware/require-scope.js";

const logger = createLogger("api-governance");


export interface GovernanceRouteServices {
  workDir: string;
  db:      InstanceType<typeof Database> | null;
}


export function registerGovernanceRoutes(app: Hono, services: GovernanceRouteServices): void {
  const { workDir, db } = services;

  // ---- GET /api/v1/governance/status -------------------------------------

  app.get("/api/v1/governance/status", requireScope("readonly"), (c) => {
    const snapshots = listSnapshots(workDir);

    let lastApplyAt: string | null = null;
    if (db !== null && hasTable(db, "divisions")) {
      const row = db.prepare("SELECT updated_at FROM divisions ORDER BY updated_at DESC LIMIT 1").get() as { updated_at: string } | undefined;
      lastApplyAt = row?.updated_at ?? null;
    }

    return c.json({
      snapshot_count:  snapshots.length,
      latest_snapshot: snapshots[0] ?? null,
      last_apply_at:   lastApplyAt,
      work_dir:        workDir,
    });
  });

  // ---- GET /api/v1/governance/history ------------------------------------

  app.get("/api/v1/governance/history", requireScope("readonly"), (c) => {
    const snapshots = listSnapshots(workDir);
    return c.json({ snapshots });
  });

  // ---- POST /api/v1/governance/rollback/:version -------------------------

  app.post("/api/v1/governance/rollback/:version", requireScope("admin"), async (c) => {
    const versionStr = c.req.param("version");
    const version    = parseInt(versionStr, 10);

    if (isNaN(version) || version < 1) {
      throw SidjuaError.from("INPUT-003", `Invalid version: ${versionStr}`);
    }

    const snapshot = loadSnapshot(workDir, version);
    if (snapshot === null) {
      return notFound(c, `Snapshot version ${version} not found`);
    }

    // restoreSnapshot throws SidjuaError(GOV-008) if rollback is already in progress
    restoreSnapshot(workDir, snapshot, db);

    logger.info("governance_rollback", `Governance rolled back to version ${version}`, {
      correlationId: reqId(c),
      metadata: { version, snapshot_id: snapshot.id },
    });

    return c.json({
      message:  `Governance rolled back to version ${version}`,
      snapshot,
    });
  });

  // ---- GET /api/v1/governance/diff/:version ------------------------------

  app.get("/api/v1/governance/diff/:version", requireScope("readonly"), (c) => {
    const versionStr = c.req.param("version");
    const version    = parseInt(versionStr, 10);

    if (isNaN(version) || version < 1) {
      throw SidjuaError.from("INPUT-003", `Invalid version: ${versionStr}`);
    }

    const snapshot = loadSnapshot(workDir, version);
    if (snapshot === null) {
      return notFound(c, `Snapshot version ${version} not found`);
    }

    const configPath = `${workDir}/divisions.yaml`;
    const diff       = diffSnapshot(workDir, snapshot, configPath);

    return c.json({ version, snapshot_id: snapshot.id, diff });
  });
}
