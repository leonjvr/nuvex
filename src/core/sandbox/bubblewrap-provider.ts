// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 19: BubblewrapProvider
 *
 * Sandbox provider backed by @anthropic-ai/sandbox-runtime.
 * On Linux this uses bubblewrap (bwrap) for filesystem isolation and
 * HTTP/SOCKS proxy servers for network filtering.
 * On macOS it uses sandbox-exec.
 *
 * Architecture note:
 *   SIDJUA agents are spawned via child_process.fork() for IPC. The
 *   wrapCommand() method wraps shell-exec commands (e.g. tool invocations).
 *   Network isolation for agent processes is achieved separately by injecting
 *   proxy env vars from getProxyPort(). See OrchestratorProcess.getSandboxEnvVars().
 */

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { createLogger } from "../logger.js";
import { SidjuaError } from "../error-codes.js";
import { startViolationLogger } from "./violation-logger.js";
import type {
  AgentSandboxConfig,
  SandboxDefaults,
  SandboxDependencyCheck,
  SandboxProvider,
} from "./types.js";

const logger = createLogger("bubblewrap-provider");

export class BubblewrapProvider implements SandboxProvider {
  readonly name = "bubblewrap" as const;
  private _initialized  = false;
  // Timestamp of the last failed initialization attempt (0 = never attempted).
  // Used to enforce a cooldown before retrying — avoids hammering a broken
  // system while still allowing recovery when the environment is fixed.
  private _lastInitAttempt: number = 0;
  // Count of consecutive initialization failures. When this reaches
  // MAX_INIT_RETRIES the provider permanently refuses further attempts.
  private _initFailureCount = 0;
  private static readonly MAX_INIT_RETRIES = 3;
  // Cooldown between retries after a failed initialization (ms).
  private static readonly INIT_RETRY_COOLDOWN_MS = 60_000;
  // Promise gate prevents double-initialization when multiple agents
  // concurrently call initialize() on the same provider instance.
  private _initPromise: Promise<void> | null = null;
  // AbortController for violation logger subscription lifecycle.
  private _loggerAbort: AbortController | null = null;

  constructor(private readonly defaults: SandboxDefaults) {}

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    // Already fully initialized — fast path
    if (this._initialized) return;

    // Hard limit: after MAX_INIT_RETRIES consecutive failures, permanently refuse.
    if (this._initFailureCount >= BubblewrapProvider.MAX_INIT_RETRIES) {
      throw SidjuaError.from(
        "SANDBOX-002",
        `Sandbox initialization failed after ${BubblewrapProvider.MAX_INIT_RETRIES} attempts — manual intervention required`,
      );
    }

    // Previous attempt failed — enforce cooldown before retrying.
    if (this._lastInitAttempt > 0) {
      const elapsed  = Date.now() - this._lastInitAttempt;
      const cooldown = BubblewrapProvider.INIT_RETRY_COOLDOWN_MS;
      if (elapsed < cooldown) {
        const retryAt = new Date(this._lastInitAttempt + cooldown).toISOString();
        throw SidjuaError.from(
          "SYS-011",
          `Bubblewrap initialization failed. Next retry available after ${retryAt}.`,
        );
      }
      // Cooldown has passed — log and fall through to retry.
      logger.info(
        "sandbox_init_retry",
        "Retrying bubblewrap initialization (previous attempt failed at " +
          new Date(this._lastInitAttempt).toISOString() + ")",
        {},
      );
    }

    // In-flight initialization — wait for the existing promise so concurrent
    // callers share a single SandboxManager.initialize() call.
    if (this._initPromise !== null) {
      await this._initPromise;
      return;
    }

    // Set _initPromise SYNCHRONOUSLY (before any await) so any concurrent
    // caller that enters after this line sees it immediately and waits.
    this._initPromise = this._doInitialize()
      .then(() => {
        this._initialized     = true;
        this._lastInitAttempt = 0; // reset on success so future cleanup+reinit works
        this._initFailureCount = 0;
      })
      .catch((err: unknown) => {
        // Record the failure time; _initPromise is cleared so the next caller
        // after the cooldown window can attempt a fresh initialization.
        this._lastInitAttempt = Date.now();
        this._initFailureCount += 1;
        this._initPromise      = null;
        throw err;
      });

    await this._initPromise;
  }

  private async _doInitialize(): Promise<void> {
    const runtimeConfig = this._buildRuntimeConfig(this.defaults);
    try {
      await SandboxManager.initialize(runtimeConfig);
      logger.info("sandbox_initialized", "Bubblewrap sandbox initialized", {
        metadata: {
          provider:       "bubblewrap",
          allowedDomains: this.defaults.network.allowedDomains.length,
          deniedDomains:  this.defaults.network.deniedDomains.length,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errEntry: { code: string; message: string; stack?: string } = {
        code: "SANDBOX_INIT_FAILED", message: msg,
      };
      if (err instanceof Error && err.stack !== undefined) errEntry.stack = err.stack;
      logger.error("sandbox_init_failed", "Bubblewrap initialization failed", {
        error: errEntry,
      });
      throw err;
    }
  }

  /**
   * Wrap a shell command with sandbox restrictions.
   * Per-agent network and filesystem overrides are applied via customConfig.
   */
  async wrapCommand(command: string, agentConfig: AgentSandboxConfig): Promise<string> {
    if (!this._initialized) {
      // Use SidjuaError so callers can distinguish this from generic errors.
      throw SidjuaError.from(
        "SYS-003",
        "BubblewrapProvider.wrapCommand() called before initialize() completed",
      );
    }

    // When no domains are explicitly allowed, enforce full network denial.
    // This is the sandbox equivalent of --unshare-net: the MITM proxy blocks all
    // outbound connections since there are no entries in the allowlist.
    const networkDenyAll = agentConfig.network.allowedDomains.length === 0;
    if (networkDenyAll) {
      logger.info(
        "sandbox_network_deny_all",
        "No allowed domains configured — all outbound network traffic blocked for this execution",
        { metadata: { agentId: agentConfig.agentId } },
      );
    }

    const customConfig: Partial<SandboxRuntimeConfig> = {
      network: {
        allowedDomains: agentConfig.network.allowedDomains,
        // Deny-all: proxy blocks everything when allowedDomains is empty;
        // explicit deniedDomains are layered on top for partial-allow policies.
        deniedDomains:  networkDenyAll ? [] : agentConfig.network.deniedDomains,
      },
      filesystem: {
        denyRead:   agentConfig.filesystem.denyRead,
        allowWrite: agentConfig.filesystem.allowWrite,
        denyWrite:  agentConfig.filesystem.denyWrite,
      },
    };

    return SandboxManager.wrapWithSandbox(command, undefined, customConfig);
  }

  /**
   * Check whether all sandbox dependencies (bwrap, socat, ripgrep, etc.) are present.
   * Maps the real API's { errors, warnings } to our SandboxDependencyCheck interface.
   */
  async checkDependencies(): Promise<SandboxDependencyCheck> {
    // checkDependencies() is synchronous in the real API
    const result = SandboxManager.checkDependencies();
    const available = result.errors.length === 0;
    return {
      available,
      provider: "bubblewrap",
      // "missing" uses the error messages as identifiers
      missing: result.errors,
      message: available
        ? "Bubblewrap sandbox dependencies satisfied" +
          (result.warnings.length > 0 ? ` (warnings: ${result.warnings.join(", ")})` : "")
        : `Bubblewrap dependencies missing: ${result.errors.join(", ")}`,
    };
  }

  /**
   * Return the HTTP proxy port started by SandboxManager.
   * Returns undefined when not initialized or proxy not started.
   */
  getProxyPort(): number | undefined {
    return this._initialized ? SandboxManager.getProxyPort() : undefined;
  }

  /**
   * Return the SOCKS proxy port started by SandboxManager.
   * Returns undefined when not initialized or proxy not started.
   */
  getSocksProxyPort(): number | undefined {
    return this._initialized ? SandboxManager.getSocksProxyPort() : undefined;
  }

  /**
   * Start violation logging for this provider.
   * Owned by the provider so it is automatically stopped on cleanup().
   * Callers MUST NOT call startViolationLogger(provider) externally when
   * using BubblewrapProvider — it manages its own subscription.
   *
   * The AbortController is aborted in cleanup() to prevent memory
   * leaks when the provider is recreated (hot-reconfigure scenario).
   */
  startViolationLogging(): void {
    if (!this._initialized) return;
    // Abort any existing subscription before creating a new one
    this._loggerAbort?.abort();
    this._loggerAbort = new AbortController();
    startViolationLogger(this, this._loggerAbort.signal);
  }

  async cleanup(): Promise<void> {
    if (!this._initialized) return;
    // Stop violation logger subscription before resetting SandboxManager
    if (this._loggerAbort !== null) {
      this._loggerAbort.abort();
      this._loggerAbort = null;
    }
    try {
      await SandboxManager.reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("sandbox_cleanup_error", "Error during sandbox cleanup", {
        metadata: { error: msg },
      });
    }
    this._initialized = false;
    this._initPromise = null;
    logger.info("sandbox_cleaned_up", "Bubblewrap sandbox cleaned up", {});
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _buildRuntimeConfig(defaults: SandboxDefaults): SandboxRuntimeConfig {
    return {
      network: {
        allowedDomains: defaults.network.allowedDomains,
        deniedDomains:  defaults.network.deniedDomains,
      },
      filesystem: {
        denyRead:   defaults.filesystem.denyRead,
        allowWrite: defaults.filesystem.allowWrite,
        denyWrite:  defaults.filesystem.denyWrite,
      },
    };
  }
}
