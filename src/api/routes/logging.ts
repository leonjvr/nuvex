// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 11b: Logging REST Endpoints
 *
 * GET    /api/v1/logging/status        — current log levels for all components
 * PUT    /api/v1/logging/:component    — change log level at runtime (ephemeral)
 *
 * These routes wrap Phase 10.8 getLoggerStatus / setGlobalLevel / setComponentLevel.
 * No persistence — changes are in-memory only (reverted on restart).
 */

import { Hono } from "hono";
import { SidjuaError }     from "../../core/error-codes.js";
import { createLogger }    from "../../core/logger.js";
import { reqId }           from "../utils/request-id.js";
import { requireScope }    from "../middleware/require-scope.js";
import {
  getLoggerStatus,
  setGlobalLevel,
  setComponentLevel,
  type LogLevel,
} from "../../core/logger.js";

const logger = createLogger("api-logging");

const VALID_LEVELS = new Set<string>(["debug", "info", "warn", "error", "fatal", "off"]);


export function registerLoggingRoutes(app: Hono): void {
  // ---- GET /api/v1/logging/status ----------------------------------------

  app.get("/api/v1/logging/status", requireScope("readonly"), (c) => {
    const status = getLoggerStatus();
    return c.json(status);
  });

  // ---- PUT /api/v1/logging/:component ------------------------------------

  app.put("/api/v1/logging/:component", requireScope("admin"), async (c) => {
    const component = c.req.param("component");
    const body      = await c.req.json() as Record<string, unknown>;
    const level     = body["level"];

    if (typeof level !== "string" || !VALID_LEVELS.has(level)) {
      throw SidjuaError.from(
        "INPUT-003",
        `Invalid log level: ${String(level)}. Valid values: debug | info | warn | error | fatal | off`,
      );
    }

    const requestId = reqId(c);

    if (component === "global") {
      setGlobalLevel(level as LogLevel);
      logger.info("log_level_changed", `Global log level changed to ${level}`, {
        correlationId: requestId,
        metadata: { component: "global", level },
      });
    } else {
      setComponentLevel(component, level as LogLevel);
      logger.info("log_level_changed", `Log level for ${component} changed to ${level}`, {
        correlationId: requestId,
        metadata: { component, level },
      });
    }

    return c.json({ component, level, updated: true });
  });
}
