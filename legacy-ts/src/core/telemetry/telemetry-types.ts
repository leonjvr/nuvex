// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA Error Telemetry — Shared Types
 */


export type TelemetrySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface TelemetryEvent {
  installation_id: string;     // UUID, generated once on sidjua init
  fingerprint:     string;     // SHA256(error_type + stack_pattern)
  error_type:      string;     // e.g. "TypeError", "GovernanceError"
  error_message:   string;     // sanitized
  stack_hash:      string;     // SHA256 of sanitized stack, NOT full trace
  sidjua_version:  string;
  node_version:    string;
  os:              string;     // process.platform
  arch:            string;     // process.arch
  timestamp:       string;     // ISO
  severity:        TelemetrySeverity;
}


export interface TelemetryConfig {
  mode:                     'auto' | 'ask' | 'off';
  primaryEndpoint:          string;
  fallbackEndpoint:         string;
  installationId:           string;
  /** ISO timestamp of when this installation ID was generated. Used for rotation. */
  installationIdCreatedAt?: string;
}

/**
 * Installation IDs rotate after this many days for privacy.
 * Prevents long-term correlation of telemetry events across time.
 */
export const INSTALLATION_ID_TTL_DAYS = 90;


export interface StoredEvent {
  id:         number;
  fingerprint: string;
  event:      TelemetryEvent;
  createdAt:  string;
  sentAt:     string | null;
  status:     'pending' | 'sent' | 'failed';
}


export const DEFAULT_PRIMARY_ENDPOINT  = 'https://errors.sidjua.com/v1/report';
export const DEFAULT_FALLBACK_ENDPOINT = 'https://errors-direct.sidjua.com/v1/report';
