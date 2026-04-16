// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 19: Sandbox Types
 *
 * Core interfaces and configuration types for the agent sandboxing system.
 * Supports pluggable providers: "none" (passthrough) and "bubblewrap" (Linux namespaces).
 */


/**
 * Configuration for sandbox behavior at the division/agent level.
 * Loaded from divisions.yaml -> sandbox section.
 */
export interface SandboxConfig {
  /** Which sandbox provider to use. "none" = passthrough (no isolation). */
  provider: "none" | "bubblewrap";
  defaults: SandboxDefaults;
}

export interface SandboxDefaults {
  network: SandboxNetworkConfig;
  filesystem: SandboxFilesystemConfig;
}

export interface SandboxNetworkConfig {
  /**
   * Domains the agent is allowed to connect to.
   * Empty array = unrestricted when provider is "none",
   * blocked-all when provider is "bubblewrap".
   */
  allowedDomains: string[];
  /** Domains explicitly denied. Takes precedence over allowedDomains. */
  deniedDomains: string[];
}

export interface SandboxFilesystemConfig {
  /** Paths the agent is denied read access to. */
  denyRead: string[];
  /** Paths the agent is allowed to write to. Agent workdir is always implicitly allowed. */
  allowWrite: string[];
  /** Paths the agent is explicitly denied write access to. Takes precedence. */
  denyWrite: string[];
}


/**
 * Per-agent sandbox configuration, derived from division config + agent-specific overrides.
 * Passed to wrapCommand() at runtime.
 */
export interface AgentSandboxConfig {
  agentId: string;
  workDir: string;
  network: SandboxNetworkConfig;
  filesystem: SandboxFilesystemConfig;
}


/**
 * Result of a dependency check (checkDependencies()).
 * Never throws — returns a plain object.
 */
export interface SandboxDependencyCheck {
  available: boolean;
  provider: string;
  missing: string[];
  message: string;
}


/**
 * The core interface that all sandbox providers must implement.
 *
 * Lifecycle:
 *   1. createSandboxProvider(config) — factory, does not initialize
 *   2. provider.initialize()         — start proxies, check binaries, etc.
 *   3. provider.wrapCommand(cmd, agentConfig) — called per agent invocation
 *   4. provider.cleanup()            — stop proxies, release resources
 */
export interface SandboxProvider {
  /** Human-readable name of this provider (e.g. "none", "bubblewrap") */
  readonly name: string;

  /** Initialize the provider (start proxies, check binaries, etc.) */
  initialize(): Promise<void>;

  /**
   * Wrap a shell command string so it runs inside the sandbox.
   *
   * For NoSandboxProvider, returns the command unchanged.
   * For BubblewrapProvider , wraps with bwrap + proxy config.
   *
   * @param command     - The raw shell command to wrap
   * @param agentConfig - Per-agent network/filesystem policy
   * @returns           - The wrapped command ready to pass to child_process
   */
  wrapCommand(command: string, agentConfig: AgentSandboxConfig): Promise<string>;

  /**
   * Check whether all required dependencies are available on this system.
   * Must NOT throw — returns a result object.
   */
  checkDependencies(): Promise<SandboxDependencyCheck>;

  /** Release all resources (stop proxies, etc.) */
  cleanup(): Promise<void>;

  /** Whether initialize() has been called and completed successfully */
  readonly initialized: boolean;
}
