// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: Executors Public API
 */

export { ScriptExecutor }  from "./script-executor.js";
export { CliExecutor }     from "./cli-executor.js";
export { McpBridge }       from "./mcp-bridge.js";

export type { ScriptExecutionRequest, ScriptExecutionResult } from "./script-executor.js";
export type { CliExecutionRequest }                           from "./cli-executor.js";
export type { McpBridgeRequest, McpBridgeResult, McpClient }  from "./mcp-bridge.js";
