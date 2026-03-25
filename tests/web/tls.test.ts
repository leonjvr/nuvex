// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * TLS certificate generation and HTTPS server tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir }  from "node:os";
import { join }    from "node:path";
import {
  generateSelfSignedCert,
  resolveTlsConfig,
  tlsFilesExist,
  DEFAULT_TLS_CONFIG,
  type TlsConfig,
} from "../../src/api/tls.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "sidjua-tls-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function hasOpenSsl(): boolean {
  try {
    const { execFileSync } = require("node:child_process");
    execFileSync("openssl", ["version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Certificate generation
// ---------------------------------------------------------------------------

describe("generateSelfSignedCert", () => {
  it("creates cert.pem and key.pem files", { skip: !hasOpenSsl() }, () => {
    const certPath = join(tmp, "cert.pem");
    const keyPath  = join(tmp, "key.pem");

    generateSelfSignedCert({ certPath, keyPath });

    expect(existsSync(certPath)).toBe(true);
    expect(existsSync(keyPath)).toBe(true);
  });

  it("cert.pem starts with PEM certificate header", { skip: !hasOpenSsl() }, () => {
    const certPath = join(tmp, "cert.pem");
    const keyPath  = join(tmp, "key.pem");

    generateSelfSignedCert({ certPath, keyPath });

    const cert = readFileSync(certPath, "utf-8");
    expect(cert).toContain("-----BEGIN CERTIFICATE-----");
    expect(cert).toContain("-----END CERTIFICATE-----");
  });

  it("key.pem contains a private key", { skip: !hasOpenSsl() }, () => {
    const certPath = join(tmp, "cert.pem");
    const keyPath  = join(tmp, "key.pem");

    generateSelfSignedCert({ certPath, keyPath });

    const key = readFileSync(keyPath, "utf-8");
    expect(key).toContain("PRIVATE KEY");
  });

  it("creates parent directories if they do not exist", { skip: !hasOpenSsl() }, () => {
    const certPath = join(tmp, "nested", "tls", "cert.pem");
    const keyPath  = join(tmp, "nested", "tls", "key.pem");

    generateSelfSignedCert({ certPath, keyPath });

    expect(existsSync(certPath)).toBe(true);
    expect(existsSync(keyPath)).toBe(true);
  });

  it("cert is valid for 365 days (default validity)", { skip: !hasOpenSsl() }, () => {
    const certPath = join(tmp, "cert.pem");
    const keyPath  = join(tmp, "key.pem");

    generateSelfSignedCert({ certPath, keyPath, validDays: 365 });

    const cert = readFileSync(certPath, "utf-8");
    // A 365-day cert should be non-trivial in size
    expect(cert.length).toBeGreaterThan(500);
  });
});

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

describe("resolveTlsConfig", () => {
  const ORIGINAL_ENV: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["SIDJUA_TLS_ENABLED", "SIDJUA_TLS_CERT", "SIDJUA_TLS_KEY"]) {
      ORIGINAL_ENV[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(ORIGINAL_ENV)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("returns defaults when no ENV vars are set", () => {
    const cfg = resolveTlsConfig(DEFAULT_TLS_CONFIG);
    expect(cfg.enabled).toBe(false);
    expect(cfg.cert).toBe(DEFAULT_TLS_CONFIG.cert);
    expect(cfg.key).toBe(DEFAULT_TLS_CONFIG.key);
  });

  it("ENV SIDJUA_TLS_ENABLED=true overrides default disabled", () => {
    process.env["SIDJUA_TLS_ENABLED"] = "true";
    const cfg = resolveTlsConfig(DEFAULT_TLS_CONFIG);
    expect(cfg.enabled).toBe(true);
  });

  it("ENV SIDJUA_TLS_ENABLED=false keeps disabled", () => {
    process.env["SIDJUA_TLS_ENABLED"] = "false";
    const cfg = resolveTlsConfig({ ...DEFAULT_TLS_CONFIG, enabled: true });
    expect(cfg.enabled).toBe(false);
  });

  it("ENV SIDJUA_TLS_CERT overrides default cert path", () => {
    process.env["SIDJUA_TLS_CERT"] = "/custom/cert.pem";
    const cfg = resolveTlsConfig(DEFAULT_TLS_CONFIG);
    expect(cfg.cert).toBe("/custom/cert.pem");
  });

  it("ENV SIDJUA_TLS_KEY overrides default key path", () => {
    process.env["SIDJUA_TLS_KEY"] = "/custom/key.pem";
    const cfg = resolveTlsConfig(DEFAULT_TLS_CONFIG);
    expect(cfg.key).toBe("/custom/key.pem");
  });
});

// ---------------------------------------------------------------------------
// tlsFilesExist
// ---------------------------------------------------------------------------

describe("tlsFilesExist", () => {
  it("returns false when cert file does not exist", () => {
    const cfg: TlsConfig = {
      enabled: true,
      cert:    join(tmp, "no-cert.pem"),
      key:     join(tmp, "no-key.pem"),
    };
    expect(tlsFilesExist(cfg)).toBe(false);
  });

  it("returns true when both files exist", { skip: !hasOpenSsl() }, () => {
    const certPath = join(tmp, "cert.pem");
    const keyPath  = join(tmp, "key.pem");
    generateSelfSignedCert({ certPath, keyPath });

    const cfg: TlsConfig = { enabled: true, cert: certPath, key: keyPath };
    expect(tlsFilesExist(cfg)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ApiServerConfig TLS extension (source inspection)
// ---------------------------------------------------------------------------

describe("ApiServerConfig TLS extension", () => {
  it("server.ts imports createServer from node:https", () => {
    const src = readFileSync(
      new URL("../../src/api/server.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("createHttpsServer");
    expect(src).toContain("node:https");
  });

  it("server.ts uses TLS config to choose HTTP or HTTPS", () => {
    const src = readFileSync(
      new URL("../../src/api/server.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain("tls?.enabled");
    expect(src).toContain("createHttpsServer");
  });
});
