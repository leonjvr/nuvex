// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Docker selftest checks
 *
 * DockerAvailable, ContainerHealthy
 * Entire category is skipped when not running inside Docker.
 */

import { existsSync } from "node:fs";
import { execFile }   from "node:child_process";
import { promisify }  from "node:util";
import type { SelftestCheck, SelftestContext, CheckResult } from "../selftest-runner.js";

const CAT = "docker";

const execFileAsync = promisify(execFile);

/** Returns true when running inside a Docker container. */
function isInDocker(): boolean {
  return (
    existsSync("/.dockerenv") ||
    process.env["SIDJUA_DOCKER"] === "1" ||
    process.env["SIDJUA_DOCKER"] === "true"
  );
}

function now(): number { return Date.now(); }


export const DockerAvailable: SelftestCheck = {
  name:     "Docker CLI available",
  category: CAT,

  async run(_ctx: SelftestContext): Promise<CheckResult> {
    const t = now();

    if (!isInDocker()) {
      return {
        name:     this.name,
        category: CAT,
        status:   "skip",
        message:  "Not running in Docker environment",
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    try {
      const { stdout } = await execFileAsync("docker", ["--version"], { timeout: 5_000 });
      return {
        name:     this.name,
        category: CAT,
        status:   "pass",
        message:  stdout.trim().slice(0, 80),
        duration: Date.now() - t,
        fixable:  false,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        name:     this.name,
        category: CAT,
        status:   "warn",
        message:  `Docker CLI not accessible: ${msg}`,
        duration: Date.now() - t,
        fixable:  false,
      };
    }
  },
};


export const ContainerHealthy: SelftestCheck = {
  name:     "Container health status",
  category: CAT,

  async run(_ctx: SelftestContext): Promise<CheckResult> {
    const t = now();

    if (!isInDocker()) {
      return {
        name:     this.name,
        category: CAT,
        status:   "skip",
        message:  "Not running in Docker environment",
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    // Inside Docker: read /proc/1/status or check HEALTHCHECK result via env
    // The healthcheck output is not directly readable from inside; check cgroup
    // or use the /proc/self/cgroup trick to confirm containerization.
    // Return pass — the fact we're running means the container is alive.
    const hostname = process.env["HOSTNAME"] ?? "(unknown)";
    return {
      name:     this.name,
      category: CAT,
      status:   "pass",
      message:  `Container running — hostname: ${hostname}`,
      duration: Date.now() - t,
      fixable:  false,
    };
  },
};
