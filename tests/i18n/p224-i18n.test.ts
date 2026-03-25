// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P224 -- i18n completeness + doc structure tests
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT    = join(import.meta.dirname, "..", "..");
const LOCALES = join(ROOT, "src", "locales");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type LocaleData = Record<string, string>;

function loadJson(path: string): LocaleData {
  return JSON.parse(readFileSync(path, "utf-8")) as LocaleData;
}

function nonMetaKeys(data: LocaleData): string[] {
  return Object.keys(data).filter((k) => !k.startsWith("_meta"));
}

function extractPlaceholders(value: string): string[] {
  const m = value.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g);
  return m ? [...new Set(m)].sort() : [];
}

const en       = loadJson(join(LOCALES, "en.json"));
const enKeys   = nonMetaKeys(en);
const allFiles  = readdirSync(LOCALES).filter((f) => f.endsWith(".json") && f !== "en.json" && f !== "_template.json");
const locales   = allFiles.map((f) => f.replace(".json", "")).sort();

// ---------------------------------------------------------------------------
// en.json integrity
// ---------------------------------------------------------------------------

describe("en.json -- source of truth", () => {
  it("has at least 200 keys", () => {
    expect(enKeys.length).toBeGreaterThan(200);
  });

  it("contains daemon CLI keys", () => {
    expect(en["cli.daemon.status.header"]).toBeDefined();
    expect(en["cli.daemon.start.starting"]).toBeDefined();
    expect(en["cli.daemon.stop.stopped"]).toBeDefined();
    expect(en["daemon.state.running"]).toBeDefined();
  });

  it("contains watchdog keys", () => {
    expect(en["watchdog.restart.agent_restarted"]).toBeDefined();
    expect(en["watchdog.circuit_breaker.open"]).toBeDefined();
    expect(en["watchdog.escalation.triggered"]).toBeDefined();
  });

  it("contains proactive scan keys", () => {
    expect(en["proactive.scan.start"]).toBeDefined();
    expect(en["proactive.scan.clean"]).toBeDefined();
    expect(en["proactive.scan.fixed"]).toBeDefined();
  });

  it("has no empty string values", () => {
    const empty = enKeys.filter((k) => (en[k] as string).trim() === "");
    expect(empty, `Empty keys: ${empty.join(", ")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// _template.json
// ---------------------------------------------------------------------------

describe("_template.json", () => {
  const templatePath = join(LOCALES, "_template.json");

  it("exists", () => {
    expect(existsSync(templatePath)).toBe(true);
  });

  it("has same keys as en.json (excluding _meta)", () => {
    const template     = loadJson(templatePath);
    const templateKeys = nonMetaKeys(template);
    const missing      = enKeys.filter((k) => !templateKeys.includes(k));
    expect(missing, `Missing: ${missing.join(", ")}`).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// All locale files -- per-locale tests
// ---------------------------------------------------------------------------

describe("all locale files -- valid JSON", () => {
  for (const locale of locales) {
    it(`${locale}.json is valid JSON`, () => {
      expect(() => loadJson(join(LOCALES, `${locale}.json`))).not.toThrow();
    });
  }
});

describe("all locale files -- no missing keys", () => {
  for (const locale of locales) {
    it(`${locale} has all en.json keys`, () => {
      const data    = loadJson(join(LOCALES, `${locale}.json`));
      const missing = enKeys.filter((k) => !Object.prototype.hasOwnProperty.call(data, k));
      expect(missing, `${locale} missing: ${missing.slice(0, 5).join(", ")}`).toHaveLength(0);
    });
  }
});

describe("all locale files -- no empty values", () => {
  for (const locale of locales) {
    it(`${locale} has no empty string values`, () => {
      const data  = loadJson(join(LOCALES, `${locale}.json`));
      const empty = nonMetaKeys(data).filter((k) => typeof data[k] === "string" && (data[k] as string).trim() === "");
      expect(empty, `${locale} empty: ${empty.join(", ")}`).toHaveLength(0);
    });
  }
});

describe("all locale files -- interpolation placeholders preserved", () => {
  for (const locale of locales) {
    it(`${locale} preserves all {placeholders}`, () => {
      const data   = loadJson(join(LOCALES, `${locale}.json`));
      const errors: string[] = [];
      for (const key of enKeys) {
        const enVal      = en[key] as string;
        const localeVal  = data[key] as string | undefined;
        if (!localeVal) continue;
        const expected = extractPlaceholders(enVal);
        const got      = extractPlaceholders(localeVal);
        if (JSON.stringify(expected) !== JSON.stringify(got)) {
          errors.push(`${key}: expected [${expected}] got [${got}]`);
        }
      }
      expect(errors, errors.slice(0, 3).join("\n")).toHaveLength(0);
    });
  }
});

describe("all locale files -- daemon keys exist", () => {
  const daemonKeys = [
    "cli.daemon.status.header",
    "cli.daemon.start.starting",
    "cli.daemon.stop.stopped",
    "daemon.state.running",
    "watchdog.restart.agent_restarted",
    "proactive.scan.clean",
  ];

  for (const locale of locales) {
    it(`${locale} has daemon/watchdog keys`, () => {
      const data = loadJson(join(LOCALES, `${locale}.json`));
      for (const key of daemonKeys) {
        expect(
          Object.prototype.hasOwnProperty.call(data, key),
          `${locale} missing: ${key}`
        ).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 26 locales exist
// ---------------------------------------------------------------------------

describe("locale file count", () => {
  it("has exactly 26 locale files (en + 25 others)", () => {
    const all = readdirSync(LOCALES).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
    expect(all).toHaveLength(26);
  });
});

// ---------------------------------------------------------------------------
// docs/INSTALLATION.md
// ---------------------------------------------------------------------------

describe("docs/INSTALLATION.md", () => {
  const installPath = join(ROOT, "docs", "INSTALLATION.md");

  it("exists", () => {
    expect(existsSync(installPath)).toBe(true);
  });

  it("contains V1.0 version string", () => {
    const content = readFileSync(installPath, "utf-8");
    expect(content).toContain("1.0.0");
  });

  it("contains Platform Support Matrix section", () => {
    const content = readFileSync(installPath, "utf-8");
    expect(content).toContain("Platform Support Matrix");
  });

  it("contains Troubleshooting section", () => {
    const content = readFileSync(installPath, "utf-8");
    expect(content).toContain("Troubleshooting");
  });

  it("contains Docker Volume Reference section", () => {
    const content = readFileSync(installPath, "utf-8");
    expect(content).toContain("Docker Volume Reference");
  });
});

// ---------------------------------------------------------------------------
// README.md
// ---------------------------------------------------------------------------

describe("README.md", () => {
  const readmePath = join(ROOT, "README.md");

  it("contains language selector bar at the top", () => {
    const content = readFileSync(readmePath, "utf-8");
    const lines   = content.split("\n");
    const firstFew = lines.slice(0, 5).join("\n");
    // P227: translations moved to docs/translations/ — links updated accordingly
    expect(firstFew).toContain("README.de.md");  // path may be docs/translations/README.de.md
    expect(firstFew).toContain("README.ja.md");
  });

  it("contains Installation section with Platform Notes table", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("## Installation");
    expect(content).toContain("Platform Notes");
    expect(content).toContain("bubblewrap");
  });

  it("contains Translations section", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("## Translations");
    expect(content).toContain("26 languages");
  });

  it("links to docs/INSTALLATION.md", () => {
    const content = readFileSync(readmePath, "utf-8");
    expect(content).toContain("docs/INSTALLATION.md");
  });
});

// ---------------------------------------------------------------------------
// README.{locale}.md existence (Task 4 - checked after translations committed)
// ---------------------------------------------------------------------------

describe("README translations -- existence check", () => {
  const expectedLocales = [
    "de", "es", "fr", "ja", "ko", "zh-CN", "zh-TW",
    "ar", "bn", "cs", "fil", "hi", "id", "it", "ms",
    "nl", "pl", "pt-BR", "ro", "ru", "sv", "th", "tr", "uk", "vi",
  ];

  for (const locale of expectedLocales) {
    it(`README.${locale}.md exists`, () => {
      // P227: translation files moved from root to docs/translations/
      const path = join(ROOT, "docs", "translations", `README.${locale}.md`);
      expect(existsSync(path), `README.${locale}.md not found at docs/translations/`).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// docs/i18n/{locale}/INSTALLATION.md existence (Task 5)
// ---------------------------------------------------------------------------

describe("INSTALLATION.md translations -- existence check", () => {
  const expectedLocales = [
    "de", "es", "fr", "ja", "ko", "zh-CN", "zh-TW",
    "ar", "bn", "cs", "fil", "hi", "id", "it", "ms",
    "nl", "pl", "pt-BR", "ro", "ru", "sv", "th", "tr", "uk", "vi",
  ];

  for (const locale of expectedLocales) {
    it(`docs/i18n/${locale}/INSTALLATION.md exists`, () => {
      const path = join(ROOT, "docs", "i18n", locale, "INSTALLATION.md");
      expect(existsSync(path), `docs/i18n/${locale}/INSTALLATION.md not found`).toBe(true);
    });
  }
});
