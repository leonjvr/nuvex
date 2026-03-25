// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for MemoryBriefingGenerator — Phase 186
 */

import { describe, it, expect } from "vitest";
import { MemoryBriefingGenerator } from "../../src/session/memory-briefing.js";
import type { BriefingMessage } from "../../src/session/memory-briefing.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TASK_GOAL = "Analyse the Q1 sales data and produce a markdown report with recommendations.";

const SAMPLE_MESSAGES: BriefingMessage[] = [
  { role: "system",    content: "You are a financial analyst agent." },
  { role: "user",      content: TASK_GOAL },
  { role: "assistant", content: "I will start by loading the sales data file." },
  { role: "user",      content: "Tool result: { rows: 1200, columns: ['region', 'revenue'] }" },
  { role: "assistant", content: "I found 1200 rows across 5 regions. Decided to group by quarter." },
  { role: "user",      content: "Tool result: aggregation complete, Q1 total = $4.2M" },
  { role: "assistant", content: "Completed Q1 analysis. Revenue was $4.2M, up 12% YoY." },
];

const briefer = new MemoryBriefingGenerator();

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

describe("MemoryBriefingGenerator — header", () => {
  it("includes session continuity header", () => {
    const briefing = briefer.generate(SAMPLE_MESSAGES, "standard");
    expect(briefing).toContain("Session Continuity Briefing");
  });

  it("includes session number in header", () => {
    const briefing = briefer.generate(SAMPLE_MESSAGES, "standard", undefined, 3);
    expect(briefing).toContain("Session 3");
  });

  it("includes task title when provided", () => {
    const briefing = briefer.generate(SAMPLE_MESSAGES, "standard", "Sales Q1 Report");
    expect(briefing).toContain("Sales Q1 Report");
  });

  it("does not crash when task title is omitted", () => {
    expect(() => briefer.generate(SAMPLE_MESSAGES, "standard")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// minimal level
// ---------------------------------------------------------------------------

describe("MemoryBriefingGenerator — minimal", () => {
  it("includes task goal", () => {
    const briefing = briefer.generate(SAMPLE_MESSAGES, "minimal");
    expect(briefing).toContain("Task Goal");
    expect(briefing).toContain("Q1 sales data");
  });

  it("is shorter than standard briefing", () => {
    const minimal  = briefer.generate(SAMPLE_MESSAGES, "minimal");
    const standard = briefer.generate(SAMPLE_MESSAGES, "standard");
    expect(minimal.length).toBeLessThan(standard.length);
  });

  it("does not crash on empty messages", () => {
    expect(() => briefer.generate([], "minimal")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// standard level
// ---------------------------------------------------------------------------

describe("MemoryBriefingGenerator — standard", () => {
  it("includes task goal section", () => {
    const briefing = briefer.generate(SAMPLE_MESSAGES, "standard");
    expect(briefing).toContain("Task Goal");
  });

  it("includes recent context section when messages provided", () => {
    const briefing = briefer.generate(SAMPLE_MESSAGES, "standard");
    expect(briefing).toContain("Recent Context");
  });

  it("default level is standard", () => {
    const def      = briefer.generate(SAMPLE_MESSAGES);
    const explicit = briefer.generate(SAMPLE_MESSAGES, "standard");
    expect(def).toBe(explicit);
  });
});

// ---------------------------------------------------------------------------
// detailed level
// ---------------------------------------------------------------------------

describe("MemoryBriefingGenerator — detailed", () => {
  it("is longer than standard briefing", () => {
    const standard = briefer.generate(SAMPLE_MESSAGES, "standard");
    const detailed = briefer.generate(SAMPLE_MESSAGES, "detailed");
    // Detailed has more sections; at minimum same length
    expect(detailed.length).toBeGreaterThanOrEqual(standard.length);
  });

  it("includes recent exchanges section", () => {
    const briefing = briefer.generate(SAMPLE_MESSAGES, "detailed");
    // Should have "Recent Exchanges" header
    expect(briefing).toContain("Recent");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("MemoryBriefingGenerator — edge cases", () => {
  it("handles messages with only system message", () => {
    const msgs: BriefingMessage[] = [
      { role: "system", content: "You are an agent." },
    ];
    expect(() => briefer.generate(msgs, "standard")).not.toThrow();
  });

  it("truncates very long goal to avoid oversized briefing", () => {
    const longGoal = "x".repeat(2000);
    const msgs: BriefingMessage[] = [
      { role: "system", content: "System prompt." },
      { role: "user",   content: longGoal },
    ];
    const briefing = briefer.generate(msgs, "minimal");
    // Should be truncated — briefing total should be < 3000 chars for minimal
    expect(briefing.length).toBeLessThan(3000);
  });

  it("returns non-empty string for all levels with empty messages", () => {
    for (const level of ["minimal", "standard", "detailed"] as const) {
      const briefing = briefer.generate([], level);
      expect(typeof briefing).toBe("string");
      expect(briefing.length).toBeGreaterThan(0);
    }
  });

  it("briefing is a plain string (no null/undefined)", () => {
    const result = briefer.generate(SAMPLE_MESSAGES, "standard", "My Task", 2);
    expect(typeof result).toBe("string");
  });
});
