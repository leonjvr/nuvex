// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 19: ViolationLogger
 *
 * Subscribes to the SandboxViolationStore and logs each violation
 * via the SIDJUA structured logger. Returns an unsubscribe function
 * for clean lifecycle management.
 */

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import type { SandboxViolationEvent } from "@anthropic-ai/sandbox-runtime";
import { createLogger } from "../logger.js";
import type { SandboxProvider } from "./types.js";
import { BubblewrapProvider } from "./bubblewrap-provider.js";

const logger = createLogger("sandbox-violations");

/**
 * Start logging sandbox violations for the given provider.
 * Only subscribed when the provider is a BubblewrapProvider.
 *
 * Accepts an optional AbortSignal. When the signal fires, the
 * subscription is automatically cleaned up. This prevents memory leaks
 * when the provider is recreated (hot-reconfigure scenario).
 * BubblewrapProvider manages its own AbortController internally via
 * startViolationLogging(); external callers should pass a signal.
 *
 * @returns Unsubscribe function — call it to stop logging (alternative to signal).
 */
export function startViolationLogger(
  provider: SandboxProvider,
  signal?:  AbortSignal,
): () => void {
  if (!(provider instanceof BubblewrapProvider)) {
    // NoSandboxProvider and future providers that don't use SandboxManager
    // do not emit violations.
    return () => { /* no-op */ };
  }

  const violationStore = SandboxManager.getSandboxViolationStore();
  const unsubscribe = violationStore.subscribe((violations: SandboxViolationEvent[]) => {
    for (const v of violations) {
      logger.warn(
        "sandbox_violation",
        "Sandbox access violation detected",
        {
          metadata: {
            line:            v.line,
            command:         v.command,
            encodedCommand:  v.encodedCommand,
            timestamp:       v.timestamp.toISOString(),
          },
        },
      );
    }
  });

  // Wire AbortSignal to the subscription so cleanup is automatic
  if (signal !== undefined) {
    if (signal.aborted) {
      unsubscribe();
      return unsubscribe;
    }
    signal.addEventListener("abort", () => { unsubscribe(); }, { once: true });
  }

  logger.info("sandbox_violation_logger_started", "Sandbox violation logging active");
  return unsubscribe;
}
