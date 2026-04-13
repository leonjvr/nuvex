// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: Messaging API routes
 *
 *   GET  /api/v1/messaging/instances         — list all configured adapter instances
 *   GET  /api/v1/messaging/instances/:id     — get status of a specific instance
 *   POST /api/v1/messaging/instances/:id/start  — start an instance
 *   POST /api/v1/messaging/instances/:id/stop   — stop an instance
 *   POST /api/v1/messaging/reload            — reload config from messaging.yaml
 *   GET  /api/v1/messaging/mappings          — list user mappings
 *   POST /api/v1/messaging/mappings          — create/update a user mapping
 *   DELETE /api/v1/messaging/mappings/:instanceId/:platformId — remove a mapping
 *
 * Returns 503 when the messaging gateway is not configured.
 */

import type { Hono } from "hono";
import type { UserMapping } from "../../messaging/types.js";
import { requireScope } from "../middleware/require-scope.js";


export interface AdapterInstanceInfo {
  instanceId: string;
  channel:    string;
  healthy:    boolean;
}

export interface MessagingGatewayLike {
  stop(): Promise<void>;
  addInstance(config: import("../../messaging/types.js").AdapterInstanceConfig): Promise<void>;
  removeInstance(instanceId: string): Promise<void>;
}

export interface AdapterRegistryLike {
  getInstance(instanceId: string): { channel: string; isHealthy(): boolean } | undefined;
  getAllInstances(): AdapterInstanceInfo[];
  startInstance(instanceId: string): Promise<void>;
  stopInstance(instanceId: string): Promise<void>;
}

export interface UserMappingStoreLike {
  listMappings(sidjuaId?: string): UserMapping[];
  mapUser(sidjuaId: string, instanceId: string, platformId: string, role: "admin" | "user" | "viewer"): void | Promise<void>;
  unmapUser(instanceId: string, platformId: string): void | Promise<void>;
  isAuthorized(instanceId: string, platformId: string): boolean;
}

export interface MessagingRouteServices {
  gateway?:      MessagingGatewayLike | null;
  registry?:     AdapterRegistryLike  | null;
  userMapping?:  UserMappingStoreLike | null;
  reloadConfig?: () => Promise<void>;
}


const NOT_CONFIGURED_BODY = {
  error: { code: "SYS-503", message: "Messaging gateway not configured", recoverable: true },
} as const;


export function registerMessagingRoutes(app: Hono, services: MessagingRouteServices = {}): void {
  const { registry = null, userMapping = null } = services;

  // ── GET /api/v1/messaging/instances ──────────────────────────────────────
  app.get("/api/v1/messaging/instances", requireScope("readonly"), (c) => {
    if (registry === null) return c.json(NOT_CONFIGURED_BODY, 503);
    const instances = registry.getAllInstances();
    return c.json({ instances });
  });

  // ── GET /api/v1/messaging/instances/:id ──────────────────────────────────
  app.get("/api/v1/messaging/instances/:id", requireScope("readonly"), (c) => {
    if (registry === null) return c.json(NOT_CONFIGURED_BODY, 503);
    const id   = c.req.param("id");
    const inst = registry.getInstance(id);
    if (inst === undefined) {
      return c.json({ error: { code: "MSG-404", message: `Instance '${id}' not found` } }, 404);
    }
    return c.json({ instance: { instanceId: id, channel: inst.channel, healthy: inst.isHealthy() } });
  });

  // ── POST /api/v1/messaging/instances/:id/start ────────────────────────────
  app.post("/api/v1/messaging/instances/:id/start", requireScope("operator"), async (c) => {
    if (registry === null) return c.json(NOT_CONFIGURED_BODY, 503);
    const id = c.req.param("id");
    try {
      await registry.startInstance(id);
      return c.json({ started: true, id });
    } catch (e: unknown) {
      return c.json({ error: { code: "MSG-500", message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  // ── POST /api/v1/messaging/instances/:id/stop ─────────────────────────────
  app.post("/api/v1/messaging/instances/:id/stop", requireScope("operator"), async (c) => {
    if (registry === null) return c.json(NOT_CONFIGURED_BODY, 503);
    const id = c.req.param("id");
    try {
      await registry.stopInstance(id);
      return c.json({ stopped: true, id });
    } catch (e: unknown) {
      return c.json({ error: { code: "MSG-500", message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  // ── POST /api/v1/messaging/reload ─────────────────────────────────────────
  app.post("/api/v1/messaging/reload", requireScope("operator"), async (c) => {
    if (services.reloadConfig === undefined) return c.json(NOT_CONFIGURED_BODY, 503);
    try {
      await services.reloadConfig();
      return c.json({ reloaded: true });
    } catch (e: unknown) {
      return c.json({ error: { code: "MSG-500", message: e instanceof Error ? e.message : String(e) } }, 500);
    }
  });

  // ── GET /api/v1/messaging/mappings ────────────────────────────────────────
  app.get("/api/v1/messaging/mappings", requireScope("readonly"), (c) => {
    if (userMapping === null) return c.json(NOT_CONFIGURED_BODY, 503);
    const sidjuaId = c.req.query("sidjua_user_id");
    const mappings  = userMapping.listMappings(sidjuaId);
    return c.json({ mappings });
  });

  // ── POST /api/v1/messaging/mappings ───────────────────────────────────────
  app.post("/api/v1/messaging/mappings", requireScope("operator"), async (c) => {
    if (userMapping === null) return c.json(NOT_CONFIGURED_BODY, 503);
    const body       = await c.req.json() as Record<string, unknown>;
    const sidjuaId   = body["sidjua_user_id"]  as string | undefined;
    const instanceId = body["instance_id"]      as string | undefined;
    const platformId = body["platform_user_id"] as string | undefined;
    const role       = (body["role"] as string | undefined) ?? "user";

    if (!sidjuaId || !instanceId || !platformId) {
      return c.json({ error: { code: "MSG-001", message: "sidjua_user_id, instance_id, and platform_user_id are required" } }, 400);
    }

    const validRoles = ["admin", "user", "viewer"] as const;
    if (!validRoles.includes(role as "admin" | "user" | "viewer")) {
      return c.json({ error: { code: "MSG-001", message: "role must be admin, user, or viewer" } }, 400);
    }

    await Promise.resolve(userMapping.mapUser(sidjuaId, instanceId, platformId, role as "admin" | "user" | "viewer"));
    return c.json({ mapped: true });
  });

  // ── DELETE /api/v1/messaging/mappings/:instanceId/:platformId ─────────────
  app.delete("/api/v1/messaging/mappings/:instanceId/:platformId", requireScope("operator"), async (c) => {
    if (userMapping === null) return c.json(NOT_CONFIGURED_BODY, 503);
    const instanceId = c.req.param("instanceId");
    const platformId = c.req.param("platformId");
    await Promise.resolve(userMapping.unmapUser(instanceId, platformId));
    return c.json({ removed: true });
  });
}
