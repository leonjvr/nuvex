// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Resource selftest checks
 *
 * DiskSpace, PortAvailability, NodeVersion
 */

import { statfsSync } from "node:fs";
import * as net       from "node:net";
import type { SelftestCheck, SelftestContext, CheckResult } from "../selftest-runner.js";

const CAT = "resource";

function now(): number { return Date.now(); }


const DISK_FAIL_BYTES = 100 * 1024 * 1024;  // 100 MB
const DISK_WARN_BYTES = 500 * 1024 * 1024;  // 500 MB

export const DiskSpace: SelftestCheck = {
  name:     "Disk space",
  category: CAT,

  async run(ctx: SelftestContext): Promise<CheckResult> {
    const t = now();

    try {
      const stats     = statfsSync(ctx.workDir);
      const available = stats.bavail * stats.bsize;
      const total     = stats.blocks * stats.bsize;
      const used      = total - available;
      const pctFree   = total > 0 ? Math.round((available / total) * 100) : 0;

      const fmt = (b: number) => `${(b / 1024 / 1024).toFixed(0)} MB`;
      const details = ctx.verbose
        ? `Total: ${fmt(total)}, Used: ${fmt(used)}, Available: ${fmt(available)} (${pctFree}% free)`
        : undefined;

      if (available < DISK_FAIL_BYTES) {
        return {
          name:      this.name,
          category:  CAT,
          status:    "fail",
          message:   `Critical: only ${fmt(available)} disk space free`,
          duration:  Date.now() - t,
          fixable:   false,
          fixAction: "Free up disk space — less than 100 MB available in work directory",
          details,
        };
      }

      if (available < DISK_WARN_BYTES) {
        return {
          name:      this.name,
          category:  CAT,
          status:    "warn",
          message:   `Low disk space: ${fmt(available)} free`,
          duration:  Date.now() - t,
          fixable:   false,
          fixAction: "Consider freeing disk space — less than 500 MB available",
          details,
        };
      }

      return {
        name:     this.name,
        category: CAT,
        status:   "pass",
        message:  `${fmt(available)} free (${pctFree}%)`,
        duration: Date.now() - t,
        fixable:  false,
        details,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        name:     this.name,
        category: CAT,
        status:   "warn",
        message:  `Disk space check unavailable: ${msg}`,
        duration: Date.now() - t,
        fixable:  false,
      };
    }
  },
};


const DEFAULT_PORT = 3000;

export const PortAvailability: SelftestCheck = {
  name:     "API port availability",
  category: CAT,

  async run(_ctx: SelftestContext): Promise<CheckResult> {
    const t    = now();
    const port = parseInt(process.env["SIDJUA_PORT"] ?? String(DEFAULT_PORT), 10);

    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => { server.close(); resolve(true); });
      server.listen(port, "127.0.0.1");
    });

    if (available) {
      return {
        name:     this.name,
        category: CAT,
        status:   "pass",
        message:  `Port ${port} available`,
        duration: Date.now() - t,
        fixable:  false,
      };
    }

    // Port in use — could be SIDJUA itself (acceptable) or something else
    return {
      name:     this.name,
      category: CAT,
      status:   "warn",
      message:  `Port ${port} is already in use — may be SIDJUA server running`,
      duration: Date.now() - t,
      fixable:  false,
      fixAction: `Check port ${port}: lsof -i :${port}`,
    };
  },
};


const MIN_NODE_MAJOR = 22;

export const NodeVersion: SelftestCheck = {
  name:     "Node.js version",
  category: CAT,

  async run(_ctx: SelftestContext): Promise<CheckResult> {
    const t = now();

    // process.version is "v22.1.0" etc.
    const versionStr = process.version.replace(/^v/, "");
    const major      = parseInt(versionStr.split(".")[0] ?? "0", 10);

    if (major < MIN_NODE_MAJOR) {
      return {
        name:      this.name,
        category:  CAT,
        status:    "fail",
        message:   `Node.js ${process.version} — minimum required: v${MIN_NODE_MAJOR}`,
        duration:  Date.now() - t,
        fixable:   false,
        fixAction: `Upgrade Node.js to v${MIN_NODE_MAJOR} or later`,
      };
    }

    return {
      name:     this.name,
      category: CAT,
      status:   "pass",
      message:  `Node.js ${process.version} OK (≥ v${MIN_NODE_MAJOR} required)`,
      duration: Date.now() - t,
      fixable:  false,
    };
  },
};
