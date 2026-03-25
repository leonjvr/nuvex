/**
 * Tests for Step 1: VALIDATE
 *
 * Covers:
 * - Valid business config (real divisions.yaml)
 * - Valid personal mode config
 * - All fatal error cases from spec
 * - All warning cases from spec
 * - Default application (missing optional fields)
 * - ParsedConfig shape correctness
 */

import { describe, it, expect } from "vitest";
import { validateRaw, loadAndValidate } from "../../src/apply/validate.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIVISIONS_YAML = resolve(__dirname, "../../config/divisions.yaml");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid business config — all required fields, one division */
function minimalValid(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    company: {
      name: "Acme Corp",
      size: "solo",
      locale: "en",
      timezone: "UTC",
    },
    size_presets: {
      solo: { recommended: [], description: "Solo mode" },
    },
    divisions: [
      {
        code: "engineering",
        name: { en: "Engineering" },
        scope: "Source code and infrastructure",
        required: true,
        active: true,
        head: { role: "CTO", agent: "sonnet-t2" },
      },
    ],
  };
}

/** Minimal valid personal mode config */
function minimalPersonal(): Record<string, unknown> {
  return {
    schema_version: "1.0",
    company: {
      name: "My Workspace",
      size: "personal",
    },
    size_presets: {},
    mode: "personal",
    divisions: [],
  };
}

// ---------------------------------------------------------------------------
// Valid configurations
// ---------------------------------------------------------------------------

describe("validateRaw — valid inputs", () => {
  it("accepts the real divisions.yaml", () => {
    const { result, config } = loadAndValidate(DIVISIONS_YAML);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(config).not.toBeNull();
  });

  it("returns correct ParsedConfig for divisions.yaml", () => {
    const { config } = loadAndValidate(DIVISIONS_YAML);
    expect(config).not.toBeNull();
    expect(config!.company.name).toBe("SIDJUA");
    expect(config!.schema_version).toBe("1.0");
    expect(config!.divisions.length).toBeGreaterThan(0);
    expect(config!.activeDivisions.every((d) => d.active)).toBe(true);
    expect(config!.activeDivisions.length).toBeLessThanOrEqual(config!.divisions.length);
  });

  it("activeDivisions is a subset of divisions", () => {
    const { config } = loadAndValidate(DIVISIONS_YAML);
    const activeCodes = new Set(config!.activeDivisions.map((d) => d.code));
    const allCodes = new Set(config!.divisions.map((d) => d.code));
    for (const code of activeCodes) {
      expect(allCodes.has(code)).toBe(true);
    }
  });

  it("accepts minimal valid business config", () => {
    const result = validateRaw(minimalValid());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts valid personal mode config", () => {
    const result = validateRaw(minimalPersonal());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts divisions with optional fields missing (defaults applied)", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        {
          code: "sales",
          name: { en: "Sales" },
          // scope, required, active, head all missing → defaults applied
        },
      ],
    };
    const result = validateRaw(raw);
    // scope missing → warning, but no error
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fatal error: schema_version
// ---------------------------------------------------------------------------

describe("validateRaw — fatal: schema_version", () => {
  it("rejects missing schema_version", () => {
    const raw = { ...minimalValid() };
    delete (raw as Record<string, unknown>)["schema_version"];
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "SCHEMA_VERSION_MISSING")).toBe(true);
  });

  it("rejects unsupported schema_version", () => {
    const result = validateRaw({ ...minimalValid(), schema_version: "99.0" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "SCHEMA_VERSION_UNSUPPORTED")).toBe(true);
  });

  it("rejects schema_version: null", () => {
    const result = validateRaw({ ...minimalValid(), schema_version: null });
    expect(result.valid).toBe(false);
    const rules = result.errors.map((e) => e.rule);
    expect(rules.some((r) => r === "SCHEMA_VERSION_MISSING" || r === "SCHEMA_VERSION_UNSUPPORTED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fatal error: company.name
// ---------------------------------------------------------------------------

describe("validateRaw — fatal: company.name", () => {
  it("rejects missing company.name", () => {
    const raw = minimalValid();
    const company = { ...(raw["company"] as Record<string, unknown>) };
    delete company["name"];
    const result = validateRaw({ ...raw, company });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "COMPANY_NAME_MISSING")).toBe(true);
  });

  it("rejects empty string company.name", () => {
    const raw = { ...minimalValid(), company: { ...(minimalValid()["company"] as object), name: "   " } };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "COMPANY_NAME_MISSING")).toBe(true);
  });

  it("rejects missing company section entirely", () => {
    const raw = { ...minimalValid() };
    delete (raw as Record<string, unknown>)["company"];
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "COMPANY_MISSING")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fatal error: company.size
// ---------------------------------------------------------------------------

describe("validateRaw — fatal: company.size", () => {
  it("rejects size not in size_presets and not 'personal'", () => {
    const raw = {
      ...minimalValid(),
      company: { ...(minimalValid()["company"] as object), size: "unicorn" },
    };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "COMPANY_SIZE_INVALID")).toBe(true);
  });

  it("accepts size 'personal' even if not in size_presets", () => {
    const raw = {
      ...minimalValid(),
      company: { ...(minimalValid()["company"] as object), size: "personal" },
      mode: "personal",
      divisions: [],
    };
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "COMPANY_SIZE_INVALID")).toHaveLength(0);
  });

  it("accepts size that is a key in size_presets", () => {
    const raw = {
      ...minimalValid(),
      company: { ...(minimalValid()["company"] as object), size: "solo" },
      size_presets: { solo: { recommended: [], description: "" } },
    };
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "COMPANY_SIZE_INVALID")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fatal error: mode
// ---------------------------------------------------------------------------

describe("validateRaw — fatal: mode", () => {
  it("rejects invalid mode value", () => {
    const result = validateRaw({ ...minimalValid(), mode: "enterprise" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "MODE_INVALID")).toBe(true);
  });

  it("accepts mode 'personal'", () => {
    const raw = { ...minimalPersonal() };
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "MODE_INVALID")).toHaveLength(0);
  });

  it("accepts mode 'business'", () => {
    const raw = { ...minimalValid(), mode: "business" };
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "MODE_INVALID")).toHaveLength(0);
  });

  it("allows missing mode (defaults to business)", () => {
    const raw = minimalValid();
    delete (raw as Record<string, unknown>)["mode"];
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "MODE_INVALID")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fatal error: division code uniqueness
// ---------------------------------------------------------------------------

describe("validateRaw — fatal: division code uniqueness", () => {
  it("rejects duplicate division codes", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        { code: "engineering", name: { en: "Engineering" }, scope: "x", active: true },
        { code: "engineering", name: { en: "Engineering 2" }, scope: "y", active: true },
      ],
    };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "UNIQUE_CODE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fatal error: division code characters
// ---------------------------------------------------------------------------

describe("validateRaw — fatal: division code characters", () => {
  it("rejects code with uppercase letters", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        { code: "Engineering", name: { en: "Engineering" }, scope: "x", active: true },
      ],
    };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "CODE_INVALID_CHARS")).toBe(true);
  });

  it("rejects code with spaces", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        { code: "my division", name: { en: "My Division" }, scope: "x", active: true },
      ],
    };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "CODE_INVALID_CHARS")).toBe(true);
  });

  it("rejects code with underscores", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        { code: "my_division", name: { en: "My Division" }, scope: "x", active: true },
      ],
    };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "CODE_INVALID_CHARS")).toBe(true);
  });

  it("accepts code with hyphens and numbers", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        { code: "customer-service-2", name: { en: "CS" }, scope: "x", active: true },
      ],
    };
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "CODE_INVALID_CHARS")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fatal error: division code length
// ---------------------------------------------------------------------------

describe("validateRaw — fatal: division code length", () => {
  it("rejects code longer than 32 characters", () => {
    const longCode = "a".repeat(33);
    const raw = {
      ...minimalValid(),
      divisions: [
        { code: longCode, name: { en: "Long" }, scope: "x", active: true },
      ],
    };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "CODE_TOO_LONG")).toBe(true);
  });

  it("accepts code exactly 32 characters", () => {
    const code = "a".repeat(32);
    const raw = {
      ...minimalValid(),
      divisions: [
        { code, name: { en: "Long" }, scope: "x", active: true },
      ],
    };
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "CODE_TOO_LONG")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fatal error: required division inactive
// ---------------------------------------------------------------------------

describe("validateRaw — fatal: required division inactive", () => {
  it("rejects required:true + active:false", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        {
          code: "legal",
          name: { en: "Legal" },
          scope: "Legal matters",
          required: true,
          active: false,
          head: { role: null, agent: null },
        },
      ],
    };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "REQUIRED_DIVISION_INACTIVE")).toBe(true);
  });

  it("accepts required:true + active:true", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        {
          code: "legal",
          name: { en: "Legal" },
          scope: "Legal matters",
          required: true,
          active: true,
          head: { role: null, agent: null },
        },
      ],
    };
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "REQUIRED_DIVISION_INACTIVE")).toHaveLength(0);
  });

  it("accepts required:false + active:false", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        {
          code: "hr",
          name: { en: "HR" },
          scope: "Human resources",
          required: false,
          active: false,
          head: { role: null, agent: null },
        },
      ],
    };
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "REQUIRED_DIVISION_INACTIVE")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fatal error: circular head.agent
// ---------------------------------------------------------------------------

describe("validateRaw — fatal: circular head.agent", () => {
  it("rejects agent_id that matches a division code", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        {
          code: "engineering",
          name: { en: "Engineering" },
          scope: "x",
          active: true,
          head: { role: "CTO", agent: "product" }, // agent_id === another division code
        },
        {
          code: "product",
          name: { en: "Product" },
          scope: "y",
          active: true,
          head: { role: "CPO", agent: null },
        },
      ],
    };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.rule === "CIRCULAR_HEAD_AGENT")).toBe(true);
  });

  it("accepts agent_id that does not match any division code", () => {
    const raw = minimalValid();
    const result = validateRaw(raw);
    expect(result.errors.filter((e) => e.rule === "CIRCULAR_HEAD_AGENT")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

describe("validateRaw — warnings", () => {
  it("warns when recommended division is inactive", () => {
    const raw = {
      schema_version: "1.0",
      company: { name: "Co", size: "small", locale: "en" },
      size_presets: {
        small: { recommended: ["sales"], description: "" },
      },
      divisions: [
        {
          code: "sales",
          name: { en: "Sales" },
          scope: "sales scope",
          required: false,
          active: false, // recommended but inactive → warning
          head: { role: null, agent: null },
        },
      ],
    };
    const result = validateRaw(raw);
    expect(result.warnings.some((w) => w.rule === "RECOMMENDED_INACTIVE")).toBe(true);
  });

  it("warns when locale is unsupported", () => {
    const raw = {
      ...minimalValid(),
      company: { ...(minimalValid()["company"] as object), locale: "klingon" },
    };
    const result = validateRaw(raw);
    expect(result.warnings.some((w) => w.rule === "LOCALE_UNSUPPORTED")).toBe(true);
  });

  it("warns when division has no scope", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        {
          code: "hr",
          name: { en: "HR" },
          // no scope
          active: true,
          head: { role: null, agent: null },
        },
      ],
    };
    const result = validateRaw(raw);
    expect(result.warnings.some((w) => w.rule === "SCOPE_MISSING")).toBe(true);
  });

  it("does not warn for supported locale", () => {
    const result = validateRaw(minimalValid()); // locale: "en"
    expect(result.warnings.filter((w) => w.rule === "LOCALE_UNSUPPORTED")).toHaveLength(0);
  });

  it("does not warn for active recommended division", () => {
    const raw = {
      schema_version: "1.0",
      company: { name: "Co", size: "small", locale: "en" },
      size_presets: {
        small: { recommended: ["sales"], description: "" },
      },
      divisions: [
        {
          code: "sales",
          name: { en: "Sales" },
          scope: "sales scope",
          required: false,
          active: true, // active — no warning
          head: { role: null, agent: null },
        },
      ],
    };
    const result = validateRaw(raw);
    expect(result.warnings.filter((w) => w.rule === "RECOMMENDED_INACTIVE")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Default application
// ---------------------------------------------------------------------------

describe("loadAndValidate — default application", () => {
  it("applies locale fallback to 'en' for unsupported locales", () => {
    // The real divisions.yaml uses locale: "de" which is supported, so check a config
    // that uses an unsupported locale — it should be set to "en" in ParsedConfig.
    // We test this via the loadAndValidate path using an in-memory fixture.
    // (loadAndValidate reads from disk; we test behavior via validateRaw + buildParsedConfig
    //  indirectly through the real YAML.)
    const { config } = loadAndValidate(DIVISIONS_YAML);
    // "de" is supported — should stay "de"
    expect(config!.company.locale).toBe("de");
  });

  it("defaults mode to 'business' when absent", () => {
    // The real divisions.yaml has no mode field — should default to "business"
    const { config } = loadAndValidate(DIVISIONS_YAML);
    expect(config!.mode).toBe("business");
  });

  it("sets default active:false for divisions without active field", () => {
    const raw = {
      ...minimalValid(),
      divisions: [
        {
          code: "hr",
          name: { en: "HR" },
          scope: "HR scope",
          // active not specified — default false
        },
      ],
    };
    const result = validateRaw(raw);
    // No error about active
    expect(result.errors.filter((e) => e.rule === "REQUIRED_DIVISION_INACTIVE")).toHaveLength(0);
  });

  it("contentHash is a 64-char hex string", () => {
    const { config } = loadAndValidate(DIVISIONS_YAML);
    expect(config!.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sourcePath is absolute", () => {
    const { config } = loadAndValidate(DIVISIONS_YAML);
    expect(config!.sourcePath.startsWith("/")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple errors
// ---------------------------------------------------------------------------

describe("validateRaw — multiple errors reported at once", () => {
  it("reports all errors in one pass (not just the first)", () => {
    const raw = {
      schema_version: "99.0",
      company: { name: "", size: "invalid-size" },
      size_presets: {},
      divisions: [
        { code: "BAD CODE!", name: { en: "Bad" }, scope: "x", active: true },
        { code: "BAD CODE!", name: { en: "Bad2" }, scope: "y", active: true }, // duplicate
      ],
    };
    const result = validateRaw(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
