// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — UpdateProvider Interface
 *
 * Abstraction layer for update sources. V1 ships with NpmUpdateProvider.
 * Future providers (GitHub Releases, self-hosted) implement the same interface.
 *
 * Actual HTTP calls and download logic are not yet implemented in NpmUpdateProvider.
 * This file defines the contract and the NpmUpdateProvider skeleton.
 */


export interface UpdateInfo {
  version:                         string;
  releaseDate:                     string;
  changelog:                       string;
  breakingChanges:                 boolean;
  dataMigrationRequired:           boolean;
  embeddingMigrationRequired:      boolean;
  newSystemRules:                  string[];
  governanceRulesetVersion:        string;
  estimatedMigrationTimeSeconds:   number;
  sha256:                          string;
  downloadUrl:                     string;
}

export interface GovernanceUpdateInfo {
  rulesetVersion: string;
  newRules:       string[];
  modifiedRules:  string[];
  removedRules:   string[];
  changelog:      string;
  sha256:         string;
}


export interface UpdateProvider {
  /** Check if a newer SIDJUA version is available. Returns null if up-to-date. */
  checkForUpdate(currentVersion: string): Promise<UpdateInfo | null>;

  /** Check if a newer governance ruleset is available. Returns null if up-to-date. */
  checkForGovernanceUpdate(currentRulesetVersion: string): Promise<GovernanceUpdateInfo | null>;

  /** Download a specific SIDJUA release archive. Returns local file path. */
  downloadRelease(version: string): Promise<string>;

  /** Download a governance ruleset update. Returns local file path. */
  downloadGovernanceRuleset(version: string): Promise<string>;

  /** Verify integrity of a downloaded release (SHA-256 check). */
  verifyRelease(archivePath: string): Promise<boolean>;

  /** Fetch changelog for a specific version. */
  getChangelog(version: string): Promise<string>;
}
