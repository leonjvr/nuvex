// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: Daemon API routes
 *
 * REST endpoints for daemon lifecycle management.
 *
 *   GET  /api/v1/daemon           — list all running daemon statuses
 *   GET  /api/v1/daemon/:id       — get status for a specific daemon
 *   POST /api/v1/daemon/:id/start   — start daemon for an agent
 *   POST /api/v1/daemon/:id/stop    — stop daemon for an agent
 *   POST /api/v1/daemon/:id/restart — restart daemon for an agent
 *
 * Returns 503 when no DaemonManagerLike is configured.
 */

import type { Hono } from "hono";
import { notFound } from "../utils/responses.js";
import type { DaemonStatus } from "../../agent-lifecycle/types.js";
import { requireScope } from "../middleware/require-scope.js";


/**
 * Minimal interface the daemon routes need from AgentDaemonManager.
 * Implemented by AgentDaemonManager; can be mocked in tests.
 */
export interface DaemonManagerLike {
  getAllStatuses(): DaemonStatus[];
  getStatus(agentId: string): DaemonStatus | undefined;
  startAgent(agentId: string): boolean;
  stopAgent(agentId: string): Promise<boolean>;
  restartAgent(agentId: string): Promise<boolean>;
}


export function registerDaemonRoutes(
  app:     Hono,
  manager: DaemonManagerLike | null,
): void {
  // ── GET /api/v1/daemon ──────────────────────────────────────────────────

  app.get("/api/v1/daemon", requireScope("readonly"), (c) => {
    if (manager === null) {
      return c.json(
        { error: { code: "SYS-503", message: "Daemon manager not configured", recoverable: true } },
        503,
      );
    }
    const daemons = manager.getAllStatuses();
    return c.json({ daemons });
  });

  // ── GET /api/v1/daemon/:id ───────────────────────────────────────────────

  app.get("/api/v1/daemon/:id", requireScope("readonly"), (c) => {
    if (manager === null) {
      return c.json(
        { error: { code: "SYS-503", message: "Daemon manager not configured", recoverable: true } },
        503,
      );
    }
    const agentId = c.req.param("id");
    const status  = manager.getStatus(agentId);
    if (status === undefined) {
      return notFound(c, `No daemon running for agent '${agentId}'`);
    }
    return c.json({ daemon: status });
  });

  // ── POST /api/v1/daemon/:id/start ────────────────────────────────────────

  app.post("/api/v1/daemon/:id/start", requireScope("operator"), (c) => {
    if (manager === null) {
      return c.json(
        { error: { code: "SYS-503", message: "Daemon manager not configured", recoverable: true } },
        503,
      );
    }
    const agentId = c.req.param("id");
    const started = manager.startAgent(agentId);
    if (!started) {
      return c.json(
        {
          error: {
            code:        "SYS-409",
            message:     `Daemon already running for agent '${agentId}'`,
            recoverable: false,
          },
        },
        409,
      );
    }
    return c.json({ agent_id: agentId, action: "started" }, 201);
  });

  // ── POST /api/v1/daemon/:id/stop ─────────────────────────────────────────

  app.post("/api/v1/daemon/:id/stop", requireScope("operator"), async (c) => {
    if (manager === null) {
      return c.json(
        { error: { code: "SYS-503", message: "Daemon manager not configured", recoverable: true } },
        503,
      );
    }
    const agentId = c.req.param("id");
    const stopped = await manager.stopAgent(agentId);
    if (!stopped) {
      return notFound(c, `No daemon running for agent '${agentId}'`);
    }
    return c.json({ agent_id: agentId, action: "stopped" });
  });

  // ── POST /api/v1/daemon/:id/restart ──────────────────────────────────────

  app.post("/api/v1/daemon/:id/restart", requireScope("operator"), async (c) => {
    if (manager === null) {
      return c.json(
        { error: { code: "SYS-503", message: "Daemon manager not configured", recoverable: true } },
        503,
      );
    }
    const agentId   = c.req.param("id");
    const restarted = await manager.restartAgent(agentId);
    if (!restarted) {
      return notFound(c, `Agent '${agentId}' not found in registry`);
    }
    return c.json({ agent_id: agentId, action: "restarted" });
  });
}
