// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 19: Sandbox barrel export
 */

export type {
  AgentSandboxConfig,
  SandboxConfig,
  SandboxDefaults,
  SandboxDependencyCheck,
  SandboxFilesystemConfig,
  SandboxNetworkConfig,
  SandboxProvider,
} from "./types.js";

export { NoSandboxProvider }   from "./no-sandbox-provider.js";
export { BubblewrapProvider }  from "./bubblewrap-provider.js";
export { startViolationLogger } from "./violation-logger.js";
export { createSandboxProvider, DEFAULT_SANDBOX_CONFIG } from "./sandbox-factory.js";
