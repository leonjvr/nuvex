// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * ADB adapter — shells out to `adb` CLI for Android device interaction.
 * Supports: connect, shell, push, pull, install, screencap, am_start, pm_list.
 */

import { execFileSync } from "node:child_process";
import type {
  ToolAdapter,
  ToolAction,
  ToolCapability,
  ToolResult,
  ToolType,
  AdbToolConfig,
} from "../types.js";
import { createLogger } from "../../core/logger.js";

const logger = createLogger("adb-adapter");

export class AdbAdapter implements ToolAdapter {
  readonly id: string;
  readonly type: ToolType = "adb";

  private connected = false;
  private readonly config: AdbToolConfig;
  private readonly capabilities: ToolCapability[];

  constructor(
    id: string,
    config: AdbToolConfig,
    capabilities: ToolCapability[]
  ) {
    this.id = id;
    this.config = config;
    this.capabilities = capabilities;
  }

  async connect(): Promise<void> {
    const adbPath = this.config.adb_path ?? "adb";
    const timeout = this.config.timeout_ms ?? 30000;

    // Verify adb is available.
    execFileSync(adbPath, ["devices"], { timeout, encoding: "utf8" });

    if (this.config.wifi_address != null) {
      execFileSync(adbPath, ["connect", this.config.wifi_address], {
        timeout,
        encoding: "utf8",
      });
    }

    this.connected = true;
  }

  async execute(action: ToolAction): Promise<ToolResult> {
    const start = Date.now();
    const adbPath = this.config.adb_path ?? "adb";
    const timeout = this.config.timeout_ms ?? 30000;

    try {
      const args = this.buildArgs(action.capability, action.params);
      const result = execFileSync(adbPath, args, {
        timeout,
        encoding: "utf8",
      });
      return {
        success: true,
        data: { output: result },
        duration_ms: Date.now() - start,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: msg,
        duration_ms: Date.now() - start,
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    const adbPath = this.config.adb_path ?? "adb";
    const timeout = this.config.timeout_ms ?? 30000;
    try {
      const args: string[] =
        this.config.serial != null ? ["-s", this.config.serial, "devices"] : ["devices"];
      execFileSync(adbPath, args, { timeout, encoding: "utf8" });
      return true;
    } catch (e: unknown) {
      logger.warn("adb-adapter", "ADB device health check failed — adapter may be unavailable", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.config.wifi_address != null) {
      const adbPath = this.config.adb_path ?? "adb";
      const timeout = this.config.timeout_ms ?? 30000;
      try {
        execFileSync(adbPath, ["disconnect", this.config.wifi_address], {
          timeout,
          encoding: "utf8",
        });
      } catch (e: unknown) { void e; /* cleanup-ignore: ADB disconnect is best-effort */ }
    }
    this.connected = false;
  }

  getCapabilities(): ToolCapability[] {
    return this.capabilities;
  }

  private buildArgs(capability: string, params: Record<string, unknown>): string[] {
    const prefix: string[] =
      this.config.serial != null ? ["-s", this.config.serial] : [];

    switch (capability) {
      case "shell":
        return [...prefix, "shell", String(params["command"] ?? "")];

      case "push":
        return [
          ...prefix,
          "push",
          String(params["local"]),
          String(params["remote"]),
        ];

      case "pull":
        return [
          ...prefix,
          "pull",
          String(params["remote"]),
          String(params["local"]),
        ];

      case "install":
        return [...prefix, "install", String(params["apk_path"])];

      case "screencap":
        // Returns PNG bytes via exec-out.
        return [...prefix, "exec-out", "screencap", "-p"];

      case "am_start":
        return [
          ...prefix,
          "shell",
          "am",
          "start",
          String(params["intent"] ?? ""),
        ];

      case "pm_list":
        return [...prefix, "shell", "pm", "list", "packages"];

      case "connect":
        return [
          "connect",
          String(params["address"] ?? this.config.wifi_address ?? ""),
        ];

      default:
        throw new Error(`Unknown capability: ${capability}`);
    }
  }
}
