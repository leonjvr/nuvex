// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: SQLite Audit Service
 *
 * Concrete implementation of GatewayAuditService that persists integration
 * audit events to a `integration_audit_events` table in the SIDJUA SQLite DB.
 */

import type { Database } from "../utils/db.js";
import type { GatewayAuditService, IntegrationAuditEvent } from "./types.js";


export const INTEGRATION_AUDIT_SQL = `
  CREATE TABLE IF NOT EXISTS integration_audit_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type   TEXT NOT NULL,
    request_id   TEXT NOT NULL,
    agent_id     TEXT NOT NULL,
    division     TEXT NOT NULL,
    service      TEXT NOT NULL,
    action       TEXT NOT NULL,
    path_used    TEXT NOT NULL,
    risk_level   TEXT NOT NULL,
    status_code  INTEGER,
    execution_ms INTEGER,
    error        TEXT,
    timestamp    TEXT NOT NULL
  )
`;


export class SqliteGatewayAuditService implements GatewayAuditService {
  constructor(private readonly db: Database) {
    this.db.exec(INTEGRATION_AUDIT_SQL);
  }

  async logIntegrationEvent(event: IntegrationAuditEvent): Promise<void> {
    this.db
      .prepare<
        [
          string, string, string, string,
          string, string, string, string,
          number | null, number | null, string | null, string,
        ],
        void
      >(`
        INSERT INTO integration_audit_events
          (event_type, request_id, agent_id, division,
           service, action, path_used, risk_level,
           status_code, execution_ms, error, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.event_type,
        event.request_id,
        event.agent_id,
        event.division,
        event.service,
        event.action,
        event.path_used,
        event.risk_level,
        event.status_code ?? null,
        event.execution_ms ?? null,
        event.error ?? null,
        event.timestamp,
      );
  }
}


export class NoOpGatewayAuditService implements GatewayAuditService {
  readonly events: IntegrationAuditEvent[] = [];

  async logIntegrationEvent(event: IntegrationAuditEvent): Promise<void> {
    this.events.push(event);
  }
}
