// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8: HeartbeatMonitor
 *
 * Tracks the last heartbeat timestamp for each monitored agent subprocess.
 * In-memory only — rebuilt on system restart. No persistence needed.
 *
 * ITBootstrapAgent polls isHealthy() every check_interval_ms to detect
 * unresponsive agents and trigger restart procedures.
 */


export class HeartbeatMonitor {
  /** agentId → last heartbeat time (ms since epoch) */
  private readonly lastSeen = new Map<string, number>();

  /** Config: ms after which an agent is considered unhealthy */
  private readonly timeoutMs: number;

  constructor(config: { timeout_ms: number }) {
    this.timeoutMs = config.timeout_ms;
  }

  /**
   * Record a heartbeat from an agent.
   * Called whenever the parent process receives a HEARTBEAT IPC message.
   */
  recordHeartbeat(agentId: string): void {
    this.lastSeen.set(agentId, Date.now());
  }

  /**
   * Return true if the agent has sent a heartbeat within the timeout window.
   * Unregistered agents are always considered unhealthy.
   */
  isHealthy(agentId: string): boolean {
    const last = this.lastSeen.get(agentId);
    if (last === undefined) return false;
    return Date.now() - last <= this.timeoutMs;
  }

  /**
   * Return the number of milliseconds since the agent's last heartbeat.
   * Returns null if the agent has never sent a heartbeat.
   */
  getTimeSinceLastHeartbeat(agentId: string): number | null {
    const last = this.lastSeen.get(agentId);
    if (last === undefined) return null;
    return Date.now() - last;
  }

  /** Get the ISO 8601 timestamp of the last heartbeat, or null if never seen. */
  getLastHeartbeatTime(agentId: string): string | null {
    const last = this.lastSeen.get(agentId);
    if (last === undefined) return null;
    return new Date(last).toISOString();
  }

  /**
   * Register an agent for monitoring.
   * This does NOT record a heartbeat — call recordHeartbeat() when the first
   * heartbeat arrives. Until then, isHealthy() returns false.
   */
  register(agentId: string): void {
    // Only register if not already tracking (preserve existing heartbeat)
    if (!this.lastSeen.has(agentId)) {
      // Initialize with current time so newly registered agents get a grace period
      this.lastSeen.set(agentId, Date.now());
    }
  }

  /** Remove an agent from monitoring. */
  unregister(agentId: string): void {
    this.lastSeen.delete(agentId);
  }

  /** Return agent IDs whose heartbeats have timed out. */
  getUnhealthyAgents(): string[] {
    const now = Date.now();
    const unhealthy: string[] = [];
    for (const [agentId, last] of this.lastSeen) {
      if (now - last > this.timeoutMs) {
        unhealthy.push(agentId);
      }
    }
    return unhealthy;
  }

  /** Return all registered agent IDs. */
  getRegisteredAgents(): string[] {
    return [...this.lastSeen.keys()];
  }
}
