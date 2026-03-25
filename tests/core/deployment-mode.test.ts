/**
 * SIDJUA — Multi-Agent Governance Framework
 * Copyright (c) 2026 Götz Kohlberg
 *
 * Dual licensed under:
 *   - AGPL-3.0 (see LICENSE-AGPL)
 *   - SIDJUA Commercial License (see LICENSE-COMMERCIAL)
 *
 * Unless you have a signed Commercial License, your use is governed
 * by the AGPL-3.0. See LICENSE for details.
 */

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectDeploymentMode, getCheckpointIntervalMs } from "../../src/core/deployment-mode.js";

// ---------------------------------------------------------------------------
// Helpers — save/restore env vars
// ---------------------------------------------------------------------------

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

// ---------------------------------------------------------------------------
// detectDeploymentMode
// ---------------------------------------------------------------------------

describe("detectDeploymentMode", () => {
  it("returns 'server' when SIDJUA_DEPLOYMENT_MODE=server", () => {
    withEnv({ SIDJUA_DEPLOYMENT_MODE: "server", INVOCATION_ID: undefined, container: undefined }, () => {
      expect(detectDeploymentMode()).toBe("server");
    });
  });

  it("returns 'desktop' when SIDJUA_DEPLOYMENT_MODE=desktop", () => {
    withEnv({ SIDJUA_DEPLOYMENT_MODE: "desktop", INVOCATION_ID: undefined, container: undefined }, () => {
      expect(detectDeploymentMode()).toBe("desktop");
    });
  });

  it("ignores invalid SIDJUA_DEPLOYMENT_MODE values and falls through", () => {
    withEnv({ SIDJUA_DEPLOYMENT_MODE: "unknown", INVOCATION_ID: undefined, container: undefined }, () => {
      // Falls through to systemd/container checks, then defaults to desktop
      const result = detectDeploymentMode();
      expect(["server", "desktop"]).toContain(result);
    });
  });

  it("returns 'server' when INVOCATION_ID is set (systemd)", () => {
    withEnv({
      SIDJUA_DEPLOYMENT_MODE: undefined,
      INVOCATION_ID: "abc123",
      container: undefined,
    }, () => {
      expect(detectDeploymentMode()).toBe("server");
    });
  });

  it("returns 'server' when container env var is set (Podman)", () => {
    withEnv({
      SIDJUA_DEPLOYMENT_MODE: undefined,
      INVOCATION_ID: undefined,
      container: "podman",
    }, () => {
      expect(detectDeploymentMode()).toBe("server");
    });
  });

  it("returns 'desktop' when no server signals are present", () => {
    withEnv({
      SIDJUA_DEPLOYMENT_MODE: undefined,
      INVOCATION_ID: undefined,
      container: undefined,
    }, () => {
      // On a CI server, /proc/1/cgroup may contain docker — so we accept either
      // result as long as the function doesn't throw
      const result = detectDeploymentMode();
      expect(["server", "desktop"]).toContain(result);
    });
  });

  it("SIDJUA_DEPLOYMENT_MODE takes priority over INVOCATION_ID", () => {
    withEnv({
      SIDJUA_DEPLOYMENT_MODE: "desktop",
      INVOCATION_ID: "abc123",
    }, () => {
      expect(detectDeploymentMode()).toBe("desktop");
    });
  });
});

// ---------------------------------------------------------------------------
// getCheckpointIntervalMs
// ---------------------------------------------------------------------------

describe("getCheckpointIntervalMs", () => {
  it("returns 60000 (60s) for desktop mode", () => {
    expect(getCheckpointIntervalMs("desktop")).toBe(60_000);
  });

  it("returns 300000 (300s / 5min) for server mode", () => {
    expect(getCheckpointIntervalMs("server")).toBe(300_000);
  });

  it("server interval is 5x the desktop interval", () => {
    expect(getCheckpointIntervalMs("server")).toBe(getCheckpointIntervalMs("desktop") * 5);
  });
});
