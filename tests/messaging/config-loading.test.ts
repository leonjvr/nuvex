/**
 * V1.1 — Messaging config loader tests
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "node:path";
import * as fsModule from "node:fs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getLoader() {
  const mod = await import("../../src/messaging/config-loader.js");
  return mod.loadMessagingConfig;
}

// ---------------------------------------------------------------------------
// Tests — file not found
// ---------------------------------------------------------------------------

describe("loadMessagingConfig — no file", () => {
  it("returns defaults when messaging.yaml does not exist", async () => {
    const load = await getLoader();
    const cfg  = load("/nonexistent/workspace");
    expect(cfg.governance.require_mapping).toBe(true);
    expect(cfg.governance.response_max_length).toBe(4000);
    expect(cfg.governance.max_inbound_per_hour).toBe(1000);
    expect(cfg.instances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — real temp file parsing
// ---------------------------------------------------------------------------

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

function makeTempWorkspace(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "sidjua-msg-test-"));
  mkdirSync(join(dir, "governance"), { recursive: true });
  writeFileSync(join(dir, "governance", "messaging.yaml"), yaml, "utf8");
  return dir;
}

describe("loadMessagingConfig — governance defaults", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch (e: unknown) { void e; }
    }
    dirs.length = 0;
  });

  it("parses governance fields from YAML", async () => {
    const dir = makeTempWorkspace(`
governance:
  require_mapping: true
  response_max_length: 2000
  max_inbound_per_hour: 500
instances: []
`);
    dirs.push(dir);
    const load = await getLoader();
    const cfg  = load(dir);
    expect(cfg.governance.require_mapping).toBe(true);
    expect(cfg.governance.response_max_length).toBe(2000);
    expect(cfg.governance.max_inbound_per_hour).toBe(500);
  });

  it("uses defaults for missing governance fields", async () => {
    const dir = makeTempWorkspace("governance:\n  require_mapping: true\ninstances: []\n");
    dirs.push(dir);
    const load = await getLoader();
    const cfg  = load(dir);
    expect(cfg.governance.require_mapping).toBe(true);
    expect(cfg.governance.response_max_length).toBe(4000); // default
  });

  it("handles null/empty YAML file", async () => {
    const dir = makeTempWorkspace("---\n");
    dirs.push(dir);
    const load = await getLoader();
    const cfg  = load(dir);
    expect(cfg.governance.require_mapping).toBe(true); // default is true
    expect(cfg.instances).toHaveLength(0);
  });
});

describe("loadMessagingConfig — instances", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try { rmSync(d, { recursive: true, force: true }); } catch (e: unknown) { void e; }
    }
    dirs.length = 0;
  });

  it("parses enabled instances", async () => {
    const dir = makeTempWorkspace(`
governance:
  require_mapping: false
instances:
  - id: "tg-main"
    adapter: "telegram"
    enabled: true
    config:
      bot_token_secret: "my-secret"
    rate_limit_per_min: 30
`);
    dirs.push(dir);
    const load = await getLoader();
    const cfg  = load(dir);
    expect(cfg.instances).toHaveLength(1);
    expect(cfg.instances[0]!.id).toBe("tg-main");
    expect(cfg.instances[0]!.adapter).toBe("telegram");
    expect(cfg.instances[0]!.enabled).toBe(true);
    expect(cfg.instances[0]!.rate_limit_per_min).toBe(30);
    expect(cfg.instances[0]!.config["bot_token_secret"]).toBe("my-secret");
  });

  it("includes disabled instances (caller filters)", async () => {
    const dir = makeTempWorkspace(`
instances:
  - id: "disabled-inst"
    adapter: "websocket"
    enabled: false
    config: {}
    rate_limit_per_min: 0
`);
    dirs.push(dir);
    const load = await getLoader();
    const cfg  = load(dir);
    expect(cfg.instances).toHaveLength(1);
    expect(cfg.instances[0]!.enabled).toBe(false);
  });

  it("filters out instances with empty id or adapter", async () => {
    const dir = makeTempWorkspace(`
instances:
  - id: ""
    adapter: "telegram"
    enabled: true
    config: {}
    rate_limit_per_min: 0
  - id: "ok-inst"
    adapter: ""
    enabled: true
    config: {}
    rate_limit_per_min: 0
  - id: "valid-inst"
    adapter: "websocket"
    enabled: true
    config: {}
    rate_limit_per_min: 0
`);
    dirs.push(dir);
    const load = await getLoader();
    const cfg  = load(dir);
    expect(cfg.instances).toHaveLength(1);
    expect(cfg.instances[0]!.id).toBe("valid-inst");
  });

  it("handles multiple instances", async () => {
    const dir = makeTempWorkspace(`
instances:
  - id: "inst-a"
    adapter: "telegram"
    enabled: true
    config: { bot_token_secret: "tok-a" }
    rate_limit_per_min: 10
  - id: "inst-b"
    adapter: "websocket"
    enabled: true
    config: { port: 4201 }
    rate_limit_per_min: 60
`);
    dirs.push(dir);
    const load = await getLoader();
    const cfg  = load(dir);
    expect(cfg.instances).toHaveLength(2);
    expect(cfg.instances[0]!.id).toBe("inst-a");
    expect(cfg.instances[1]!.id).toBe("inst-b");
  });
});
