// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for P189 — GUI Smoke Test + Light/Dark Mode Toggle
 *
 * Coverage:
 *   - CSS globals: all required CSS custom properties present in both themes
 *   - No hardcoded colors remaining in components
 *   - ThemeToggle: no lucide-react dependency; uses inline SVG
 *   - Sidebar / AgentCard / Shell / ConfirmDialog / FirstRunOverlay: CSS-var clean
 *   - API paths: workspaceConfig + firstRunComplete defined
 *   - API types: WorkspaceConfigResponse + FirstRunCompleteResponse present
 *   - API smoke: GET /api/v1/config + POST /api/v1/config/first-run-complete
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath }  from "node:url";
import { Hono }           from "hono";
import Database           from "better-sqlite3";
import { createErrorHandler }           from "../../src/api/middleware/error-handler.js";
import { registerWorkspaceConfigRoutes } from "../../src/api/routes/workspace-config.js";
import { runWorkspaceConfigMigration }   from "../../src/api/workspace-config-migration.js";
import { withAdminCtx }                  from "../helpers/with-admin-ctx.js";

// ---------------------------------------------------------------------------
// Helpers — read GUI source files as plain text
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const guiSrc    = join(__dirname, "../../sidjua-gui/src");

function src(relPath: string): string {
  return readFileSync(join(guiSrc, relPath), "utf8");
}

const globalsCss         = src("styles/globals.css");
const themeToggleTsx     = src("components/shared/ThemeToggle.tsx");
const sidebarTsx         = src("components/layout/Sidebar.tsx");
const agentCardTsx       = src("components/shared/AgentCard.tsx");
const shellTsx           = src("components/layout/Shell.tsx");
const confirmDialogTsx   = src("components/shared/ConfirmDialog.tsx");
const firstRunOverlayTsx = src("components/overlay/FirstRunOverlay.tsx");
const pathsTs            = src("api/paths.ts");
const typesTs            = src("api/types.ts");
const themeTsLib         = src("lib/theme.ts");

// ---------------------------------------------------------------------------
// CSS Custom Properties — light theme (:root)
// ---------------------------------------------------------------------------

describe("globals.css — light theme custom properties", () => {
  it("defines --color-on-accent", () => {
    expect(globalsCss).toContain("--color-on-accent:");
  });

  it("defines --color-overlay-bg", () => {
    expect(globalsCss).toContain("--color-overlay-bg:");
  });

  it("defines --color-modal-overlay", () => {
    expect(globalsCss).toContain("--color-modal-overlay:");
  });

  it("defines --color-mobile-overlay", () => {
    expect(globalsCss).toContain("--color-mobile-overlay:");
  });

  it("defines --color-sidebar-logo", () => {
    expect(globalsCss).toContain("--color-sidebar-logo:");
  });

  it("defines --color-sidebar-divider", () => {
    expect(globalsCss).toContain("--color-sidebar-divider:");
  });

  it("defines --color-sidebar-badge-bg", () => {
    expect(globalsCss).toContain("--color-sidebar-badge-bg:");
  });

  it("defines --color-sidebar-footer-text", () => {
    expect(globalsCss).toContain("--color-sidebar-footer-text:");
  });

  it("defines tier badge variables", () => {
    expect(globalsCss).toContain("--color-tier-1-bg:");
    expect(globalsCss).toContain("--color-tier-1-text:");
    expect(globalsCss).toContain("--color-tier-2-bg:");
    expect(globalsCss).toContain("--color-tier-2-text:");
    expect(globalsCss).toContain("--color-tier-3-bg:");
    expect(globalsCss).toContain("--color-tier-3-text:");
  });

  it("defines LLM badge variables", () => {
    expect(globalsCss).toContain("--color-llm-ready-bg:");
    expect(globalsCss).toContain("--color-llm-ready-border:");
    expect(globalsCss).toContain("--color-llm-warn-text:");
    expect(globalsCss).toContain("--color-llm-warn-bg:");
    expect(globalsCss).toContain("--color-llm-warn-border:");
  });

  it("defines --color-info-border", () => {
    expect(globalsCss).toContain("--color-info-border:");
  });

  it("[data-theme='dark'] block defines --color-overlay-bg", () => {
    const darkSection = globalsCss.split("[data-theme='dark']")[1] ?? "";
    expect(darkSection).toContain("--color-overlay-bg:");
  });

  it("[data-theme='dark'] block defines tier badge variables", () => {
    const darkSection = globalsCss.split("[data-theme='dark']")[1] ?? "";
    expect(darkSection).toContain("--color-tier-1-bg:");
    expect(darkSection).toContain("--color-tier-2-bg:");
    expect(darkSection).toContain("--color-tier-3-bg:");
  });
});

// ---------------------------------------------------------------------------
// ThemeToggle — inline SVG, no lucide-react
// ---------------------------------------------------------------------------

describe("ThemeToggle.tsx", () => {
  it("does NOT import from lucide-react", () => {
    expect(themeToggleTsx).not.toContain("lucide-react");
  });

  it("defines MoonIcon using inline SVG", () => {
    expect(themeToggleTsx).toContain("function MoonIcon");
    expect(themeToggleTsx).toContain("<svg");
    expect(themeToggleTsx).toContain('M21 12.79A9 9 0 1 1 11.21 3');
  });

  it("defines SunIcon using inline SVG", () => {
    expect(themeToggleTsx).toContain("function SunIcon");
  });

  it("uses useTheme hook", () => {
    expect(themeToggleTsx).toContain("useTheme");
  });

  it("button has aria-label attribute", () => {
    expect(themeToggleTsx).toContain("aria-label");
  });

  it("uses CSS variables for styling", () => {
    expect(themeToggleTsx).toContain("var(--color-border)");
    expect(themeToggleTsx).toContain("var(--color-surface)");
  });
});

// ---------------------------------------------------------------------------
// Sidebar — no hardcoded colors
// ---------------------------------------------------------------------------

describe("Sidebar.tsx — no hardcoded colors", () => {
  it("does NOT contain '#fff'", () => {
    expect(sidebarTsx).not.toContain("'#fff'");
  });

  it("does NOT contain rgba(255,255,255", () => {
    expect(sidebarTsx).not.toMatch(/rgba\(255,255,255/);
  });

  it("uses --color-sidebar-logo for logo text", () => {
    expect(sidebarTsx).toContain("var(--color-sidebar-logo)");
  });

  it("uses --color-sidebar-divider for borders", () => {
    expect(sidebarTsx).toContain("var(--color-sidebar-divider)");
  });

  it("uses --color-sidebar-badge-bg for nav badges", () => {
    expect(sidebarTsx).toContain("var(--color-sidebar-badge-bg)");
  });

  it("uses --color-sidebar-footer-text for footer", () => {
    expect(sidebarTsx).toContain("var(--color-sidebar-footer-text)");
  });
});

// ---------------------------------------------------------------------------
// AgentCard — CSS variable tier colors
// ---------------------------------------------------------------------------

describe("AgentCard.tsx — CSS variable tier colors", () => {
  it("TIER_COLORS uses --color-tier-1-bg", () => {
    expect(agentCardTsx).toContain("var(--color-tier-1-bg)");
  });

  it("TIER_COLORS uses --color-tier-2-bg", () => {
    expect(agentCardTsx).toContain("var(--color-tier-2-bg)");
  });

  it("TIER_COLORS uses --color-tier-3-bg", () => {
    expect(agentCardTsx).toContain("var(--color-tier-3-bg)");
  });

  it("LLM badge uses --color-llm-ready-bg", () => {
    expect(agentCardTsx).toContain("var(--color-llm-ready-bg)");
  });

  it("LLM badge uses --color-llm-warn-bg", () => {
    expect(agentCardTsx).toContain("var(--color-llm-warn-bg)");
  });

  it("does NOT contain hardcoded hex colors in TIER_COLORS", () => {
    // The TIER_COLORS object no longer has hardcoded hex strings
    expect(agentCardTsx).not.toMatch(/'#[0-9a-fA-F]{6}'/);
  });
});

// ---------------------------------------------------------------------------
// Shell, ConfirmDialog, FirstRunOverlay — overlays use CSS vars
// ---------------------------------------------------------------------------

describe("overlay backgrounds use CSS variables", () => {
  it("Shell.tsx mobile overlay uses --color-mobile-overlay", () => {
    expect(shellTsx).toContain("var(--color-mobile-overlay)");
  });

  it("Shell.tsx does NOT contain 'rgba(0,0,0,0.4)'", () => {
    expect(shellTsx).not.toContain("rgba(0,0,0,0.4)");
  });

  it("ConfirmDialog.tsx backdrop uses --color-modal-overlay", () => {
    expect(confirmDialogTsx).toContain("var(--color-modal-overlay)");
  });

  it("ConfirmDialog.tsx does NOT contain 'rgba(0,0,0,0.5)'", () => {
    expect(confirmDialogTsx).not.toContain("rgba(0,0,0,0.5)");
  });

  it("ConfirmDialog.tsx button text uses --color-on-accent", () => {
    expect(confirmDialogTsx).toContain("var(--color-on-accent)");
  });

  it("FirstRunOverlay.tsx uses --color-overlay-bg", () => {
    expect(firstRunOverlayTsx).toContain("var(--color-overlay-bg)");
  });

  it("FirstRunOverlay.tsx does NOT contain 'rgba(0, 0, 0, 0.75)'", () => {
    expect(firstRunOverlayTsx).not.toContain("rgba(0, 0, 0, 0.75)");
  });
});

// ---------------------------------------------------------------------------
// API paths
// ---------------------------------------------------------------------------

describe("API_PATHS — workspace config paths", () => {
  it("paths.ts exports workspaceConfig function pointing to /config", () => {
    expect(pathsTs).toContain("workspaceConfig:");
    // Path uses template literal: `${API_PREFIX}/config`
    expect(pathsTs).toContain("}/config`");
  });

  it("paths.ts exports firstRunComplete function", () => {
    expect(pathsTs).toContain("firstRunComplete:");
    expect(pathsTs).toContain("/config/first-run-complete");
  });
});

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

describe("API types — workspace config", () => {
  it("types.ts exports WorkspaceConfigResponse with firstRunCompleted field", () => {
    expect(typesTs).toContain("WorkspaceConfigResponse");
    expect(typesTs).toContain("firstRunCompleted: boolean");
  });

  it("types.ts exports FirstRunCompleteResponse with success field", () => {
    expect(typesTs).toContain("FirstRunCompleteResponse");
    expect(typesTs).toContain("success: boolean");
  });
});

// ---------------------------------------------------------------------------
// Theme lib
// ---------------------------------------------------------------------------

describe("lib/theme.ts", () => {
  it("exports Theme type with 'light' | 'dark' values", () => {
    expect(themeTsLib).toContain("export type Theme =");
    expect(themeTsLib).toContain("'light'");
    expect(themeTsLib).toContain("'dark'");
  });

  it("uses 'sidjua-theme' as localStorage key", () => {
    expect(themeTsLib).toContain("sidjua-theme");
  });

  it("exports ThemeProvider", () => {
    expect(themeTsLib).toContain("export function ThemeProvider");
  });

  it("sets data-theme attribute on document.documentElement", () => {
    expect(themeTsLib).toContain("data-theme");
    expect(themeTsLib).toContain("document.documentElement");
  });
});

// ---------------------------------------------------------------------------
// API smoke: workspace config routes
// ---------------------------------------------------------------------------

describe("API smoke — GET /api/v1/config", () => {
  let app: Hono;

  beforeEach(() => {
    const db = new Database(":memory:");
    runWorkspaceConfigMigration(db);
    app = new Hono();
    app.use("*", withAdminCtx);
    app.onError(createErrorHandler(false));
    registerWorkspaceConfigRoutes(app, { db });
  });

  it("responds 200 with firstRunCompleted boolean", async () => {
    const res  = await app.request("/api/v1/config");
    expect(res.status).toBe(200);
    const body = await res.json() as { firstRunCompleted: unknown };
    expect(typeof body.firstRunCompleted).toBe("boolean");
  });

  it("initial state is firstRunCompleted=false", async () => {
    const res  = await app.request("/api/v1/config");
    const body = await res.json() as { firstRunCompleted: boolean };
    expect(body.firstRunCompleted).toBe(false);
  });

  it("POST /api/v1/config/first-run-complete returns { success: true }", async () => {
    const res  = await app.request("/api/v1/config/first-run-complete", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("config shows firstRunCompleted=true after POST", async () => {
    await app.request("/api/v1/config/first-run-complete", { method: "POST" });
    const res  = await app.request("/api/v1/config");
    const body = await res.json() as { firstRunCompleted: boolean };
    expect(body.firstRunCompleted).toBe(true);
  });
});
