// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Documentation completeness tests.
 *
 * Verifies the Guide's handbook covers features shipped in:
 *   - P178: Starter agents + divisions GUI
 *   - P179: LLM provider setup
 *   - P180: Agent chat interface
 *
 * Also checks navigation reference and troubleshooting sections.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function readDoc(relPath: string): string {
  return readFileSync(new URL(`../../${relPath}`, import.meta.url), "utf-8");
}

// ---------------------------------------------------------------------------
// Handbook — P178 features: Starter Agents + Divisions
// ---------------------------------------------------------------------------

describe("Handbook covers P178 — Starter Agents + Divisions", () => {
  const handbook = readDoc("src/defaults/knowledge/guide-complete-handbook.md");

  it("lists all 6 starter agents by name", () => {
    expect(handbook).toContain("Guide");
    expect(handbook).toContain("HR Manager");
    expect(handbook).toContain("IT Administrator");
    expect(handbook).toContain("Auditor");
    expect(handbook).toContain("Financial Controller");
    expect(handbook).toContain("Librarian");
  });

  it("mentions the Agents page (/agents)", () => {
    expect(handbook).toContain("/agents");
    expect(handbook).toContain("Agents");
  });

  it("mentions the Divisions page (/divisions)", () => {
    expect(handbook).toContain("/divisions");
    expect(handbook).toContain("Divisions");
  });

  it("describes the starter team concept", () => {
    expect(handbook).toContain("starter");
  });

  it("explains what each agent does (Guide role)", () => {
    expect(handbook).toContain("first point of contact");
  });

  it("explains what HR Manager does", () => {
    expect(handbook).toContain("HR");
    expect(handbook).toContain("new agents");
  });

  it("explains what the Auditor does", () => {
    expect(handbook).toContain("Auditor");
    expect(handbook).toContain("compliance");
  });
});

// ---------------------------------------------------------------------------
// Handbook — P179 features: LLM Provider Setup
// ---------------------------------------------------------------------------

describe("Handbook covers P179 — LLM Provider Setup", () => {
  const handbook = readDoc("src/defaults/knowledge/guide-complete-handbook.md");

  it("covers Section 2: Setting Up LLM Provider", () => {
    expect(handbook).toContain("Section 2");
    expect(handbook).toContain("LLM Provider");
  });

  it("mentions Groq as a free provider", () => {
    expect(handbook).toContain("Groq");
    expect(handbook).toContain("free");
  });

  it("mentions Google AI Studio as a free provider", () => {
    expect(handbook).toContain("Google AI Studio");
  });

  it("provides step-by-step setup instructions", () => {
    expect(handbook).toContain("Settings");
    expect(handbook).toContain("API Key");
    expect(handbook).toContain("Test Connection");
  });

  it("explains simple vs advanced mode", () => {
    expect(handbook).toContain("Advanced mode");
  });

  it("mentions rate limits for free tiers", () => {
    expect(handbook).toContain("rate limit");
  });
});

// ---------------------------------------------------------------------------
// Handbook — P180 features: Chat Interface
// ---------------------------------------------------------------------------

describe("Handbook covers P180 — Agent Chat Interface", () => {
  const handbook = readDoc("src/defaults/knowledge/guide-complete-handbook.md");

  it("covers Section 3: Chatting with Agents", () => {
    expect(handbook).toContain("Section 3");
    expect(handbook).toContain("Chatting");
  });

  it("mentions the Chat page (/chat)", () => {
    expect(handbook).toContain("/chat");
    expect(handbook).toContain("Chat");
  });

  it("mentions Agent Switcher", () => {
    expect(handbook).toContain("Agent Switcher");
  });

  it("explains how to start a conversation", () => {
    expect(handbook).toContain("Chat");
    expect(handbook).toContain("Guide");
  });

  it("explains what happens when no provider is configured", () => {
    // Should mention needing a provider to chat
    expect(handbook).toContain("provider");
  });
});

// ---------------------------------------------------------------------------
// Handbook — Budget & Costs section
// ---------------------------------------------------------------------------

describe("Handbook covers budget and costs (Section 6)", () => {
  const handbook = readDoc("src/defaults/knowledge/guide-complete-handbook.md");

  it("contains Section 6: Budget & Costs", () => {
    expect(handbook).toContain("Section 6");
    expect(handbook).toContain("Budget");
  });

  it("mentions per-agent cost tracking", () => {
    const hasIt = handbook.includes("per-agent") || handbook.includes("Per-agent");
    expect(hasIt).toBe(true);
  });

  it("explains budget enforcement", () => {
    expect(handbook).toContain("budget");
    expect(handbook).toContain("limit");
  });

  it("mentions the Budget/costs page", () => {
    expect(handbook).toContain("/costs");
  });
});

// ---------------------------------------------------------------------------
// Handbook — Navigation Reference section
// ---------------------------------------------------------------------------

describe("Handbook covers navigation reference (Section 7)", () => {
  const handbook = readDoc("src/defaults/knowledge/guide-complete-handbook.md");

  it("contains Section 7: Navigation Reference", () => {
    expect(handbook).toContain("Section 7");
    expect(handbook).toContain("Navigation");
  });

  it("lists Dashboard route", () => {
    expect(handbook).toContain("Dashboard");
    expect(handbook).toContain("/");
  });

  it("lists Audit Log route", () => {
    expect(handbook).toContain("Audit");
    expect(handbook).toContain("/audit");
  });

  it("lists Settings route", () => {
    expect(handbook).toContain("Settings");
    expect(handbook).toContain("/settings");
  });
});

// ---------------------------------------------------------------------------
// Handbook — Troubleshooting section
// ---------------------------------------------------------------------------

describe("Handbook troubleshooting section", () => {
  const handbook = readDoc("src/defaults/knowledge/guide-complete-handbook.md");

  it("has a Troubleshooting section", () => {
    expect(handbook).toContain("Troubleshooting");
  });

  it("addresses 'Test Connection failed' issue", () => {
    expect(handbook).toContain("Test Connection");
  });

  it("mentions what to do when API key is invalid", () => {
    expect(handbook).toContain("API key");
  });
});

// ---------------------------------------------------------------------------
// Creating New Agents section
// ---------------------------------------------------------------------------

describe("Handbook covers creating new agents (Section 5)", () => {
  const handbook = readDoc("src/defaults/knowledge/guide-complete-handbook.md");

  it("contains Section 5: Creating New Agents", () => {
    expect(handbook).toContain("Section 5");
    expect(handbook).toContain("Creating");
  });

  it("explains how to create an agent via HR Manager", () => {
    expect(handbook).toContain("HR Manager");
    expect(handbook).toContain("new agent");
  });

  it("mentions the Agents page for finding new agents", () => {
    expect(handbook).toContain("Agents page");
  });
});

// ---------------------------------------------------------------------------
// Guide system prompt — all agents mentioned
// ---------------------------------------------------------------------------

describe("Guide system prompt completeness", () => {
  const prompt = readDoc("src/defaults/knowledge/guide-system-prompt.md");

  it("mentions SIDJUA platform", () => { expect(prompt).toContain("SIDJUA"); });
  it("references Guide role",     () => { expect(prompt).toContain("Guide"); });
  it("mentions HR Manager",       () => { expect(prompt).toContain("HR Manager"); });
  it("mentions IT Administrator", () => { expect(prompt).toContain("IT Administrator"); });
  it("mentions Auditor",          () => { expect(prompt).toContain("Auditor"); });
  it("mentions Financial Controller or Finance", () => {
    const hasFinancial = prompt.includes("Financial") || prompt.includes("Finance");
    expect(hasFinancial).toBe(true);
  });
  it("mentions Librarian",        () => { expect(prompt).toContain("Librarian"); });
  it("has language adaptation rule", () => { expect(prompt).toContain("language"); });
  it("has a Settings reference for provider setup", () => {
    expect(prompt).toContain("Settings");
  });
});

// ---------------------------------------------------------------------------
// Agent team reference — all 6 agents
// ---------------------------------------------------------------------------

describe("Agent team reference completeness", () => {
  const ref = readDoc("src/defaults/knowledge/agent-team-reference.md");

  it("lists Guide",                () => { expect(ref).toContain("Guide"); });
  it("lists HR Manager",           () => { expect(ref).toContain("HR Manager"); });
  it("lists IT Administrator",     () => { expect(ref).toContain("IT Administrator"); });
  it("lists Auditor",              () => { expect(ref).toContain("Auditor"); });
  it("lists Financial Controller", () => { expect(ref).toContain("Financial Controller"); });
  it("lists Librarian",            () => { expect(ref).toContain("Librarian"); });
  it("mentions agent switching",   () => { expect(ref).toContain("switch"); });
  it("is non-empty",               () => { expect(ref.trim().length).toBeGreaterThan(50); });
});

// ---------------------------------------------------------------------------
// QUICK-START.md covers LLM setup and chat
// ---------------------------------------------------------------------------

describe("QUICK-START.md covers key features", () => {
  const qs = readDoc("docs/QUICK-START.md");

  it("mentions LLM provider or API key", () => {
    const hasIt = qs.includes("LLM") || qs.includes("API key") || qs.includes("provider");
    expect(hasIt).toBe(true);
  });

  it("mentions the web GUI or dashboard", () => {
    const hasIt = qs.includes("GUI") || qs.includes("dashboard") || qs.includes("browser");
    expect(hasIt).toBe(true);
  });

  it("mentions sidjua command", () => {
    expect(qs).toContain("sidjua");
  });
});
