// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Integration tests: sandbox config parsing via loadAndValidate (validate.ts Step 5).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAndValidate } from "../../../src/apply/validate.js";
import { DEFAULT_SANDBOX_CONFIG } from "../../../src/core/sandbox/sandbox-factory.js";

// ---------------------------------------------------------------------------
// Minimal valid YAML with optional sandbox section
// ---------------------------------------------------------------------------

const MINIMAL_YAML_BASE = `
schema_version: '1.0'
company:
  name: TestCo
  size: solo
  locale: en
  timezone: UTC
size_presets:
  solo:
    recommended: []
    description: Solo mode
divisions:
  - code: engineering
    name:
      en: Engineering
    active: true
    required: true
    scope: Code
    head:
      role: Lead
      agent: test-agent
`;

let tmpDir: string;
let yamlFile: string;

beforeEach(() => {
  tmpDir   = mkdtempSync(join(tmpdir(), "sidjua-sandbox-cfg-"));
  yamlFile = join(tmpDir, "divisions.yaml");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("sandbox config — no sandbox section", () => {
  it("uses DEFAULT_SANDBOX_CONFIG when sandbox section is absent", () => {
    writeFileSync(yamlFile, MINIMAL_YAML_BASE, "utf-8");
    const { config, result } = loadAndValidate(yamlFile);
    expect(result.valid).toBe(true);
    expect(config).not.toBeNull();
    expect(config!.sandbox).toBeDefined();
    expect(config!.sandbox.provider).toBe("none");
  });

  it("default config denies ~/.ssh and ~/.gnupg", () => {
    writeFileSync(yamlFile, MINIMAL_YAML_BASE, "utf-8");
    const { config } = loadAndValidate(yamlFile);
    expect(config!.sandbox.defaults.filesystem.denyRead).toContain("~/.ssh");
    expect(config!.sandbox.defaults.filesystem.denyRead).toContain("~/.gnupg");
    expect(config!.sandbox.defaults.filesystem.denyRead).toContain("/etc/shadow");
  });

  it("default config has empty network lists", () => {
    writeFileSync(yamlFile, MINIMAL_YAML_BASE, "utf-8");
    const { config } = loadAndValidate(yamlFile);
    expect(config!.sandbox.defaults.network.allowedDomains).toEqual([]);
    expect(config!.sandbox.defaults.network.deniedDomains).toEqual([]);
  });
});

describe("sandbox config — provider: none", () => {
  it("parses provider: none correctly", () => {
    writeFileSync(
      yamlFile,
      MINIMAL_YAML_BASE + `\nsandbox:\n  provider: none\n`,
      "utf-8",
    );
    const { config, result } = loadAndValidate(yamlFile);
    expect(result.valid).toBe(true);
    expect(config!.sandbox.provider).toBe("none");
  });

  it("merges custom network config", () => {
    writeFileSync(
      yamlFile,
      MINIMAL_YAML_BASE +
        `\nsandbox:\n  provider: none\n  defaults:\n    network:\n      allowedDomains:\n        - api.example.com\n      deniedDomains:\n        - evil.example.com\n`,
      "utf-8",
    );
    const { config } = loadAndValidate(yamlFile);
    expect(config!.sandbox.defaults.network.allowedDomains).toContain("api.example.com");
    expect(config!.sandbox.defaults.network.deniedDomains).toContain("evil.example.com");
  });
});

describe("sandbox config — provider: bubblewrap", () => {
  it("parses provider: bubblewrap (accepted, not yet implemented)", () => {
    writeFileSync(
      yamlFile,
      MINIMAL_YAML_BASE + `\nsandbox:\n  provider: bubblewrap\n`,
      "utf-8",
    );
    const { config, result } = loadAndValidate(yamlFile);
    expect(result.valid).toBe(true);
    // Provider string is stored as-is in config
    expect(config!.sandbox.provider).toBe("bubblewrap");
  });
});

describe("sandbox config — invalid provider", () => {
  it("falls back to 'none' for an unknown provider string", () => {
    writeFileSync(
      yamlFile,
      MINIMAL_YAML_BASE + `\nsandbox:\n  provider: invalid-provider-xyz\n`,
      "utf-8",
    );
    const { config, result } = loadAndValidate(yamlFile);
    expect(result.valid).toBe(true);
    // buildSandboxConfig falls back to DEFAULT_SANDBOX_CONFIG.provider
    expect(config!.sandbox.provider).toBe(DEFAULT_SANDBOX_CONFIG.provider);
  });

  it("falls back to defaults when sandbox section is not an object", () => {
    writeFileSync(
      yamlFile,
      MINIMAL_YAML_BASE + `\nsandbox: "not-an-object"\n`,
      "utf-8",
    );
    const { config, result } = loadAndValidate(yamlFile);
    expect(result.valid).toBe(true);
    expect(config!.sandbox.provider).toBe("none");
  });
});

describe("sandbox config — filesystem overrides", () => {
  it("parses custom denyRead list", () => {
    writeFileSync(
      yamlFile,
      MINIMAL_YAML_BASE +
        `\nsandbox:\n  provider: none\n  defaults:\n    filesystem:\n      denyRead:\n        - /custom/secret\n        - ~/.aws\n`,
      "utf-8",
    );
    const { config } = loadAndValidate(yamlFile);
    expect(config!.sandbox.defaults.filesystem.denyRead).toContain("/custom/secret");
    expect(config!.sandbox.defaults.filesystem.denyRead).toContain("~/.aws");
  });

  it("parses custom allowWrite list", () => {
    writeFileSync(
      yamlFile,
      MINIMAL_YAML_BASE +
        `\nsandbox:\n  provider: none\n  defaults:\n    filesystem:\n      allowWrite:\n        - /tmp/agent-output\n`,
      "utf-8",
    );
    const { config } = loadAndValidate(yamlFile);
    expect(config!.sandbox.defaults.filesystem.allowWrite).toContain("/tmp/agent-output");
  });
});
