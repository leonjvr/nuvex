// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm }                                  from "node:fs/promises";
import { tmpdir }                                       from "node:os";
import {
  extractCredentials,
  migrateCredentials,
  maskSecret,
}                                                       from "../../src/import/openclaw-credential-migrator.js";
import type { OpenClawConfig }                          from "../../src/import/openclaw-types.js";

describe("extractCredentials", () => {
  it("extracts API key from flat env", () => {
    const config: OpenClawConfig = {
      env: { ANTHROPIC_API_KEY: "sk-ant-abc123" },
    };
    const creds = extractCredentials(config);
    expect(creds).toHaveLength(1);
    expect(creds[0]?.provider).toBe("anthropic");
    expect(creds[0]?.value).toBe("sk-ant-abc123");
    expect(creds[0]?.source).toContain("ANTHROPIC_API_KEY");
  });

  it("extracts API key from env.vars nested object", () => {
    const config: OpenClawConfig = {
      env: { vars: { GROQ_API_KEY: "gsk-xyz789" } },
    };
    const creds = extractCredentials(config);
    expect(creds).toHaveLength(1);
    expect(creds[0]?.provider).toBe("groq");
    expect(creds[0]?.value).toBe("gsk-xyz789");
  });

  it("extracts multiple providers from env", () => {
    const config: OpenClawConfig = {
      env: {
        ANTHROPIC_API_KEY: "sk-ant-1",
        OPENAI_API_KEY:    "sk-openai-2",
      },
    };
    const creds = extractCredentials(config);
    const providers = creds.map((c) => c.provider);
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
  });

  it("extracts DISCORD_BOT_TOKEN as discord provider", () => {
    const config: OpenClawConfig = {
      env: { DISCORD_BOT_TOKEN: "Bot tok123" },
    };
    const creds = extractCredentials(config);
    expect(creds[0]?.provider).toBe("discord");
  });

  it("extracts skill-level env vars", () => {
    const config: OpenClawConfig = {
      skills: {
        entries: {
          groq: {
            enabled: true,
            env: { GROQ_API_KEY: "gsk-from-skill" },
          },
        },
      },
    };
    const creds = extractCredentials(config);
    expect(creds[0]?.provider).toBe("groq");
    expect(creds[0]?.value).toBe("gsk-from-skill");
  });

  it("extracts skill-level apiKey", () => {
    const config: OpenClawConfig = {
      skills: {
        entries: {
          weather: {
            enabled: true,
            apiKey: "weather-api-key-xyz",
          },
        },
      },
    };
    const creds = extractCredentials(config);
    expect(creds[0]?.provider).toBe("weather");
    expect(creds[0]?.value).toBe("weather-api-key-xyz");
  });

  it("deduplicates — first occurrence wins", () => {
    const config: OpenClawConfig = {
      env: { ANTHROPIC_API_KEY: "first" },
      skills: {
        entries: {
          anthropic: { env: { ANTHROPIC_API_KEY: "second" } },
        },
      },
    };
    const creds = extractCredentials(config);
    const anthropic = creds.filter((c) => c.provider === "anthropic");
    expect(anthropic).toHaveLength(1);
    expect(anthropic[0]?.value).toBe("first");
  });

  it("returns empty array for empty config", () => {
    expect(extractCredentials({})).toHaveLength(0);
  });

  it("ignores env vars not in the known mapping", () => {
    const config: OpenClawConfig = {
      env: { UNKNOWN_VAR: "some-value" },
    };
    expect(extractCredentials(config)).toHaveLength(0);
  });
});

describe("migrateCredentials — no-secrets mode", () => {
  it("returns all as skipped when noSecrets = true", async () => {
    const config: OpenClawConfig = {
      env: { ANTHROPIC_API_KEY: "sk-ant-abc" },
    };
    const result = await migrateCredentials(config, "/tmp", true);
    expect(result.migrated).toHaveLength(0);
    expect(result.skipped).toContain("anthropic");
  });

  it("returns empty result for empty config even without noSecrets", async () => {
    const result = await migrateCredentials({}, "/tmp", false);
    expect(result.migrated).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });
});

describe("migrateCredentials — with real fs", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sidjua-cred-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("writes credentials to .sidjua-imported.env", async () => {
    const config: OpenClawConfig = {
      env: { ANTHROPIC_API_KEY: "sk-ant-test123" },
    };
    const result = await migrateCredentials(config, tempDir, false);
    expect(result.migrated).toContain("anthropic");

    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const content = await readFile(join(tempDir, ".sidjua-imported.env"), "utf-8");
    expect(content).toContain("ANTHROPIC_API_KEY=sk-ant-test123");
  });

  it("does not duplicate keys on second run", async () => {
    const config: OpenClawConfig = {
      env: { OPENAI_API_KEY: "sk-openai-abc" },
    };
    await migrateCredentials(config, tempDir, false);
    await migrateCredentials(config, tempDir, false); // second run

    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const content = await readFile(join(tempDir, ".sidjua-imported.env"), "utf-8");
    const matches = content.match(/OPENAI_API_KEY=/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe("maskSecret", () => {
  it("masks a long key showing first+last 4 chars", () => {
    const masked = maskSecret("sk-ant-abc1234567890xyz");
    expect(masked).toContain("sk-a");
    expect(masked).toContain("****");
    expect(masked).toContain("0xyz");
    expect(masked).not.toContain("abc1234567");
  });

  it("returns **** for short values", () => {
    expect(maskSecret("short")).toBe("****");
  });
});

// Helper to avoid importing path in test body
function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}
