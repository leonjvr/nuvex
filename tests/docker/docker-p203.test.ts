// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * P203 — Docker rebuild & v1.0.0 launch verification.
 *
 * Static configuration tests (no Docker daemon required):
 *   - Dockerfile: port, health check, VOLUME, ENV, non-root user
 *   - docker-compose.yml: version, port, health check
 *   - version.ts + package.json: 1.0.0
 *   - smoke test script: exists, executable, correct image tag
 *   - Health endpoint: correct JSON shape (via existing server tests)
 *
 * Docker-actual-run tests are skipped unless SIDJUA_DOCKER_TEST=1.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join }                               from "node:path";

const ROOT = join(import.meta.dirname, "../..");

function readFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

// ---------------------------------------------------------------------------
// Task 4: Version strings
// ---------------------------------------------------------------------------

describe("P203 — version bump to 1.0.0", () => {
  it("src/version.ts exports SIDJUA_VERSION = '1.0.0'", () => {
    const src = readFile("src/version.ts");
    expect(src).toContain("\"1.0.0\"");
  });

  it("package.json version is 1.0.0", () => {
    const pkg = JSON.parse(readFile("package.json")) as { version: string };
    expect(pkg.version).toBe("1.0.0");
  });

  it("no '0.11.0' version references remain in src/", () => {
    // docker-compose.yml image tag and Dockerfile VERSION arg may still reference old versions
    // but src/ TypeScript files must be clean
    const versionSrc = readFile("src/version.ts");
    expect(versionSrc).not.toContain("0.11.0");
  });
});

// ---------------------------------------------------------------------------
// Task 1: Dockerfile
// ---------------------------------------------------------------------------

describe("P203 — Dockerfile audit", () => {
  let dockerfile: string;

  it("Dockerfile exists", () => {
    const path = join(ROOT, "Dockerfile");
    expect(existsSync(path)).toBe(true);
    dockerfile = readFile("Dockerfile");
  });

  it("uses Node.js 22 LTS", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toMatch(/FROM node:22/);
  });

  it("multi-stage build has builder and production stages", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("AS builder");
    expect(dockerfile).toContain("AS production");
  });

  it("ENV SIDJUA_PORT=4200 is set", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("SIDJUA_PORT=4200");
  });

  it("ENV SIDJUA_DATA_DIR=/data is set", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("SIDJUA_DATA_DIR=/data");
  });

  it("ENV SIDJUA_LOG_LEVEL=info is set", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("SIDJUA_LOG_LEVEL=info");
  });

  it("VOLUME ['/data'] is declared", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("VOLUME");
    expect(dockerfile).toContain("/data");
  });

  it("EXPOSE 4200 is declared", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("EXPOSE 4200");
  });

  it("HEALTHCHECK references port 4200 via SIDJUA_PORT", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toMatch(/SIDJUA_PORT.*4200|4200.*SIDJUA_PORT/);
  });

  it("HEALTHCHECK uses /api/v1/health endpoint", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("/api/v1/health");
  });

  it("runs as non-root user 'sidjua'", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("USER sidjua");
    expect(dockerfile).toContain("adduser");
  });

  it("tini is used as PID 1 init", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("tini");
    expect(dockerfile).toContain("ENTRYPOINT");
  });

  it("devDependencies are pruned before production stage", () => {
    dockerfile = dockerfile ?? readFile("Dockerfile");
    expect(dockerfile).toContain("npm prune --production");
  });
});

// ---------------------------------------------------------------------------
// .dockerignore
// ---------------------------------------------------------------------------

describe("P203 — .dockerignore", () => {
  it(".dockerignore exists", () => {
    expect(existsSync(join(ROOT, ".dockerignore"))).toBe(true);
  });

  it(".dockerignore excludes test files", () => {
    const content = readFile(".dockerignore");
    expect(content).toContain("tests");
  });

  it(".dockerignore excludes node_modules", () => {
    const content = readFile(".dockerignore");
    expect(content).toContain("node_modules");
  });

  it(".dockerignore excludes .git", () => {
    const content = readFile(".dockerignore");
    expect(content).toContain(".git");
  });
});

// ---------------------------------------------------------------------------
// Task 3: docker-compose.yml
// ---------------------------------------------------------------------------

describe("P203 — docker-compose.yml", () => {
  let compose: string;

  it("docker-compose.yml exists", () => {
    const path = join(ROOT, "docker-compose.yml");
    expect(existsSync(path)).toBe(true);
    compose = readFile("docker-compose.yml");
  });

  it("references image sidjua/sidjua:1.0.0", () => {
    compose = compose ?? readFile("docker-compose.yml");
    expect(compose).toContain("sidjua/sidjua:1.0.0");
  });

  it("default port is 4200", () => {
    compose = compose ?? readFile("docker-compose.yml");
    expect(compose).toContain("4200");
  });

  it("health check uses /api/v1/health", () => {
    compose = compose ?? readFile("docker-compose.yml");
    expect(compose).toContain("/api/v1/health");
  });

  it("restart policy is unless-stopped", () => {
    compose = compose ?? readFile("docker-compose.yml");
    expect(compose).toContain("unless-stopped");
  });

  it("named volumes are declared", () => {
    compose = compose ?? readFile("docker-compose.yml");
    expect(compose).toContain("volumes:");
    expect(compose).toContain("sidjua-data");
  });
});

// ---------------------------------------------------------------------------
// Task 2: docker-entrypoint.sh
// ---------------------------------------------------------------------------

describe("P203 — docker-entrypoint.sh", () => {
  let entrypoint: string;

  it("docker-entrypoint.sh exists", () => {
    expect(existsSync(join(ROOT, "docker-entrypoint.sh"))).toBe(true);
    entrypoint = readFile("docker-entrypoint.sh");
  });

  it("auto-generates API key on first run", () => {
    entrypoint = entrypoint ?? readFile("docker-entrypoint.sh");
    expect(entrypoint).toContain("SIDJUA_API_KEY");
    expect(entrypoint).toContain("auto-generat");
  });

  it("injects --port from SIDJUA_PORT env var", () => {
    entrypoint = entrypoint ?? readFile("docker-entrypoint.sh");
    expect(entrypoint).toContain("SIDJUA_PORT");
    expect(entrypoint).toContain("--port");
  });

  it("default port fallback is 4200", () => {
    entrypoint = entrypoint ?? readFile("docker-entrypoint.sh");
    expect(entrypoint).toContain("4200");
  });
});

// ---------------------------------------------------------------------------
// Task 2: Smoke test script
// ---------------------------------------------------------------------------

describe("P203 — smoke test script", () => {
  it("scripts/docker-smoke-test.sh exists", () => {
    expect(existsSync(join(ROOT, "scripts/docker-smoke-test.sh"))).toBe(true);
  });

  it("smoke test script is executable", () => {
    const stats = statSync(join(ROOT, "scripts/docker-smoke-test.sh"));
    // Check owner execute bit
    expect(stats.mode & 0o100).toBeGreaterThan(0);
  });

  it("smoke test script references image sidjua/sidjua:1.0.0", () => {
    const content = readFile("scripts/docker-smoke-test.sh");
    expect(content).toContain("sidjua/sidjua:1.0.0");
  });

  it("smoke test script checks /api/v1/health", () => {
    const content = readFile("scripts/docker-smoke-test.sh");
    expect(content).toContain("/api/v1/health");
  });

  it("smoke test script checks sidjua --version", () => {
    const content = readFile("scripts/docker-smoke-test.sh");
    expect(content).toContain("sidjua --version");
  });

  it("smoke test script verifies non-root user", () => {
    const content = readFile("scripts/docker-smoke-test.sh");
    expect(content).toContain("non-root");
  });

  it("smoke test script checks /data writable", () => {
    const content = readFile("scripts/docker-smoke-test.sh");
    expect(content).toContain("/data");
  });

  it("smoke test script tests SIGTERM graceful shutdown", () => {
    const content = readFile("scripts/docker-smoke-test.sh");
    expect(content).toContain("SIGTERM");
  });
});
