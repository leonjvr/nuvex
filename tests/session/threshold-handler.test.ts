// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for ThresholdHandler — Phase 186
 */

import { describe, it, expect } from "vitest";
import { ThresholdHandler, DEFAULT_WARN_PERCENT, DEFAULT_ROTATE_PERCENT } from "../../src/session/threshold-handler.js";
import type { SessionTokenState, SessionConfig } from "../../src/session/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<SessionTokenState> = {}): SessionTokenState {
  return {
    session_id:    "sess-1",
    agent_id:      "agent-1",
    task_id:       "task-1",
    tokens_used:   0,
    context_limit: 100_000,
    percent_used:  0,
    turn_count:    0,
    started_at:    new Date().toISOString(),
    last_updated:  new Date().toISOString(),
    status:        "active",
    ...overrides,
  };
}

const handler = new ThresholdHandler();

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe("ThresholdHandler defaults", () => {
  it("exports DEFAULT_WARN_PERCENT = 70", () => {
    expect(DEFAULT_WARN_PERCENT).toBe(70);
  });

  it("exports DEFAULT_ROTATE_PERCENT = 85", () => {
    expect(DEFAULT_ROTATE_PERCENT).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// check() — action = ok
// ---------------------------------------------------------------------------

describe("ThresholdHandler.check — ok", () => {
  it("returns ok when tokens are low (below warn)", () => {
    const state = makeState({ percent_used: 50 });
    const result = handler.check(state);
    expect(result.action).toBe("ok");
  });

  it("returns ok when tokens are zero", () => {
    const result = handler.check(makeState());
    expect(result.action).toBe("ok");
  });

  it("returns ok when already warned (won't re-warn)", () => {
    // Once status is 'warned', we only look for rotate threshold
    const state = makeState({ percent_used: 72, status: "warned" });
    const result = handler.check(state);
    expect(result.action).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// check() — action = warn
// ---------------------------------------------------------------------------

describe("ThresholdHandler.check — warn", () => {
  it("returns warn when percent_used >= warn threshold (active status)", () => {
    const state = makeState({ percent_used: 70, status: "active" });
    const result = handler.check(state);
    expect(result.action).toBe("warn");
  });

  it("returns warn at just above warn threshold", () => {
    const state = makeState({ percent_used: 71, status: "active" });
    expect(handler.check(state).action).toBe("warn");
  });

  it("uses custom warn_threshold_percent", () => {
    const cfg: SessionConfig = { warn_threshold_percent: 60 };
    const state = makeState({ percent_used: 61, status: "active" });
    expect(handler.check(state, cfg).action).toBe("warn");
  });

  it("does not warn below custom threshold", () => {
    const cfg: SessionConfig = { warn_threshold_percent: 60 };
    const state = makeState({ percent_used: 59, status: "active" });
    expect(handler.check(state, cfg).action).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// check() — action = rotate
// ---------------------------------------------------------------------------

describe("ThresholdHandler.check — rotate", () => {
  it("returns rotate when percent_used >= rotate threshold", () => {
    const state = makeState({ percent_used: 85 });
    expect(handler.check(state).action).toBe("rotate");
  });

  it("returns rotate at exactly 100%", () => {
    const state = makeState({ percent_used: 100 });
    expect(handler.check(state).action).toBe("rotate");
  });

  it("uses custom rotate_threshold_percent", () => {
    const cfg: SessionConfig = { rotate_threshold_percent: 80 };
    const state = makeState({ percent_used: 80 });
    expect(handler.check(state, cfg).action).toBe("rotate");
  });

  it("rotate takes precedence over warn at same level", () => {
    // If someone sets warn=85, rotate=85 — rotate should win
    const cfg: SessionConfig = { warn_threshold_percent: 84, rotate_threshold_percent: 85 };
    const state = makeState({ percent_used: 85, status: "active" });
    expect(handler.check(state, cfg).action).toBe("rotate");
  });
});

// ---------------------------------------------------------------------------
// check() — max_session_turns
// ---------------------------------------------------------------------------

describe("ThresholdHandler.check — max_session_turns", () => {
  it("returns rotate when turn_count reaches max_session_turns", () => {
    const cfg: SessionConfig = { max_session_turns: 10 };
    const state = makeState({ percent_used: 30, turn_count: 10 });
    expect(handler.check(state, cfg).action).toBe("rotate");
  });

  it("returns ok when turn_count is below max", () => {
    const cfg: SessionConfig = { max_session_turns: 10 };
    const state = makeState({ percent_used: 30, turn_count: 9 });
    expect(handler.check(state, cfg).action).toBe("ok");
  });

  it("max_session_turns=0 disables turn-based rotation", () => {
    const cfg: SessionConfig = { max_session_turns: 0 };
    const state = makeState({ percent_used: 30, turn_count: 999 });
    expect(handler.check(state, cfg).action).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// resolveThresholds
// ---------------------------------------------------------------------------

describe("ThresholdHandler.resolveThresholds", () => {
  it("returns defaults when no config", () => {
    const { warnAt, rotateAt } = handler.resolveThresholds();
    expect(warnAt).toBe(70);
    expect(rotateAt).toBe(85);
  });

  it("clamps warn below 10 to 10", () => {
    const cfg: SessionConfig = { warn_threshold_percent: 5 };
    expect(handler.resolveThresholds(cfg).warnAt).toBe(10);
  });

  it("clamps rotate above 99 to 99", () => {
    const cfg: SessionConfig = { rotate_threshold_percent: 100 };
    expect(handler.resolveThresholds(cfg).rotateAt).toBe(99);
  });

  it("ensures rotateAt is always > warnAt", () => {
    const cfg: SessionConfig = { warn_threshold_percent: 80, rotate_threshold_percent: 80 };
    const { warnAt, rotateAt } = handler.resolveThresholds(cfg);
    expect(rotateAt).toBeGreaterThan(warnAt);
  });
});

// ---------------------------------------------------------------------------
// isTurnLimitReached
// ---------------------------------------------------------------------------

describe("ThresholdHandler.isTurnLimitReached", () => {
  it("returns false when no config", () => {
    expect(handler.isTurnLimitReached(100)).toBe(false);
  });

  it("returns false when max_session_turns=0", () => {
    expect(handler.isTurnLimitReached(100, { max_session_turns: 0 })).toBe(false);
  });

  it("returns true when turnCount >= max", () => {
    expect(handler.isTurnLimitReached(10, { max_session_turns: 10 })).toBe(true);
  });

  it("returns false when turnCount < max", () => {
    expect(handler.isTurnLimitReached(9, { max_session_turns: 10 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ThresholdCheckResult fields
// ---------------------------------------------------------------------------

describe("ThresholdHandler.check — result fields", () => {
  it("populates all result fields", () => {
    const state  = makeState({ percent_used: 50, tokens_used: 50_000, context_limit: 100_000 });
    const result = handler.check(state);
    expect(result.percent_used).toBe(50);
    expect(result.tokens_used).toBe(50_000);
    expect(result.context_limit).toBe(100_000);
    expect(result.warn_at).toBe(DEFAULT_WARN_PERCENT);
    expect(result.rotate_at).toBe(DEFAULT_ROTATE_PERCENT);
  });
});
