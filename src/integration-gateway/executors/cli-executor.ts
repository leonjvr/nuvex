// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Integration Gateway: CLI Executor
 *
 * Executes allow-listed CLI tools (FFmpeg, git, docker, curl) with:
 *   - Strict command allow-list (no arbitrary shell)
 *   - Shell metacharacter rejection to prevent injection
 *   - Per-command timeout caps
 *   - Hard SIGKILL after timeout
 *   - spawn() — NOT exec() — to avoid shell interpretation
 *
 * SECURITY NOTE: args are passed directly to spawn() as an array, which
 * bypasses the shell entirely.  No interpolation or globbing occurs.
 */

import { spawn }            from "node:child_process";
import { createLogger }     from "../../core/logger.js";
import { IntegrationError } from "../errors.js";
import type { ScriptExecutionResult } from "./script-executor.js";

const logger = createLogger("cli-executor");


export interface CliExecutionRequest {
  /** Command name (must be in allow-list) */
  command: string;
  /** Arguments — each element is passed as a separate argv entry */
  args: string[];
  /** Hard timeout in milliseconds */
  timeout_ms: number;
  /** Request correlation ID */
  request_id: string;
  /** Optional working directory for the child process */
  working_directory?: string;
}

// Re-export for consumers that just import from this module
export type { ScriptExecutionResult };


interface AllowedCommandConfig {
  /** Override the binary path (default: use command name, rely on PATH) */
  path?: string;
  /** Hard cap regardless of what the caller requests */
  max_timeout_ms: number;
}

const ALLOWED_COMMANDS: Readonly<Record<string, AllowedCommandConfig>> = {
  ffmpeg: { max_timeout_ms: 3_600_000 }, // 1 hour for video processing
  git:    { max_timeout_ms:   120_000 },
  docker: { max_timeout_ms:   300_000 },
  curl:   { max_timeout_ms:    30_000 },
};

/**
 * Shell metacharacters that must not appear in any argument.
 * We use spawn (not exec) so these chars are not interpreted — but blocking
 * them prevents confusion if a future code path uses exec or passes args
 * onward to another process.
 */
const SHELL_META_RE = /[;|`<>&]|\$\(|\$\{/;

const MAX_OUTPUT_BYTES = 100 * 1024; // 100 KB

export class CliExecutor {
  /** Execute an allow-listed CLI command and return its stdout/stderr. */
  async execute(request: CliExecutionRequest): Promise<ScriptExecutionResult> {
    // 1. Allow-list check
    const config = ALLOWED_COMMANDS[request.command];
    if (config === undefined) {
      throw new IntegrationError(
        `CLI command '${request.command}' not in allow-list. Allowed: ${Object.keys(ALLOWED_COMMANDS).join(", ")}`,
        "COMMAND_NOT_ALLOWED",
      );
    }

    // 2. Shell metacharacter check
    for (const arg of request.args) {
      if (SHELL_META_RE.test(arg)) {
        throw new IntegrationError(
          `Argument contains shell metacharacters: ${arg.slice(0, 50)}`,
          "UNSAFE_ARGUMENT",
        );
      }
    }

    // 3. Timeout — cap at per-command maximum
    const timeoutMs = Math.min(request.timeout_ms, config.max_timeout_ms);

    const binary = config.path ?? request.command;
    logger.debug("cli-executor", `Spawning ${binary}`, {
      metadata: {
        requestId: request.request_id,
        command:   request.command,
        argCount:  request.args.length,
      },
    });

    return this.spawnCommand(binary, request.args, timeoutMs, request.request_id, request.working_directory);
  }

  // ---------------------------------------------------------------------------
  // Process spawning
  // ---------------------------------------------------------------------------

  private async spawnCommand(
    binary: string,
    args: string[],
    timeoutMs: number,
    requestId: string,
    cwd?: string,
  ): Promise<ScriptExecutionResult> {
    return new Promise<ScriptExecutionResult>((resolve) => {
      const startTime = Date.now();
      let stdout = "";
      let stderr = "";
      let killed = false;

      const spawnOpts: Parameters<typeof spawn>[2] = {
        stdio: ["pipe", "pipe", "pipe"],
        env:   { ...process.env, SIDJUA_REQUEST_ID: requestId },
      };
      if (cwd !== undefined) spawnOpts.cwd = cwd;

      const child = spawn(binary, args, spawnOpts);

      child.stdout?.on("data", (data: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) stdout += data.toString();
      });
      child.stderr?.on("data", (data: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) stderr += data.toString();
      });

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
        logger.warn("cli-executor", `Process killed after ${timeoutMs}ms timeout`, {
          metadata: { requestId, binary },
        });
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          success:      !killed && code === 0,
          stdout:       stdout.slice(0, MAX_OUTPUT_BYTES),
          stderr:       killed
            ? `Process killed after ${timeoutMs}ms timeout`
            : stderr.slice(0, MAX_OUTPUT_BYTES),
          exit_code:    code ?? -1,
          execution_ms: Date.now() - startTime,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          success:      false,
          stdout:       "",
          stderr:       err.message,
          exit_code:    -1,
          execution_ms: Date.now() - startTime,
        });
      });
    });
  }
}
