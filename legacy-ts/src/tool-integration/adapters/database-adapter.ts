// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Database adapter — SQLite (better-sqlite3) fully supported;
 * PostgreSQL stub throws "PostgreSQL not supported in V1".
 * Row limit: 1000 per query.
 */

import Database from "better-sqlite3";
import { openDatabase } from "../../utils/db.js";
import type {
  ToolAdapter,
  ToolAction,
  ToolCapability,
  ToolResult,
  ToolType,
  DatabaseToolConfig,
} from "../types.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("database-adapter");

export class DatabaseAdapter implements ToolAdapter {
  readonly id: string;
  readonly type: ToolType = "database";

  private connected = false;
  private readonly config: DatabaseToolConfig;
  private readonly capabilities: ToolCapability[];
  private db: InstanceType<typeof Database> | undefined;

  constructor(
    id: string,
    config: DatabaseToolConfig,
    capabilities: ToolCapability[]
  ) {
    this.id = id;
    this.config = config;
    this.capabilities = capabilities;
  }

  async connect(): Promise<void> {
    if (this.config.db_type === "postgresql") {
      throw new Error("PostgreSQL not supported in V1");
    }
    const path = this.config.path ?? ":memory:";
    const isReadOnly = (this.config.access_mode ?? "readonly") === "readonly";

    if (path === ":memory:") {
      // In-memory DBs cannot use readonly mode; WAL not applicable
      this.db = new Database(path);
    } else if (isReadOnly) {
      // B1 (P274): Use native better-sqlite3 readonly connection as primary enforcement.
      // This makes write queries throw at the SQLite engine level, not just application logic.
      this.db = new Database(path, { readonly: true });
    } else {
      // db_type === 'sqlite' — use openDatabase() to enforce WAL + FK + synchronous pragmas.
      this.db = openDatabase(path);
    }
    this.connected = true;
  }

  async execute(action: ToolAction): Promise<ToolResult> {
    const start = Date.now();

    if (action.capability === "query" || action.capability === "execute") {
      const sql = String(action.params["sql"] ?? "");
      const params = (action.params["params"] as unknown[]) ?? [];
      const isSelect = sql.trim().toUpperCase().startsWith("SELECT");

      // P274 B1: Enforce read/write split — reject write queries in readonly mode.
      // Primary enforcement: native readonly connection (set in connect()).
      // Defense-in-depth: application-level checks below prevent bypass attempts.
      const isReadOnly = (this.config.access_mode ?? "readonly") === "readonly";
      if (isReadOnly && !isSelect) {
        return {
          success: false,
          error: "Database adapter is in readonly mode — write queries require access_mode: 'readwrite'",
          duration_ms: Date.now() - start,
        };
      }

      // Reject multi-statement queries (e.g. "SELECT 1; DELETE FROM ...") in readonly mode
      // to prevent CTE-based injection bypasses like "WITH x AS (DELETE ...) SELECT ..."
      if (isReadOnly && sql.includes(";")) {
        return {
          success: false,
          error: "Database adapter is in readonly mode — multi-statement queries are not allowed",
          duration_ms: Date.now() - start,
        };
      }

      if (isSelect) {
        const rows = this.db!.prepare(sql).all(...params).slice(0, this.config.max_rows ?? 1000);
        return {
          success: true,
          data: { rows, count: rows.length },
          duration_ms: Date.now() - start,
        };
      } else {
        const info = this.db!.prepare(sql).run(...params);
        return {
          success: true,
          data: { changes: info.changes, lastInsertRowid: info.lastInsertRowid },
          duration_ms: Date.now() - start,
        };
      }
    }

    throw new Error(`Unknown capability: ${action.capability}`);
  }

  async healthCheck(): Promise<boolean> {
    try {
      this.db?.prepare("SELECT 1").get();
      return true;
    } catch (e: unknown) {
      logger.warn("database-adapter", "Database health check failed — adapter may be unavailable", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.db?.close();
    this.connected = false;
  }

  getCapabilities(): ToolCapability[] {
    return this.capabilities;
  }
}
