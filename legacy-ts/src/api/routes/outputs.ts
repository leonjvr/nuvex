// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 14: Task Output REST Endpoints
 *
 * GET  /api/v1/tasks/:taskId/outputs     — list outputs for a task
 * GET  /api/v1/outputs/:id               — get specific output
 * POST /api/v1/tasks/:taskId/outputs     — store a new output
 * GET  /api/v1/tasks/:taskId/summary     — latest summary for a task
 * GET  /api/v1/outputs/search            — semantic search (?q=...)
 * GET  /api/v1/outputs/stats             — output statistics
 */

import { Hono } from "hono";
import type { Database }          from "../../utils/db.js";
import { TaskOutputStore }        from "../../tasks/output-store.js";
import { TaskSummaryStore }       from "../../tasks/summary-store.js";
import { TaskOutputEmbedder }     from "../../tasks/output-embedder.js";
import { CommunicationManager }   from "../../tasks/communication-manager.js";
import { SidjuaError }            from "../../core/error-codes.js";
import { createLogger }           from "../../core/logger.js";
import { reqId }                  from "../utils/request-id.js";
import { requireScope }           from "../middleware/require-scope.js";
import type { OutputType }        from "../../tasks/output-store.js";
import type { CreateOutputInput } from "../../tasks/output-store.js";

const logger = createLogger("api-outputs");

export interface OutputRouteServices {
  db: Database;
}

const VALID_OUTPUT_TYPES = new Set<string>([
  "file", "report", "analysis", "code", "data", "summary",
]);

export function registerOutputRoutes(app: Hono, services: OutputRouteServices): void {
  const { db } = services;

  const outputStore  = new TaskOutputStore(db);
  const summaryStore = new TaskSummaryStore(db);
  const embedder     = new TaskOutputEmbedder(db, null); // no embedder by default
  const cm           = new CommunicationManager(outputStore, summaryStore, embedder);

  outputStore.initialize();
  summaryStore.initialize();
  embedder.initialize();

  // ── GET /api/v1/outputs/search ──────────────────────────────────────────
  // Must be registered BEFORE /api/v1/outputs/:id to avoid shadowing

  app.get("/api/v1/outputs/search", requireScope("readonly"), async (c) => {
    const q = c.req.query("q");
    if (!q || q.trim() === "") {
      return c.json({ error: { code: "INPUT-001", message: "q parameter is required", recoverable: false } }, 400);
    }
    const limit = parseInt(c.req.query("limit") ?? "5", 10);
    const results = await cm.searchOutputs(q, { limit: isNaN(limit) ? 5 : limit });
    logger.info("outputs_search", `Search: "${q}"`, { metadata: { q, count: results.length } });
    return c.json({ results });
  });

  // ── GET /api/v1/outputs/stats ───────────────────────────────────────────

  app.get("/api/v1/outputs/stats", requireScope("readonly"), (c) => {
    const stats = cm.getStats();
    return c.json(stats);
  });

  // ── GET /api/v1/outputs/:id ─────────────────────────────────────────────

  app.get("/api/v1/outputs/:id", requireScope("readonly"), (c) => {
    const id     = c.req.param("id");
    const output = outputStore.getById(id);
    if (output === null) {
      throw SidjuaError.from("OUTPUT-002", `Output not found: ${id}`);
    }
    // Strip binary content from response (return metadata only, content_text included)
    const { content_binary, ...rest } = output;
    void content_binary;
    return c.json(rest);
  });

  // ── GET /api/v1/tasks/:taskId/outputs ──────────────────────────────────

  app.get("/api/v1/tasks/:taskId/outputs", requireScope("readonly"), (c) => {
    const taskId  = c.req.param("taskId");
    const outputs = outputStore.getByTaskId(taskId);
    const result  = outputs.map(({ content_binary, ...rest }) => { void content_binary; return rest; });
    logger.info("outputs_list", `List outputs for task ${taskId}`, {
      metadata: { task_id: taskId, count: result.length },
    });
    return c.json({ outputs: result, total: result.length });
  });

  // ── POST /api/v1/tasks/:taskId/outputs ─────────────────────────────────

  app.post("/api/v1/tasks/:taskId/outputs", requireScope("agent"), async (c) => {
    const taskId = c.req.param("taskId");
    const body   = await c.req.json() as Record<string, unknown>;

    const agent_id    = body["agent_id"];
    const output_type = body["output_type"];
    const content_text = body["content_text"];

    if (typeof agent_id !== "string" || agent_id.trim() === "") {
      throw SidjuaError.from("INPUT-001", "agent_id is required");
    }
    if (typeof output_type !== "string" || !VALID_OUTPUT_TYPES.has(output_type)) {
      throw SidjuaError.from("INPUT-001", `output_type must be one of: ${[...VALID_OUTPUT_TYPES].join(", ")}`);
    }
    if (content_text === undefined && body["content_binary"] === undefined) {
      throw SidjuaError.from("OUTPUT-001");
    }

    const input: CreateOutputInput = {
      task_id:        taskId,
      agent_id:       agent_id as string,
      output_type:    output_type as OutputType,
      classification: typeof body["classification"] === "string" ? body["classification"] : "INTERNAL",
      ...(typeof content_text          === "string" && { content_text: content_text }),
      ...(typeof body["division_id"]   === "string" && { division_id:  body["division_id"] as string }),
      ...(typeof body["filename"]      === "string" && { filename:     body["filename"]    as string }),
      ...(typeof body["mime_type"]     === "string" && { mime_type:    body["mime_type"]   as string }),
    };

    const output = await cm.storeOutput(input);
    const { content_binary, ...rest } = output;
    void content_binary;

    logger.info("output_stored_api", `Stored output ${output.id} via API`, {
      metadata: { task_id: taskId, output_id: output.id },
    });
    return c.json(rest, 201);
  });

  // ── GET /api/v1/tasks/:taskId/summary ──────────────────────────────────

  app.get("/api/v1/tasks/:taskId/summary", requireScope("readonly"), (c) => {
    const taskId  = c.req.param("taskId");
    const summary = cm.getTaskSummary(taskId);
    if (summary === null) {
      return c.json(
        { error: { code: "SYS-003", message: `No summary found for task ${taskId}`, recoverable: false, request_id: reqId(c) } },
        404,
      );
    }
    return c.json(summary);
  });
}
