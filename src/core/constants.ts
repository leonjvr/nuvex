// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Platform-wide constants.
 *
 * Centralising limits and thresholds here prevents magic numbers from
 * scattering across the codebase and makes tuning for different editions
 * (Free / Enterprise) a single-file change.
 */

/** Maximum number of non-deleted agents allowed in the Free tier (xAI-ARCH-C1). */
export const MAX_AGENTS_FREE = 100;

/** Warn when active agent count reaches this value (xAI-ARCH-C1). */
export const MAX_AGENTS_FREE_SOFT_LIMIT = 80;

/**
 * Maximum total provider call attempts across primary + failover combined
 * (xAI-ARCH-H3). Prevents unbounded retries when both providers are flaky.
 * Example: if the primary exhausts 2 attempts, the failover gets at most 1.
 */
export const MAX_TOTAL_PROVIDER_RETRIES = 3;

/**
 * Fallback model ID used when no provider has been configured.
 * Both start.ts (CLI) and cli-server.ts (Docker) must import this
 * constant rather than hardcoding a model string inline.
 * DUAL PATH: any change here applies to both startup code paths.
 */
export const DEFAULT_FALLBACK_MODEL = "auto";
