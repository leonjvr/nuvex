// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: UserMappingStore
 *
 * Maps external messaging users (per adapter instance) to SIDJUA user IDs.
 * UNIQUE constraint on (instance_id, platform_user_id) ensures the same
 * platform account on two different adapter instances counts as two separate
 * identities (e.g. two Telegram bots for two teams).
 */

import type { Database } from "../utils/db.js";
import type { UserMapping } from "./types.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("user-mapping");


const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS messaging_user_mappings (
  id                TEXT PRIMARY KEY,
  sidjua_user_id    TEXT NOT NULL,
  instance_id       TEXT NOT NULL,
  platform_user_id  TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'user',
  created_at        TEXT NOT NULL,
  UNIQUE(instance_id, platform_user_id)
);
CREATE INDEX IF NOT EXISTS idx_mum_lookup
  ON messaging_user_mappings(instance_id, platform_user_id);
CREATE INDEX IF NOT EXISTS idx_mum_sidjua
  ON messaging_user_mappings(sidjua_user_id);
`;


interface MappingRow {
  id:               string;
  sidjua_user_id:   string;
  instance_id:      string;
  platform_user_id: string;
  role:             string;
  created_at:       string;
}

export class UserMappingStore {
  constructor(
    private readonly db: Database,
  ) {
    this.db.exec(SCHEMA_SQL);
  }

  /** Create the mappings table if it does not already exist. */
  initialize(): Promise<void> {
    this.db.exec(SCHEMA_SQL);
    logger.info("user-mapping", "Schema initialized", { metadata: {} });
    return Promise.resolve();
  }

  /**
   * Map a SIDJUA user to a platform user within a specific adapter instance.
   * Replaces an existing mapping for the same (instance_id, platform_user_id).
   */
  mapUser(
    sidjuaId:   string,
    instanceId: string,
    platformId: string,
    role:       "admin" | "user" | "viewer" = "user",
  ): Promise<void> {
    const id  = `${instanceId}:${platformId}`;
    const now = new Date().toISOString();

    this.db.prepare<unknown[], void>(`
      INSERT INTO messaging_user_mappings
        (id, sidjua_user_id, instance_id, platform_user_id, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(instance_id, platform_user_id) DO UPDATE SET
        sidjua_user_id  = excluded.sidjua_user_id,
        role            = excluded.role,
        created_at      = excluded.created_at
    `).run(id, sidjuaId, instanceId, platformId, role, now);

    logger.info("user-mapping", "User mapped", {
      metadata: {
        event:       "USER_MAPPED" as const,
        sidjua_id:   sidjuaId,
        instance_id: instanceId,
        platform_id: platformId,
        role,
      },
    });

    return Promise.resolve();
  }

  /** Remove the mapping for a platform user within an adapter instance. */
  unmapUser(instanceId: string, platformId: string): Promise<void> {
    this.db.prepare<unknown[], void>(
      "DELETE FROM messaging_user_mappings WHERE instance_id = ? AND platform_user_id = ?",
    ).run(instanceId, platformId);

    logger.info("user-mapping", "User unmapped", {
      metadata: {
        event:       "USER_UNMAPPED" as const,
        instance_id: instanceId,
        platform_id: platformId,
      },
    });

    return Promise.resolve();
  }

  /**
   * Look up a mapping by adapter instance + platform user ID.
   * Returns null if no mapping exists.
   */
  lookupUser(instanceId: string, platformId: string): UserMapping | null {
    const row = this.db.prepare<unknown[], MappingRow>(
      "SELECT * FROM messaging_user_mappings WHERE instance_id = ? AND platform_user_id = ?",
    ).get(instanceId, platformId);

    if (row === undefined) return null;
    return rowToMapping(row);
  }

  /**
   * Return true if a mapping exists for the given instance + platform user.
   * Used by InboundMessageGateway for authorization checks.
   */
  isAuthorized(instanceId: string, platformId: string): boolean {
    const row = this.db.prepare<unknown[], { cnt: number }>(
      "SELECT COUNT(*) as cnt FROM messaging_user_mappings WHERE instance_id = ? AND platform_user_id = ?",
    ).get(instanceId, platformId);
    return (row?.cnt ?? 0) > 0;
  }

  /**
   * List all mappings, optionally filtered by SIDJUA user ID.
   */
  listMappings(sidjuaId?: string): UserMapping[] {
    let rows: MappingRow[];
    if (sidjuaId !== undefined) {
      rows = this.db.prepare<unknown[], MappingRow>(
        "SELECT * FROM messaging_user_mappings WHERE sidjua_user_id = ? ORDER BY created_at",
      ).all(sidjuaId);
    } else {
      rows = this.db.prepare<unknown[], MappingRow>(
        "SELECT * FROM messaging_user_mappings ORDER BY created_at",
      ).all();
    }
    return rows.map(rowToMapping);
  }
}


function rowToMapping(row: MappingRow): UserMapping {
  return {
    sidjua_user_id:   row.sidjua_user_id,
    instance_id:      row.instance_id,
    platform_user_id: row.platform_user_id,
    role:             row.role as UserMapping["role"],
    created_at:       row.created_at,
  };
}
