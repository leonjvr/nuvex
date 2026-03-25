// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Favicon and icon generation tests.
 *
 *   - createFaviconIco generates a valid ICO file
 *   - GET /favicon.ico route returns 200 with correct Content-Type
 *   - Favicon and icon routes are all reachable
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createSolidColorPNG, createFaviconIco, BRAND_COLOR } from "../../src/api/png-utils.js";
import { registerPwaRoutes } from "../../src/api/routes/pwa.js";

// ---------------------------------------------------------------------------
// createFaviconIco — unit tests
// ---------------------------------------------------------------------------

describe("createFaviconIco", () => {
  it("returns a Buffer", () => {
    const ico = createFaviconIco(37, 99, 235);
    expect(ico).toBeInstanceOf(Buffer);
  });

  it("starts with ICO magic bytes (reserved=0, type=1, count=1)", () => {
    const ico = createFaviconIco(37, 99, 235);
    // Bytes 0-1: reserved (0x0000)
    expect(ico.readUInt16LE(0)).toBe(0);
    // Bytes 2-3: type (0x0001 = icon)
    expect(ico.readUInt16LE(2)).toBe(1);
    // Bytes 4-5: count (0x0001 = 1 image)
    expect(ico.readUInt16LE(4)).toBe(1);
  });

  it("ICONDIRENTRY specifies 32x32 image", () => {
    const ico = createFaviconIco(37, 99, 235);
    expect(ico[6]).toBe(32);  // width
    expect(ico[7]).toBe(32);  // height
  });

  it("ICONDIRENTRY image offset points after header+entry (offset = 22)", () => {
    const ico = createFaviconIco(37, 99, 235);
    // Offset field is at bytes 18-21 in the ICONDIRENTRY (6 header + 12 offset in entry)
    const offset = ico.readUInt32LE(6 + 12);
    expect(offset).toBe(22);  // 6 (header) + 16 (entry)
  });

  it("embedded PNG data starts at offset 22 with PNG magic bytes", () => {
    const ico = createFaviconIco(37, 99, 235);
    // PNG signature: 0x89 0x50 0x4E 0x47
    expect(ico[22]).toBe(0x89);
    expect(ico[23]).toBe(0x50);  // 'P'
    expect(ico[24]).toBe(0x4E);  // 'N'
    expect(ico[25]).toBe(0x47);  // 'G'
  });

  it("ICO size equals header(6) + entry(16) + PNG size", () => {
    const { r, g, b } = BRAND_COLOR;
    const png = createSolidColorPNG(32, 32, r, g, b);
    const ico = createFaviconIco(r, g, b);
    expect(ico.length).toBe(6 + 16 + png.length);
  });
});

// ---------------------------------------------------------------------------
// PWA routes — favicon.ico
// ---------------------------------------------------------------------------

describe("GET /favicon.ico", () => {
  function buildApp(): Hono {
    const app = new Hono();
    registerPwaRoutes(app);
    return app;
  }

  it("returns 200", async () => {
    const app = buildApp();
    const res = await app.request("/favicon.ico");
    expect(res.status).toBe(200);
  });

  it("Content-Type is image/x-icon", async () => {
    const app = buildApp();
    const res = await app.request("/favicon.ico");
    expect(res.headers.get("content-type")).toContain("image/x-icon");
  });

  it("Cache-Control is set", async () => {
    const app = buildApp();
    const res = await app.request("/favicon.ico");
    expect(res.headers.get("cache-control")).toBeTruthy();
  });

  it("response body is non-empty", async () => {
    const app = buildApp();
    const res = await app.request("/favicon.ico");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(22);
  });

  it("response body starts with ICO magic bytes", async () => {
    const app = buildApp();
    const res = await app.request("/favicon.ico");
    const buf = new Uint8Array(await res.arrayBuffer());
    // Reserved 0,0 | type 1,0 | count 1,0
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(0);
    expect(buf[2]).toBe(1);
    expect(buf[3]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// All icon routes reachable
// ---------------------------------------------------------------------------

describe("Icon routes — all 200 OK", () => {
  function buildApp(): Hono {
    const app = new Hono();
    registerPwaRoutes(app);
    return app;
  }

  const routes = [
    ["/favicon.ico",             "image/x-icon"],
    ["/icons/icon-192.png",      "image/png"],
    ["/icons/icon-512.png",      "image/png"],
    ["/icons/apple-touch-icon.png", "image/png"],
  ] as const;

  for (const [path, expectedType] of routes) {
    it(`${path} → 200 ${expectedType}`, async () => {
      const app = buildApp();
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain(expectedType);
    });
  }
});
