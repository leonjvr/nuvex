// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Deployment mode detection.
 *
 * Distinguishes between server deployments (systemd, Docker, Podman) and
 * desktop deployments (developer laptops, personal machines). The mode
 * controls the silent checkpoint interval:
 *   - desktop: 60s   (max 1 min data loss on hard power-off)
 *   - server:  300s  (systemd/Docker handle graceful stop signals)
 */

import { readFileSync } from "node:fs";

export type DeploymentMode = "server" | "desktop";

/**
 * Detect the deployment mode from environment signals.
 *
 * Detection order (first match wins):
 * 1. `SIDJUA_DEPLOYMENT_MODE` env var — explicit user override
 * 2. `INVOCATION_ID` env var — set by systemd for all service units
 * 3. `container` env var — set by Podman and some container runtimes
 * 4. `/proc/1/cgroup` — contains "docker", "podman", or "containerd"
 * 5. Default: "desktop"
 */
export function detectDeploymentMode(): DeploymentMode {
  // Explicit override — takes highest priority
  const explicit = process.env["SIDJUA_DEPLOYMENT_MODE"];
  if (explicit === "server" || explicit === "desktop") return explicit;

  // systemd: INVOCATION_ID is set for all service units
  if (process.env["INVOCATION_ID"]) return "server";

  // Podman / some OCI runtimes
  if (process.env["container"]) return "server";

  // Docker / containerd via cgroup
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf-8");
    if (
      cgroup.includes("docker") ||
      cgroup.includes("podman") ||
      cgroup.includes("containerd")
    ) {
      return "server";
    }
  } catch (_e) {
    // Not Linux or no read access — skip
  }

  // Default: desktop
  return "desktop";
}

/**
 * Return the silent checkpoint interval in milliseconds for a given deployment mode.
 *
 * - desktop: 60 000 ms (60 s)
 * - server:  300 000 ms (300 s / 5 min)
 */
export function getCheckpointIntervalMs(mode: DeploymentMode): number {
  return mode === "server" ? 300_000 : 60_000;
}
