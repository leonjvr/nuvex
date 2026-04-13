// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 10: IPC client
 *
 * Sends a CLIRequest to the orchestrator's Unix domain socket and
 * returns the CLIResponse. JSON-line protocol: one line per message.
 */

import { connect } from "node:net";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CLIRequest, CLIResponse } from "../orchestrator/orchestrator.js";
import { IPC_TOKEN_FILENAME } from "../orchestrator/orchestrator.js";

/**
 * Read the IPC secret from the secret file alongside the socket.
 * Returns undefined if the file does not exist or cannot be read.
 */
function readIpcSecret(socketPath: string): string | undefined {
  const secretPath = join(dirname(socketPath), IPC_TOKEN_FILENAME);
  if (!existsSync(secretPath)) return undefined;
  try {
    // On non-Windows: verify the token file has 0o600 permissions (owner-only).
    // A world-readable token file would allow other processes to impersonate the CLI.
    if (process.platform !== "win32") {
      const mode = statSync(secretPath).mode & 0o777;
      if (mode !== 0o600) {
        process.stderr.write(
          `⚠ IPC token file has insecure permissions (${mode.toString(8)}, expected 600) — refusing to use\n`,
        );
        return undefined;
      }
    }
    return readFileSync(secretPath, "utf-8").trim();
  } catch (_e) {
    return undefined;
  }
}

/**
 * Send a single IPC request to the orchestrator socket and resolve with the response.
 *
 * @param socketPath  Path to the Unix domain socket (.system/orchestrator.sock)
 * @param req         The request payload
 * @param timeoutMs   How long to wait for a response (default: 10 000 ms)
 */
export function sendIpc(
  socketPath: string,
  req:        CLIRequest,
  timeoutMs   = 10_000,
): Promise<CLIResponse> {
  // Read and attach IPC secret if available; used for peer authentication.
  const ipcSecret = readIpcSecret(socketPath);
  const reqWithToken: CLIRequest = ipcSecret !== undefined ? { ...req, token: ipcSecret } : req;

  return new Promise<CLIResponse>((resolve, reject) => {
    const socket   = connect({ path: socketPath });
    let buf        = "";
    let settled    = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`IPC timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(JSON.stringify(reqWithToken) + "\n");
    });

    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl === -1) return;

      const line = buf.slice(0, nl);
      buf        = buf.slice(nl + 1);

      clearTimeout(timer);
      if (!settled) {
        settled = true;
        socket.destroy();
        try {
          const parsed = JSON.parse(line) as unknown;
          if (
            parsed === null ||
            typeof parsed !== "object" ||
            !("success" in parsed) ||
            typeof (parsed as Record<string, unknown>)["success"] !== "boolean"
          ) {
            reject(new Error(`Invalid IPC response shape: ${line}`));
          } else {
            // Give a clear message when IPC auth fails so the user knows
            // to check whether the orchestrator is running.
            const resp = parsed as CLIResponse;
            if (resp.error === "IPC_AUTH_FAILED") {
              reject(new Error(
                ipcSecret === undefined
                  ? "Orchestrator not running or IPC secret missing"
                  : "IPC authentication failed — restart the orchestrator",
              ));
            } else {
              resolve(resp);
            }
          }
        } catch (err) {
          reject(new Error(`Invalid IPC response: ${line}`));
        }
      }
    });

    socket.on("error", (err: Error) => {
      clearTimeout(timer);
      socket.destroy();
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    socket.on("close", () => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error("IPC socket closed without response"));
      }
    });
  });
}

export type { CLIRequest, CLIResponse };
