// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA Error Telemetry — Global Error Hooks
 *
 * Install process-level error catchers that feed into TelemetryReporter.
 * Call installTelemetryHooks() once during CLI bootstrap, after config is loaded.
 */

import type { TelemetryReporter } from "./telemetry-reporter.js";
export { reportError } from "./telemetry-reporter.js";

/**
 * Install global unhandledRejection and uncaughtException hooks.
 * These are critical-severity events.
 *
 * NOTE: uncaughtException hook does NOT call process.exit — the existing
 * Node.js behavior handles that. We only report before it happens.
 */
export function installTelemetryHooks(reporter: TelemetryReporter): void {
  process.on('unhandledRejection', (reason) => {
    const error = reason instanceof Error
      ? reason
      : new Error(String(reason));
    reporter.report(error, 'critical').catch(() => {});
  });

  process.on('uncaughtException', (error) => {
    reporter.report(error, 'critical').catch(() => {});
    // Do NOT call process.exit here — let the existing handler do that
  });
}
