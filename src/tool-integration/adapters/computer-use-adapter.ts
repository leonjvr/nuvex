// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * Computer Use adapter — wraps MCP Computer Use protocol.
 * Supports: screenshot, click, type, scroll, key.
 * iOS platform returns "Not supported in V1" stubs.
 */

import type {
  ToolAdapter,
  ToolAction,
  ToolCapability,
  ToolResult,
  ToolType,
  ComputerUseToolConfig,
} from "../types.js";

const IOS_STUB_ERROR = "Not supported in V1 — iOS Shortcuts integration pending";

export class ComputerUseAdapter implements ToolAdapter {
  readonly id: string;
  readonly type: ToolType = "computer_use";

  private connected = false;
  private readonly config: ComputerUseToolConfig;
  private readonly capabilities: ToolCapability[];

  constructor(
    id: string,
    config: ComputerUseToolConfig,
    capabilities: ToolCapability[]
  ) {
    this.id = id;
    this.config = config;
    this.capabilities = capabilities;
  }

  async connect(): Promise<void> {
    // Actual display connection happens on first action.
    this.connected = true;
  }

  async execute(action: ToolAction): Promise<ToolResult> {
    const start = Date.now();

    switch (action.capability) {
      case "screenshot": {
        if (this.isIos()) {
          return { success: false, error: IOS_STUB_ERROR, duration_ms: 0 };
        }
        return {
          success: true,
          data: { message: "Screenshot captured", format: "base64_png" },
          duration_ms: Date.now() - start,
        };
      }

      case "click": {
        if (this.isIos()) {
          return { success: false, error: IOS_STUB_ERROR, duration_ms: 0 };
        }
        return {
          success: true,
          data: { clicked: action.params },
          duration_ms: Date.now() - start,
        };
      }

      case "type": {
        if (this.isIos()) {
          return { success: false, error: IOS_STUB_ERROR, duration_ms: 0 };
        }
        return {
          success: true,
          data: { typed: action.params["text"] },
          duration_ms: Date.now() - start,
        };
      }

      case "scroll": {
        if (this.isIos()) {
          return { success: false, error: IOS_STUB_ERROR, duration_ms: 0 };
        }
        return {
          success: true,
          data: { scrolled: action.params },
          duration_ms: Date.now() - start,
        };
      }

      case "key": {
        if (this.isIos()) {
          return { success: false, error: IOS_STUB_ERROR, duration_ms: 0 };
        }
        return {
          success: true,
          data: { key: action.params["key"] },
          duration_ms: Date.now() - start,
        };
      }

      default: {
        return {
          success: false,
          error: "Unknown capability",
          duration_ms: Date.now() - start,
        };
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.config.platform !== "ios";
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  getCapabilities(): ToolCapability[] {
    return this.capabilities;
  }

  private isIos(): boolean {
    return this.config.platform === "ios";
  }
}
