// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — OpenClaw Import Types
 *
 * All TypeScript interfaces for OpenClaw agent configuration and SIDJUA import
 * options / results.  This module has NO runtime dependencies — pure types only.
 */


export interface OpenClawIdentity {
  name?:  string;
  theme?: string;
  emoji?: string;
}

export interface OpenClawModel {
  primary?:  string;  // e.g. "anthropic/claude-sonnet-4-5"
  fallback?: string;
}

export interface OpenClawAgent {
  workspace?: string;
  model?:     OpenClawModel;
}

export interface OpenClawSkillEntry {
  enabled?: boolean;
  env?:     Record<string, string>;
  apiKey?:  string;
}

export interface OpenClawSkills {
  entries?:      Record<string, OpenClawSkillEntry>;
  allowBundled?: string[];
  load?:         { extraDirs?: string[] };
}

export interface OpenClawChannels {
  whatsapp?: { allowFrom?: string[]; groups?: Record<string, unknown> };
  discord?:  { guilds?: Record<string, unknown> };
  telegram?: { allowFrom?: Array<string | number> };
  slack?:    Record<string, unknown>;
  signal?:   Record<string, unknown>;
}

export interface OpenClawAuthProfile {
  provider?: string;
  mode?:     string;
  email?:    string;
}

export interface OpenClawAuth {
  profiles?: Record<string, OpenClawAuthProfile>;
  order?:    Record<string, string[]>;
}

/**
 * Top-level OpenClaw config as parsed from ~/.openclaw/openclaw.json.
 * Unknown fields are ignored; missing optional fields get defaults.
 */
export interface OpenClawConfig {
  identity?: OpenClawIdentity;
  agent?:    OpenClawAgent;
  channels?: OpenClawChannels;
  skills?:   OpenClawSkills;
  env?:      Record<string, string | Record<string, string>>;
  auth?:     OpenClawAuth;
}


export interface ModelMapping {
  provider: string;
  model:    string;
}


export type SkillDisposition = "imported" | "module_required" | "skipped";

export interface SkillConvertResult {
  name:         string;
  disposition:  SkillDisposition;
  /** For module_required: which SIDJUA module is needed */
  moduleId?:    string;
  /** For imported: destination path of the converted skill file */
  destPath?:    string;
  reason?:      string;
}


export interface ExtractedCredential {
  /** Provider name, e.g. "anthropic", "openai", or module name like "discord" */
  provider: string;
  /** The actual secret value (never logged) */
  value:    string;
  /** Human-readable source description, e.g. "env.ANTHROPIC_API_KEY" */
  source:   string;
}


export interface OpenClawImportOptions {
  /** Absolute path to openclaw.json */
  configPath:  string;
  /** Absolute path to OpenClaw skills directory (auto-detected if omitted) */
  skillsPath?: string;
  /** SIDJUA workspace directory */
  workDir:     string;
  /** Preview mode — no files written, no DB changes */
  dryRun:      boolean;
  /** Skip API key migration */
  noSecrets:   boolean;
  /** Monthly budget limit in USD */
  budgetUsd:   number;
  /** Agent tier (1–3) */
  tier:        number;
  /** Division to assign the agent */
  division:    string;
  /** Override the agent name derived from OpenClaw identity */
  nameOverride?: string;
  /** Primary model override, e.g. "anthropic/claude-sonnet-4-5" */
  modelOverride?: string;
}


export interface GovernanceApplied {
  preActionEnforcement: boolean;
  auditTrail:           boolean;
  budgetPerTask:        number;
  budgetMonthly:        number;
}

export interface ImportResult {
  agent: {
    id:       string;
    name:     string;
    tier:     number;
    division: string;
    provider: string;
    model:    string;
  };
  skills: {
    imported:       string[];
    moduleRequired: Array<{ skill: string; module: string }>;
    skipped:        string[];
  };
  credentials: {
    migrated: string[];
    skipped:  string[];
  };
  channels:   string[];
  governance: GovernanceApplied;
}
