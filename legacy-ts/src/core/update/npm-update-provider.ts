// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — NpmUpdateProvider
 *
 * Implements UpdateProvider backed by the npm registry.
 * checkForUpdate() fetches the latest published version and returns
 * UpdateInfo when a newer version is available; null otherwise.
 *
 * Network errors and non-200 responses are treated as "no update available"
 * so a transient network outage never blocks the CLI.
 *
 * Skipped entirely when SIDJUA_NO_UPDATE_CHECK=1 is set (handled upstream by
 * shouldSkipCheck(), but NpmUpdateProvider also respects it directly so callers
 * that bypass the update-check layer can still opt out).
 */

import type { UpdateProvider, UpdateInfo, GovernanceUpdateInfo } from "./update-provider.js";
import { semverGt } from "./version-utils.js";

/** Shape returned by the npm registry latest endpoint. */
interface NpmLatestResponse {
  version: string;
  [key: string]: unknown;
}

const NPM_REGISTRY_URL = "https://registry.npmjs.org/sidjua/latest";
const FETCH_TIMEOUT_MS = 5_000;

export class NpmUpdateProvider implements UpdateProvider {
  /**
   * Fetch the latest published version from the npm registry.
   * Returns UpdateInfo when latestVersion > currentVersion, null otherwise.
   * Never throws — network failures return null.
   */
  async checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
    if (process.env["SIDJUA_NO_UPDATE_CHECK"] === "1") return null;

    let latestVersion: string;
    try {
      latestVersion = await fetchLatestNpmVersion();
    } catch (_err) {
      return null;
    }

    if (!semverGt(latestVersion, currentVersion)) return null;

    return {
      version:                       latestVersion,
      releaseDate:                   new Date().toISOString(),
      changelog:                     "",
      breakingChanges:               false,
      dataMigrationRequired:         false,
      embeddingMigrationRequired:    false,
      newSystemRules:                [],
      governanceRulesetVersion:      latestVersion,
      estimatedMigrationTimeSeconds: 0,
      sha256:                        "",
      downloadUrl:                   `https://registry.npmjs.org/sidjua/-/sidjua-${latestVersion}.tgz`,
    };
  }

  /**
   * Governance ruleset updates are not yet distributed via npm.
   * Returns null until a dedicated registry endpoint is available.
   */
  async checkForGovernanceUpdate(_currentRulesetVersion: string): Promise<GovernanceUpdateInfo | null> {
    return null;
  }

  /** Not implemented in V1. */
  async downloadRelease(_version: string): Promise<string> {
    throw new Error("Not implemented");
  }

  /** Not implemented in V1. */
  async downloadGovernanceRuleset(_version: string): Promise<string> {
    throw new Error("Not implemented");
  }

  /** Not implemented in V1. */
  async verifyRelease(_archivePath: string): Promise<boolean> {
    throw new Error("Not implemented");
  }

  /** Not implemented in V1. */
  async getChangelog(_version: string): Promise<string> {
    throw new Error("Not implemented");
  }
}


/**
 * Fetch the latest published version string from the npm registry.
 * Throws on network error or unexpected response.
 */
async function fetchLatestNpmVersion(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(NPM_REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`npm registry responded with HTTP ${res.status}`);
    }
    const body = await res.json() as NpmLatestResponse;
    if (typeof body.version !== "string" || body.version.length === 0) {
      throw new Error("npm registry response missing version field");
    }
    return body.version;
  } finally {
    clearTimeout(timer);
  }
}

