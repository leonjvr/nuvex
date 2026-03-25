// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: API Schema Store
 *
 * Lightweight schema registry for the intelligent path.
 * Stores discovered OpenAPI / GraphQL / MCP specs in SQLite with
 * an in-memory cache for fast repeated lookups.
 *
 * Full API Schema Store is a separate issue — this is the
 * minimal interface needed by the intelligent path.
 */

import { openDatabase } from "../utils/db.js";
import type { Database } from "../utils/db.js";


export interface ApiSchema {
  service_name: string;
  spec_format: "openapi3" | "graphql" | "sidjua-local" | "sidjua-cli" | "mcp-tool";
  spec_content: string;
  quality: "verified" | "community" | "discovered" | "draft";
  last_used: string;
  success_rate: number;
  usage_count: number;
}

interface SchemaRow {
  service_name: string;
  spec_format: string;
  spec_content: string;
  quality: string;
  last_used: string;
  success_rate: number;
  usage_count: number;
}


export class SchemaStore {
  private readonly cache: Map<string, ApiSchema> = new Map();
  private db: Database | null = null;

  constructor(private readonly dbPath: string) {}

  /**
   * Initialise the SQLite table and warm the in-memory cache.
   * Must be called before any other method.
   */
  async init(): Promise<void> {
    this.db = openDatabase(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_schemas (
        service_name TEXT PRIMARY KEY,
        spec_format  TEXT NOT NULL,
        spec_content TEXT NOT NULL,
        quality      TEXT DEFAULT 'draft',
        last_used    TEXT,
        success_rate REAL DEFAULT 0.0,
        usage_count  INTEGER DEFAULT 0
      )
    `);
    // Warm cache from DB
    const rows = this.db.prepare<[], SchemaRow>("SELECT * FROM api_schemas").all();
    for (const row of rows) {
      this.cache.set(row.service_name, this.rowToSchema(row));
    }
  }

  /**
   * Look up a schema by service name.
   * Checks in-memory cache first, then SQLite.
   * Returns null if not found.
   */
  async getSchema(serviceName: string): Promise<ApiSchema | null> {
    const cached = this.cache.get(serviceName);
    if (cached !== undefined) return cached;
    if (this.db === null) return null;
    const row = this.db
      .prepare<[string], SchemaRow>("SELECT * FROM api_schemas WHERE service_name = ?")
      .get(serviceName);
    if (row === undefined) return null;
    const schema = this.rowToSchema(row);
    this.cache.set(serviceName, schema);
    return schema;
  }

  /**
   * Upsert a schema to SQLite and update the in-memory cache.
   */
  async storeSchema(schema: ApiSchema): Promise<void> {
    if (this.db !== null) {
      this.db
        .prepare<[string, string, string, string, string, number, number], void>(`
          INSERT INTO api_schemas
            (service_name, spec_format, spec_content, quality, last_used, success_rate, usage_count)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(service_name) DO UPDATE SET
            spec_format  = excluded.spec_format,
            spec_content = excluded.spec_content,
            quality      = excluded.quality,
            last_used    = excluded.last_used,
            success_rate = excluded.success_rate,
            usage_count  = excluded.usage_count
        `)
        .run(
          schema.service_name,
          schema.spec_format,
          schema.spec_content,
          schema.quality,
          schema.last_used,
          schema.success_rate,
          schema.usage_count,
        );
    }
    this.cache.set(schema.service_name, { ...schema });
  }

  /**
   * Increment usage_count, update rolling success_rate, and refresh last_used.
   * No-ops silently when the service is unknown.
   */
  async recordUsage(serviceName: string, success: boolean): Promise<void> {
    const schema = await this.getSchema(serviceName);
    if (schema === null) return;
    const newCount = schema.usage_count + 1;
    const newRate  =
      (schema.success_rate * schema.usage_count + (success ? 1 : 0)) / newCount;
    const updated: ApiSchema = {
      ...schema,
      usage_count:  newCount,
      success_rate: newRate,
      last_used:    new Date().toISOString(),
    };
    await this.storeSchema(updated);
  }

  /**
   * Return all stored schemas (refreshes in-memory cache from DB).
   */
  async listSchemas(): Promise<ApiSchema[]> {
    if (this.db !== null) {
      const rows = this.db.prepare<[], SchemaRow>("SELECT * FROM api_schemas").all();
      for (const row of rows) {
        this.cache.set(row.service_name, this.rowToSchema(row));
      }
    }
    return [...this.cache.values()];
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private rowToSchema(row: SchemaRow): ApiSchema {
    return {
      service_name: row.service_name,
      spec_format:  row.spec_format as ApiSchema["spec_format"],
      spec_content: row.spec_content,
      quality:      row.quality as ApiSchema["quality"],
      last_used:    row.last_used,
      success_rate: row.success_rate,
      usage_count:  row.usage_count,
    };
  }
}
