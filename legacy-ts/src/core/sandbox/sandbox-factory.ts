// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 19: SandboxFactory
 *
 * Creates the appropriate SandboxProvider based on configuration.
 * Does NOT initialize — caller must call provider.initialize().
 */

import { createLogger } from "../logger.js";
import { SidjuaError } from "../error-codes.js";
import { NoSandboxProvider } from "./no-sandbox-provider.js";
import { BubblewrapProvider } from "./bubblewrap-provider.js";
import type { SandboxConfig, SandboxProvider } from "./types.js";

const logger = createLogger("sandbox-factory");

/**
 * Create a SandboxProvider based on configuration.
 * Does NOT initialize it — caller must call provider.initialize().
 */
export function createSandboxProvider(config: SandboxConfig): SandboxProvider {
  switch (config.provider) {
    case "none":
      if (process.env["SIDJUA_ALLOW_NO_SANDBOX"] !== "true") {
        throw SidjuaError.from(
          "SANDBOX-001",
          'Sandbox provider is set to "none" (no process isolation). ' +
          "Set SIDJUA_ALLOW_NO_SANDBOX=true to explicitly acknowledge this risk.",
        );
      }
      return new NoSandboxProvider();

    case "bubblewrap": {
      return new BubblewrapProvider(config.defaults);
    }

    default: {
      // Fail-secure — reject unknown provider instead of silently falling back.
      // TypeScript will flag new union members here (exhaustive check).
      const exhaustive: never = config.provider;
      logger.error(
        "sandbox_unknown_provider",
        `Unknown sandbox provider: "${String(exhaustive)}"`,
        {},
      );
      throw SidjuaError.from(
        "SYS-003",
        `Unknown sandbox provider: "${String(exhaustive)}". Valid providers: "none", "bubblewrap".`,
      );
    }
  }
}

/** Default sandbox config when not specified in divisions.yaml */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  provider: "none",
  defaults: {
    network: {
      allowedDomains: [],
      deniedDomains:  [],
    },
    filesystem: {
      denyRead:  ["~/.ssh", "~/.gnupg", "/etc/shadow"],
      allowWrite: [],
      denyWrite:  [],
    },
  },
};
