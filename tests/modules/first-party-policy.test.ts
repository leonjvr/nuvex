// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Unit tests for first-party module policy.
 *
 * Covers:
 *   - discord module loads successfully (first-party)
 *   - unknown module blocked with MOD-003
 *   - Blocked install attempt generates audit event
 *   - FIRST_PARTY_MODULES contains only 'discord' in V1.0
 *   - interactiveInstall also blocked for non-first-party
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp }                          from "node:fs/promises";
import { join }                             from "node:path";
import { tmpdir }                           from "node:os";
import {
  installModule,
  interactiveInstall,
  FIRST_PARTY_MODULES,
  getModuleAuditLog,
  clearModuleAuditLog,
} from "../../src/modules/module-loader.js";
import { SidjuaError } from "../../src/core/error-codes.js";
import type { InstallIO } from "../../src/modules/module-loader.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sidjua-first-party-test-"));
  clearModuleAuditLog();
});

// ---------------------------------------------------------------------------
// FIRST_PARTY_MODULES constant
// ---------------------------------------------------------------------------

describe("FIRST_PARTY_MODULES constant", () => {
  it("contains 'discord'", () => {
    expect(FIRST_PARTY_MODULES.has("discord")).toBe(true);
  });

  it("is a Set with exactly 1 entry in V1.0", () => {
    expect(FIRST_PARTY_MODULES.size).toBe(1);
  });

  it("does not contain 'slack'", () => {
    expect(FIRST_PARTY_MODULES.has("slack")).toBe(false);
  });

  it("does not contain 'unknown-module'", () => {
    expect(FIRST_PARTY_MODULES.has("unknown-module")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// installModule — first-party policy enforcement
// ---------------------------------------------------------------------------

describe("installModule() — first-party enforcement", () => {
  it("discord module installs successfully (first-party)", async () => {
    await expect(installModule(workDir, "discord")).resolves.toBeUndefined();
  });

  it("unknown-module is blocked with SidjuaError", async () => {
    await expect(installModule(workDir, "unknown-module")).rejects.toBeInstanceOf(SidjuaError);
  });

  it("blocked module throws MOD-003 error code", async () => {
    let thrownErr: unknown;
    try {
      await installModule(workDir, "unknown-module");
    } catch (err) {
      thrownErr = err;
    }
    expect(thrownErr).toBeInstanceOf(SidjuaError);
    expect((thrownErr as SidjuaError).code).toBe("MOD-003");
  });

  it("error message mentions 'first-party'", async () => {
    let message = "";
    try {
      await installModule(workDir, "unknown-module");
    } catch (err) {
      message = (err as SidjuaError).message;
    }
    expect(message.toLowerCase()).toContain("first-party");
  });

  it("blocked install generates module_install_blocked audit event", async () => {
    try {
      await installModule(workDir, "fake-module");
    } catch {
      // expected
    }

    const log = getModuleAuditLog();
    const blocked = log.filter((e) => e.eventType === "module_install_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.moduleId).toBe("fake-module");
  });

  it("blocked install does NOT generate module_install audit event", async () => {
    try {
      await installModule(workDir, "fake-module");
    } catch {
      // expected
    }

    const log = getModuleAuditLog();
    const installs = log.filter((e) => e.eventType === "module_install");
    expect(installs).toHaveLength(0);
  });

  it("slack module blocked with MOD-003", async () => {
    let thrownErr: unknown;
    try {
      await installModule(workDir, "slack");
    } catch (err) {
      thrownErr = err;
    }
    expect((thrownErr as SidjuaError).code).toBe("MOD-003");
  });

  it("module-with-hyphens blocked with MOD-003 (valid ID, not first-party)", async () => {
    let thrownErr: unknown;
    try {
      await installModule(workDir, "my-module");
    } catch (err) {
      thrownErr = err;
    }
    expect((thrownErr as SidjuaError).code).toBe("MOD-003");
  });
});

// ---------------------------------------------------------------------------
// interactiveInstall — first-party check inherited from installModule
// ---------------------------------------------------------------------------

describe("interactiveInstall() — first-party enforcement", () => {
  const noopIO: InstallIO = {
    async prompt() { return ""; },
    write() {},
  };

  it("blocks unknown-module with MOD-003 before prompting user", async () => {
    let promptCalled = false;
    const io: InstallIO = {
      async prompt() {
        promptCalled = true;
        return "";
      },
      write() {},
    };

    let thrownCode = "";
    try {
      await interactiveInstall(workDir, "unknown-module", io);
    } catch (err) {
      thrownCode = (err as SidjuaError).code;
    }

    expect(thrownCode).toBe("MOD-003");
    expect(promptCalled).toBe(false);
  });

  it("discord module proceeds to interactive prompts", async () => {
    // discord requires a BOT_TOKEN secret; the prompt will return empty string
    // which is OK since it's non-blocking for optional secrets
    await expect(interactiveInstall(workDir, "discord", noopIO)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error recoverable flag
// ---------------------------------------------------------------------------

describe("MOD-003 error properties", () => {
  it("MOD-003 is not recoverable", async () => {
    let err: SidjuaError | undefined;
    try {
      await installModule(workDir, "not-first-party");
    } catch (e) {
      err = e as SidjuaError;
    }
    expect(err?.recoverable).toBe(false);
  });
});
