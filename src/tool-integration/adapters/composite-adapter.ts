// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Composite adapter — routes to multiple sub-tools.
 * Strategies: fallback (try in order, use first success), parallel (all, return first success), round_robin.
 * Logs sub-tool failures and continues to next.
 */

import type {
  ToolAdapter,
  ToolAction,
  ToolCapability,
  ToolResult,
  ToolType,
  CompositeToolConfig,
} from "../types.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("composite-adapter");

export class CompositeAdapter implements ToolAdapter {
  readonly id: string;
  readonly type: ToolType = "composite";

  private readonly config: CompositeToolConfig;
  private readonly subAdapters: Map<string, ToolAdapter>;
  private readonly capabilities: ToolCapability[];
  private rrIndex = 0;

  constructor(
    id: string,
    config: CompositeToolConfig,
    subAdapters: Map<string, ToolAdapter>,
    capabilities: ToolCapability[]
  ) {
    this.id = id;
    this.config = config;
    this.subAdapters = subAdapters;
    this.capabilities = capabilities;
  }

  async connect(): Promise<void> {
    for (const subId of this.config.sub_tools) {
      const adapter = this.subAdapters.get(subId);
      if (adapter == null) continue;
      try {
        await adapter.connect();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("composite_connect_failed", `Sub-tool ${subId} failed to connect`, { metadata: { sub_tool_id: subId, error: msg } });
      }
    }
  }

  async execute(action: ToolAction): Promise<ToolResult> {
    switch (this.config.strategy) {
      case "fallback":
        return this.executeFallback(action);
      case "parallel":
        return this.executeParallel(action);
      case "round_robin":
        return this.executeRoundRobin(action);
    }
  }

  private async executeFallback(action: ToolAction): Promise<ToolResult> {
    let lastResult: ToolResult = {
      success: false,
      error: "No sub-tools available",
      duration_ms: 0,
    };

    for (const subId of this.config.sub_tools) {
      const adapter = this.subAdapters.get(subId);
      if (adapter == null) continue;
      try {
        const result = await adapter.execute(action);
        if (result.success) {
          return result;
        }
        lastResult = result;
        const errMsg = result.error ?? "sub-tool returned failure";
        logger.error("composite_sub_tool_failed", `Sub-tool ${subId} failed: ${errMsg}, trying next`, { metadata: { sub_tool_id: subId, error: errMsg } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("composite_sub_tool_failed", `Sub-tool ${subId} failed: ${msg}, trying next`, { metadata: { sub_tool_id: subId, error: msg } });
        lastResult = { success: false, error: msg, duration_ms: 0 };
      }
    }

    return lastResult;
  }

  private async executeParallel(action: ToolAction): Promise<ToolResult> {
    const adapters = this.config.sub_tools
      .map((subId) => ({ subId, adapter: this.subAdapters.get(subId) }))
      .filter((entry): entry is { subId: string; adapter: ToolAdapter } => entry.adapter != null);

    const settled = await Promise.allSettled(
      adapters.map(({ adapter }) => adapter.execute(action))
    );

    for (const outcome of settled) {
      if (outcome.status === "fulfilled" && outcome.value.success) {
        return outcome.value;
      }
    }

    // None fulfilled successfully — return last error or generic failure.
    for (let i = settled.length - 1; i >= 0; i--) {
      const outcome = settled[i];
      if (outcome !== undefined && outcome.status === "fulfilled") {
        return outcome.value;
      }
    }

    return { success: false, error: "All parallel sub-tools failed", duration_ms: 0 };
  }

  private async executeRoundRobin(action: ToolAction): Promise<ToolResult> {
    const subIds = this.config.sub_tools;
    if (subIds.length === 0) {
      return { success: false, error: "No sub-tools available", duration_ms: 0 };
    }

    const startIndex = this.rrIndex % subIds.length;
    this.rrIndex++;

    // Try selected adapter first, then fall through on failure.
    for (let offset = 0; offset < subIds.length; offset++) {
      const idx = (startIndex + offset) % subIds.length;
      const subId = subIds[idx];
      if (subId == null) continue;
      const adapter = this.subAdapters.get(subId);
      if (adapter == null) continue;
      try {
        const result = await adapter.execute(action);
        if (result.success || offset === subIds.length - 1) {
          return result;
        }
        const errMsg = result.error ?? "sub-tool returned failure";
        logger.error("composite_sub_tool_failed", `Sub-tool ${subId} failed: ${errMsg}, trying next`, { metadata: { sub_tool_id: subId, error: errMsg } });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("composite_sub_tool_failed", `Sub-tool ${subId} failed: ${msg}, trying next`, { metadata: { sub_tool_id: subId, error: msg } });
      }
    }

    return { success: false, error: "All round-robin sub-tools failed", duration_ms: 0 };
  }

  async healthCheck(): Promise<boolean> {
    for (const subId of this.config.sub_tools) {
      const adapter = this.subAdapters.get(subId);
      if (adapter == null) continue;
      try {
        const healthy = await adapter.healthCheck();
        if (healthy) return true;
      } catch (e: unknown) {
        logger.warn("composite-adapter", "Sub-adapter health check failed — adapter may be unavailable", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      }
    }
    return false;
  }

  async disconnect(): Promise<void> {
    for (const subId of this.config.sub_tools) {
      const adapter = this.subAdapters.get(subId);
      if (adapter == null) continue;
      try {
        await adapter.disconnect();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("composite_disconnect_failed", `Sub-tool ${subId} failed to disconnect`, { metadata: { sub_tool_id: subId, error: msg } });
      }
    }
  }

  getCapabilities(): ToolCapability[] {
    const seen = new Set<string>();
    const merged: ToolCapability[] = [];

    // Start with the capabilities injected at construction time.
    for (const cap of this.capabilities) {
      if (!seen.has(cap.name)) {
        seen.add(cap.name);
        merged.push(cap);
      }
    }

    // Augment with capabilities from each live sub-adapter.
    for (const subId of this.config.sub_tools) {
      const adapter = this.subAdapters.get(subId);
      if (adapter == null) continue;
      for (const cap of adapter.getCapabilities()) {
        if (!seen.has(cap.name)) {
          seen.add(cap.name);
          merged.push(cap);
        }
      }
    }

    return merged;
  }
}
