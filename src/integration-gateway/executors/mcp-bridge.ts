// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: MCP Protocol Bridge
 *
 * Bridges Integration Gateway action calls to MCP (Model Context Protocol)
 * tool invocations.
 *
 * Integration point:
 *   SIDJUA already has an MCP client in src/tool-integration/adapters/mcp-adapter.ts
 *   that spawns an MCP server via stdio and speaks JSON-RPC 2.0.  The gateway
 *   MCP bridge should eventually delegate to that McpAdapter (or a shared client
 *   pool managed by ToolManager).
 *
 *   TODO: Wire McpBridge.execute() to ToolManager.getTool(serverName)
 *   and call callTool(toolName, args).  The ToolManager registry already knows
 *   which MCP servers are configured.
 *
 * Until Phase 3, this stub throws `MCP_NOT_IMPLEMENTED` to surface the integration
 * gap clearly rather than silently swallowing calls.
 */

import { createLogger }     from "../../core/logger.js";
import { IntegrationError } from "../errors.js";

const logger = createLogger("mcp-bridge");


export interface McpBridgeRequest {
  /** Name of the MCP server (from adapter definition, e.g. "filesystem-mcp") */
  server_name: string;
  /** MCP tool name to call */
  tool_name: string;
  /** Arguments passed to the MCP tool */
  arguments: Record<string, unknown>;
  /** Request correlation ID */
  request_id: string;
  /** Timeout for the MCP tool call */
  timeout_ms: number;
}

export interface McpBridgeResult {
  success: boolean;
  result: unknown;
  error?: string;
  execution_ms: number;
}


export class McpBridge {
  /**
   * Create an McpBridge.
   *
   * @param mcpClientFactory  Optional factory that returns a configured MCP
   *   client for a given server name.  Injecting this allows tests and
   *   Phase 3 wiring to provide a real client without modifying the bridge.
   */
  constructor(
    private readonly mcpClientFactory?: (serverName: string) => Promise<McpClient | null>,
  ) {}

  /**
   * Execute an MCP tool call.
   *
   * If a `mcpClientFactory` was provided and returns a client, the call is
   * forwarded to the MCP server.  Otherwise throws `MCP_NOT_IMPLEMENTED`.
   */
  async execute(request: McpBridgeRequest): Promise<McpBridgeResult> {
    const startTime = Date.now();

    if (this.mcpClientFactory !== undefined) {
      const client = await this.mcpClientFactory(request.server_name);
      if (client !== null) {
        try {
          logger.debug("mcp-bridge", `Calling tool '${request.tool_name}' on server '${request.server_name}'`, {
            metadata: { requestId: request.request_id, server: request.server_name, tool: request.tool_name },
          });
          const result = await client.callTool(request.tool_name, request.arguments, request.timeout_ms);
          return {
            success:      true,
            result,
            execution_ms: Date.now() - startTime,
          };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn("mcp-bridge", `MCP tool call failed: ${msg}`, {
            metadata: { requestId: request.request_id, server: request.server_name, tool: request.tool_name },
          });
          return {
            success:      false,
            result:       null,
            error:        msg,
            execution_ms: Date.now() - startTime,
          };
        }
      }
    }

    // No client configured — documented integration gap
    logger.warn("mcp-bridge", "MCP bridge called but no client factory configured", {
      metadata: { requestId: request.request_id, server: request.server_name },
    });
    throw new IntegrationError(
      `MCP bridge: no client configured for server '${request.server_name}'. ` +
      "Wire McpBridge with a mcpClientFactory to enable MCP protocol support (#503 Phase 3).",
      "MCP_NOT_IMPLEMENTED",
      request.server_name,
      request.tool_name,
    );
  }
}


/**
 * Minimal surface the bridge needs from a MCP client.
 * The existing McpAdapter in src/tool-integration/adapters/mcp-adapter.ts
 * implements a superset of this interface.
 */
export interface McpClient {
  callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
}
