// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * PWA manifest, service worker, offline page, and icon route tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerPwaRoutes } from "../../src/api/routes/pwa.js";
import { createSolidColorPNG, BRAND_COLOR } from "../../src/api/png-utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(): Hono {
  const app = new Hono();
  registerPwaRoutes(app);
  return app;
}

// ---------------------------------------------------------------------------
// PNG utility unit tests
// ---------------------------------------------------------------------------

describe("createSolidColorPNG", () => {
  it("returns a Buffer starting with PNG signature", () => {
    const png = createSolidColorPNG(4, 4, 37, 99, 235);
    // PNG magic bytes: 137 80 78 71 13 10 26 10
    expect(png[0]).toBe(137);
    expect(png[1]).toBe(80);
    expect(png[2]).toBe(78);
    expect(png[3]).toBe(71);
  });

  it("contains IHDR, IDAT, IEND chunk markers", () => {
    const png = createSolidColorPNG(8, 8, 255, 0, 0);
    const str = png.toString("binary");
    expect(str).toContain("IHDR");
    expect(str).toContain("IDAT");
    expect(str).toContain("IEND");
  });

  it("generates non-empty buffer for 192x192", () => {
    const png = createSolidColorPNG(192, 192, BRAND_COLOR.r, BRAND_COLOR.g, BRAND_COLOR.b);
    expect(png.length).toBeGreaterThan(100);
  });

  it("BRAND_COLOR has expected RGB values for #2563eb", () => {
    expect(BRAND_COLOR.r).toBe(37);
    expect(BRAND_COLOR.g).toBe(99);
    expect(BRAND_COLOR.b).toBe(235);
  });
});

// ---------------------------------------------------------------------------
// /manifest.json
// ---------------------------------------------------------------------------

describe("GET /manifest.json", () => {
  it("returns 200 with manifest+json content-type", async () => {
    const res = await buildApp().request("/manifest.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
  });

  it("manifest contains required PWA fields", async () => {
    const res  = await buildApp().request("/manifest.json");
    const body = await res.json() as Record<string, unknown>;
    expect(body["name"]).toBe("SIDJUA Management Console");
    expect(body["short_name"]).toBe("SIDJUA");
    expect(body["start_url"]).toBe("/");
    expect(body["display"]).toBe("standalone");
    expect(body["theme_color"]).toBe("#2563eb");
    expect(Array.isArray(body["icons"])).toBe(true);
  });

  it("manifest icons list has 192 and 512 sizes", async () => {
    const res   = await buildApp().request("/manifest.json");
    const body  = await res.json() as { icons: Array<{ sizes: string; src: string }> };
    const sizes = body.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });
});

// ---------------------------------------------------------------------------
// /sw.js
// ---------------------------------------------------------------------------

describe("GET /sw.js", () => {
  it("returns 200 with javascript content-type", async () => {
    const res = await buildApp().request("/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("service worker includes install, activate, fetch listeners", async () => {
    const res  = await buildApp().request("/sw.js");
    const body = await res.text();
    expect(body).toContain("install");
    expect(body).toContain("activate");
    expect(body).toContain("fetch");
    expect(body).toContain("CACHE_NAME");
    expect(body).toContain("OFFLINE_URL");
  });

  it("sw.js has no-cache header (SW must not be cached by browser)", async () => {
    const res = await buildApp().request("/sw.js");
    expect(res.headers.get("cache-control")).toContain("no-cache");
  });

  it("sw.js has Service-Worker-Allowed: / header for root scope", async () => {
    const res = await buildApp().request("/sw.js");
    expect(res.headers.get("service-worker-allowed")).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// /offline.html
// ---------------------------------------------------------------------------

describe("GET /offline.html", () => {
  it("returns 200 with text/html content-type", async () => {
    const res = await buildApp().request("/offline.html");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("offline page contains SIDJUA branding and auto-retry script", async () => {
    const res  = await buildApp().request("/offline.html");
    const body = await res.text();
    expect(body).toContain("SIDJUA");
    expect(body).toContain("offline");
    expect(body).toContain("location.reload");
  });
});

// ---------------------------------------------------------------------------
// Icon routes
// ---------------------------------------------------------------------------

describe("GET /icons/*", () => {
  it("returns 200 with image/png for icon-192.png", async () => {
    const res = await buildApp().request("/icons/icon-192.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("returns 200 with image/png for icon-512.png", async () => {
    const res = await buildApp().request("/icons/icon-512.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("returns 200 with image/png for apple-touch-icon.png", async () => {
    const res = await buildApp().request("/icons/apple-touch-icon.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("placeholder icon body starts with PNG signature bytes", async () => {
    const res  = await buildApp().request("/icons/icon-192.png");
    const buf  = Buffer.from(await res.arrayBuffer());
    expect(buf[0]).toBe(137);
    expect(buf[1]).toBe(80);
    expect(buf[2]).toBe(78);
    expect(buf[3]).toBe(71);
  });

  it("icon has a long cache-control header", async () => {
    const res = await buildApp().request("/icons/icon-192.png");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });
});
