// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * MCP (Model Context Protocol) adapter — JSON-RPC 2.0 over stdio.
 * Spawns the MCP server process once, handles initialize handshake,
 * multiplexes JSON-RPC requests/responses with 30s timeout.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createLogger } from "../../core/logger.js";
import type {
  ToolAdapter,
  ToolAction,
  ToolCapability,
  ToolResult,
  ToolType,
  McpToolConfig,
} from "../types.js";


interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface PendingRequest {
  resolve: (r: JsonRpcResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}


const logger = createLogger("mcp-adapter");


const REQUEST_TIMEOUT_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

export class McpAdapter implements ToolAdapter {
  readonly id: string;
  readonly type: ToolType = "mcp";

  private readonly config: McpToolConfig;
  private readonly capabilities: ToolCapability[];

  private process: ChildProcess | null = null;
  private connected = false;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stdoutBuffer = "";

  constructor(id: string, config: McpToolConfig, capabilities: ToolCapability[]) {
    this.id = id;
    this.config = config;
    this.capabilities = capabilities;
  }

  // -------------------------------------------------------------------------
  // connect
  // -------------------------------------------------------------------------

  async connect(): Promise<void> {
    const child = spawn(this.config.command, this.config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(this.config.env ?? {}) },
    });

    this.process = child;

    // Wire stdout — line-buffered JSON-RPC parsing
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      let newlineIdx: number;
      while ((newlineIdx = this.stdoutBuffer.indexOf("\n")) !== -1) {
        const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          this.handleLine(line);
        }
      }
    });

    // Wire stderr — log prefixed lines
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.trim().length > 0) {
          logger.error("mcp_stderr", line, { metadata: { tool_id: this.id } });
        }
      }
    });

    // Process exit — reject all pending requests
    child.on("exit", () => {
      this.connected = false;
      const err = new Error("MCP process exited");
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.reject(err);
      }
      this.pending.clear();
    });

    // Send initialize request and wait for response
    const initResponse = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sidjua", version: "1.0.0" },
    });

    if (initResponse.error != null) {
      child.kill();
      throw new Error(`MCP initialize failed: ${initResponse.error.message}`);
    }

    // Send initialized notification (no id field)
    this.sendNotification("notifications/initialized");

    this.connected = true;
  }

  // -------------------------------------------------------------------------
  // execute
  // -------------------------------------------------------------------------

  async execute(action: ToolAction): Promise<ToolResult> {
    const start = Date.now();

    if (!this.connected) {
      return {
        success: false,
        error: "MCP adapter not connected",
        duration_ms: Date.now() - start,
      };
    }

    const response = await this.sendRequest("tools/call", {
      name: action.capability,
      arguments: action.params,
    });

    const duration_ms = Date.now() - start;

    if (response.error != null) {
      return {
        success: false,
        error: response.error.message,
        duration_ms,
      };
    }

    return {
      success: true,
      data: response.result,
      duration_ms,
    };
  }

  // -------------------------------------------------------------------------
  // healthCheck
  // -------------------------------------------------------------------------

  async healthCheck(): Promise<boolean> {
    if (!this.connected || this.process == null) {
      return false;
    }

    try {
      const response = await Promise.race([
        this.sendRequest("ping", {}),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ping timeout")), HEALTH_CHECK_TIMEOUT_MS)
        ),
      ]);
      return response.error == null;
    } catch (e: unknown) {
      logger.warn("mcp-adapter", "MCP provider ping failed — connection may be unavailable", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // disconnect
  // -------------------------------------------------------------------------

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.process != null) {
      this.process.kill();
      this.process = null;
    }
  }

  // -------------------------------------------------------------------------
  // getCapabilities
  // -------------------------------------------------------------------------

  getCapabilities(): ToolCapability[] {
    return this.capabilities;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Send a JSON-RPC request and return a promise for the response. */
  private sendRequest(method: string, params: unknown): Promise<JsonRpcResponse> {
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const id = this.nextId++;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method} (id=${id})`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.writeToProcess(request);
    });
  }

  /** Send a JSON-RPC notification (no id, no response expected). */
  private sendNotification(method: string, params?: unknown): void {
    const notification: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined ? { params } : {}),
    };
    this.writeToProcess(notification);
  }

  /** Write a JSON-RPC message to the child process stdin. */
  private writeToProcess(msg: JsonRpcRequest): void {
    if (this.process?.stdin == null) {
      throw new Error("MCP process stdin not available");
    }
    this.process.stdin.write(JSON.stringify(msg) + "\n");
  }

  /** Handle a single line of stdout from the child process. */
  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e: unknown) {
      logger.debug("mcp-adapter", "Unparseable MCP stdout line — skipping", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      return;
    }

    // Validate it looks like a JSON-RPC response
    if (
      parsed == null ||
      typeof parsed !== "object" ||
      !("id" in parsed)
    ) {
      // Notification or unknown — ignore
      return;
    }

    // Safe cast: we validated the shape above
    const response = parsed as JsonRpcResponse;
    const id = response.id;

    if (typeof id !== "number") {
      return;
    }

    const pending = this.pending.get(id);
    if (pending == null) {
      logger.warn("mcp_no_pending_request", `No pending request for id=${id}`, { metadata: { tool_id: this.id, rpc_id: id } });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(response);
  }
}
