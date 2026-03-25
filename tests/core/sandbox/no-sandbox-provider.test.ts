// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for src/core/sandbox/no-sandbox-provider.ts
 */

import { describe, it, expect } from "vitest";
import { NoSandboxProvider } from "../../../src/core/sandbox/no-sandbox-provider.js";
import type { AgentSandboxConfig } from "../../../src/core/sandbox/types.js";

const AGENT_CONFIG: AgentSandboxConfig = {
  agentId: "test-agent",
  workDir: "/tmp/test-agent",
  network: { allowedDomains: [], deniedDomains: [] },
  filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
};

describe("NoSandboxProvider", () => {
  it("has name 'none'", () => {
    const p = new NoSandboxProvider();
    expect(p.name).toBe("none");
  });

  it("is not initialized before initialize() is called", () => {
    const p = new NoSandboxProvider();
    expect(p.initialized).toBe(false);
  });

  it("initialize() sets initialized to true", async () => {
    const p = new NoSandboxProvider();
    await p.initialize();
    expect(p.initialized).toBe(true);
  });

  it("wrapCommand() returns command unchanged", async () => {
    const p = new NoSandboxProvider();
    await p.initialize();
    const cmd = "ls -la /tmp";
    const result = await p.wrapCommand(cmd, AGENT_CONFIG);
    expect(result).toBe(cmd);
  });

  it("wrapCommand() passes through any command without modification", async () => {
    const p = new NoSandboxProvider();
    const cmds = [
      "echo hello",
      "node dist/index.js apply",
      'bash -c "find / -name *.db"',
    ];
    for (const cmd of cmds) {
      expect(await p.wrapCommand(cmd, AGENT_CONFIG)).toBe(cmd);
    }
  });

  it("checkDependencies() returns available: true", async () => {
    const p = new NoSandboxProvider();
    const result = await p.checkDependencies();
    expect(result.available).toBe(true);
    expect(result.provider).toBe("none");
    expect(result.missing).toHaveLength(0);
    expect(result.message).toBeTruthy();
  });

  it("cleanup() sets initialized to false", async () => {
    const p = new NoSandboxProvider();
    await p.initialize();
    expect(p.initialized).toBe(true);
    await p.cleanup();
    expect(p.initialized).toBe(false);
  });

  it("cleanup() is idempotent when not initialized", async () => {
    const p = new NoSandboxProvider();
    expect(p.initialized).toBe(false);
    await expect(p.cleanup()).resolves.toBeUndefined();
    expect(p.initialized).toBe(false);
  });
});
