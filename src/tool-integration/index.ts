// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

// Types
export * from "./types.js";

// Migration
export { runToolMigrations, TOOL_MIGRATIONS } from "./migration.js";

// Rate limiter
export { SlidingWindowRateLimiter } from "./rate-limiter.js";

// Registry & management
export { ToolRegistry } from "./tool-registry.js";
export { ToolValidator, ToolValidationError } from "./tool-validator.js";
export { ToolGovernance } from "./tool-governance.js";
export { ToolActionResolver } from "./tool-action-resolver.js";
export { ToolDescriptionGen } from "./tool-description-gen.js";
export { ToolManager } from "./tool-manager.js";
export { EnvironmentManager } from "./environment-manager.js";

// Adapters
export { McpAdapter } from "./adapters/mcp-adapter.js";
export { RestAdapter } from "./adapters/rest-adapter.js";
export { ShellAdapter } from "./adapters/shell-adapter.js";
export { FilesystemAdapter } from "./adapters/filesystem-adapter.js";
export { ComputerUseAdapter } from "./adapters/computer-use-adapter.js";
export { DatabaseAdapter } from "./adapters/database-adapter.js";
export { CompositeAdapter } from "./adapters/composite-adapter.js";
export { AdbAdapter } from "./adapters/adb-adapter.js";

// CLI
export { registerToolCommands } from "./cli-tool.js";
export { registerEnvCommands } from "./cli-env.js";
