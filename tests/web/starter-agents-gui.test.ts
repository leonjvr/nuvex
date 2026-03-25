// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * GUI source inspection tests for starter agent panel.
 *
 *   - Agents.tsx imports AgentCard and AgentIcon
 *   - Agents.tsx renders YourTeamPanel with 6 agent cards
 *   - AgentCard.tsx has tier badges and status indicator
 *   - AgentIcon.tsx exports all 6 agent icon types
 *   - Sidebar has Agents link with badge "6"
 *   - Sidebar has Divisions link
 *   - App.tsx includes /divisions route
 *   - Divisions.tsx shows division info
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function read(relPath: string): string {
  return readFileSync(new URL(`../../${relPath}`, import.meta.url), "utf-8");
}

// ---------------------------------------------------------------------------
// Agents.tsx
// ---------------------------------------------------------------------------

describe("Agents.tsx — Your Team panel", () => {
  it("imports AgentCard and AgentIcon", () => {
    const src = read("sidjua-gui/src/pages/Agents.tsx");
    expect(src).toContain("AgentCard");
    expect(src).toContain("AgentIcon");
  });

  it("renders YourTeamPanel", () => {
    const src = read("sidjua-gui/src/pages/Agents.tsx");
    expect(src).toContain("YourTeamPanel");
  });

  it("uses listStarterAgents to fetch agents", () => {
    const src = read("sidjua-gui/src/pages/Agents.tsx");
    expect(src).toContain("listStarterAgents");
  });

  it("has StarterAgentDetail component", () => {
    const src = read("sidjua-gui/src/pages/Agents.tsx");
    expect(src).toContain("StarterAgentDetail");
  });

  it("has Create New Agent button", () => {
    const src = read("sidjua-gui/src/pages/Agents.tsx");
    expect(src).toContain("Create New Agent");
  });

  it("has info banner about LLM provider", () => {
    const src = read("sidjua-gui/src/pages/Agents.tsx");
    expect(src).toContain("starter team");
    expect(src).toContain("LLM provider");
  });

  it("agent detail has Configure LLM button", () => {
    const src = read("sidjua-gui/src/pages/Agents.tsx");
    expect(src).toContain("Configure LLM");
  });

  it("agent detail Chat button links to /chat/:agentId when provider configured", () => {
    const src = read("sidjua-gui/src/pages/Agents.tsx");
    expect(src).toContain("/chat/");
    expect(src).toContain("Chat with");
  });
});

// ---------------------------------------------------------------------------
// AgentCard.tsx
// ---------------------------------------------------------------------------

describe("AgentCard.tsx", () => {
  it("renders tier badge for T1, T2, T3", () => {
    const src = read("sidjua-gui/src/components/shared/AgentCard.tsx");
    expect(src).toContain("T1");
    expect(src).toContain("T2");
    expect(src).toContain("T3");
  });

  it("shows active/inactive status", () => {
    const src = read("sidjua-gui/src/components/shared/AgentCard.tsx");
    expect(src).toContain("active");
    expect(src).toContain("inactive");
  });

  it("renders domain pills", () => {
    const src = read("sidjua-gui/src/components/shared/AgentCard.tsx");
    expect(src).toContain("domains");
  });

  it("renders AgentIcon component", () => {
    const src = read("sidjua-gui/src/components/shared/AgentCard.tsx");
    expect(src).toContain("AgentIcon");
  });
});

// ---------------------------------------------------------------------------
// AgentIcon.tsx
// ---------------------------------------------------------------------------

describe("AgentIcon.tsx — all 6 icon types", () => {
  it("exports CompassIcon (guide)", () => {
    const src = read("sidjua-gui/src/components/shared/AgentIcon.tsx");
    expect(src).toContain("CompassIcon");
  });

  it("exports UsersIcon (hr)", () => {
    const src = read("sidjua-gui/src/components/shared/AgentIcon.tsx");
    expect(src).toContain("UsersIcon");
  });

  it("exports ServerIcon (it)", () => {
    const src = read("sidjua-gui/src/components/shared/AgentIcon.tsx");
    expect(src).toContain("ServerIcon");
  });

  it("exports ShieldCheckIcon (auditor)", () => {
    const src = read("sidjua-gui/src/components/shared/AgentIcon.tsx");
    expect(src).toContain("ShieldCheckIcon");
  });

  it("exports BarChartIcon (finance)", () => {
    const src = read("sidjua-gui/src/components/shared/AgentIcon.tsx");
    expect(src).toContain("BarChartIcon");
  });

  it("exports BookOpenIcon (librarian)", () => {
    const src = read("sidjua-gui/src/components/shared/AgentIcon.tsx");
    expect(src).toContain("BookOpenIcon");
  });

  it("AgentIcon mapper handles all 6 icon names from YAML", () => {
    const src = read("sidjua-gui/src/components/shared/AgentIcon.tsx");
    for (const name of ['compass', 'users', 'server', 'shield-check', 'bar-chart', 'book-open']) {
      expect(src).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar — Agents badge + Divisions nav
// ---------------------------------------------------------------------------

describe("Sidebar.tsx — Agents badge and Divisions nav", () => {
  it("Agents nav item has badge '6'", () => {
    const src = read("sidjua-gui/src/components/layout/Sidebar.tsx");
    expect(src).toContain("'6'");
    expect(src).toContain("badge");
  });

  it("Divisions nav item present", () => {
    const src = read("sidjua-gui/src/components/layout/Sidebar.tsx");
    expect(src).toContain("/divisions");
    expect(src).toContain("gui.nav.divisions");
  });
});

// ---------------------------------------------------------------------------
// App.tsx — Divisions route
// ---------------------------------------------------------------------------

describe("App.tsx — Divisions route", () => {
  it("includes /divisions route", () => {
    const src = read("sidjua-gui/src/App.tsx");
    expect(src).toContain("divisions");
    expect(src).toContain("Divisions");
  });
});

// ---------------------------------------------------------------------------
// Divisions.tsx
// ---------------------------------------------------------------------------

describe("Divisions.tsx", () => {
  it("uses listStarterDivisions", () => {
    const src = read("sidjua-gui/src/pages/Divisions.tsx");
    expect(src).toContain("listStarterDivisions");
  });

  it("shows PROTECTED badge", () => {
    const src = read("sidjua-gui/src/pages/Divisions.tsx");
    expect(src).toContain("PROTECTED");
  });

  it("shows budget info", () => {
    const src = read("sidjua-gui/src/pages/Divisions.tsx");
    expect(src).toContain("budget");
  });
});
