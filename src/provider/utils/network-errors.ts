// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Provider network-error utilities
 *
 * Shared helper used by all provider adapters to classify transient network
 * errors as retryable. Centralised here to avoid duplicating identical logic
 * across adapters.
 */

/**
 * Returns true when the error message indicates a transient network condition
 * that warrants a retry (timeout, connection reset, DNS failure, etc.).
 */
export function isNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("etimedout") ||
    msg.includes("network")
  );
}
