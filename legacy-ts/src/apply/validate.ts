// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Step 1: VALIDATE
 *
 * Parses divisions.yaml, applies defaults, and validates all rules from spec.
 * Returns a ValidationResult (errors + warnings) and — when valid — a ParsedConfig.
 *
 * Usage:
 *   const { config, result } = loadAndValidate("./divisions.yaml");
 *   if (!result.valid) throw new ApplyError("VALIDATION_ERROR", "VALIDATE", ...);
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type Company,
  type Division,
  type DivisionHead,
  type DivisionName,
  type Mode,
  type ParsedConfig,
  type SchemaVersion,
  type SizePreset,
  type SizePresetsMap,
  COMPANY_DEFAULTS,
  DIVISION_DEFAULTS,
  SUPPORTED_SCHEMA_VERSIONS,
} from "../types/config.js";
import type { ValidationError, ValidationResult, ValidationWarning } from "../types/apply.js";
import { parse as parseYaml } from "yaml";
import { readYamlFileWithHash, sha256 } from "../utils/yaml.js";
import {
  type SandboxConfig,
  DEFAULT_SANDBOX_CONFIG,
} from "../core/sandbox/index.js";


/** Pattern for valid division codes */
const CODE_PATTERN = /^[a-z0-9-]+$/;
const MAX_CODE_LENGTH = 32;

/**
 * Locales with first-class support. Others trigger a LOCALE_UNSUPPORTED warning.
 * Not exhaustive — just a reasonable baseline for V1.
 */
const SUPPORTED_LOCALES = new Set([
  "en", "de", "fr", "es", "ja", "zh", "pt", "it", "nl", "pl",
  "ru", "ko", "ar", "hi", "sv", "da", "no", "fi", "tr", "cs",
  "sk", "hu", "ro", "bg", "hr", "uk", "id", "ms", "th", "vi", "he", "el",
]);


/**
 * Read a divisions.yaml file, validate it, and — if valid — return the
 * parsed configuration ready for use by subsequent apply steps.
 *
 * @param configPath Path to divisions.yaml (absolute or relative to cwd)
 * @returns { config, result } — check result.valid before using config
 * @throws {Error} if the file cannot be read or is not parseable YAML
 */
export function loadAndValidate(configPath: string): {
  config: ParsedConfig | null;
  result: ValidationResult;
} {
  const { parsed, contentHash, absolutePath } = readYamlFileWithHash(configPath);
  const result = validateRaw(parsed);
  if (!result.valid) {
    return { config: null, result };
  }
  const config = buildParsedConfig(parsed as RawYaml, absolutePath, contentHash);
  return { config, result };
}

/**
 * Load and validate a directory of per-division YAML files.
 *
 * Each file must have a top-level `division:` key with fields:
 *   id, name, description, protected (bool), budget.daily_limit_usd,
 *   budget.monthly_cap_usd, agents[]
 *
 * Returns a synthetic ParsedConfig with personal-mode defaults so all
 * existing apply steps work unchanged.
 *
 * @param dirPath Absolute path to a directory containing *.yaml files
 */
export async function loadAndValidateDir(dirPath: string): Promise<{
  config: ParsedConfig | null;
  result: ValidationResult;
}> {
  const errors: ValidationError[]   = [];
  const warnings: ValidationWarning[] = [];

  let entries: string[];
  try {
    entries = (await readdir(dirPath)).filter((f) => f.endsWith(".yaml")).sort();
  } catch (err: unknown) {
    errors.push({
      field: "(directory)",
      rule: "DIR_READ_FAILED",
      message: `Cannot read divisions directory: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { config: null, result: { valid: false, errors, warnings } };
  }

  if (entries.length === 0) {
    errors.push({
      field: "(directory)",
      rule: "DIR_EMPTY",
      message: `No *.yaml files found in ${dirPath}`,
    });
    return { config: null, result: { valid: false, errors, warnings } };
  }

  const divisions: Division[] = [];
  const rawContents: string[] = [];

  for (const filename of entries) {
    const filePath = join(dirPath, filename);
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (err: unknown) {
      errors.push({
        field: filename,
        rule: "FILE_READ_FAILED",
        message: `Cannot read ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    rawContents.push(content);

    let doc: unknown;
    try {
      doc = parseYaml(content);
    } catch (err: unknown) {
      errors.push({
        field: filename,
        rule: "YAML_PARSE_ERROR",
        message: `Invalid YAML in ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    if (!isObject(doc)) {
      errors.push({
        field: filename,
        rule: "INVALID_STRUCTURE",
        message: `${filename} must be a YAML mapping`,
      });
      continue;
    }

    const divRaw = (doc as Record<string, unknown>)["division"];
    if (!isObject(divRaw)) {
      errors.push({
        field: `${filename}.division`,
        rule: "DIVISION_MISSING",
        message: `${filename} must have a top-level "division:" key`,
      });
      continue;
    }

    const d = divRaw as Record<string, unknown>;
    const id = isNonEmptyString(d["id"]) ? d["id"] : "";
    if (!id) {
      errors.push({ field: `${filename}.division.id`, rule: "DIVISION_ID_MISSING", message: `${filename}: division.id is required` });
      continue;
    }

    const div: Division = {
      code:           id,
      name:           buildDivisionName(d["name"]),
      scope:          isString(d["description"]) ? d["description"] : "",
      required:       d["protected"] === true,
      active:         true,
      recommend_from: null,
      head:           { role: null, agent: null },
    };
    divisions.push(div);
  }

  if (errors.length > 0) {
    return { config: null, result: { valid: false, errors, warnings } };
  }

  const contentHash = sha256(rawContents.join("\n---\n"));

  const company: Company = {
    name:     "My AI Workspace",
    locale:   COMPANY_DEFAULTS.locale   ?? "en",
    timezone: COMPANY_DEFAULTS.timezone ?? "UTC",
    size:     "personal",
    mode:     "personal",
  };

  const config: ParsedConfig = {
    schema_version: "1.0" as SchemaVersion,
    company,
    mode:             "personal",
    divisions,
    activeDivisions:  divisions.filter((d) => d.active),
    size_presets:     {} as SizePresetsMap,
    sourcePath:       dirPath,
    contentHash,
    sandbox:          { ...DEFAULT_SANDBOX_CONFIG },
  };

  return { config, result: { valid: true, errors: [], warnings } };
}


/**
 * Validate a raw (already-parsed) YAML value against the divisions.yaml schema.
 * Does not read from disk — useful for unit testing with inline fixtures.
 *
 * @param raw The value returned by `yaml.parse()`
 */
export function validateRaw(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!isObject(raw)) {
    errors.push({
      field: "(root)",
      rule: "INVALID_STRUCTURE",
      message: "divisions.yaml must be a YAML mapping at the top level",
    });
    return { valid: false, errors, warnings };
  }

  checkSchemaVersion(raw, errors);
  checkCompany(raw, errors, warnings);
  checkMode(raw, errors);
  checkDivisions(raw, errors, warnings);

  return { valid: errors.length === 0, errors, warnings };
}


/** Loose shape of what we expect at the top level before full validation */
type RawYaml = Record<string, unknown>;


function checkSchemaVersion(raw: RawYaml, errors: ValidationError[]): void {
  const v = raw["schema_version"];
  if (v === null || v === undefined) {
    errors.push({
      field: "schema_version",
      rule: "SCHEMA_VERSION_MISSING",
      message: "schema_version is required",
    });
    return;
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(String(v) as SchemaVersion)) {
    errors.push({
      field: "schema_version",
      rule: "SCHEMA_VERSION_UNSUPPORTED",
      message: `schema_version "${v}" is not supported. Supported: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`,
    });
  }
}

function checkCompany(
  raw: RawYaml,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  const company = raw["company"];
  if (!isObject(company)) {
    errors.push({
      field: "company",
      rule: "COMPANY_MISSING",
      message: "company section is required",
    });
    return;
  }

  // company.name required
  if (!isNonEmptyString(company["name"])) {
    errors.push({
      field: "company.name",
      rule: "COMPANY_NAME_MISSING",
      message: "company.name is required and must be a non-empty string",
    });
  }

  // company.locale warning if unsupported
  const locale = isNonEmptyString(company["locale"]) ? company["locale"] : COMPANY_DEFAULTS.locale!;
  if (!SUPPORTED_LOCALES.has(locale)) {
    warnings.push({
      field: "company.locale",
      rule: "LOCALE_UNSUPPORTED",
      message: `Locale "${locale}" is not in the supported list — falling back to "en"`,
    });
  }

  // company.size — validated against size_presets keys + "personal"
  const sizePresets = raw["size_presets"];
  const validSizes = new Set<string>(["personal"]);
  if (isObject(sizePresets)) {
    for (const key of Object.keys(sizePresets)) {
      validSizes.add(key);
    }
  }
  const size = company["size"];
  if (size !== null && size !== undefined) {
    if (!isString(size) || !validSizes.has(size)) {
      errors.push({
        field: "company.size",
        rule: "COMPANY_SIZE_INVALID",
        message: `company.size "${size}" must be one of: ${[...validSizes].sort().join(", ")}`,
      });
    }
  }
}

function checkMode(raw: RawYaml, errors: ValidationError[]): void {
  // mode is optional; if present at top-level or inside company, must be valid
  const topLevelMode = raw["mode"];
  const company = raw["company"];
  const companyMode = isObject(company) ? company["mode"] : undefined;
  const effectiveMode = topLevelMode ?? companyMode;

  if (effectiveMode !== null && effectiveMode !== undefined) {
    if (effectiveMode !== "personal" && effectiveMode !== "business") {
      errors.push({
        field: "mode",
        rule: "MODE_INVALID",
        message: `mode "${effectiveMode}" must be "personal" or "business"`,
      });
    }
  }
}

function checkDivisions(
  raw: RawYaml,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  const divisions = raw["divisions"];

  // personal mode may omit divisions
  const mode = resolveMode(raw);
  if (mode === "personal") {
    // divisions optional in personal mode
    if (divisions !== null && divisions !== undefined && !isArray(divisions)) {
      errors.push({
        field: "divisions",
        rule: "DIVISIONS_NOT_ARRAY",
        message: "divisions must be an array",
      });
    }
    return;
  }

  if (!isArray(divisions)) {
    errors.push({
      field: "divisions",
      rule: "DIVISIONS_NOT_ARRAY",
      message: "divisions must be an array",
    });
    return;
  }

  const seenCodes = new Set<string>();
  const agentToDivisions = new Map<string, string[]>();

  for (let i = 0; i < divisions.length; i++) {
    const div = divisions[i];
    const prefix = `divisions[${i}]`;

    if (!isObject(div)) {
      errors.push({
        field: prefix,
        rule: "DIVISION_NOT_OBJECT",
        message: `${prefix} must be a mapping`,
      });
      continue;
    }

    const code = div["code"];

    // code: must be a string
    if (!isNonEmptyString(code)) {
      errors.push({
        field: `${prefix}.code`,
        rule: "CODE_MISSING",
        message: `${prefix}.code is required`,
      });
      continue;
    }

    // code: characters outside [a-z0-9-]
    if (!CODE_PATTERN.test(code)) {
      errors.push({
        field: `${prefix}.code`,
        rule: "CODE_INVALID_CHARS",
        message: `Division code "${code}" contains invalid characters. Only [a-z0-9-] allowed`,
      });
    }

    // code: length > 32
    if (code.length > MAX_CODE_LENGTH) {
      errors.push({
        field: `${prefix}.code`,
        rule: "CODE_TOO_LONG",
        message: `Division code "${code}" exceeds ${MAX_CODE_LENGTH} characters (length: ${code.length})`,
      });
    }

    // code: uniqueness
    if (seenCodes.has(code)) {
      errors.push({
        field: `${prefix}.code`,
        rule: "UNIQUE_CODE",
        message: `Division code "${code}" is not unique`,
      });
    } else {
      seenCodes.add(code);
    }

    // required: true + active: false → fatal
    const required = div["required"] === true;
    const active = div["active"] !== false; // default true in practice — but spec says default false
    // Actually spec default is active: false. A required division must be active.
    const activeValue = div["active"];
    const isActive = activeValue === true || (activeValue === null || activeValue === undefined
      ? DIVISION_DEFAULTS.active
      : activeValue === true);

    if (required && !isActive) {
      errors.push({
        field: `${prefix}`,
        rule: "REQUIRED_DIVISION_INACTIVE",
        message: `Division "${code}" is required (required: true) but is not active. Required divisions must be active.`,
      });
    }

    // scope: warn if missing on a non-empty-named division (custom division)
    const scope = div["scope"];
    if (scope === null || scope === undefined || (isString(scope) && scope.trim() === "")) {
      warnings.push({
        field: `${prefix}.scope`,
        rule: "SCOPE_MISSING",
        message: `Division "${code}" has no scope defined`,
      });
    }

    // head.agent: track for circular reference check
    const head = div["head"];
    if (isObject(head)) {
      const agent = head["agent"];
      if (isNonEmptyString(agent)) {
        const existing = agentToDivisions.get(agent) ?? [];
        existing.push(code);
        agentToDivisions.set(agent, existing);
      }
    }
  }

  // Circular head.agent check:
  // Fatal if a division code is the same as an agent_id that heads another division.
  // (Agent named "engineering" heads division "product" while "engineering" is also a division
  //  creates a circular governance reference.)
  for (const [agentId, divCodes] of agentToDivisions) {
    if (seenCodes.has(agentId)) {
      errors.push({
        field: "divisions[*].head.agent",
        rule: "CIRCULAR_HEAD_AGENT",
        message: `Agent "${agentId}" is used as head.agent but "${agentId}" is also a division code — circular governance reference`,
      });
    }
    // Warn if agent heads 0 divisions (can't happen — we only add when found) — skip
    void divCodes; // used for tracking, no further check needed in V1
  }

  // Recommended-but-inactive warnings
  checkRecommendedInactive(raw, seenCodes, warnings);

  // head.agent unknown agent warning — in V1 we have no agent registry,
  // so we emit a warning only for obviously malformed agent IDs (empty string, etc.)
  for (let i = 0; i < divisions.length; i++) {
    const div = divisions[i];
    if (!isObject(div)) continue;
    const head = div["head"];
    if (isObject(head) && head["agent"] !== null && head["agent"] !== undefined) {
      const agent = head["agent"];
      if (!isNonEmptyString(agent)) {
        warnings.push({
          field: `divisions[${i}].head.agent`,
          rule: "HEAD_AGENT_INVALID",
          message: `divisions[${i}].head.agent must be a non-empty string or null`,
        });
      }
    }
  }
}

function checkRecommendedInactive(
  raw: RawYaml,
  seenCodes: Set<string>,
  warnings: ValidationWarning[],
): void {
  const company = raw["company"];
  if (!isObject(company)) return;

  const size = isString(company["size"]) ? company["size"] : null;
  if (!size) return;

  const sizePresets = raw["size_presets"];
  if (!isObject(sizePresets)) return;

  const preset = sizePresets[size];
  if (!isObject(preset)) return;

  const recommended = preset["recommended"];
  if (!isArray(recommended)) return;

  const divisions = raw["divisions"];
  if (!isArray(divisions)) return;

  const inactiveMap = new Map<string, boolean>();
  for (const div of divisions) {
    if (!isObject(div)) continue;
    const code = div["code"];
    if (!isNonEmptyString(code)) continue;
    const activeValue = div["active"];
    const isActive = activeValue === true || (activeValue === null || activeValue === undefined
      ? DIVISION_DEFAULTS.active
      : false);
    inactiveMap.set(code, !isActive);
  }

  for (const rec of recommended) {
    if (!isString(rec)) continue;
    if (!seenCodes.has(rec)) continue; // division not defined — different check
    const isInactive = inactiveMap.get(rec) ?? true;
    if (isInactive) {
      warnings.push({
        field: `size_presets.${size}.recommended`,
        rule: "RECOMMENDED_INACTIVE",
        message: `Division "${rec}" is recommended for size "${size}" but is not active`,
      });
    }
  }
}


function buildParsedConfig(
  raw: RawYaml,
  absolutePath: string,
  contentHash: string,
): ParsedConfig {
  const schemaVersion = String(raw["schema_version"]) as SchemaVersion;
  const rawCompany = raw["company"] as RawYaml;
  const sizePresets = buildSizePresets(raw["size_presets"]);
  const mode = resolveMode(raw);
  const company = buildCompany(rawCompany, mode);
  const rawDivisions = isArray(raw["divisions"]) ? (raw["divisions"] as unknown[]) : [];
  const divisions = rawDivisions
    .filter((d) => isObject(d))
    .map((d, i) => buildDivision(d as RawYaml, i));

  const activeDivisions = divisions.filter((d) => d.active);

  const sandbox = buildSandboxConfig(raw["sandbox"]);

  return {
    schema_version: schemaVersion,
    company,
    mode,
    divisions,
    activeDivisions,
    size_presets: sizePresets,
    sourcePath: absolutePath,
    contentHash,
    sandbox,
  };
}


function isValidSandboxProvider(value: string): value is "none" | "bubblewrap" {
  return value === "none" || value === "bubblewrap";
}

function buildSandboxConfig(raw: unknown): SandboxConfig {
  if (!isObject(raw)) {
    return { ...DEFAULT_SANDBOX_CONFIG };
  }

  const rawObj = raw as RawYaml;
  const providerRaw = rawObj["provider"];
  let provider: "none" | "bubblewrap" = DEFAULT_SANDBOX_CONFIG.provider;

  if (typeof providerRaw === "string") {
    if (isValidSandboxProvider(providerRaw)) {
      provider = providerRaw;
    }
    // Invalid provider value — silently fall back to default (warning logged by createSandboxProvider)
  }

  const rawDefaults = isObject(rawObj["defaults"]) ? (rawObj["defaults"] as RawYaml) : {};
  const rawNetwork  = isObject(rawDefaults["network"])    ? (rawDefaults["network"] as RawYaml)    : {};
  const rawFs       = isObject(rawDefaults["filesystem"]) ? (rawDefaults["filesystem"] as RawYaml) : {};

  const def = DEFAULT_SANDBOX_CONFIG.defaults;

  return {
    provider,
    defaults: {
      network: {
        allowedDomains: toStringArray(rawNetwork["allowedDomains"]) ?? def.network.allowedDomains,
        deniedDomains:  toStringArray(rawNetwork["deniedDomains"])  ?? def.network.deniedDomains,
      },
      filesystem: {
        denyRead:   toStringArray(rawFs["denyRead"])   ?? def.filesystem.denyRead,
        allowWrite: toStringArray(rawFs["allowWrite"]) ?? def.filesystem.allowWrite,
        denyWrite:  toStringArray(rawFs["denyWrite"])  ?? def.filesystem.denyWrite,
      },
    },
  };
}

function toStringArray(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null;
  return (val as unknown[]).filter((v) => typeof v === "string") as string[];
}

function buildCompany(raw: RawYaml, resolvedMode: Mode): Company {
  const name = String(raw["name"]);
  const size = isNonEmptyString(raw["size"]) ? (raw["size"] as SizePreset) : COMPANY_DEFAULTS.size!;
  const locale = isNonEmptyString(raw["locale"])
    ? raw["locale"]
    : COMPANY_DEFAULTS.locale!;
  const timezone = isNonEmptyString(raw["timezone"])
    ? raw["timezone"]
    : COMPANY_DEFAULTS.timezone!;
  const industry = isNonEmptyString(raw["industry"]) ? raw["industry"] : undefined;

  const company: Company = {
    name,
    size: resolvedMode === "personal" ? ("personal" as SizePreset) : size,
    locale: SUPPORTED_LOCALES.has(locale) ? locale : "en",
    timezone,
    mode: resolvedMode,
  };
  if (industry !== undefined) {
    company.industry = industry;
  }
  return company;
}

function buildDivision(raw: RawYaml, index: number): Division {
  const code = isNonEmptyString(raw["code"]) ? raw["code"] : `division-${index}`;
  const name = buildDivisionName(raw["name"]);
  const scope = isString(raw["scope"]) ? raw["scope"] : DIVISION_DEFAULTS.scope;
  const required =
    raw["required"] === true ? true : raw["required"] === false ? false : DIVISION_DEFAULTS.required;
  const active =
    raw["active"] === true ? true : raw["active"] === false ? false : DIVISION_DEFAULTS.active;
  const recommend_from = isNonEmptyString(raw["recommend_from"])
    ? (raw["recommend_from"] as SizePreset)
    : DIVISION_DEFAULTS.recommend_from;
  const head = buildHead(raw["head"]);

  return { code, name, scope, required, active, recommend_from, head };
}

function buildDivisionName(raw: unknown): DivisionName {
  if (isObject(raw) && isNonEmptyString(raw["en"])) {
    const result: DivisionName = { en: raw["en"] };
    for (const [k, v] of Object.entries(raw)) {
      if (k !== "en" && isNonEmptyString(v)) {
        result[k] = v;
      }
    }
    return result;
  }
  // Fallback: if name is a plain string, use it as "en"
  if (isNonEmptyString(raw)) {
    return { en: raw };
  }
  return { en: "(unnamed)" };
}

function buildHead(raw: unknown): DivisionHead {
  if (!isObject(raw)) {
    return { role: null, agent: null };
  }
  const role = isNonEmptyString(raw["role"]) ? raw["role"] : null;
  const agent = isNonEmptyString(raw["agent"]) ? raw["agent"] : null;
  return { role, agent };
}

function buildSizePresets(raw: unknown): SizePresetsMap {
  if (!isObject(raw)) return {};
  const result: SizePresetsMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isObject(value)) continue;
    const recommended = isArray(value["recommended"])
      ? (value["recommended"] as unknown[]).filter(isString)
      : [];
    const description = isString(value["description"]) ? value["description"] : "";
    result[key] = { recommended, description };
  }
  return result;
}


/**
 * Resolve the effective mode.
 * Priority: top-level `mode` field > company.mode > company.size === "personal" > default "business"
 */
function resolveMode(raw: RawYaml): Mode {
  const topLevel = raw["mode"];
  if (topLevel === "personal" || topLevel === "business") return topLevel;

  const company = raw["company"];
  if (isObject(company)) {
    const cm = company["mode"];
    if (cm === "personal" || cm === "business") return cm;
    const size = company["size"];
    if (size === "personal") return "personal";
  }

  return COMPANY_DEFAULTS.mode as Mode;
}


function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
