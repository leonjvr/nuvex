// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 11b: Orchestrator REST Endpoints
 *
 * POST   /api/v1/orchestrator/pause   — pause the orchestrator
 * POST   /api/v1/orchestrator/resume  — resume the orchestrator
 * GET    /api/v1/orchestrator/status  — current orchestrator state + metrics
 *
 * The orchestrator instance is injected optionally. If not provided (e.g., server
 * started without an active orchestrator), routes return 503.
 */

import { Hono } from "hono";
import { SidjuaError }  from "../../core/error-codes.js";
import { createLogger } from "../../core/logger.js";
import type { OrchestratorStatus, OrchestratorState } from "../../orchestrator/index.js";
import { requireScope } from "../middleware/require-scope.js";

const logger = createLogger("api-orchestrator");


export interface OrchestratorLike {
  readonly state: OrchestratorState;
  pause():  Promise<void>;
  resume(): Promise<void>;
  getStatus(): OrchestratorStatus;
}

export interface OrchestratorRouteServices {
  orchestrator: OrchestratorLike | null;
}


export function registerOrchestratorRoutes(app: Hono, services: OrchestratorRouteServices): void {
  function getOrchestrator(): OrchestratorLike {
    if (services.orchestrator === null) {
      throw SidjuaError.from("AGT-003", "Orchestrator is not running");
    }
    return services.orchestrator;
  }

  // ---- GET /api/v1/orchestrator/status -----------------------------------

  app.get("/api/v1/orchestrator/status", requireScope("readonly"), (c) => {
    if (services.orchestrator === null) {
      return c.json({ state: "STOPPED" as OrchestratorState, agents: [], pending_taskcount: 0, total_events_processed: 0, started_at: null });
    }
    return c.json(services.orchestrator.getStatus());
  });

  // ---- POST /api/v1/orchestrator/pause -----------------------------------

  app.post("/api/v1/orchestrator/pause", requireScope("operator"), async (c) => {
    const orch = getOrchestrator();

    if (orch.state === "PAUSED" || orch.state === "PAUSING") {
      return c.json({ state: orch.state, message: "Orchestrator is already pausing/paused" });
    }

    await orch.pause();

    logger.info("orchestrator_paused", "Orchestrator paused via API", {});
    return c.json({ state: orch.state, message: "Orchestrator paused" });
  });

  // ---- POST /api/v1/orchestrator/resume ----------------------------------

  app.post("/api/v1/orchestrator/resume", requireScope("operator"), async (c) => {
    const orch = getOrchestrator();

    if (orch.state === "RUNNING") {
      return c.json({ state: orch.state, message: "Orchestrator is already running" });
    }

    await orch.resume();

    logger.info("orchestrator_resumed", "Orchestrator resumed via API", {});
    return c.json({ state: orch.state, message: "Orchestrator resumed" });
  });
}
