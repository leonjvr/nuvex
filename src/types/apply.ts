// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — sidjua apply step types
 *
 * Types for each of the 11 provisioning steps executed by `sidjua apply`.
 * Also includes shared error/result types, RBAC, routing, and cost center types.
 *
 * Source: SIDJUA-APPLY-TECH-SPEC-V1.md
 */

/** Canonical number of apply steps (VALIDATE → FILESYSTEM → DATABASE → AGENTS →
 *  SECRETS → RBAC → ROUTING → SKILLS → AUDIT → COST_CENTERS → FINALIZE). */
export const APPLY_STEP_COUNT = 11;

import type { Division, ParsedConfig } from "./config.js";


export interface ValidationError {
  /** YAML field path, e.g. "divisions[3].code" */
  field: string;
  /** Rule identifier, e.g. "UNIQUE_CODE" */
  rule: string;
  message: string;
}

export interface ValidationWarning {
  /** YAML field path */
  field: string;
  /** Rule identifier */
  rule: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  /** Fatal errors — abort apply */
  errors: ValidationError[];
  /** Non-fatal warnings — log and continue */
  warnings: ValidationWarning[];
}


export type FilesystemOpType = "mkdir" | "write" | "copy_template" | "skip_existing";

export interface FilesystemOp {
  type: FilesystemOpType;
  /** Absolute path */
  path: string;
  /** Content for "write" operations */
  content?: string;
  /** Template identifier for "copy_template" operations */
  template?: string;
  /** false = skip if exists (idempotent); true = always write */
  overwrite: boolean;
}

export interface FilesystemResult {
  ops: FilesystemOp[];
  created: number;
  skipped: number;
  written: number;
}


export interface Migration {
  version: string;
  /** SQL to apply */
  up: string;
  /** SQL to rollback */
  down: string;
  description: string;
}

export interface DatabaseResult {
  tablesCreated: number;
  migrationsApplied: number;
  divisionsSynced: number;
  budgetsInitialized: number;
}


/** V1: "sqlite" (AES-256-GCM). V2 planned: "infisical". */
export type SecretsProviderType = "sqlite" | "infisical";

export interface SecretsConfig {
  provider: SecretsProviderType;
  /** SQLite + AES-256-GCM: path to secrets DB (default: .system/secrets.db) */
  db_path?: string;
  /** Infisical (Enterprise V2+) */
  infisical_url?: string;
  infisical_token?: string;
}

export interface SecretMetadata {
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  last_accessed_by: string;
  rotation_age_days: number;
  version: number;
}

/**
 * Abstract secrets provider interface.
 * V1 implementation: SQLite + AES-256-GCM. V2 planned: Infisical.
 */
export interface SecretsProvider {
  init(config: SecretsConfig): Promise<void>;
  get(namespace: string, key: string): Promise<string | null>;
  set(namespace: string, key: string, value: string): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string): Promise<string[]>;
  ensureNamespace(namespace: string): Promise<void>;
  rotate(namespace: string, key: string, newValue: string): Promise<void>;
  getMetadata(namespace: string, key: string): Promise<SecretMetadata | null>;
}

export interface SecretsResult {
  namespacesCreated: number;
  namespacesVerified: number;
}


export type Permission =
  | "read_all"
  | "write_all"
  | "approve_tasks"
  | "manage_agents"
  | "view_audit"
  | "view_costs"
  | "read_workspace"
  | "write_workspace"
  | "read_knowledge"
  | "read_inbox"
  | "write_outbox"
  | "create_audit_entry"
  | "read_outbox"
  // Secrets access
  | "read_secrets"          // Read secrets in own division namespace
  | "read_secrets_global"   // Read secrets in global/providers namespace
  | "write_secrets"         // Write secrets in own division namespace
  | "write_secrets_global"  // Write secrets in global/providers namespace
  | "*";

export interface RoleDefinition {
  role: string;
  /** "own_division" | "specified_divisions" | undefined (global) */
  scope?: string;
  permissions: Permission[];
  description?: string;
}

export interface RoleAssignment {
  role: string;
  division?: string;
  divisions?: string[];
}

export interface AgentAssignment {
  agent: string;
  roles: RoleAssignment[];
}

export interface RBACConfig {
  schema_version: "1.0";
  generated_at: string;
  roles: RoleDefinition[];
  assignments: AgentAssignment[];
}


export interface Route {
  division: string;
  primary: string | null;
  fallback: string | null;
}

export interface DefaultRoute {
  agent: string;
  action: string;
}

export interface RoutingTable {
  schema_version: "1.0";
  generated_at: string;
  routes: Route[];
  default_route: DefaultRoute;
}


export type SkillScope = "own_division" | "shared" | string[];

export interface SkillDefinition {
  name: string;
  scope: SkillScope;
  requires_approval: boolean;
}

export interface DivisionSkills {
  division: string;
  skills: SkillDefinition[];
}


export type AuditLogLevel = "minimal" | "standard" | "verbose";

export interface AuditEventConfig {
  task_start: boolean;
  task_complete: boolean;
  decision: boolean;
  escalation: boolean;
  governance_check: boolean;
  error: boolean;
  approval_request: boolean;
  blocked: boolean;
}

export interface AuditRetentionConfig {
  days: number;
  export_before_delete: boolean;
}

export interface AuditExportConfig {
  formats: Array<"json" | "csv">;
  include_metadata: boolean;
}

export interface AuditConfig {
  schema_version: "1.0";
  log_level: AuditLogLevel;
  events: AuditEventConfig;
  retention: AuditRetentionConfig;
  export: AuditExportConfig;
}

export interface AuditResult {
  viewsCreated: number;
  exportDirVerified: boolean;
}


export interface DivisionBudget {
  monthly_limit_usd: number | null;
  daily_limit_usd: number | null;
  alert_threshold_percent?: number;
}

export interface CostCentersConfig {
  schema_version: "1.0";
  generated_at: string;
  global: DivisionBudget & { alert_threshold_percent: number };
  divisions: Record<string, DivisionBudget>;
}


export interface ApplyHistoryEntry {
  timestamp: string;
  action: string;
  changes: string[];
}

export interface LastApplyState {
  timestamp: string;
  divisions_yaml_hash: string;
  governance_hash: string;
  mode: string;
  active_divisions: string[];
  inactive_divisions: string[];
  db_version: string;
  agent_count: number;
  apply_duration_ms: number;
}

export interface StateFile {
  schema_version: "1.0";
  last_apply: LastApplyState;
  history: ApplyHistoryEntry[];
}


/** The result returned by each apply step */
export interface StepResult {
  step: ApplyStep;
  success: boolean;
  duration_ms: number;
  summary: string;
  details?: Record<string, unknown>;
}

export type ApplyStep =
  | "VALIDATE"
  | "FILESYSTEM"
  | "DATABASE"
  | "AGENTS"
  | "SECRETS"
  | "RBAC"
  | "ROUTING"
  | "SKILLS"
  | "AUDIT"
  | "COST_CENTERS"
  | "FINALIZE";

/** Options passed from the CLI to the apply orchestrator */
export interface ApplyOptions {
  configPath: string;
  /** Print plan without executing filesystem/DB writes */
  dryRun: boolean;
  /** Verbose per-step output */
  verbose: boolean;
  /** Skip confirmation prompts */
  force: boolean;
  /** Run only one specific step */
  step?: ApplyStep;
  /** Working directory (default: cwd) */
  workDir: string;
  /** SQLite database path (default: {workDir}/.system/sidjua.db) */
  dbPath?: string;
}

/** Full apply run result */
export interface ApplyResult {
  success: boolean;
  steps: StepResult[];
  config: ParsedConfig;
  duration_ms: number;
}


export type ApplyErrorCategory =
  | "VALIDATION_ERROR"
  | "FILESYSTEM_ERROR"
  | "DATABASE_ERROR"
  | "GENERATION_ERROR";

export class ApplyError extends Error {
  constructor(
    public readonly category: ApplyErrorCategory,
    public readonly step: ApplyStep,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ApplyError";
  }
}
