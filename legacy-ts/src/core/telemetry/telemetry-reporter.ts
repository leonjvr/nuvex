// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA Error Telemetry — Client-Side Reporter
 *
 * Privacy: All data is PII-redacted before sending. No API keys, file paths,
 * IPs, or user data leaves the installation. Only error types, sanitized
 * stack hashes, and system metadata (version, OS, arch) are transmitted.
 *
 * Resilience: Events are stored locally first (SQLite), then sent to dual
 * endpoints. If both fail, events buffer locally and retry on next cycle.
 * The installation NEVER blocks waiting for telemetry.
 *
 * Governance: Controlled via telemetry config in .system/telemetry.json.
 * Modes: auto (default), ask (prompt user), off (disabled).
 */

import { join, resolve, dirname }  from "node:path";
import { readFile, writeFile }     from "node:fs/promises";
import { existsSync, mkdirSync }   from "node:fs";
import { randomUUID }              from "node:crypto";
import { sha256hex }               from "../crypto-utils.js";
import { createLogger }            from "../logger.js";
import { TelemetryBuffer }         from "./telemetry-buffer.js";
import {
  redactPii,
  containsPotentialPii,
  generateFingerprint,
  classifySeverity,
} from "./pii-redactor.js";
import {
  DEFAULT_PRIMARY_ENDPOINT,
  DEFAULT_FALLBACK_ENDPOINT,
  INSTALLATION_ID_TTL_DAYS,
  type TelemetryEvent,
  type TelemetryConfig,
} from "./telemetry-types.js";

const logger = createLogger("telemetry");

const SEND_TIMEOUT_MS  = 5_000;
const DRAIN_BATCH_SIZE = 20;


const TELEMETRY_CONFIG_FILE = ".system/telemetry.json";

export function telemetryConfigPath(workDir: string): string {
  return join(resolve(workDir), TELEMETRY_CONFIG_FILE);
}

export async function loadTelemetryConfig(workDir: string): Promise<TelemetryConfig> {
  const cfgPath = telemetryConfigPath(workDir);
  try {
    if (existsSync(cfgPath)) {
      const raw = await readFile(cfgPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<TelemetryConfig>;

      let installationId        = parsed.installationId        ?? randomUUID();
      let installationIdCreatedAt = parsed.installationIdCreatedAt ?? new Date().toISOString();

      // Rotate installation ID after TTL for privacy (prevents long-term correlation)
      const ageMs  = Date.now() - new Date(installationIdCreatedAt).getTime();
      const ttlMs  = INSTALLATION_ID_TTL_DAYS * 24 * 60 * 60 * 1000;
      const rotated = ageMs >= ttlMs;
      if (rotated) {
        installationId          = randomUUID();
        installationIdCreatedAt = new Date().toISOString();
      }

      const config: TelemetryConfig = {
        mode:                   parsed.mode             ?? "off",   // Default off
        primaryEndpoint:        parsed.primaryEndpoint  ?? DEFAULT_PRIMARY_ENDPOINT,
        fallbackEndpoint:       parsed.fallbackEndpoint ?? DEFAULT_FALLBACK_ENDPOINT,
        installationId,
        installationIdCreatedAt,
      };

      // Persist if we generated a new ID or rotation happened
      if (parsed.installationId === undefined || rotated ||
          parsed.installationIdCreatedAt === undefined) {
        await saveTelemetryConfig(workDir, config);
      }

      return config;
    }
  } catch (e: unknown) {
    logger.debug("telemetry", "Telemetry config parse failed — using defaults", { metadata: { error: e instanceof Error ? e.message : String(e) } });
  }
  // Missing config — generate fresh installation ID and save
  return ensureAndSaveDefaultConfig(workDir);
}


async function ensureAndSaveDefaultConfig(workDir: string): Promise<TelemetryConfig> {
  const config: TelemetryConfig = {
    mode:                   "off",   // Privacy-safe default
    primaryEndpoint:        DEFAULT_PRIMARY_ENDPOINT,
    fallbackEndpoint:       DEFAULT_FALLBACK_ENDPOINT,
    installationId:         randomUUID(),
    installationIdCreatedAt: new Date().toISOString(),  // Track ID age
  };
  await saveTelemetryConfig(workDir, config);
  return config;
}

export async function saveTelemetryConfig(
  workDir: string,
  config: TelemetryConfig,
): Promise<void> {
  const cfgPath = telemetryConfigPath(workDir);
  mkdirSync(dirname(cfgPath), { recursive: true });
  await writeFile(cfgPath, JSON.stringify(config, null, 2), "utf-8");
}


async function sendTo(endpoint: string, event: TelemetryEvent): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "User-Agent": `sidjua/${event.sidjua_version}` },
      body:    JSON.stringify(event),
      signal:  controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}


export class TelemetryReporter {
  private buffer:  TelemetryBuffer;
  private config:  TelemetryConfig;
  private version: string;
  private askNotified = false;

  constructor(config: TelemetryConfig, workDir: string, version: string) {
    this.config  = config;
    this.version = version;
    this.buffer  = new TelemetryBuffer(workDir);
    // Prune old sent events on startup
    try { this.buffer.prune(); } catch (e: unknown) { logger.warn("telemetry", "Telemetry buffer prune failed — non-fatal", { metadata: { error: e instanceof Error ? e.message : String(e) } }); }
  }

  // ---------------------------------------------------------------------------
  // report — main entry point
  // ---------------------------------------------------------------------------

  /**
   * Report an error. Non-blocking, fire-and-forget. Never throws.
   */
  async report(error: Error, severityOverride?: string): Promise<void> {
    try {
      const event = this.buildEvent(error, severityOverride);

      // Always store locally first (source of truth)
      this.buffer.store(event);

      if (this.config.mode === 'off') {
        // mode=off: store locally only
        return;
      }

      if (this.config.mode === 'ask') {
        if (!this.askNotified) {
          this.askNotified = true;
          process.stderr.write(
            "[sidjua telemetry] Error reporting is not yet enabled. " +
            "Run `sidjua telemetry enable` to help improve SIDJUA.\n",
          );
        }
        return;
      }

      // mode=auto: send immediately
      void this.sendAndDrain(event).catch(() => {});
    } catch (internalErr) {
      // Never throw from reporter
      logger.warn("telemetry_report_failed", "Failed to record telemetry event", {
        error: { code: "TEL-001", message: String(internalErr) },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // drain — send pending buffer events
  // ---------------------------------------------------------------------------

  /**
   * Drain pending buffer events. Returns counts of sent/failed.
   */
  async drain(): Promise<{ sent: number; failed: number }> {
    const pending = this.buffer.getPending(DRAIN_BATCH_SIZE);
    let sent = 0;
    let failed = 0;

    for (const stored of pending) {
      // Re-apply PII redaction as defense-in-depth before transmission.
      // Events were redacted at capture time, but patterns may have been updated
      // since storage, or a bug may have slipped through. Re-applying is idempotent.
      const safeEvent: TelemetryEvent = containsPotentialPii(stored.event.error_message)
        ? { ...stored.event, error_message: redactPii(stored.event.error_message) }
        : stored.event;

      const ok = await this.trySend(safeEvent);
      if (ok) {
        this.buffer.markSent([stored.id]);
        sent++;
      } else {
        failed++;
        break; // stop on first failure — don't hammer failing endpoint
      }
    }

    return { sent, failed };
  }

  // ---------------------------------------------------------------------------
  // updateConfig — for CLI enable/disable
  // ---------------------------------------------------------------------------

  updateConfig(patch: Partial<TelemetryConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  getBuffer(): TelemetryBuffer {
    return this.buffer;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildEvent(error: Error, severityOverride?: string): TelemetryEvent {
    const errorType    = error.constructor?.name ?? error.name ?? "Error";
    const stack        = error.stack ?? `${errorType}: ${error.message}`;
    const cleanMessage = redactPii(error.message);
    const cleanStack   = redactPii(stack);
    const fingerprint  = generateFingerprint(errorType, cleanStack);
    const stackHash    = sha256hex(cleanStack);
    const severity     = classifySeverity(errorType, cleanMessage, severityOverride);

    return {
      installation_id: this.config.installationId,
      fingerprint,
      error_type:      errorType,
      error_message:   cleanMessage,
      stack_hash:      stackHash,
      sidjua_version:  this.version,
      node_version:    process.version,
      os:              process.platform,
      arch:            process.arch,
      timestamp:       new Date().toISOString(),
      severity,
    };
  }

  private async sendAndDrain(event: TelemetryEvent): Promise<void> {
    // Try primary and fallback simultaneously — first success wins
    const stored = this.buffer.getPending(1).find(
      (e) => e.fingerprint === event.fingerprint,
    );

    const ok = await this.trySend(event);
    if (ok && stored !== undefined) {
      this.buffer.markSent([stored.id]);
      // Drain remaining pending events after successful send
      await this.drain();
    }
  }

  private async trySend(event: TelemetryEvent): Promise<boolean> {
    try {
      await Promise.any([
        sendTo(this.config.primaryEndpoint,  event),
        sendTo(this.config.fallbackEndpoint, event),
      ]);
      return true;
    } catch (e: unknown) {
      logger.warn("telemetry", "Telemetry send failed — will retry on next drain", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }
}


let _singleton: TelemetryReporter | null = null;

/**
 * Initialize the singleton reporter. Call once during CLI bootstrap.
 */
export function initTelemetryReporter(
  config:  TelemetryConfig,
  workDir: string,
  version: string,
): TelemetryReporter {
  _singleton = new TelemetryReporter(config, workDir, version);
  return _singleton;
}

/**
 * Get the singleton reporter. Returns null if not initialized.
 */
export function getTelemetryReporter(): TelemetryReporter | null {
  return _singleton;
}

/**
 * Reset singleton (for tests).
 */
export function resetTelemetryReporter(): void {
  _singleton = null;
}

/**
 * Manually report an error via the singleton. No-op if telemetry not initialized.
 * Use in strategic catch blocks throughout the codebase.
 */
export function reportError(error: Error, severity?: string): void {
  const reporter = _singleton;
  if (reporter === null) return;
  reporter.report(error, severity).catch(() => {});
}
