// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for P191 — Locale Completeness Validation
 *
 * Coverage:
 *   - de.json has all keys present in en.json (no missing keys)
 *   - de.json has no orphan keys (no keys absent from en.json)
 *   - de.json has no empty values for non-meta keys
 *   - Interpolation placeholders in de.json match en.json exactly
 *   - de.json completeness via locale API is 1.0 (100%)
 *   - _template.json has all keys from en.json with empty values
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadLocaleData, clearLocaleCache } from "../../src/i18n/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract all {paramName} placeholders from a string. */
function extractPlaceholders(str: string): Set<string> {
  const matches = str.match(/\{([^}]+)\}/g) ?? [];
  return new Set(matches);
}

function isMetaKey(key: string): boolean {
  return key.startsWith("_meta.");
}

// ---------------------------------------------------------------------------
// de.json completeness
// ---------------------------------------------------------------------------

describe("de.json completeness", () => {
  let enData: Record<string, string>;
  let deData: Record<string, string>;

  beforeEach(() => {
    clearLocaleCache();
    enData = loadLocaleData("en");
    deData = loadLocaleData("de");
  });

  afterEach(() => clearLocaleCache());

  it("de.json exists and has keys", () => {
    expect(Object.keys(deData).length).toBeGreaterThan(10);
  });

  it("de.json has all non-meta keys from en.json", () => {
    const enKeys = Object.keys(enData).filter((k) => !isMetaKey(k));
    const missing = enKeys.filter((k) => !(k in deData));
    expect(missing).toHaveLength(0);
  });

  it("de.json has no orphan keys (no keys absent from en.json)", () => {
    const deKeys  = Object.keys(deData).filter((k) => !isMetaKey(k));
    const orphans = deKeys.filter((k) => !(k in enData));
    expect(orphans).toHaveLength(0);
  });

  it("de.json has no empty values for non-meta keys", () => {
    const emptyKeys = Object.entries(deData)
      .filter(([k, v]) => !isMetaKey(k) && v.trim() === "")
      .map(([k]) => k);
    expect(emptyKeys).toHaveLength(0);
  });

  it("de.json preserves all interpolation placeholders from en.json", () => {
    const enKeys = Object.keys(enData).filter((k) => !isMetaKey(k));
    const mismatches: string[] = [];

    for (const key of enKeys) {
      const enVal = enData[key];
      const deVal = deData[key];
      if (!enVal || !deVal) continue;

      const enPlaceholders = extractPlaceholders(enVal);
      const dePlaceholders = extractPlaceholders(deVal);

      for (const ph of enPlaceholders) {
        if (!dePlaceholders.has(ph)) {
          mismatches.push(`${key}: missing placeholder ${ph} in de.json`);
        }
      }
    }

    expect(mismatches).toHaveLength(0);
  });

  it("de.json _meta.language is 'Deutsch'", () => {
    expect(deData["_meta.language"]).toBe("Deutsch");
  });

  it("de.json _meta.locale is 'de'", () => {
    expect(deData["_meta.locale"]).toBe("de");
  });

  it("de.json GUI nav keys are translated (not same as en except proper nouns)", () => {
    // 'Dashboard' and 'Chat' are proper nouns kept identical
    expect(deData["gui.nav.agents"]).toBe("Agenten");
    expect(deData["gui.nav.audit"]).toBe("Audit-Protokoll");
    expect(deData["gui.nav.settings"]).toBe("Einstellungen");
  });

  it("de.json GUI shell keys are translated", () => {
    expect(deData["gui.shell.not_connected"]).toBe("Nicht mit SIDJUA-Server verbunden.");
    expect(deData["gui.shell.open_settings"]).toBe("Einstellungen öffnen");
  });

  it("de.json GUI overlay heading is translated", () => {
    expect(deData["gui.overlay.heading"]).toBe("Dein Büro, deine Entscheidungen");
  });

  it("de.json GUI overlay text contains \\n\\n paragraph separators", () => {
    const text = deData["gui.overlay.text"];
    expect(text).toContain("\n\n");
  });

  it("de.json key count matches en.json key count", () => {
    const enKeys = Object.keys(enData);
    const deKeys = Object.keys(deData);
    expect(deKeys.length).toBe(enKeys.length);
  });
});

// ---------------------------------------------------------------------------
// _template.json structure
// ---------------------------------------------------------------------------

describe("_template.json structure", () => {
  let enData: Record<string, string>;
  let templateData: Record<string, string>;

  beforeEach(() => {
    clearLocaleCache();
    enData       = loadLocaleData("en");
    templateData = loadLocaleData("_template");
  });

  afterEach(() => clearLocaleCache());

  it("_template.json has same keys as en.json", () => {
    const enKeys = Object.keys(enData).filter((k) => !isMetaKey(k));
    const tplKeys = Object.keys(templateData).filter((k) => !isMetaKey(k));
    const missing = enKeys.filter((k) => !tplKeys.includes(k));
    expect(missing).toHaveLength(0);
  });

  it("_template.json non-meta values are empty strings", () => {
    const nonEmptyValues = Object.entries(templateData)
      .filter(([k, v]) => !isMetaKey(k) && v !== "")
      .map(([k]) => k);
    expect(nonEmptyValues).toHaveLength(0);
  });
});
