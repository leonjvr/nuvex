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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CLIRequest, CLIResponse } from "../orchestrator/orchestrator.js";
import { IPC_TOKEN_FILENAME } from "../orchestrator/orchestrator.js";

/**
 * Read the IPC authentication token from the token file alongside the socket.
 * Returns undefined if the file does not exist or cannot be read.
 */
function readIpcToken(socketPath: string): string | undefined {
  const tokenPath = join(dirname(socketPath), IPC_TOKEN_FILENAME);
  if (!existsSync(tokenPath)) return undefined;
  try {
    return readFileSync(tokenPath, "utf-8").trim();
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
  // P272 Task 1: Read and attach IPC authentication token if available.
  const token = readIpcToken(socketPath);
  const reqWithToken: CLIRequest = token !== undefined ? { ...req, token } : req;

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
            resolve(parsed as CLIResponse);
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
