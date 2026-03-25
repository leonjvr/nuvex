// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for P190 — i18n Foundation
 *
 * Coverage:
 *   - Core module: t(), msg(), setLocale(), getLocale()
 *   - Loader: loadLocaleData(), getAvailableLocales(), clearLocaleCache()
 *   - en.json: key presence for all major namespaces
 *   - Interpolation: {param} syntax, missing params, numeric values
 *   - Fallback: missing key returns key itself (no crash)
 *   - Locale switching: setLocale/getLocale round-trip
 *   - workspace-config migration: locale default inserted
 *   - locale CLI: locale command exports
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  t,
  msg,
  getLocale,
  setLocale,
  getAvailableLocales,
  loadLocaleData,
  clearLocaleCache,
  initLocaleFromDb,
} from "../../src/i18n/index.js";
import { runWorkspaceConfigMigration } from "../../src/api/workspace-config-migration.js";

// ---------------------------------------------------------------------------
// Reset state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setLocale("en");
  clearLocaleCache();
});

// ---------------------------------------------------------------------------
// t() / msg() — basic lookup
// ---------------------------------------------------------------------------

describe("t() — basic translation lookup", () => {
  it("returns English string for a valid key", () => {
    const result = t("memory.search.no_results", { query: "test" });
    expect(result).toContain("test");
  });

  it("returns key itself when key is missing (graceful fallback)", () => {
    expect(t("key.that.does.not.exist")).toBe("key.that.does.not.exist");
  });

  it("msg() is an alias for t()", () => {
    expect(msg("memory.import.ingesting")).toBe(t("memory.import.ingesting"));
  });

  it("returns value as-is when no params", () => {
    const result = t("memory.import.ingesting");
    expect(result).toBe("Ingesting into knowledge pipeline...");
  });
});

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

describe("t() — {param} interpolation", () => {
  it("substitutes single string param", () => {
    const result = t("cli.start.already_running", { pid: "1234" });
    expect(result).toContain("1234");
  });

  it("substitutes numeric param (coerced to string)", () => {
    const result = t("memory.search.results_header", { query: "test", count: 42 });
    expect(result).toContain("42");
  });

  it("leaves unknown placeholder intact", () => {
    const result = t("memory.search.no_results", { wrong_param: "x" });
    expect(result).toContain("{query}");
  });

  it("substitutes multiple params", () => {
    const result = t("memory.search.results_header", { query: "hello", count: 3 });
    expect(result).toContain("hello");
    expect(result).toContain("3");
  });
});

// ---------------------------------------------------------------------------
// Locale switching
// ---------------------------------------------------------------------------

describe("getLocale() / setLocale()", () => {
  it("default locale is 'en'", () => {
    expect(getLocale()).toBe("en");
  });

  it("setLocale changes getLocale()", () => {
    setLocale("de");
    expect(getLocale()).toBe("de");
  });

  it("after setLocale back to en, getLocale returns en", () => {
    setLocale("de");
    setLocale("en");
    expect(getLocale()).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// getAvailableLocales()
// ---------------------------------------------------------------------------

describe("getAvailableLocales()", () => {
  it("returns at least 'en'", () => {
    const locales = getAvailableLocales();
    expect(locales).toContain("en");
  });

  it("does not include _template", () => {
    const locales = getAvailableLocales();
    expect(locales).not.toContain("_template");
  });

  it("returns an array of strings", () => {
    const locales = getAvailableLocales();
    expect(Array.isArray(locales)).toBe(true);
    for (const l of locales) {
      expect(typeof l).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// loadLocaleData() — flat key structure
// ---------------------------------------------------------------------------

describe("loadLocaleData('en')", () => {
  it("returns a flat object with dot-notation keys", () => {
    const data = loadLocaleData("en");
    expect(typeof data).toBe("object");
    expect(data).toHaveProperty("memory.search.no_results");
  });

  it("all values are strings", () => {
    const data = loadLocaleData("en");
    for (const [key, value] of Object.entries(data)) {
      expect(typeof value, `key ${key} should have string value`).toBe("string");
    }
  });

  it("caches result on second call", () => {
    const first  = loadLocaleData("en");
    const second = loadLocaleData("en");
    expect(first).toBe(second); // same object reference
  });
});

// ---------------------------------------------------------------------------
// initLocaleFromDb()
// ---------------------------------------------------------------------------

describe("initLocaleFromDb()", () => {
  it("reads locale from workspace_config table", () => {
    const db = new Database(":memory:");
    runWorkspaceConfigMigration(db);
    db.prepare("INSERT OR REPLACE INTO workspace_config (key, value, updated_at) VALUES ('locale', 'de', datetime('now'))").run();

    initLocaleFromDb(db);
    expect(getLocale()).toBe("de");
    db.close();
  });

  it("stays on 'en' when table does not exist", () => {
    const db = new Database(":memory:");
    initLocaleFromDb(db); // no table → no crash
    expect(getLocale()).toBe("en");
    db.close();
  });

  it("stays on 'en' when locale key is missing", () => {
    const db = new Database(":memory:");
    runWorkspaceConfigMigration(db);
    // Remove locale row
    db.prepare("DELETE FROM workspace_config WHERE key = 'locale'").run();
    initLocaleFromDb(db);
    expect(getLocale()).toBe("en");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// en.json — key presence checks (all major namespaces)
// ---------------------------------------------------------------------------

describe("en.json — startup namespace", () => {
  it("has startup.embedder_hint_openai with {model} and {dimensions}", () => {
    const result = t("startup.embedder_hint_openai", { model: "text-embedding-3-large", dimensions: "3072" });
    expect(result).toContain("text-embedding-3-large");
    expect(result).toContain("3072");
  });

  it("has startup.embedder_hint_cloudflare", () => {
    const result = t("startup.embedder_hint_cloudflare");
    expect(result).toContain("Cloudflare");
  });

  it("has startup.embedder_hint_none", () => {
    const result = t("startup.embedder_hint_none");
    expect(result).toContain("BM25");
  });
});

describe("en.json — cli.start namespace", () => {
  it("has cli.start.already_running with {pid}", () => {
    const result = t("cli.start.already_running", { pid: 999 });
    expect(result).toContain("999");
  });

  it("has cli.start.config_not_found", () => {
    expect(t("cli.start.config_not_found")).toContain("sidjua apply");
  });

  it("has cli.start.started with {pid}", () => {
    expect(t("cli.start.started", { pid: 123 })).toContain("123");
  });

  it("has cli.start.port_in_use with {port}", () => {
    const result = t("cli.start.port_in_use", { port: 8080, nextPort: 8081 });
    expect(result).toContain("8080");
  });
});

describe("en.json — cli.chat namespace", () => {
  it("has cli.chat.unsupported_agent with {agent}", () => {
    const result = t("cli.chat.unsupported_agent", { agent: "foobot" });
    expect(result).toContain("foobot");
  });

  it("has cli.chat.workspace_not_initialized with {workDir}", () => {
    const result = t("cli.chat.workspace_not_initialized", { workDir: "/tmp/work" });
    expect(result).toContain("/tmp/work");
  });

  it("has cli.chat.task.list_empty", () => {
    expect(t("cli.chat.task.list_empty")).toBeTruthy();
  });

  it("has cli.chat.task.added with {id} and {title}", () => {
    const result = t("cli.chat.task.added", { id: "t1", title: "Fix bug", dlNote: "" });
    expect(result).toContain("t1");
    expect(result).toContain("Fix bug");
  });
});

describe("en.json — cli.locale namespace", () => {
  it("has cli.locale.current with {locale}", () => {
    expect(t("cli.locale.current", { locale: "en" })).toContain("en");
  });

  it("has cli.locale.set_success with {locale}", () => {
    expect(t("cli.locale.set_success", { locale: "de" })).toContain("de");
  });

  it("has cli.locale.available_header", () => {
    expect(t("cli.locale.available_header")).toBeTruthy();
  });
});

describe("en.json — agent namespace", () => {
  it("has agent.greeting.text (CEO Assistant first-run greeting)", () => {
    const result = t("agent.greeting.text");
    expect(result).toContain("CEO Assistant");
    expect(result).toContain("What would you like to do first?");
  });

  it("has agent.briefing.welcome_back", () => {
    expect(t("agent.briefing.welcome_back")).toContain("Welcome back");
  });

  it("has agent.dienstschluss.title", () => {
    expect(t("agent.dienstschluss.title")).toContain("Dienstschluss");
  });

  it("has agent.dienstschluss.goodbye", () => {
    expect(t("agent.dienstschluss.goodbye")).toContain("Goodbye");
  });
});

describe("en.json — error namespace", () => {
  it("has error.GOV-001.message", () => {
    expect(t("error.GOV-001.message")).toContain("policy");
  });

  it("has error.PROV-001.message", () => {
    expect(t("error.PROV-001.message")).toContain("unavailable");
  });

  it("has error.EXEC-001.message", () => {
    expect(t("error.EXEC-001.message")).toContain("turns");
  });

  it("error code keys cover all major categories", () => {
    const data = loadLocaleData("en");
    const categories = ["GOV", "TASK", "AGT", "PROV", "TOOL", "SYS", "INPUT", "EXEC", "MOD"];
    for (const cat of categories) {
      const key = `error.${cat}-001.message`;
      expect(data[key], `missing ${key}`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// workspace-config migration — locale default
// ---------------------------------------------------------------------------

describe("workspace-config migration — locale row", () => {
  it("inserts locale=en row on first migration", () => {
    const db = new Database(":memory:");
    runWorkspaceConfigMigration(db);
    const row = db.prepare("SELECT value FROM workspace_config WHERE key = 'locale'").get() as { value: string } | undefined;
    expect(row?.value).toBe("en");
    db.close();
  });

  it("does not overwrite existing locale on re-migration", () => {
    const db = new Database(":memory:");
    runWorkspaceConfigMigration(db);
    db.prepare("UPDATE workspace_config SET value = 'de' WHERE key = 'locale'").run();
    runWorkspaceConfigMigration(db); // second run — idempotent
    const row = db.prepare("SELECT value FROM workspace_config WHERE key = 'locale'").get() as { value: string } | undefined;
    expect(row?.value).toBe("de");
    db.close();
  });
});

// ---------------------------------------------------------------------------
// locale command — exports
// ---------------------------------------------------------------------------

describe("locale.ts — module exports", () => {
  it("exports registerLocaleCommands function", async () => {
    const mod = await import("../../src/cli/commands/locale.js");
    expect(typeof mod.registerLocaleCommands).toBe("function");
  });
});
