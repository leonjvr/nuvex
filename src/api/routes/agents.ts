// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 11b: Agent REST Endpoints
 *
 * GET    /api/v1/agents              — list agents (filterable by tier/status/division)
 * GET    /api/v1/agents/:id          — agent detail
 * POST   /api/v1/agents/:id/start   — start agent
 * POST   /api/v1/agents/:id/stop    — stop agent (graceful)
 */

import { Hono } from "hono";
import { SidjuaError }    from "../../core/error-codes.js";
import { createLogger }   from "../../core/logger.js";
import { DIVISION_RE, validateDivisionName } from "../../core/validation/division.js";
import { reqId } from "../utils/request-id.js";
import { requireScope } from "../middleware/require-scope.js";
import { getProviderForAgent } from "../../core/provider-config.js";
import type {
  AgentDefinitionRow,
  AgentLifecycleStatus,
  RegistryFilters,
} from "../../agent-lifecycle/index.js";


/** Valid agent tiers as defined in the SIDJUA governance model. */
const VALID_AGENT_TIERS = new Set<number>([1, 2, 3]);

/** Valid agent lifecycle statuses. */
const VALID_AGENT_STATUSES = ["stopped", "starting", "active", "idle", "stopping", "error", "deleted"] as const;

/** Type guard for AgentLifecycleStatus. */
function isValidAgentStatus(s: string): s is AgentLifecycleStatus {
  return (VALID_AGENT_STATUSES as readonly string[]).includes(s);
}

/**
 * Validate a tier query parameter.
 * Accepts only the exact strings "1", "2", "3" (not "1abc", "1e2", etc.).
 *
 * ParseInt("1abc") → 1 would silently accept malformed input.
 * Require exact match before parsing.
 *
 * @throws SidjuaError INPUT-001 for any non-matching value
 */
function validateTierParam(input: string): 1 | 2 | 3 {
  const tier = Number(input);
  if (!Number.isInteger(tier) || !VALID_AGENT_TIERS.has(tier) || String(tier) !== input.trim()) {
    throw SidjuaError.from(
      "INPUT-001",
      `Invalid tier: "${input}". Must be one of: 1, 2, 3`,
    );
  }
  return tier as 1 | 2 | 3;
}


/**
 * Division names: must start with a letter, contain only alphanumeric,
 * underscores, or hyphens, and be no longer than 64 characters.
 *
 * Re-exported from the canonical module for backwards compatibility with
 * other route files that import DIVISION_REGEX / validateDivision directly.
 */
export const DIVISION_REGEX = DIVISION_RE;

/**
 * Validate a division name parameter.
 * @throws SidjuaError INPUT-001 for invalid formats
 */
export function validateDivision(input: string): string {
  return validateDivisionName(input);
}

const logger = createLogger("api-agents");

/**
 * Enrich an AgentDefinitionRow with a `resolved_model` field.
 * When `model` is "auto" or empty, resolve the actual model from the
 * provider config; otherwise pass model through as-is.
 */
function withResolvedModel(agent: AgentDefinitionRow): AgentDefinitionRow & { resolved_model: string } {
  let resolved = agent.model;
  if (!resolved || resolved === "auto") {
    try {
      const prov = getProviderForAgent(agent.id);
      if (prov) {
        resolved = prov.model ?? prov.provider_id;
      }
    } catch {
      // Non-fatal — provider config may not be set up yet
    }
  }
  return { ...agent, resolved_model: resolved };
}


export interface AgentRegistryLike {
  list(filters?: RegistryFilters): AgentDefinitionRow[];
  getById(id: string): AgentDefinitionRow | undefined;
  setStatus(id: string, status: AgentLifecycleStatus): void;
}

export interface AgentRouteServices {
  registry: AgentRegistryLike;
}


export function registerAgentRoutes(app: Hono, services: AgentRouteServices): void {
  const { registry } = services;

  // ---- GET /api/v1/agents ------------------------------------------------

  app.get("/api/v1/agents", requireScope("readonly"), (c) => {
    const tierParam     = c.req.query("tier");
    const statusParam   = c.req.query("status");
    const divisionParam = c.req.query("division");

    const filters: RegistryFilters = {};
    if (tierParam !== undefined)     filters.tier     = validateTierParam(tierParam);
    if (statusParam !== undefined) {
      if (!isValidAgentStatus(statusParam)) {
        return c.json({
          error: {
            code:    "AGENT-400",
            message: `Invalid agent status: "${statusParam}"`,
            valid:   VALID_AGENT_STATUSES,
          },
        }, 400);
      }
      filters.status = statusParam;
    }
    if (divisionParam !== undefined) filters.division = validateDivision(divisionParam);

    const agents = registry.list(filters).map(withResolvedModel);
    return c.json({ agents });
  });

  // ---- GET /api/v1/agents/:id --------------------------------------------

  app.get("/api/v1/agents/:id", requireScope("readonly"), (c) => {
    const id    = c.req.param("id");
    const agent = registry.getById(id);

    if (agent === undefined) {
      throw SidjuaError.from("AGT-001", `Agent ${id} not found`);
    }

    return c.json({ agent: withResolvedModel(agent) });
  });

  // ---- POST /api/v1/agents/:id/start -------------------------------------

  app.post("/api/v1/agents/:id/start", requireScope("operator"), (c) => {
    const id    = c.req.param("id");
    const agent = registry.getById(id);

    if (agent === undefined) {
      throw SidjuaError.from("AGT-001", `Agent ${id} not found`);
    }

    if (agent.status === "active" || agent.status === "starting") {
      return c.json({ agent, message: "Agent is already running" });
    }

    if (agent.status === "error") {
      throw SidjuaError.from("AGT-002", `Agent ${id} is in error state and cannot be started without recovery`);
    }

    registry.setStatus(id, "starting");
    const updated = registry.getById(id);

    logger.info("agent_started", `Agent ${id} started via API`, {
      correlationId: reqId(c),
      metadata: { agent_id: id },
    });

    return c.json({ agent: updated ?? agent, message: "Agent started" });
  });

  // ---- POST /api/v1/agents/:id/stop --------------------------------------

  app.post("/api/v1/agents/:id/stop", requireScope("operator"), (c) => {
    const id    = c.req.param("id");
    const agent = registry.getById(id);

    if (agent === undefined) {
      throw SidjuaError.from("AGT-001", `Agent ${id} not found`);
    }

    if (agent.status === "stopped" || agent.status === "stopping") {
      return c.json({ agent, message: "Agent is already stopping/stopped" });
    }

    registry.setStatus(id, "stopping");
    const updated = registry.getById(id);

    logger.info("agent_stopped", `Agent ${id} stopped via API`, {
      correlationId: reqId(c),
      metadata: { agent_id: id },
    });

    return c.json({ agent: updated ?? agent, message: "Agent stopped" });
  });
}
