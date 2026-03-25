// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Security regression tests for #519 B11 and H6:
 *
 *   B11a: Module ID validation (safe charset, path traversal blocked)
 *   B11b: Module lifecycle events logged to audit trail
 *   B11c: SECURITY NOTE in module-loader source
 *   H6:   injectEnvSecrets sanitizes values (newlines, quoting) + atomic write
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, readFile }                  from "node:fs/promises";
import { join }                                          from "node:path";
import { tmpdir }                                        from "node:os";
import {
  validateModuleId,
  validateEnvName,
  sanitizeEnvValue,
  installModule,
  uninstallModule,
  getModuleStatus,
  interactiveInstall,
  getModuleAuditLog,
  clearModuleAuditLog,
} from "../../src/modules/module-loader.js";
import type { InstallIO } from "../../src/modules/module-loader.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sidjua-b11-h6-test-"));
  clearModuleAuditLog();
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// ===========================================================================
// B11a: Module ID validation
// ===========================================================================

describe("B11a #519: Module ID validation", () => {
  it("accepts valid single-segment id: 'discord'", () => {
    expect(() => validateModuleId("discord")).not.toThrow();
  });

  it("accepts valid hyphenated id: 'my-module-1'", () => {
    expect(() => validateModuleId("my-module-1")).not.toThrow();
  });

  it("accepts single alphanumeric char id", () => {
    expect(() => validateModuleId("a")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => validateModuleId("")).toThrow(/SEC-011|invalid module id/i);
  });

  it("rejects id with path traversal: '../exploit'", () => {
    expect(() => validateModuleId("../exploit")).toThrow(/SEC-011|invalid module id/i);
  });

  it("rejects id with spaces: 'a b c'", () => {
    expect(() => validateModuleId("a b c")).toThrow(/SEC-011|invalid module id/i);
  });

  it("rejects id with uppercase letters", () => {
    expect(() => validateModuleId("Discord")).toThrow(/SEC-011|invalid module id/i);
  });

  it("rejects id with shell metacharacters: 'mod;rm'", () => {
    expect(() => validateModuleId("mod;rm")).toThrow(/SEC-011|invalid module id/i);
  });

  it("rejects id with null byte", () => {
    expect(() => validateModuleId("mod\0name")).toThrow(/SEC-011|invalid module id/i);
  });

  it("rejects id exceeding 64 characters", () => {
    expect(() => validateModuleId("a".repeat(65))).toThrow(/SEC-011|invalid module id/i);
  });

  it("installModule rejects path-traversal id", async () => {
    await expect(installModule(workDir, "../escape")).rejects.toThrow(/SEC-011|invalid module id/i);
  });

  it("getModuleStatus rejects path-traversal id", async () => {
    await expect(getModuleStatus(workDir, "../escape")).rejects.toThrow(/SEC-011|invalid module id/i);
  });
});

// ===========================================================================
// B11b: Module lifecycle audit logging
// ===========================================================================

describe("B11b #519: Module lifecycle audit logging", () => {
  it("installModule logs a module_install event", async () => {
    await installModule(workDir, "discord");
    const log = getModuleAuditLog();
    expect(log.length).toBeGreaterThan(0);
    const installEvent = log.find((e) => e.eventType === "module_install");
    expect(installEvent).toBeDefined();
    expect(installEvent?.moduleId).toBe("discord");
    expect(installEvent?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("installModule audit event includes version", async () => {
    await installModule(workDir, "discord");
    const log = getModuleAuditLog();
    const event = log.find((e) => e.eventType === "module_install");
    expect(event?.version).toBeTruthy();
  });

  it("uninstallModule logs a module_uninstall event", async () => {
    await installModule(workDir, "discord");
    clearModuleAuditLog();
    await uninstallModule(workDir, "discord");
    const log = getModuleAuditLog();
    const uninstallEvent = log.find((e) => e.eventType === "module_uninstall");
    expect(uninstallEvent).toBeDefined();
    expect(uninstallEvent?.moduleId).toBe("discord");
  });

  it("audit log is cleared between tests via clearModuleAuditLog", () => {
    // afterEach+beforeEach calls clearModuleAuditLog — log should be empty at start
    expect(getModuleAuditLog()).toHaveLength(0);
  });
});

// ===========================================================================
// B11c: Security note in source
// ===========================================================================

describe("B11c #519: Security note in module-loader source", () => {
  it("module-loader.ts source contains SECURITY NOTE comment", async () => {
    const src = await readFile(
      new URL("../../src/modules/module-loader.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("SECURITY NOTE");
    expect(src).toContain("full Node.js privileges");
  });

  it("module-loader.ts exports validateModuleId", async () => {
    const src = await readFile(
      new URL("../../src/modules/module-loader.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("export function validateModuleId");
  });

  it("install command description contains privilege warning", async () => {
    const src = await readFile(
      new URL("../../src/cli/commands/module.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("full host privileges");
    expect(src).toContain("trusted sources");
  });
});

// ===========================================================================
// H6: Env var name validation
// ===========================================================================

describe("H6 #519: validateEnvName", () => {
  it("accepts valid POSIX env var name: DISCORD_BOT_TOKEN", () => {
    expect(() => validateEnvName("DISCORD_BOT_TOKEN")).not.toThrow();
  });

  it("accepts underscore-prefixed name: _INTERNAL", () => {
    expect(() => validateEnvName("_INTERNAL")).not.toThrow();
  });

  it("rejects lowercase name", () => {
    expect(() => validateEnvName("lower_case")).toThrow(/INPUT-004|invalid env var name/i);
  });

  it("rejects name starting with digit", () => {
    expect(() => validateEnvName("1INVALID")).toThrow(/INPUT-004|invalid env var name/i);
  });

  it("rejects name with shell metacharacters", () => {
    expect(() => validateEnvName("VAR;rm")).toThrow(/INPUT-004|invalid env var name/i);
  });
});

// ===========================================================================
// H6: Env var value sanitization
// ===========================================================================

describe("H6 #519: sanitizeEnvValue", () => {
  it("passes through a plain token value unchanged", () => {
    expect(sanitizeEnvValue("Bot.xKd9aMnP2qr7sT8uVw")).toBe("Bot.xKd9aMnP2qr7sT8uVw");
  });

  it("throws SEC-012 on value containing newline", () => {
    expect(() => sanitizeEnvValue("tok\nMALICIOUS=injected")).toThrow(/SEC-012|newline|carriage/i);
  });

  it("throws SEC-012 on value containing carriage return", () => {
    expect(() => sanitizeEnvValue("tok\rMALICIOUS=injected")).toThrow(/SEC-012|newline|carriage/i);
  });

  it("wraps value with spaces in double-quotes", () => {
    const result = sanitizeEnvValue("hello world");
    expect(result).toBe('"hello world"');
  });

  it("escapes existing double-quotes in value", () => {
    const result = sanitizeEnvValue('say "hi"');
    expect(result).toBe('"say \\"hi\\""');
  });

  it("escapes backslashes in value when also contains spaces", () => {
    // Value has both backslashes and a space → triggers quoting block → backslashes escaped
    const result = sanitizeEnvValue("C:\\Users\\user data");
    expect(result).toBe('"C:\\\\Users\\\\user data"');
  });

  it("wraps value containing # in double-quotes", () => {
    const result = sanitizeEnvValue("tok#secret");
    expect(result).toBe('"tok#secret"');
  });

  it("wraps value containing = in double-quotes", () => {
    const result = sanitizeEnvValue("key=value");
    expect(result).toBe('"key=value"');
  });
});

// ===========================================================================
// H6: .env file written with atomic write + 0o600 permissions
// ===========================================================================

describe("H6 #519: installModule .env file permissions and write atomicity", () => {
  it(".env file is written with 0o600 permissions when env secret is injected", async () => {
    // Set env var that matches a discord secret
    const originalToken = process.env["DISCORD_BOT_TOKEN"];
    process.env["DISCORD_BOT_TOKEN"] = "test-token-for-perm-check";

    try {
      await installModule(workDir, "discord");
      const envPath = join(workDir, ".system", "modules", "discord", ".env");
      const s = await stat(envPath);
      // 0o600 = owner read+write only (no group/other)
      const mode = s.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      if (originalToken === undefined) {
        delete process.env["DISCORD_BOT_TOKEN"];
      } else {
        process.env["DISCORD_BOT_TOKEN"] = originalToken;
      }
    }
  });

  it("module-loader.ts source imports rename for atomic writes", async () => {
    const src = await readFile(
      new URL("../../src/modules/module-loader.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("rename");
    expect(src).toContain("writeEnvFile");
  });

  it("installModule does not leave .tmp files behind after write", async () => {
    const originalToken = process.env["DISCORD_BOT_TOKEN"];
    process.env["DISCORD_BOT_TOKEN"] = "clean-token";

    try {
      await installModule(workDir, "discord");
      const modulePath = join(workDir, ".system", "modules", "discord");
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(modulePath);
      const tmpFiles = files.filter((f) => f.includes(".tmp."));
      expect(tmpFiles).toHaveLength(0);
    } finally {
      if (originalToken === undefined) {
        delete process.env["DISCORD_BOT_TOKEN"];
      } else {
        process.env["DISCORD_BOT_TOKEN"] = originalToken;
      }
    }
  });
});

// ===========================================================================
// H6: interactiveInstall sanitizes user-typed secrets
// ===========================================================================

describe("H6 #519: interactiveInstall sanitizes prompt values", () => {
  it("interactiveInstall throws if user enters newline in a secret value", async () => {
    const io: InstallIO = {
      write: () => {},
      prompt: async () => "tok\nMALICIOUS=injected",
    };

    await expect(interactiveInstall(workDir, "discord", io)).rejects.toThrow(
      /SEC-012|newline|carriage/i,
    );
  });
});
