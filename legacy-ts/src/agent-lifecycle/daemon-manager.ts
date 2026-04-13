// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V1.1: AgentDaemonManager
 *
 * Manages the lifecycle of AgentDaemon instances across all registered agents.
 * Provides start/stop controls for individual agents and for the whole fleet.
 *
 * Agents with `daemon.mode === "on-demand"` or with no `daemon` config are skipped
 * by startAll() and must be activated explicitly via startAgent().
 */

import { parse as parseYaml } from "yaml";
import type { AgentRegistry } from "./agent-registry.js";
import type { TaskQueue } from "../tasks/queue.js";
import type { BudgetTracker } from "./budget-tracker.js";
import type { ProcessSupervisor } from "./supervisor/process-supervisor.js";
import type {
  AgentLifecycleDefinition,
  AgentDaemonConfig,
  DaemonGovernance,
  DaemonStatus,
} from "./types.js";
import { AgentDaemon, type ExecuteTaskFn, type SleepFn, type SchedulerServices } from "./agent-daemon.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("daemon-manager");


export class AgentDaemonManager {
  private readonly daemons = new Map<string, AgentDaemon>();

  constructor(
    private readonly registry:    AgentRegistry,
    private readonly queue:       TaskQueue,
    private readonly budget:      BudgetTracker,
    private readonly supervisor:  ProcessSupervisor,
    private readonly execute:     ExecuteTaskFn,
    private readonly governance:  DaemonGovernance = {},
    private readonly sleep?:      SleepFn,
  ) {}

  /** Inject scheduler services (CronScheduler + DeadlineWatcher). Must be called before startAll(). */
  private _schedulerServices?: SchedulerServices;
  setSchedulerServices(services: SchedulerServices): void {
    this._schedulerServices = services;
  }

  // ---------------------------------------------------------------------------
  // Fleet control
  // ---------------------------------------------------------------------------

  /**
   * Start daemon loops for all agents that have a daemon config with mode
   * !== "on-demand". Already-running daemons are left unchanged.
   * Returns the number of daemons started.
   */
  startAll(): number {
    const rows = this.registry.list();
    let started = 0;

    for (const row of rows) {
      let def: AgentLifecycleDefinition;
      try {
        def = parseYaml(row.config_yaml) as AgentLifecycleDefinition;
      } catch (e: unknown) {
        logger.warn("daemon-manager", "YAML parse failed for agent — skipping", {
          metadata: {
            agent_id: row.id,
            error: e instanceof Error ? e.message : String(e),
          },
        });
        continue;
      }

      if (!_shouldAutoStart(def.daemon)) continue;
      if (this.daemons.has(row.id)) continue; // already running

      this._launch(row.id, def.daemon!);
      started++;
    }

    return started;
  }

  /** Stop all running daemon loops. */
  async stopAll(): Promise<void> {
    await Promise.all(
      Array.from(this.daemons.values()).map((d) => d.stop()),
    );
    this.daemons.clear();
  }

  // ---------------------------------------------------------------------------
  // Per-agent control
  // ---------------------------------------------------------------------------

  /**
   * Start a daemon for a specific agent.
   * If no daemonConfig is provided, reads it from the registry.
   * No-op if the daemon is already running.
   */
  startAgent(agentId: string, daemonConfig?: AgentDaemonConfig): boolean {
    if (this.daemons.has(agentId)) return false;

    let config = daemonConfig;
    if (config === undefined) {
      const row = this.registry.getById(agentId);
      if (row === undefined) {
        logger.warn("daemon-manager", "Agent not found in registry", { metadata: { agent_id: agentId } });
        return false;
      }
      try {
        const def = parseYaml(row.config_yaml) as AgentLifecycleDefinition;
        config = def.daemon;
      } catch (e: unknown) {
        logger.warn("daemon-manager", "YAML parse failed for agent", {
          metadata: { agent_id: agentId, error: e instanceof Error ? e.message : String(e) },
        });
        return false;
      }
    }

    this._launch(agentId, config ?? {});
    return true;
  }

  /** Stop and remove a running daemon for a specific agent. */
  async stopAgent(agentId: string): Promise<boolean> {
    const daemon = this.daemons.get(agentId);
    if (daemon === undefined) return false;
    await daemon.stop();
    this.daemons.delete(agentId);
    return true;
  }

  /**
   * Restart a daemon: stop it (if running) then start it again.
   * Used by the watchdog system to recover crashed agents.
   * Returns true if the daemon was successfully restarted.
   */
  async restartAgent(agentId: string): Promise<boolean> {
    await this.stopAgent(agentId);
    return this.startAgent(agentId);
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  /** Return status for a single agent's daemon (undefined if not running). */
  getStatus(agentId: string): DaemonStatus | undefined {
    return this.daemons.get(agentId)?.getStatus();
  }

  /** Return status for all running daemons. */
  getAllStatuses(): DaemonStatus[] {
    return Array.from(this.daemons.values()).map((d) => d.getStatus());
  }

  /** Return the number of currently active daemon loops. */
  get activeCount(): number {
    return this.daemons.size;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _launch(agentId: string, config: AgentDaemonConfig): void {
    // Resolve per-agent division for scheduler services
    let agentSchedulerServices = this._schedulerServices;
    if (agentSchedulerServices !== undefined) {
      // Attempt to look up this agent's division from the registry
      const row = this.registry.getById(agentId);
      if (row !== undefined) {
        try {
          const def = parseYaml(row.config_yaml) as { division?: string };
          const division = def.division ?? agentSchedulerServices.agentDivision;
          agentSchedulerServices = { ...agentSchedulerServices, agentDivision: division };
        } catch (_err) { /* keep parent scheduler services with fallback division */ }
      }
    }

    const daemon = new AgentDaemon(
      agentId,
      config,
      this.governance,
      this.queue,
      this.budget,
      this.supervisor,
      this.execute,
      this.sleep,
      undefined, // watchdogPair
      undefined, // proactiveScanner
      agentSchedulerServices,
    );
    this.daemons.set(agentId, daemon);
    daemon.start();
    logger.info("daemon-manager", "Daemon started", { metadata: { agent_id: agentId } });
  }
}


function _shouldAutoStart(config: AgentDaemonConfig | undefined): boolean {
  if (config === undefined) return false;
  const mode = config.mode ?? "polling";
  return mode !== "on-demand";
}
