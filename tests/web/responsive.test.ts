// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Responsive tablet layout — source inspection tests.
 *
 *   - globals.css has ≤1024px breakpoint
 *   - Shell.tsx manages hamburger/drawer state
 *   - Header.tsx has hamburger button (Menu icon)
 *   - Sidebar.tsx supports drawer overlay mode
 *   - Dashboard.tsx has responsive grid columns
 *   - Tables in Dashboard/Configuration are wrapped in overflow-x: auto
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function read(relPath: string): string {
  return readFileSync(new URL(`../../${relPath}`, import.meta.url), "utf-8");
}

// ---------------------------------------------------------------------------
// globals.css — breakpoints
// ---------------------------------------------------------------------------

describe("globals.css — tablet breakpoints", () => {
  it("has a ≤1024px media query", () => {
    const src = read("sidjua-gui/src/styles/globals.css");
    expect(src).toContain("max-width: 1024px");
  });

  it("has a ≤767px media query for mobile", () => {
    const src = read("sidjua-gui/src/styles/globals.css");
    expect(src).toContain("max-width: 767px");
  });
});

// ---------------------------------------------------------------------------
// Shell.tsx — hamburger / drawer state
// ---------------------------------------------------------------------------

describe("Shell.tsx — hamburger and drawer state", () => {
  it("tracks drawerOpen state", () => {
    const src = read("sidjua-gui/src/components/layout/Shell.tsx");
    expect(src).toContain("drawerOpen");
  });

  it("tracks isMobile or isTablet breakpoint state", () => {
    const src = read("sidjua-gui/src/components/layout/Shell.tsx");
    expect(src).toMatch(/isMobile|isTablet/);
  });

  it("passes showMenuButton and onMenuToggle to Header", () => {
    const src = read("sidjua-gui/src/components/layout/Shell.tsx");
    expect(src).toContain("showMenuButton");
    expect(src).toContain("onMenuToggle");
  });

  it("passes drawerOpen and isMobile to Sidebar", () => {
    const src = read("sidjua-gui/src/components/layout/Shell.tsx");
    expect(src).toContain("drawerOpen");
    expect(src).toContain("isMobile");
  });

  it("renders a backdrop overlay for mobile drawer", () => {
    const src = read("sidjua-gui/src/components/layout/Shell.tsx");
    // Backdrop uses CSS variable --color-mobile-overlay (no hardcoded rgba)
    expect(src).toContain("--color-mobile-overlay");
    expect(src).toContain("zIndex");
  });
});

// ---------------------------------------------------------------------------
// Header.tsx — hamburger button
// ---------------------------------------------------------------------------

describe("Header.tsx — hamburger menu button", () => {
  it("imports Menu icon from lucide-react", () => {
    const src = read("sidjua-gui/src/components/layout/Header.tsx");
    expect(src).toContain("Menu");
  });

  it("accepts showMenuButton and onMenuToggle props", () => {
    const src = read("sidjua-gui/src/components/layout/Header.tsx");
    expect(src).toContain("showMenuButton");
    expect(src).toContain("onMenuToggle");
  });

  it("renders menu button when showMenuButton is true", () => {
    const src = read("sidjua-gui/src/components/layout/Header.tsx");
    expect(src).toContain("gui.connection.menu_toggle_aria");
  });
});

// ---------------------------------------------------------------------------
// Sidebar.tsx — drawer overlay mode
// ---------------------------------------------------------------------------

describe("Sidebar.tsx — drawer overlay mode", () => {
  it("accepts drawerOpen, isMobile, and onClose props", () => {
    const src = read("sidjua-gui/src/components/layout/Sidebar.tsx");
    expect(src).toContain("drawerOpen");
    expect(src).toContain("isMobile");
    expect(src).toContain("onClose");
  });

  it("uses translateX for drawer slide-in animation", () => {
    const src = read("sidjua-gui/src/components/layout/Sidebar.tsx");
    expect(src).toContain("translateX");
  });

  it("uses position: fixed for drawer overlay", () => {
    const src = read("sidjua-gui/src/components/layout/Sidebar.tsx");
    expect(src).toContain("position");
    expect(src).toContain("fixed");
  });

  it("calls onClose when a nav link is clicked in mobile mode", () => {
    const src = read("sidjua-gui/src/components/layout/Sidebar.tsx");
    expect(src).toContain("onClose");
    expect(src).toContain("onClick");
  });
});

// ---------------------------------------------------------------------------
// Dashboard.tsx — responsive grid
// ---------------------------------------------------------------------------

describe("Dashboard.tsx — responsive 2-column grid", () => {
  it("has isTablet breakpoint state", () => {
    const src = read("sidjua-gui/src/pages/Dashboard.tsx");
    expect(src).toContain("isTablet");
  });

  it("uses twoColGrid variable for content rows", () => {
    const src = read("sidjua-gui/src/pages/Dashboard.tsx");
    expect(src).toContain("twoColGrid");
  });

  it("gridTemplateColumns changes to 1fr when isTablet", () => {
    const src = read("sidjua-gui/src/pages/Dashboard.tsx");
    expect(src).toContain("isTablet");
    expect(src).toContain("1fr 1fr");
    expect(src).toMatch(/isTablet.*1fr|1fr.*isTablet/s);
  });

  it("division table is wrapped in overflow-x: auto", () => {
    const src = read("sidjua-gui/src/pages/Dashboard.tsx");
    expect(src).toContain("overflowX: 'auto'");
  });
});

// ---------------------------------------------------------------------------
// Configuration.tsx — table overflow wrappers
// ---------------------------------------------------------------------------

describe("Configuration.tsx — table overflow wrappers", () => {
  it("division summary table is wrapped in overflow-x: auto", () => {
    const src = read("sidjua-gui/src/pages/Configuration.tsx");
    const overflowCount = (src.match(/overflowX: 'auto'/g) ?? []).length;
    expect(overflowCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// index.html — favicon.ico link
// ---------------------------------------------------------------------------

describe("index.html — favicon", () => {
  it("links to /favicon.ico", () => {
    const src = read("sidjua-gui/index.html");
    expect(src).toContain("/favicon.ico");
    expect(src).toContain("image/x-icon");
  });
});
