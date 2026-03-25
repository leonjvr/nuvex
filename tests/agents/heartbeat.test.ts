/**
 * Tests for src/agents/heartbeat.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { HeartbeatMonitor } from "../../src/agents/heartbeat.js";

describe("HeartbeatMonitor — registration", () => {
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    monitor = new HeartbeatMonitor({ timeout_ms: 5000 });
  });

  it("register makes agent visible in getRegisteredAgents()", () => {
    monitor.register("agent-1");
    expect(monitor.getRegisteredAgents()).toContain("agent-1");
  });

  it("unregister removes agent", () => {
    monitor.register("agent-1");
    monitor.unregister("agent-1");
    expect(monitor.getRegisteredAgents()).not.toContain("agent-1");
  });

  it("register twice only registers once", () => {
    monitor.register("agent-1");
    monitor.register("agent-1");
    expect(monitor.getRegisteredAgents().filter((id) => id === "agent-1")).toHaveLength(1);
  });

  it("unregistered agent isHealthy returns false", () => {
    expect(monitor.isHealthy("not-registered")).toBe(false);
  });
});

describe("HeartbeatMonitor — heartbeat recording", () => {
  let monitor: HeartbeatMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    monitor = new HeartbeatMonitor({ timeout_ms: 5000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recordHeartbeat makes agent healthy", () => {
    monitor.register("agent-1");
    monitor.recordHeartbeat("agent-1");
    expect(monitor.isHealthy("agent-1")).toBe(true);
  });

  it("agent is unhealthy after timeout", () => {
    monitor.register("agent-1");
    monitor.recordHeartbeat("agent-1");
    vi.advanceTimersByTime(6000); // past 5000ms timeout
    expect(monitor.isHealthy("agent-1")).toBe(false);
  });

  it("agent remains healthy within timeout window", () => {
    monitor.register("agent-1");
    monitor.recordHeartbeat("agent-1");
    vi.advanceTimersByTime(4999);
    expect(monitor.isHealthy("agent-1")).toBe(true);
  });

  it("recordHeartbeat without register still works", () => {
    // recordHeartbeat can work without prior register
    monitor.recordHeartbeat("spontaneous");
    expect(monitor.isHealthy("spontaneous")).toBe(true);
  });

  it("getTimeSinceLastHeartbeat returns null for unknown agent", () => {
    expect(monitor.getTimeSinceLastHeartbeat("ghost")).toBeNull();
  });

  it("getTimeSinceLastHeartbeat returns elapsed time", () => {
    monitor.recordHeartbeat("agent-1");
    vi.advanceTimersByTime(1000);
    const elapsed = monitor.getTimeSinceLastHeartbeat("agent-1");
    expect(elapsed).not.toBeNull();
    expect(elapsed!).toBeGreaterThanOrEqual(1000);
  });

  it("getLastHeartbeatTime returns ISO 8601 string", () => {
    monitor.recordHeartbeat("agent-1");
    const t = monitor.getLastHeartbeatTime("agent-1");
    expect(t).not.toBeNull();
    expect(() => new Date(t!).toISOString()).not.toThrow();
  });
});

describe("HeartbeatMonitor — getUnhealthyAgents", () => {
  it("returns empty when all healthy", () => {
    const monitor = new HeartbeatMonitor({ timeout_ms: 5000 });
    monitor.register("a");
    monitor.register("b");
    monitor.recordHeartbeat("a");
    monitor.recordHeartbeat("b");
    expect(monitor.getUnhealthyAgents()).toHaveLength(0);
  });

  it("returns unhealthy agents after timeout", () => {
    vi.useFakeTimers();
    const monitor = new HeartbeatMonitor({ timeout_ms: 1000 });
    monitor.register("healthy");
    monitor.register("sick");
    monitor.recordHeartbeat("healthy");
    monitor.recordHeartbeat("sick");

    vi.advanceTimersByTime(500);
    monitor.recordHeartbeat("healthy"); // healthy renewed

    vi.advanceTimersByTime(600); // sick now timed out
    const unhealthy = monitor.getUnhealthyAgents();
    expect(unhealthy).toContain("sick");
    expect(unhealthy).not.toContain("healthy");
    vi.useRealTimers();
  });

  it("unregistered agents do not appear in unhealthy list", () => {
    vi.useFakeTimers();
    const monitor = new HeartbeatMonitor({ timeout_ms: 100 });
    monitor.register("temp");
    monitor.recordHeartbeat("temp");
    monitor.unregister("temp");
    vi.advanceTimersByTime(200);
    expect(monitor.getUnhealthyAgents()).toHaveLength(0);
    vi.useRealTimers();
  });
});
