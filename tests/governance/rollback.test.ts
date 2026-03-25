/**
 * Tests for src/governance/rollback.ts — Phase 10.8 Component D
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  createSnapshot,
  listSnapshots,
  loadSnapshot,
  restoreSnapshot,
  diffSnapshot,
  MAX_SNAPSHOTS,
  type GovernanceSnapshot,
} from "../../src/governance/rollback.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir     = mkdtempSync(join(tmpdir(), "sidjua-rollback-test-"));
  configPath = join(tmpDir, "divisions.yaml");
  writeFileSync(configPath, "schema_version: '1.0'\ncompany:\n  name: TestCo\n", "utf8");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Snapshot creation
// ---------------------------------------------------------------------------

describe("createSnapshot", () => {
  it("creates a snapshot and writes it to disk", () => {
    const snap = createSnapshot(tmpDir, configPath, null, "apply");
    expect(snap.id).toBeDefined();
    expect(snap.version).toBe(1);
    expect(snap.trigger).toBe("apply");
    expect(typeof snap.timestamp).toBe("string");

    // File should exist on disk
    const onDisk = loadSnapshot(tmpDir, 1);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.id).toBe(snap.id);
  });

  it("snapshot contains the divisions.yaml file", () => {
    const snap = createSnapshot(tmpDir, configPath, null, "apply");
    const divFile = snap.files.find((f) => f.path.includes("divisions.yaml"));
    expect(divFile).toBeDefined();
    expect(divFile!.content).toContain("TestCo");
  });

  it("snapshot has correct divisions_yaml_hash", () => {
    const content = readFileSync(configPath, "utf8");
    const snap    = createSnapshot(tmpDir, configPath, null, "apply");
    expect(snap.divisions_yaml_hash).toBe(sha256(content));
  });

  it("snapshot captures governance boundary files when present", () => {
    const govDir = join(tmpDir, "governance", "boundaries");
    mkdirSync(govDir, { recursive: true });
    writeFileSync(join(govDir, "forbidden-actions.yaml"), "rules:\n  - action: contract.sign\n", "utf8");

    const snap = createSnapshot(tmpDir, configPath, null, "manual");
    const forbFile = snap.files.find((f) => f.path.includes("forbidden-actions.yaml"));
    expect(forbFile).toBeDefined();
  });

  it("auto-increments version on successive snapshots", () => {
    const s1 = createSnapshot(tmpDir, configPath, null, "apply");
    const s2 = createSnapshot(tmpDir, configPath, null, "apply");
    expect(s1.version).toBe(1);
    expect(s2.version).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// listSnapshots
// ---------------------------------------------------------------------------

describe("listSnapshots", () => {
  it("returns snapshots in reverse chronological order (newest first)", () => {
    createSnapshot(tmpDir, configPath, null, "apply");
    createSnapshot(tmpDir, configPath, null, "manual");
    createSnapshot(tmpDir, configPath, null, "apply");

    const list = listSnapshots(tmpDir);
    expect(list).toHaveLength(3);
    expect(list[0]!.version).toBe(3); // newest first
    expect(list[2]!.version).toBe(1); // oldest last
  });

  it("returns empty array when no snapshots exist", () => {
    expect(listSnapshots(tmpDir)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loadSnapshot
// ---------------------------------------------------------------------------

describe("loadSnapshot", () => {
  it("loads a specific snapshot by version", () => {
    createSnapshot(tmpDir, configPath, null, "apply");
    createSnapshot(tmpDir, configPath, null, "manual");

    const snap = loadSnapshot(tmpDir, 1);
    expect(snap).not.toBeNull();
    expect(snap!.version).toBe(1);
    expect(snap!.trigger).toBe("apply");
  });

  it("returns null for a non-existent version", () => {
    const snap = loadSnapshot(tmpDir, 999);
    expect(snap).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// restoreSnapshot
// ---------------------------------------------------------------------------

describe("restoreSnapshot", () => {
  it("restores files from snapshot", () => {
    const govDir = join(tmpDir, "governance", "boundaries");
    mkdirSync(govDir, { recursive: true });
    const forbPath = join(govDir, "forbidden-actions.yaml");
    writeFileSync(forbPath, "rules:\n  - action: contract.sign\n", "utf8");

    // Create snapshot BEFORE modifying files
    const snap = createSnapshot(tmpDir, configPath, null, "apply");

    // Simulate a change
    writeFileSync(forbPath, "rules:\n  - action: NEW_RULE\n", "utf8");
    expect(readFileSync(forbPath, "utf8")).toContain("NEW_RULE");

    // Restore
    restoreSnapshot(tmpDir, snap, null);
    expect(readFileSync(forbPath, "utf8")).toContain("contract.sign");
  });

  it("restores divisions.yaml from snapshot", () => {
    const originalContent = readFileSync(configPath, "utf8");
    const snap = createSnapshot(tmpDir, configPath, null, "apply");

    // Modify divisions.yaml
    writeFileSync(configPath, "schema_version: '1.0'\ncompany:\n  name: ModifiedCo\n", "utf8");

    // Restore
    restoreSnapshot(tmpDir, snap, null);
    const restored = readFileSync(configPath, "utf8");
    expect(restored).toBe(originalContent);
    expect(restored).toContain("TestCo");
  });
});

// ---------------------------------------------------------------------------
// diffSnapshot
// ---------------------------------------------------------------------------

describe("diffSnapshot", () => {
  it("shows no changes when files are identical", () => {
    const snap = createSnapshot(tmpDir, configPath, null, "apply");
    const diff = diffSnapshot(tmpDir, snap, configPath);
    expect(diff.changed_files).toHaveLength(0);
    expect(diff.yaml_hash_match).toBe(true);
  });

  it("detects changed divisions.yaml", () => {
    const snap = createSnapshot(tmpDir, configPath, null, "apply");

    // Modify the file
    writeFileSync(configPath, "schema_version: '1.0'\ncompany:\n  name: ChangedCo\n", "utf8");

    const diff = diffSnapshot(tmpDir, snap, configPath);
    expect(diff.yaml_hash_match).toBe(false);
  });

  it("detects removed governance files", () => {
    const govDir = join(tmpDir, "governance", "boundaries");
    mkdirSync(govDir, { recursive: true });
    const forbPath = join(govDir, "forbidden-actions.yaml");
    writeFileSync(forbPath, "rules: []\n", "utf8");

    const snap = createSnapshot(tmpDir, configPath, null, "apply");

    // Remove the file
    rmSync(forbPath);

    const diff = diffSnapshot(tmpDir, snap, configPath);
    const removed = diff.changed_files.find((f) => f.status === "removed");
    expect(removed).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Snapshot retention
// ---------------------------------------------------------------------------

describe("Max snapshot retention", () => {
  it(`keeps at most ${MAX_SNAPSHOTS} snapshots`, () => {
    for (let i = 0; i < MAX_SNAPSHOTS + 3; i++) {
      createSnapshot(tmpDir, configPath, null, "apply");
    }

    const all = listSnapshots(tmpDir);
    expect(all).toHaveLength(MAX_SNAPSHOTS);
    // Oldest versions (1, 2, 3) should be pruned; newest 10 remain
    const versions = all.map((s) => s.version).sort((a, b) => a - b);
    expect(versions[0]).toBe(4); // versions 1-3 pruned
  });
});
