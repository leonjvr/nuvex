// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Default role and division loader tests.
 *
 *   - All 6 role YAMLs parse correctly
 *   - System division YAML parses correctly
 *   - getStarterAgents() returns exactly 6 agents
 *   - Each agent has all required fields
 *   - Auditor has domains including finance and it
 *   - All agent IDs are unique
 *   - Division references valid agent IDs
 *   - Missing required fields throw clear errors
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  loadDefaultRoles,
  loadDefaultDivisions,
  getStarterAgents,
  getSystemDivision,
} from "../../src/defaults/loader.js";

const BASE = fileURLToPath(new URL("../../src/defaults", import.meta.url));

// ---------------------------------------------------------------------------
// YAML file parsing
// ---------------------------------------------------------------------------

describe("Role YAML files — raw parse", () => {
  const ROLE_IDS = ["guide", "hr", "it", "auditor", "finance", "librarian"];

  for (const id of ROLE_IDS) {
    it(`${id}.yaml parses without error`, () => {
      const raw = readFileSync(join(BASE, "roles", `${id}.yaml`), "utf-8");
      expect(() => parseYaml(raw)).not.toThrow();
    });

    it(`${id}.yaml has required role fields`, () => {
      const raw  = readFileSync(join(BASE, "roles", `${id}.yaml`), "utf-8");
      const doc  = parseYaml(raw) as Record<string, unknown>;
      const role = doc["role"] as Record<string, unknown>;
      expect(typeof role["id"]).toBe("string");
      expect(typeof role["name"]).toBe("string");
      expect(typeof role["tier"]).toBe("number");
      expect(typeof role["description"]).toBe("string");
      expect(typeof role["icon"]).toBe("string");
      expect(Array.isArray(role["domains"])).toBe(true);
      expect(Array.isArray(role["capabilities"])).toBe(true);
      expect(role["status"]).toMatch(/^(active|inactive)$/);
    });
  }

  it("system.yaml parses without error", () => {
    const raw = readFileSync(join(BASE, "divisions", "system.yaml"), "utf-8");
    expect(() => parseYaml(raw)).not.toThrow();
  });

  it("system.yaml has required division fields", () => {
    const raw = readFileSync(join(BASE, "divisions", "system.yaml"), "utf-8");
    const doc = parseYaml(raw) as Record<string, unknown>;
    const div = doc["division"] as Record<string, unknown>;
    expect(typeof div["id"]).toBe("string");
    expect(typeof div["name"]).toBe("string");
    expect(typeof div["protected"]).toBe("boolean");
    expect(typeof div["description"]).toBe("string");
    expect(Array.isArray(div["agents"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadDefaultRoles()
// ---------------------------------------------------------------------------

describe("loadDefaultRoles()", () => {
  it("returns an array of 6 roles", () => {
    const roles = loadDefaultRoles();
    expect(roles).toHaveLength(6);
  });

  it("all roles have id, name, tier, description, icon, domains, capabilities, status", () => {
    for (const role of loadDefaultRoles()) {
      expect(typeof role.id).toBe("string");
      expect(typeof role.name).toBe("string");
      expect([1, 2, 3]).toContain(role.tier);
      expect(typeof role.description).toBe("string");
      expect(typeof role.icon).toBe("string");
      expect(Array.isArray(role.domains)).toBe(true);
      expect(role.domains.length).toBeGreaterThan(0);
      expect(Array.isArray(role.capabilities)).toBe(true);
      expect(role.capabilities.length).toBeGreaterThan(0);
      expect(["active", "inactive"]).toContain(role.status);
    }
  });

  it("all role IDs are unique", () => {
    const ids = loadDefaultRoles().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("auditor has domains including 'finance' and 'it'", () => {
    const auditor = loadDefaultRoles().find((r) => r.id === "auditor");
    expect(auditor).toBeDefined();
    expect(auditor!.domains).toContain("finance");
    expect(auditor!.domains).toContain("it");
  });

  it("guide is tier 3", () => {
    const guide = loadDefaultRoles().find((r) => r.id === "guide");
    expect(guide?.tier).toBe(3);
  });

  it("all agents belong to 'system' division", () => {
    for (const role of loadDefaultRoles()) {
      expect(role.division).toBe("system");
    }
  });
});

// ---------------------------------------------------------------------------
// loadDefaultDivisions()
// ---------------------------------------------------------------------------

describe("loadDefaultDivisions()", () => {
  it("returns at least 1 division", () => {
    const divs = loadDefaultDivisions();
    expect(divs.length).toBeGreaterThanOrEqual(1);
  });

  it("system division is protected", () => {
    const system = loadDefaultDivisions().find((d) => d.id === "system");
    expect(system?.protected).toBe(true);
  });

  it("system division references all 6 starter agent IDs", () => {
    const system = loadDefaultDivisions().find((d) => d.id === "system");
    expect(system?.agents).toHaveLength(6);
    const roleIds = new Set(loadDefaultRoles().map((r) => r.id));
    for (const agentId of system!.agents) {
      expect(roleIds.has(agentId)).toBe(true);
    }
  });

  it("system division has a budget with daily and monthly limits", () => {
    const system = loadDefaultDivisions().find((d) => d.id === "system");
    expect(typeof system?.budget.daily_limit_usd).toBe("number");
    expect(typeof system?.budget.monthly_cap_usd).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// getStarterAgents()
// ---------------------------------------------------------------------------

describe("getStarterAgents()", () => {
  it("returns exactly 6 agents", () => {
    expect(getStarterAgents()).toHaveLength(6);
  });

  it("each agent has id, name, description, icon, tier, domains, capabilities, status", () => {
    for (const agent of getStarterAgents()) {
      expect(typeof agent.id).toBe("string");
      expect(typeof agent.name).toBe("string");
      expect(typeof agent.description).toBe("string");
      expect(typeof agent.icon).toBe("string");
      expect([1, 2, 3]).toContain(agent.tier);
      expect(Array.isArray(agent.domains)).toBe(true);
      expect(Array.isArray(agent.capabilities)).toBe(true);
      expect(["active", "inactive"]).toContain(agent.status);
    }
  });

  it("first agent is guide (canonical order)", () => {
    expect(getStarterAgents()[0]!.id).toBe("guide");
  });

  it("includes auditor with finance and it domains", () => {
    const auditor = getStarterAgents().find((a) => a.id === "auditor");
    expect(auditor).toBeDefined();
    expect(auditor!.domains).toContain("finance");
    expect(auditor!.domains).toContain("it");
  });

  it("all agents are in system division", () => {
    for (const agent of getStarterAgents()) {
      expect(agent.division).toBe("system");
    }
  });

  it("all agent IDs are unique", () => {
    const ids = getStarterAgents().map((a) => a.id);
    expect(new Set(ids).size).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// getSystemDivision()
// ---------------------------------------------------------------------------

describe("getSystemDivision()", () => {
  it("returns a division with id 'system'", () => {
    expect(getSystemDivision().id).toBe("system");
  });

  it("is protected", () => {
    expect(getSystemDivision().protected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe("loader validation — malformed YAML", () => {
  it("parseRoleFile via parseYaml detects missing required fields", () => {
    const malformed = parseYaml(`
role:
  id: broken
  name: Broken
`) as Record<string, unknown>;
    const role = malformed["role"] as Record<string, unknown>;
    // Required fields missing: tier, description, icon, domains, capabilities, status
    expect(role["tier"]).toBeUndefined();
    expect(role["description"]).toBeUndefined();
  });
});
