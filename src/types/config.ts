// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — divisions.yaml configuration types
 *
 * These types represent the parsed structure of the Single Source of Truth
 * (divisions.yaml). All subsystems derive their configuration from ParsedConfig.
 *
 * Source: SIDJUA-APPLY-TECH-SPEC-V1.md
 */

import type { SandboxConfig } from "../core/sandbox/types.js";


/** Supported schema versions for divisions.yaml */
export const SUPPORTED_SCHEMA_VERSIONS = ["1.0"] as const;
export type SchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];


/** Valid size preset identifiers */
export type SizePreset = "solo" | "small" | "medium" | "large" | "enterprise" | "personal";

/** Valid operational modes */
export type Mode = "personal" | "business";

/**
 * Company metadata from divisions.yaml.
 * After defaults are applied, all fields are guaranteed present.
 */
export interface Company {
  name: string;
  industry?: string;
  /** Size preset key — validated against size_presets keys or "personal" */
  size: SizePreset;
  locale: string;
  timezone: string;
  mode: Mode;
}


/**
 * Localized name for a division.
 * "en" is required; additional locale keys are optional.
 */
export interface DivisionName {
  en: string;
  [locale: string]: string;
}

/** Division head assignment */
export interface DivisionHead {
  role: string | null;
  /** agent_id or null if unassigned */
  agent: string | null;
}

/**
 * Raw division entry from divisions.yaml (pre-defaults).
 * Fields may be missing — use ParsedDivision after defaults are applied.
 */
export interface RawDivision {
  code: string;
  name: DivisionName;
  scope?: string;
  required?: boolean;
  active?: boolean;
  recommend_from?: SizePreset | null;
  head?: Partial<DivisionHead>;
}

/**
 * Division with all defaults applied.
 * Guaranteed to have every field populated after validation.
 */
export interface Division {
  code: string;
  name: DivisionName;
  scope: string;
  required: boolean;
  active: boolean;
  recommend_from: SizePreset | null;
  head: DivisionHead;
}


/** A single size preset definition */
export interface SizePresetConfig {
  recommended: string[];
  description: string;
}

/** Map of preset name → preset definition */
export type SizePresetsMap = Record<string, SizePresetConfig>;


/**
 * Fully-parsed and validated configuration.
 * This is the canonical data structure passed between apply steps.
 */
export interface ParsedConfig {
  schema_version: SchemaVersion;
  company: Company;
  mode: Mode;
  divisions: Division[];
  /** Convenience: only divisions where active === true */
  activeDivisions: Division[];
  size_presets: SizePresetsMap;
  /** Absolute path to the source divisions.yaml */
  sourcePath: string;
  /** Raw YAML content hash (SHA-256 hex) for state tracking */
  contentHash: string;
  /** Sandbox configuration (merged from yaml + defaults) */
  sandbox: SandboxConfig;
}

// Re-export for convenience so consumers don't need a second import path
export type { SandboxConfig } from "../core/sandbox/types.js";


export const DIVISION_DEFAULTS: Omit<Division, "code" | "name"> = {
  active: false,
  required: false,
  recommend_from: null,
  head: { role: null, agent: null },
  scope: "",
};

export const COMPANY_DEFAULTS: Partial<Company> = {
  locale: "en",
  timezone: "UTC",
  size: "solo",
  mode: "business",
};
