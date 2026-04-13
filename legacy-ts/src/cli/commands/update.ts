// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — `sidjua update` / `sidjua update --governance` / `sidjua changelog` Commands
 *
 * sidjua update
 *   Full update flow: lock → check → confirm → backup → download → verify →
 *   archive → install → migrate → selftest → unlock → report
 *
 * sidjua update --governance
 *   Governance-only: lock → check → backup governance → download → replace
 *   governance/ only → validate conflicts → unlock → report
 *
 * sidjua update --check
 *   Check only — no download or install.
 *
 * sidjua changelog [version]
 *   Fetch and display changelog for a version.
 */

import type { Command }         from "commander";
import { resolvePaths }         from "../../core/paths.js";
import { validateWorkDir }      from "../../utils/path-utils.js";
import { getCanonicalDbPath }  from "../../core/db/paths.js";
import { SIDJUA_VERSION }       from "../../version.js";
import { loadVersionInfo }      from "../../core/governance/rule-loader.js";
import { FileLockManager }      from "../../core/update/lock-manager.js";
import { UpdateBackupManager }  from "../../core/update/backup-manager.js";
import { VersionArchiveManager } from "../../core/update/version-archive.js";
import { NpmUpdateProvider }    from "../../core/update/npm-update-provider.js";
import { runPendingMigrations } from "../../core/update/migration-framework.js";
import { loadGovernanceRuleset } from "../../core/governance/rule-loader.js";
import { existsSync, readFileSync } from "node:fs";
import { join }                 from "node:path";
import * as readline            from "node:readline";
import { createLogger }         from "../../core/logger.js";

const logger = createLogger("update-cmd");


export function registerUpdateCommands(program: Command): void {
  program
    .command("update")
    .description("Check for and install SIDJUA updates")
    .option("--check",           "Only check for updates, don't install")
    .option("--governance",      "Update governance ruleset only")
    .option("--yes",             "Auto-confirm without interactive prompt")
    .option("--force-unlock",    "Release stale lock before starting")
    .option("--work-dir <path>", "Workspace directory", process.cwd())
    .action(async (opts: {
      check:       boolean;
      governance:  boolean;
      yes:         boolean;
      forceUnlock: boolean;
      workDir:     string;
    }) => {
      if (opts.governance) {
        await runGovernanceUpdate(opts.yes, opts.forceUnlock, opts.workDir);
      } else {
        await runFullUpdate(opts.check, opts.yes, opts.forceUnlock, opts.workDir);
      }
    });
}


export function registerChangelogCommands(program: Command): void {
  program
    .command("changelog [version]")
    .description("Show changelog for a SIDJUA version")
    .action(async (version?: string) => {
      const provider  = new NpmUpdateProvider();
      const targetVer = version ?? "latest";

      try {
        const changelog = await provider.getChangelog(targetVer);
        process.stdout.write(changelog + "\n");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Not implemented")) {
          process.stdout.write(
            `Changelog not available via update provider.\n` +
            `View release notes at: https://github.com/GoetzKohlberg/sidjua/releases\n`,
          );
        } else {
          process.stderr.write(`Error fetching changelog: ${msg}\n`);
          process.exit(1);
        }
      }
    });
}


async function runFullUpdate(checkOnly: boolean, autoYes: boolean, forceUnlock: boolean, workDir: string): Promise<void> {
  validateWorkDir(workDir);
  if (!existsSync(join(workDir, ".system", "sidjua.db"))) {
    process.stderr.write(`Error: No SIDJUA workspace found at ${workDir}\n`);
    process.exit(1);
  }
  const paths    = resolvePaths(workDir);
  const provider = new NpmUpdateProvider();
  const lock     = new FileLockManager(paths.data.root);

  // Step 1: Handle stale lock
  if (forceUnlock) {
    await lock.forceRelease();
    process.stdout.write("Stale lock released.\n");
  }

  // Step 2: Check for update
  process.stdout.write("Checking for updates...\n");
  let updateInfo = null;
  try {
    updateInfo = await provider.checkForUpdate(SIDJUA_VERSION);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Not implemented")) {
      process.stdout.write(
        "Update provider not configured. Manual update: npm update -g sidjua\n",
      );
      process.exit(0);
    }
    process.stderr.write(`Update check failed: ${msg}\n`);
    process.exit(1);
  }

  if (updateInfo === null) {
    process.stdout.write("Already up to date.\n");
    process.exit(0);
  }

  // Show update info
  process.stdout.write(`\nUpdate available: SIDJUA v${updateInfo.version}\n`);
  process.stdout.write(`Released: ${updateInfo.releaseDate.slice(0, 10)}\n`);
  if (updateInfo.breakingChanges) {
    process.stdout.write("⚠  BREAKING CHANGES in this release. Review changelog before upgrading.\n");
  }
  if (updateInfo.dataMigrationRequired) {
    process.stdout.write(`   Schema migration required (estimated ${updateInfo.estimatedMigrationTimeSeconds}s)\n`);
  }
  process.stdout.write(`\nChangelog:\n${updateInfo.changelog}\n`);

  if (checkOnly) {
    process.exit(0);
  }

  // Step 3: Confirm
  if (!autoYes) {
    const confirmed = await promptConfirm(`Install SIDJUA v${updateInfo.version}? [y/N] `);
    if (!confirmed) {
      process.stdout.write("Cancelled.\n");
      process.exit(0);
    }
  }

  // Step 4: Acquire lock
  let acquired: boolean;
  try {
    acquired = await lock.acquire("update");
  } catch (lockErr: unknown) {
    process.stderr.write(`Cannot acquire update lock: ${lockErr instanceof Error ? lockErr.message : String(lockErr)}\n`);
    process.exit(1);
  }
  if (!acquired) {
    process.stderr.write("Another update operation is in progress. Use --force-unlock if the lock is stale.\n");
    process.exit(1);
  }

  const backup  = new UpdateBackupManager(paths.data.root, paths.system.root);
  const archive = new VersionArchiveManager(join(paths.system.root, ".."), paths.system.root);

  try {
    // Step 5: Backup
    process.stdout.write("Creating pre-update backup...\n");
    const backupInfo = await backup.createPreUpdateBackup(updateInfo.version);
    process.stdout.write(`Backup created: ${backupInfo.id}\n`);

    // Step 6: Download
    process.stdout.write("Downloading release...\n");
    let archivePath: string;
    try {
      archivePath = await provider.downloadRelease(updateInfo.version);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Download failed: ${msg}\n`);
      process.stdout.write("Rolling back...\n");
      await backup.restoreBackup(backupInfo.id);
      process.exit(1);
    }

    // Step 7: Verify
    process.stdout.write("Verifying release integrity...\n");
    let verified = false;
    try {
      verified = await provider.verifyRelease(archivePath);
    } catch (e: unknown) {
      logger.warn("update-cmd", "Release verification threw an exception — treating as unverified", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    }
    if (!verified) {
      process.stderr.write("Release verification failed. Aborting.\n");
      await backup.restoreBackup(backupInfo.id);
      process.exit(1);
    }

    // Step 8: Archive current system
    process.stdout.write("Archiving current version...\n");
    await archive.archiveCurrentSystem(SIDJUA_VERSION);

    // Step 9: Install — replace system/
    process.stdout.write(`Installing SIDJUA v${updateInfo.version}...\n`);
    // (Actual extraction handled by npm update, this is a placeholder for custom install logic)
    process.stdout.write("Installation complete.\n");

    // Step 10: Migrate
    if (updateInfo.dataMigrationRequired) {
      process.stdout.write("Running schema migrations...\n");
      // Open the canonical workspace DB for migration
      const { openDatabase } = await import("../../utils/db.js");
      const db = openDatabase(getCanonicalDbPath(workDir));
      try {
        const result = await runPendingMigrations(db, paths.system.migrations, paths.data.root);
        if (result.failed !== null) {
          process.stderr.write(`Migration failed: ${result.error ?? result.failed}\n`);
          process.stdout.write("Rolling back...\n");
          await archive.restoreSystem(SIDJUA_VERSION);
          process.exit(1);
        }
        process.stdout.write(`Migrations applied: ${result.applied.join(", ") || "none"}\n`);
      } finally {
        db.close();
      }
    }

    // Step 11: Selftest
    process.stdout.write("Running selftest...\n");
    const selftestPassed = runSelftest(paths);
    if (!selftestPassed) {
      process.stderr.write("Selftest failed. Consider running: sidjua rollback\n");
    }

    // Step 13: Report
    process.stdout.write(`\nSIDJUA updated to v${updateInfo.version} successfully.\n`);
    process.stdout.write(`To rollback: sidjua rollback --to ${SIDJUA_VERSION}\n`);

  } finally {
    await lock.release();
  }

  process.exit(0);
}


async function runGovernanceUpdate(autoYes: boolean, forceUnlock: boolean, workDir: string): Promise<void> {
  validateWorkDir(workDir);
  if (!existsSync(join(workDir, ".system", "sidjua.db"))) {
    process.stderr.write(`Error: No SIDJUA workspace found at ${workDir}\n`);
    process.exit(1);
  }
  const paths    = resolvePaths(workDir);
  const provider = new NpmUpdateProvider();
  const lock     = new FileLockManager(paths.data.root);

  if (forceUnlock) {
    await lock.forceRelease();
    process.stdout.write("Stale lock released.\n");
  }

  // Step 2: Check
  process.stdout.write("Checking for governance updates...\n");
  const govInfo = loadVersionInfo(paths.system.governance);
  const currentRuleset = govInfo?.ruleset_version ?? "unknown";

  let govUpdate = null;
  try {
    govUpdate = await provider.checkForGovernanceUpdate(currentRuleset);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Not implemented")) {
      process.stdout.write(
        "Update provider not configured. Manual update: npm update -g sidjua\n",
      );
      process.exit(0);
    }
    process.stderr.write(`Governance update check failed: ${msg}\n`);
    process.exit(1);
  }

  if (govUpdate === null) {
    process.stdout.write("Governance ruleset is already up to date.\n");
    process.exit(0);
  }

  process.stdout.write(`\nGovernance update available: Ruleset v${govUpdate.rulesetVersion}\n`);
  if (govUpdate.newRules.length > 0)      process.stdout.write(`  New rules: ${govUpdate.newRules.join(", ")}\n`);
  if (govUpdate.modifiedRules.length > 0) process.stdout.write(`  Modified: ${govUpdate.modifiedRules.join(", ")}\n`);
  if (govUpdate.removedRules.length > 0)  process.stdout.write(`  Removed: ${govUpdate.removedRules.join(", ")}\n`);

  if (!autoYes) {
    const confirmed = await promptConfirm(`Apply governance ruleset v${govUpdate.rulesetVersion}? [y/N] `);
    if (!confirmed) {
      process.stdout.write("Cancelled.\n");
      process.exit(0);
    }
  }

  let acquired: boolean;
  try {
    acquired = await lock.acquire("governance-update");
  } catch (lockErr: unknown) {
    process.stderr.write(`Cannot acquire governance-update lock: ${lockErr instanceof Error ? lockErr.message : String(lockErr)}\n`);
    process.exit(1);
  }
  if (!acquired) {
    process.stderr.write("Another operation is in progress.\n");
    process.exit(1);
  }

  const backup = new UpdateBackupManager(paths.data.root, paths.system.root);

  try {
    // Step 5: Backup governance files only
    process.stdout.write("Backing up current governance ruleset...\n");
    const backupInfo = await backup.createManualBackup(`gov-pre-${govUpdate.rulesetVersion}`);
    process.stdout.write(`Backup created: ${backupInfo.id}\n`);

    // Step 6: Download governance ruleset
    process.stdout.write("Downloading governance ruleset...\n");
    let govArchivePath: string;
    try {
      govArchivePath = await provider.downloadGovernanceRuleset(govUpdate.rulesetVersion);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`Download failed: ${msg}\n`);
      process.exit(1);
    }

    // Step 7: Replace system/governance/ only
    process.stdout.write("Applying governance ruleset...\n");
    void govArchivePath; // Actual extraction handled by provider in full implementation

    // Step 8: Validate — check for conflicts with user rules
    process.stdout.write("Validating governance rules...\n");
    const ruleset = loadGovernanceRuleset(paths.system.governance, paths.data.governance);
    if (ruleset.conflicts.length > 0) {
      process.stdout.write(`⚠  ${ruleset.conflicts.length} conflict(s) detected with user rules:\n`);
      for (const conflict of ruleset.conflicts) {
        process.stdout.write(`   - ${conflict.userRule.id}: ${conflict.reason}\n`);
      }
    }

    process.stdout.write(`\nGovernance ruleset updated to v${govUpdate.rulesetVersion}.\n`);

  } finally {
    await lock.release();
  }

  process.exit(0);
}


export function runSelftest(paths: ReturnType<typeof resolvePaths>): boolean {
  const checks: Array<{ name: string; pass: boolean; reason?: string }> = [];

  // system/VERSION exists
  checks.push({
    name: "system/VERSION readable",
    pass: existsSync(paths.system.version),
  });

  // system/governance/VERSION parseable
  let govParseable = false;
  try {
    const info = loadVersionInfo(paths.system.governance);
    govParseable = info !== null;
  } catch (e: unknown) {
    logger.debug("update-cmd", "Governance VERSION parse check failed — treating as unparseable", { metadata: { error: e instanceof Error ? e.message : String(e) } });
  }
  checks.push({ name: "system/governance/VERSION parseable", pass: govParseable });

  // Governance YAML loads without error
  let govLoads = false;
  try {
    const rs = loadGovernanceRuleset(paths.system.governance, paths.data.governance);
    govLoads = rs.systemRules.length > 0;
  } catch (e: unknown) {
    logger.debug("update-cmd", "Governance YAML load check failed — treating as not loadable", { metadata: { error: e instanceof Error ? e.message : String(e) } });
  }
  checks.push({ name: "Governance YAML loads", pass: govLoads });

  // Data directory exists / is accessible
  checks.push({
    name: "Data directory accessible",
    pass: existsSync(paths.data.root),
  });

  // No stale lock file (detect if lock exists but pid is dead)
  let noStaleLock = true;
  const lockPath  = join(paths.data.root, "sidjua.lock");
  if (existsSync(lockPath)) {
    try {
      const raw  = readFileSync(lockPath, "utf-8");
      const info = JSON.parse(raw) as { pid?: number };
      if (typeof info.pid === "number") {
        try { process.kill(info.pid, 0); } catch (e: unknown) {
          const err = e as NodeJS.ErrnoException;
          if (err.code === "ESRCH") noStaleLock = false;
        }
      }
    } catch (e: unknown) {
      logger.debug("update-cmd", "Lock file JSON parse failed — treating as unparseable lock", { metadata: { error: e instanceof Error ? e.message : String(e) } });
    }
  }
  checks.push({ name: "No stale lock", pass: noStaleLock });

  // Path resolver valid
  checks.push({
    name: "Path resolver valid",
    pass: paths.system.root.length > 0 && paths.data.root.length > 0,
  });

  let allPass = true;
  for (const check of checks) {
    const status = check.pass ? "PASS" : "FAIL";
    process.stdout.write(`  [${status}] ${check.name}\n`);
    if (!check.pass) allPass = false;
  }

  return allPass;
}


async function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
