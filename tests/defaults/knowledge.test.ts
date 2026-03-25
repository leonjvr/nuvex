// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Knowledge docs tests.
 *
 * Covers:
 *   - guide-complete-handbook.md exists and is loadable
 *   - guide-system-prompt.md exists and is loadable
 *   - agent-team-reference.md exists and is loadable
 *   - Handbook covers all 7 required sections (by header)
 *   - Guide system prompt references all 6 agents
 *   - Agent team reference lists all 6 agents
 *   - buildSystemPrompt includes handbook content for Guide
 *   - buildSystemPrompt appends team reference to all agents
 */

import { describe, it, expect } from "vitest";
import { loadKnowledgeFile, buildSystemPrompt, loadDefaultRoles } from "../../src/defaults/loader.js";

// ---------------------------------------------------------------------------
// File existence and loadability
// ---------------------------------------------------------------------------

describe("loadKnowledgeFile()", () => {
  it("loads guide-complete-handbook.md without throwing", () => {
    expect(() => loadKnowledgeFile("guide-complete-handbook.md")).not.toThrow();
  });

  it("loads guide-system-prompt.md without throwing", () => {
    expect(() => loadKnowledgeFile("guide-system-prompt.md")).not.toThrow();
  });

  it("loads agent-team-reference.md without throwing", () => {
    expect(() => loadKnowledgeFile("agent-team-reference.md")).not.toThrow();
  });

  it("throws for a non-existent file", () => {
    expect(() => loadKnowledgeFile("does-not-exist.md")).toThrow();
  });

  it("returns a non-empty string for each knowledge file", () => {
    for (const f of ["guide-complete-handbook.md", "guide-system-prompt.md", "agent-team-reference.md"]) {
      const content = loadKnowledgeFile(f);
      expect(typeof content).toBe("string");
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Handbook content verification
// ---------------------------------------------------------------------------

describe("guide-complete-handbook.md", () => {
  const handbook = loadKnowledgeFile("guide-complete-handbook.md");

  it("contains Section 1: Welcome & First Steps", () => {
    expect(handbook).toContain("Section 1");
    expect(handbook).toContain("Welcome");
  });

  it("contains Section 2: Setting Up Your LLM Provider", () => {
    expect(handbook).toContain("Section 2");
    expect(handbook).toContain("LLM Provider");
  });

  it("contains Section 3: Chatting with Agents", () => {
    expect(handbook).toContain("Section 3");
    expect(handbook).toContain("Chatting");
  });

  it("contains Section 4: Understanding Your Team", () => {
    expect(handbook).toContain("Section 4");
    expect(handbook).toContain("Your Team");
  });

  it("contains Section 5: Creating New Agents", () => {
    expect(handbook).toContain("Section 5");
    expect(handbook).toContain("Creating");
  });

  it("contains Section 6: Budget & Costs", () => {
    expect(handbook).toContain("Section 6");
    expect(handbook).toContain("Budget");
  });

  it("contains Section 7: Navigation Reference", () => {
    expect(handbook).toContain("Section 7");
    expect(handbook).toContain("Navigation");
  });

  it("mentions all 6 starter agents by name", () => {
    expect(handbook).toContain("Guide");
    expect(handbook).toContain("HR Manager");
    expect(handbook).toContain("IT Administrator");
    expect(handbook).toContain("Auditor");
    expect(handbook).toContain("Financial Controller");
    expect(handbook).toContain("Librarian");
  });

  it("mentions free providers Groq and Google AI Studio", () => {
    expect(handbook).toContain("Groq");
    expect(handbook).toContain("Google AI Studio");
  });

  it("mentions Settings navigation", () => {
    expect(handbook).toContain("Settings");
  });

  it("has a troubleshooting section", () => {
    expect(handbook).toContain("Troubleshooting");
  });
});

// ---------------------------------------------------------------------------
// Guide system prompt
// ---------------------------------------------------------------------------

describe("guide-system-prompt.md", () => {
  const prompt = loadKnowledgeFile("guide-system-prompt.md");

  it("mentions SIDJUA", () => {
    expect(prompt).toContain("SIDJUA");
  });

  it("references the Guide role", () => {
    expect(prompt).toContain("Guide");
  });

  it("mentions HR Manager for agent creation", () => {
    expect(prompt).toContain("HR Manager");
  });

  it("mentions the IT Administrator", () => {
    expect(prompt).toContain("IT Administrator");
  });

  it("mentions the Auditor", () => {
    expect(prompt).toContain("Auditor");
  });

  it("mentions language adaptation rule", () => {
    expect(prompt).toContain("language");
  });
});

// ---------------------------------------------------------------------------
// Agent team reference
// ---------------------------------------------------------------------------

describe("agent-team-reference.md", () => {
  const ref = loadKnowledgeFile("agent-team-reference.md");

  it("lists Guide", () => { expect(ref).toContain("Guide"); });
  it("lists HR Manager", () => { expect(ref).toContain("HR Manager"); });
  it("lists IT Administrator", () => { expect(ref).toContain("IT Administrator"); });
  it("lists Auditor", () => { expect(ref).toContain("Auditor"); });
  it("lists Financial Controller", () => { expect(ref).toContain("Financial Controller"); });
  it("lists Librarian", () => { expect(ref).toContain("Librarian"); });

  it("mentions agent switching", () => {
    expect(ref).toContain("switch");
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt integration
// ---------------------------------------------------------------------------

describe("buildSystemPrompt()", () => {
  const roles = loadDefaultRoles();

  it("guide prompt contains handbook content", () => {
    const guide = roles.find((r) => r.id === "guide");
    if (!guide) throw new Error("guide role not found");

    const prompt = buildSystemPrompt(guide);
    expect(prompt).toContain("Handbook");
    expect(prompt).toContain("SIDJUA");
  });

  it("guide prompt includes team reference", () => {
    const guide = roles.find((r) => r.id === "guide");
    if (!guide) throw new Error("guide role not found");

    const prompt = buildSystemPrompt(guide);
    expect(prompt).toContain("HR Manager");
    expect(prompt).toContain("Librarian");
  });

  it("non-guide prompt includes agent description", () => {
    const hr = roles.find((r) => r.id === "hr");
    if (!hr) throw new Error("hr role not found");

    const prompt = buildSystemPrompt(hr);
    expect(prompt).toContain(hr.description);
  });

  it("non-guide prompt includes capabilities", () => {
    const it_ = roles.find((r) => r.id === "it");
    if (!it_) throw new Error("it role not found");

    const prompt = buildSystemPrompt(it_);
    for (const cap of it_.capabilities) {
      expect(prompt).toContain(cap);
    }
  });

  it("all agents get team reference appended", () => {
    for (const role of roles) {
      const prompt = buildSystemPrompt(role);
      expect(prompt, `${role.id} should have team reference`).toContain("Your Team");
    }
  });
});
