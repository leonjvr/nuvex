// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for Stage 0: Security Filter (dual-mode blacklist/whitelist).
 *
 * Covers:
 *   matchPattern   — exact, wildcard prefix, wildcard suffix, *
 *   matchCidr      — IPv4 ranges, bare IP, /0, /32, invalid
 *   checkSecurityFilters — blacklist mode, whitelist mode, CIDR enforcement
 *   evaluateAction  — pipeline integration (Stage 0 → Stage 1+)
 *   DEFAULT_SECURITY_CONFIG — shape and defaults
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { openDatabase, runMigrations } from "../../src/utils/db.js";
import { MIGRATIONS } from "../../src/apply/database.js";
import {
  matchPattern,
  matchCidr,
  checkSecurityFilters,
  DEFAULT_SECURITY_CONFIG,
} from "../../src/pipeline/security-filter.js";
import { evaluateAction } from "../../src/pipeline/index.js";
import type {
  ActionRequest,
  GovernanceConfig,
  SecurityFilterConfig,
} from "../../src/types/pipeline.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRequest(
  type: string,
  target: string,
  overrides: Partial<ActionRequest> = {},
): ActionRequest {
  return {
    request_id:    `req-${Date.now()}`,
    agent_id:      "agent-test",
    agent_tier:    1,
    division_code: "ENG",
    action: {
      type,
      target,
      data_classification: "PUBLIC",
    },
    context: {
      task_id:    "task-test",
      session_id: "session-test",
    },
    ...overrides,
  };
}

function makeGovernanceConfig(security?: SecurityFilterConfig): GovernanceConfig {
  const base: GovernanceConfig = {
    forbidden:      [],
    approval:       [],
    budgets:        {},
    classification: {
      levels: [
        { code: "PUBLIC",   rank: 0, description: "Public" },
        { code: "INTERNAL", rank: 1, description: "Internal" },
      ],
      agent_clearance: { tier_1: "INTERNAL", tier_2: "INTERNAL", tier_3: "INTERNAL" },
    },
    policies:    [],
    loaded_at:   new Date().toISOString(),
    file_hashes: {},
  };
  if (security !== undefined) {
    return { ...base, security: { filter: security } };
  }
  return base;
}

function makeBlacklist(
  patterns: Array<{ pattern: string; applies_to: string[]; reason: string }>,
): SecurityFilterConfig {
  return {
    mode:    "blacklist",
    blocked: patterns,
    allowed: [],
    allowed_networks: [],
  };
}

function makeWhitelist(
  patterns: Array<{ pattern: string; applies_to: string[]; reason: string }>,
  networks: string[] = [],
): SecurityFilterConfig {
  return {
    mode:             "whitelist",
    blocked:          [],
    allowed:          patterns,
    allowed_networks: networks,
  };
}

// ---------------------------------------------------------------------------
// matchPattern
// ---------------------------------------------------------------------------

describe("matchPattern", () => {
  it("matches wildcard *", () => {
    expect(matchPattern("anything.example.com", "*")).toBe(true);
    expect(matchPattern("http://x.com/foo", "*")).toBe(true);
    expect(matchPattern("", "*")).toBe(true);
  });

  it("exact match", () => {
    expect(matchPattern("api.example.com", "api.example.com")).toBe(true);
    expect(matchPattern("api.example.com", "other.example.com")).toBe(false);
    expect(matchPattern("api.example.com/v1", "api.example.com")).toBe(false);
  });

  it("wildcard prefix *.example.com — matches any subdomain", () => {
    expect(matchPattern("sub.example.com",       "*.example.com")).toBe(true);
    expect(matchPattern("deep.sub.example.com",  "*.example.com")).toBe(true);
    expect(matchPattern("example.com",           "*.example.com")).toBe(true);  // bare domain included
    expect(matchPattern("notexample.com",        "*.example.com")).toBe(false);
    expect(matchPattern("example.com.evil",      "*.example.com")).toBe(false);
  });

  it("wildcard suffix api.example.com/* — matches any path", () => {
    expect(matchPattern("api.example.com/v1/users", "api.example.com/*")).toBe(true);
    expect(matchPattern("api.example.com/",         "api.example.com/*")).toBe(true);
    expect(matchPattern("api.example.com",           "api.example.com/*")).toBe(true);  // bare host included
    expect(matchPattern("other.example.com/v1",      "api.example.com/*")).toBe(false);
    expect(matchPattern("api.example.com.evil/x",    "api.example.com/*")).toBe(false);
  });

  it("does not confuse prefix and suffix wildcards", () => {
    // "*.example.com" pattern does NOT match via suffix-wildcard "api.example.com/*"
    expect(matchPattern("*.example.com",     "api.example.com/*")).toBe(false);
    // "api.example.com" IS a valid subdomain match for "*.example.com"
    expect(matchPattern("api.example.com",   "*.example.com")).toBe(true);
    // A literal "*.example.com" string does NOT match "api.example.com/*" suffix pattern
    expect(matchPattern("api.other.com",     "*.example.com")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchCidr
// ---------------------------------------------------------------------------

describe("matchCidr", () => {
  it("bare IP — exact match", () => {
    expect(matchCidr("10.0.0.1", "10.0.0.1")).toBe(true);
    expect(matchCidr("10.0.0.2", "10.0.0.1")).toBe(false);
  });

  it("standard CIDR ranges — /8", () => {
    expect(matchCidr("10.0.0.1",   "10.0.0.0/8")).toBe(true);
    expect(matchCidr("10.255.1.1", "10.0.0.0/8")).toBe(true);
    expect(matchCidr("11.0.0.1",   "10.0.0.0/8")).toBe(false);
  });

  it("standard CIDR ranges — /16", () => {
    expect(matchCidr("192.168.1.50",  "192.168.0.0/16")).toBe(true);
    expect(matchCidr("192.168.255.1", "192.168.0.0/16")).toBe(true);
    expect(matchCidr("192.169.0.1",   "192.168.0.0/16")).toBe(false);
  });

  it("standard CIDR ranges — /24", () => {
    expect(matchCidr("172.16.0.5",  "172.16.0.0/24")).toBe(true);
    expect(matchCidr("172.16.0.255","172.16.0.0/24")).toBe(true);
    expect(matchCidr("172.16.1.0",  "172.16.0.0/24")).toBe(false);
  });

  it("/32 — exact match via CIDR", () => {
    expect(matchCidr("10.0.0.5", "10.0.0.5/32")).toBe(true);
    expect(matchCidr("10.0.0.6", "10.0.0.5/32")).toBe(false);
  });

  it("/0 — matches all IPs", () => {
    expect(matchCidr("0.0.0.0",         "0.0.0.0/0")).toBe(true);
    expect(matchCidr("255.255.255.255",  "0.0.0.0/0")).toBe(true);
    expect(matchCidr("192.168.1.1",      "0.0.0.0/0")).toBe(true);
  });

  it("handles high-bit IPs correctly (unsigned arithmetic)", () => {
    expect(matchCidr("128.0.0.1", "128.0.0.0/8")).toBe(true);
    expect(matchCidr("255.255.255.0", "255.255.255.0/24")).toBe(true);
    expect(matchCidr("192.168.0.1",   "192.168.0.0/16")).toBe(true);
  });

  it("returns false for invalid IP", () => {
    expect(matchCidr("not-an-ip",    "10.0.0.0/8")).toBe(false);
    expect(matchCidr("999.0.0.1",    "10.0.0.0/8")).toBe(false);
    expect(matchCidr("10.0.0",       "10.0.0.0/8")).toBe(false);
    expect(matchCidr("010.0.0.1",    "10.0.0.0/8")).toBe(false); // leading zero rejected
  });

  it("returns false for invalid CIDR", () => {
    expect(matchCidr("10.0.0.1", "10.0.0.0/33")).toBe(false);
    expect(matchCidr("10.0.0.1", "10.0.0.0/-1")).toBe(false);
    expect(matchCidr("10.0.0.1", "bad/8")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkSecurityFilters — blacklist mode
// ---------------------------------------------------------------------------

describe("checkSecurityFilters — blacklist mode", () => {
  it("PASS with empty blocked list", () => {
    const config: SecurityFilterConfig = { mode: "blacklist", blocked: [], allowed: [], allowed_networks: [] };
    const result = checkSecurityFilters(makeRequest("web.fetch", "safe.example.com"), config);
    expect(result.stage).toBe("security");
    expect(result.verdict).toBe("PASS");
    expect(result.rules_checked).toHaveLength(0);
  });

  it("BLOCK when target matches a blocked pattern", () => {
    const config = makeBlacklist([
      { pattern: "*.evil.com", applies_to: ["web.fetch"], reason: "Malicious domain" },
    ]);
    const result = checkSecurityFilters(makeRequest("web.fetch", "sub.evil.com"), config);
    expect(result.verdict).toBe("BLOCK");
    expect(result.rules_checked[0]?.matched).toBe(true);
    expect(result.rules_checked[0]?.reason).toBe("Malicious domain");
  });

  it("PASS when target does not match any blocked pattern", () => {
    const config = makeBlacklist([
      { pattern: "*.evil.com", applies_to: ["web.fetch"], reason: "Malicious domain" },
    ]);
    const result = checkSecurityFilters(makeRequest("web.fetch", "safe.example.com"), config);
    expect(result.verdict).toBe("PASS");
    expect(result.rules_checked[0]?.matched).toBe(false);
  });

  it("PASS when action type does not match applies_to", () => {
    const config = makeBlacklist([
      { pattern: "*.evil.com", applies_to: ["api.call"], reason: "Malicious domain" },
    ]);
    // web.fetch — not in applies_to for this entry
    const result = checkSecurityFilters(makeRequest("web.fetch", "sub.evil.com"), config);
    expect(result.verdict).toBe("PASS");
    expect(result.rules_checked).toHaveLength(0); // entry skipped entirely
  });

  it("PASS for non-network action even with blocked pattern", () => {
    const config = makeBlacklist([
      { pattern: "*", applies_to: ["web.fetch"], reason: "Block all web" },
    ]);
    // file.read is not a network action; entry applies_to doesn't match → skipped
    const result = checkSecurityFilters(makeRequest("file.read", "/etc/passwd"), config);
    expect(result.verdict).toBe("PASS");
  });

  it("checks multiple patterns and blocks on first match", () => {
    const config = makeBlacklist([
      { pattern: "*.safe.com",  applies_to: ["web.fetch"], reason: "Safe domain — PASS" },
      { pattern: "*.evil.com",  applies_to: ["web.fetch"], reason: "Evil domain" },
      { pattern: "*.other.com", applies_to: ["web.fetch"], reason: "Other domain" },
    ]);
    const result = checkSecurityFilters(makeRequest("web.fetch", "sub.evil.com"), config);
    expect(result.verdict).toBe("BLOCK");
    expect(result.rules_checked).toHaveLength(2); // first PASS, then BLOCK (short-circuit)
  });

  it("records PASS checks for non-matching patterns", () => {
    const config = makeBlacklist([
      { pattern: "*.evil.com", applies_to: ["web.fetch"], reason: "Evil" },
    ]);
    const result = checkSecurityFilters(makeRequest("web.fetch", "safe.example.com"), config);
    expect(result.verdict).toBe("PASS");
    expect(result.rules_checked[0]?.verdict).toBe("PASS");
    expect(result.rules_checked[0]?.matched).toBe(false);
  });

  it("duration_ms is non-negative", () => {
    const config: SecurityFilterConfig = { mode: "blacklist", blocked: [], allowed: [], allowed_networks: [] };
    const result = checkSecurityFilters(makeRequest("web.fetch", "example.com"), config);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// checkSecurityFilters — whitelist mode
// ---------------------------------------------------------------------------

describe("checkSecurityFilters — whitelist mode", () => {
  it("BLOCK network action when target not on allowlist", () => {
    const config = makeWhitelist([
      { pattern: "api.internal.corp", applies_to: ["web.fetch", "api.call"], reason: "Internal API only" },
    ]);
    const result = checkSecurityFilters(makeRequest("web.fetch", "external.com"), config);
    expect(result.verdict).toBe("BLOCK");
    const blocked = result.rules_checked.find((r) => r.matched);
    expect(blocked?.rule_id).toBe("security.whitelist.no_match");
  });

  it("PASS network action when target matches allowed pattern", () => {
    const config = makeWhitelist([
      { pattern: "api.internal.corp", applies_to: ["web.fetch"], reason: "Internal only" },
    ]);
    const result = checkSecurityFilters(makeRequest("web.fetch", "api.internal.corp"), config);
    expect(result.verdict).toBe("PASS");
    expect(result.rules_checked[0]?.rule_id).toBe("security.whitelist.matched");
  });

  it("PASS network action when target matches wildcard allowed pattern", () => {
    const config = makeWhitelist([
      { pattern: "*.internal.corp", applies_to: ["*"], reason: "Internal wildcard" },
    ]);
    const result = checkSecurityFilters(makeRequest("api.call", "payments.internal.corp"), config);
    expect(result.verdict).toBe("PASS");
  });

  it("PASS non-network action regardless of allowlist — whitelist only gates network actions", () => {
    const config = makeWhitelist([]); // empty allowlist
    // Non-network actions: file.read, code.execute, email.send, etc.
    expect(checkSecurityFilters(makeRequest("file.read",     "/tmp/file"), config).verdict).toBe("PASS");
    expect(checkSecurityFilters(makeRequest("code.execute",  "script.sh"), config).verdict).toBe("PASS");
    expect(checkSecurityFilters(makeRequest("email.send",    "user@co"), config).verdict).toBe("PASS");
  });

  it("BLOCK web.post not on allowlist in whitelist mode", () => {
    const config = makeWhitelist([
      { pattern: "api.trusted.com", applies_to: ["web.post"], reason: "Trusted" },
    ]);
    const result = checkSecurityFilters(makeRequest("web.post", "api.untrusted.com"), config);
    expect(result.verdict).toBe("BLOCK");
  });

  it("PASS web.post on allowlist with correct applies_to", () => {
    const config = makeWhitelist([
      { pattern: "api.trusted.com", applies_to: ["web.post"], reason: "Trusted" },
    ]);
    const result = checkSecurityFilters(makeRequest("web.post", "api.trusted.com"), config);
    expect(result.verdict).toBe("PASS");
  });

  it("applies_to filter respected in whitelist allowed entries", () => {
    const config = makeWhitelist([
      { pattern: "api.trusted.com", applies_to: ["api.call"], reason: "Trusted for api.call only" },
    ]);
    // web.fetch to same target — entry doesn't apply (applies_to = api.call only)
    const result = checkSecurityFilters(makeRequest("web.fetch", "api.trusted.com"), config);
    expect(result.verdict).toBe("BLOCK"); // no matching allowed entry for web.fetch
  });

  it("empty allowed list blocks all network actions in whitelist mode", () => {
    const config: SecurityFilterConfig = { mode: "whitelist", blocked: [], allowed: [], allowed_networks: [] };
    expect(checkSecurityFilters(makeRequest("web.fetch",  "anything.com"), config).verdict).toBe("BLOCK");
    expect(checkSecurityFilters(makeRequest("api.call",   "anything.com"), config).verdict).toBe("BLOCK");
    expect(checkSecurityFilters(makeRequest("web.post",   "anything.com"), config).verdict).toBe("BLOCK");
  });
});

// ---------------------------------------------------------------------------
// checkSecurityFilters — CIDR enforcement
// ---------------------------------------------------------------------------

describe("checkSecurityFilters — CIDR enforcement", () => {
  it("PASS when no allowed_networks configured (CIDR check skipped)", () => {
    const config: SecurityFilterConfig = { mode: "blacklist", blocked: [], allowed: [], allowed_networks: [] };
    const result = checkSecurityFilters(makeRequest("web.fetch", "10.0.0.1"), config);
    expect(result.verdict).toBe("PASS");
  });

  it("BLOCK IP outside allowed CIDR", () => {
    const config: SecurityFilterConfig = {
      mode: "blacklist", blocked: [], allowed: [],
      allowed_networks: ["10.0.0.0/8"],
    };
    const result = checkSecurityFilters(makeRequest("web.fetch", "192.168.1.5"), config);
    expect(result.verdict).toBe("BLOCK");
    const blocked = result.rules_checked.find((r) => r.matched);
    expect(blocked?.rule_id).toBe("security.network.cidr_block");
  });

  it("PASS IP inside allowed CIDR", () => {
    const config: SecurityFilterConfig = {
      mode: "blacklist", blocked: [], allowed: [],
      allowed_networks: ["10.0.0.0/8"],
    };
    const result = checkSecurityFilters(makeRequest("web.fetch", "10.5.3.1"), config);
    expect(result.verdict).toBe("PASS");
    const ok = result.rules_checked.find((r) => r.rule_id === "security.network.cidr_ok");
    expect(ok).toBeDefined();
  });

  it("PASS when target is a hostname (not an IP) — CIDR check skipped for hostnames", () => {
    const config: SecurityFilterConfig = {
      mode: "blacklist", blocked: [], allowed: [],
      allowed_networks: ["10.0.0.0/8"],
    };
    // hostname — CIDR check doesn't apply
    const result = checkSecurityFilters(makeRequest("web.fetch", "api.example.com"), config);
    expect(result.verdict).toBe("PASS");
  });

  it("extracts IP from URL target for CIDR check", () => {
    const config: SecurityFilterConfig = {
      mode: "blacklist", blocked: [], allowed: [],
      allowed_networks: ["10.0.0.0/8"],
    };
    // URL with IP host — IP extracted and checked
    const result = checkSecurityFilters(makeRequest("web.fetch", "http://10.5.3.1/path"), config);
    expect(result.verdict).toBe("PASS");
  });

  it("blocks URL with IP host outside CIDR", () => {
    const config: SecurityFilterConfig = {
      mode: "blacklist", blocked: [], allowed: [],
      allowed_networks: ["10.0.0.0/8"],
    };
    const result = checkSecurityFilters(makeRequest("web.fetch", "http://192.168.1.1/api"), config);
    expect(result.verdict).toBe("BLOCK");
  });

  it("PASS IP matching one of multiple allowed networks", () => {
    const config: SecurityFilterConfig = {
      mode: "blacklist", blocked: [], allowed: [],
      allowed_networks: ["10.0.0.0/8", "192.168.0.0/16"],
    };
    expect(checkSecurityFilters(makeRequest("web.fetch", "192.168.5.1"), config).verdict).toBe("PASS");
    expect(checkSecurityFilters(makeRequest("web.fetch", "10.1.2.3"),    config).verdict).toBe("PASS");
    expect(checkSecurityFilters(makeRequest("web.fetch", "172.16.0.1"),  config).verdict).toBe("BLOCK");
  });

  it("CIDR check skipped for non-network actions", () => {
    const config: SecurityFilterConfig = {
      mode: "blacklist", blocked: [], allowed: [],
      allowed_networks: ["10.0.0.0/8"],
    };
    const result = checkSecurityFilters(makeRequest("file.read", "192.168.1.1"), config);
    expect(result.verdict).toBe("PASS"); // not a network action
  });
});

// ---------------------------------------------------------------------------
// Integration with evaluateAction pipeline
// ---------------------------------------------------------------------------

describe("evaluateAction — Stage 0 security filter integration", () => {
  let db: ReturnType<typeof openDatabase>;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(`${tmpdir()}/sidjua-sec-test-`);
    db = openDatabase(":memory:");
    runMigrations(db, MIGRATIONS);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("BLOCK verdict sets blocking_stage = 'security'", () => {
    const governance = makeGovernanceConfig(
      makeBlacklist([{ pattern: "*.evil.com", applies_to: ["web.fetch"], reason: "Blocked" }]),
    );
    const result = evaluateAction(makeRequest("web.fetch", "sub.evil.com"), governance, db);
    expect(result.verdict).toBe("BLOCK");
    expect(result.blocking_stage).toBe("security");
    expect(result.stage_results[0]?.stage).toBe("security");
  });

  it("ALLOW verdict when security passes and all other stages pass", () => {
    const governance = makeGovernanceConfig(
      makeBlacklist([{ pattern: "*.evil.com", applies_to: ["web.fetch"], reason: "Blocked" }]),
    );
    const result = evaluateAction(makeRequest("web.fetch", "safe.example.com"), governance, db);
    expect(result.verdict).toBe("ALLOW");
    // Stage 0 is present in stage_results
    expect(result.stage_results[0]?.stage).toBe("security");
  });

  it("absent security config → Stage 0 skipped (5 stage_results instead of 6)", () => {
    const governance = makeGovernanceConfig(); // no security config
    const result = evaluateAction(makeRequest("web.fetch", "example.com"), governance, db);
    expect(result.verdict).toBe("ALLOW");
    // No security stage in results
    const stages = result.stage_results.map((s) => s.stage);
    expect(stages).not.toContain("security");
  });

  it("writes audit trail entry on BLOCK", () => {
    const governance = makeGovernanceConfig(
      makeBlacklist([{ pattern: "*", applies_to: ["web.fetch"], reason: "Block all" }]),
    );
    const result = evaluateAction(makeRequest("web.fetch", "anything.com"), governance, db);
    expect(result.verdict).toBe("BLOCK");
    expect(result.audit_entry_id).toBeGreaterThan(0);
  });

  it("whitelist BLOCK also produces correct audit entry", () => {
    const governance = makeGovernanceConfig(makeWhitelist([]));
    const result = evaluateAction(makeRequest("web.fetch", "external.com"), governance, db);
    expect(result.verdict).toBe("BLOCK");
    expect(result.blocking_stage).toBe("security");
    expect(result.audit_entry_id).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SECURITY_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_SECURITY_CONFIG", () => {
  it("has blacklist mode", () => {
    expect(DEFAULT_SECURITY_CONFIG.filter.mode).toBe("blacklist");
  });

  it("has empty blocked list", () => {
    expect(DEFAULT_SECURITY_CONFIG.filter.blocked).toEqual([]);
  });

  it("has empty allowed list", () => {
    expect(DEFAULT_SECURITY_CONFIG.filter.allowed).toEqual([]);
  });

  it("has empty allowed_networks list", () => {
    expect(DEFAULT_SECURITY_CONFIG.filter.allowed_networks).toEqual([]);
  });

  it("passes all actions through (empty blacklist = no blocks)", () => {
    const config = DEFAULT_SECURITY_CONFIG.filter;
    expect(checkSecurityFilters(makeRequest("web.fetch", "any.target.com"), config).verdict).toBe("PASS");
    expect(checkSecurityFilters(makeRequest("api.call",  "any.target.com"), config).verdict).toBe("PASS");
    expect(checkSecurityFilters(makeRequest("file.read", "/etc/passwd"),    config).verdict).toBe("PASS");
  });
});
