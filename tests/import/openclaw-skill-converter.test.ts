// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm }               from "node:fs/promises";
import { tmpdir }                                       from "node:os";
import { join }                                         from "node:path";
import {
  identifyModuleRequired,
  isPortableSkill,
  convertSkillFile,
  classifyConfigSkills,
}                                                       from "../../src/import/openclaw-skill-converter.js";

describe("identifyModuleRequired", () => {
  it("identifies 'discord' as requiring the discord module", () => {
    expect(identifyModuleRequired("discord")).toBe("discord");
  });

  it("identifies 'discord-bot' as requiring the discord module", () => {
    expect(identifyModuleRequired("discord-bot")).toBe("discord");
  });

  it("identifies 'slack' as requiring the slack module", () => {
    expect(identifyModuleRequired("slack")).toBe("slack");
  });

  it("identifies 'github' as requiring the github module", () => {
    expect(identifyModuleRequired("github")).toBe("github");
  });

  it("identifies 'notion' as requiring the notion module", () => {
    expect(identifyModuleRequired("notion")).toBe("notion");
  });

  it("identifies 'telegram' as requiring the telegram module", () => {
    expect(identifyModuleRequired("telegram")).toBe("telegram");
  });

  it("returns undefined for portable skills (weather, summarize)", () => {
    expect(identifyModuleRequired("weather")).toBeUndefined();
    expect(identifyModuleRequired("summarize")).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(identifyModuleRequired("Discord")).toBe("discord");
    expect(identifyModuleRequired("SLACK")).toBe("slack");
  });
});

describe("isPortableSkill", () => {
  it("identifies weather as portable", () => {
    expect(isPortableSkill("weather")).toBe(true);
  });

  it("identifies summarize as portable", () => {
    expect(isPortableSkill("summarize")).toBe(true);
  });

  it("identifies coding-agent as portable", () => {
    expect(isPortableSkill("coding-agent")).toBe(true);
  });

  it("identifies healthcheck as portable", () => {
    expect(isPortableSkill("healthcheck")).toBe(true);
  });

  it("returns false for discord (module-required, not portable)", () => {
    expect(isPortableSkill("discord")).toBe(false);
  });
});

describe("convertSkillFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sidjua-skill-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("converts a simple SKILL.md with frontmatter", async () => {
    const mdContent = `---
name: "Weather Agent"
description: "Fetches weather data"
metadata:
  openclaw:
    version: 1
    id: weather-bundled
---

# Weather Agent

Fetches weather for any city.
`;
    const skillPath = join(tempDir, "SKILL.md");
    await writeFile(skillPath, mdContent, "utf-8");

    const destDir = join(tempDir, "dest");
    const destPath = await convertSkillFile(skillPath, destDir, "weather");

    const { readFile } = await import("node:fs/promises");
    const result = await readFile(destPath, "utf-8");

    expect(result).toContain('name: "Weather Agent"');
    expect(result).toContain('imported_from: "openclaw"');
    expect(result).not.toContain("openclaw:");
    expect(result).toContain("# Weather Agent");
    expect(result).toContain("Fetches weather for any city.");
  });

  it("converts a SKILL.md without frontmatter", async () => {
    const mdContent = `# My Skill\n\nDoes something useful.\n`;
    const skillPath = join(tempDir, "SKILL.md");
    await writeFile(skillPath, mdContent, "utf-8");

    const destDir = join(tempDir, "dest");
    const destPath = await convertSkillFile(skillPath, destDir, "my-skill");

    const { readFile } = await import("node:fs/promises");
    const result = await readFile(destPath, "utf-8");

    expect(result).toContain("# My Skill");
    expect(result).toContain("Does something useful.");
  });
});

describe("classifyConfigSkills", () => {
  it("classifies discord entry as module_required", () => {
    const results = classifyConfigSkills({ discord: { enabled: true } });
    expect(results[0]?.disposition).toBe("module_required");
    expect(results[0]?.moduleId).toBe("discord");
  });

  it("classifies unknown skill as skipped", () => {
    const results = classifyConfigSkills({ "custom-skill": {} });
    expect(results[0]?.disposition).toBe("skipped");
  });

  it("handles multiple entries", () => {
    const results = classifyConfigSkills({
      discord:  { enabled: true },
      slack:    { enabled: true },
      weather:  { enabled: false },
    });
    const dispositions = results.map((r) => r.disposition);
    expect(dispositions).toContain("module_required");
    expect(dispositions).not.toContain("imported");
  });

  it("returns empty array for empty entries", () => {
    expect(classifyConfigSkills({})).toHaveLength(0);
  });
});
