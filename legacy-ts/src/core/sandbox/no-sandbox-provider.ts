// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 19: NoSandboxProvider
 *
 * Passthrough provider — commands pass through unchanged with no process isolation.
 * This is the default when sandbox.provider = "none" in divisions.yaml.
 *
 * Used in all V1 deployments until BubblewrapProvider is enabled.
 */

import { createLogger } from "../logger.js";
import type {
  AgentSandboxConfig,
  SandboxDependencyCheck,
  SandboxProvider,
} from "./types.js";

const logger = createLogger("sandbox-none");

export class NoSandboxProvider implements SandboxProvider {
  readonly name = "none";
  private _initialized = false;

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    logger.info(
      "sandbox_init",
      "Sandbox provider: none (passthrough, no process isolation)",
      {},
    );
    this._initialized = true;
  }

  /**
   * Passthrough — returns command unchanged.
   * Emits a warning audit entry on every call so operators can detect
   * unsandboxed execution in logs and the in-memory audit trail.
   * The agentConfig parameter is accepted but not used; isolation is deferred
   * to the BubblewrapProvider when sandbox isolation is enabled.
   */
  async wrapCommand(command: string, _agentConfig: AgentSandboxConfig): Promise<string> {
    logger.warn(
      "sandbox_no_isolation",
      "Command executing WITHOUT sandbox isolation — process and filesystem are unprotected",
      { metadata: { command: command.slice(0, 200) } },
    );
    return command;
  }

  async checkDependencies(): Promise<SandboxDependencyCheck> {
    return {
      available: true,
      provider:  "none",
      missing:   [],
      message:   "No sandbox provider configured (passthrough mode)",
    };
  }

  async cleanup(): Promise<void> {
    this._initialized = false;
  }
}
