// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * PWA static asset routes.
 *
 * Serves the Web App Manifest, Service Worker, offline fallback page, and
 * placeholder icons.  All assets are self-contained — zero external requests.
 *
 * The Service Worker must be served from the app root (/) for the default
 * scope to cover the whole origin.
 */

import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createSolidColorPNG, createFaviconIco, BRAND_COLOR } from "../png-utils.js";


const MANIFEST = JSON.stringify({
  name:             "SIDJUA Management Console",
  short_name:       "SIDJUA",
  description:      "AI Agent Governance Platform",
  start_url:        "/",
  display:          "standalone",
  background_color: "#ffffff",
  theme_color:      "#2563eb",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2);


const SERVICE_WORKER = `// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.
'use strict';

const CACHE_NAME = 'sidjua-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
  }
});
`;


const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SIDJUA — Offline</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f9fafb;
      color: #111827;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 48px 40px;
      max-width: 440px;
      width: 100%;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .icon {
      width: 56px; height: 56px;
      background: #eff6ff;
      border-radius: 50%;
      margin: 0 auto 24px;
      display: flex; align-items: center; justify-content: center;
    }
    .icon svg { width: 28px; height: 28px; color: #2563eb; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    p  { font-size: 15px; color: #6b7280; line-height: 1.6; margin-bottom: 24px; }
    .badge {
      display: inline-flex; align-items: center; gap: 8px;
      background: #fef3c7; color: #92400e;
      padding: 6px 14px; border-radius: 999px;
      font-size: 13px; font-weight: 500;
    }
    .dot {
      width: 8px; height: 8px;
      background: #f59e0b;
      border-radius: 50%;
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.3; }
    }
    .countdown { font-size: 12px; color: #9ca3af; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M8.111 16.404a5.5 5.5 0 0 1 7.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.143 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"/>
      </svg>
    </div>
    <h1>SIDJUA is offline</h1>
    <p>The server may be restarting or temporarily unreachable.<br>This page will reconnect automatically.</p>
    <div class="badge">
      <span class="dot" aria-hidden="true"></span>
      <span id="status-text">Reconnecting…</span>
    </div>
    <p class="countdown" id="countdown"></p>
  </div>
  <script>
    let retryIn = 5;
    function tick() {
      document.getElementById('countdown').textContent =
        'Next attempt in ' + retryIn + ' second' + (retryIn !== 1 ? 's' : '') + '…';
      retryIn--;
      if (retryIn < 0) {
        document.getElementById('status-text').textContent = 'Checking…';
        document.getElementById('countdown').textContent = '';
        fetch('/', { method: 'HEAD' })
          .then(() => { location.reload(); })
          .catch(() => { retryIn = 5; setTimeout(tick, 1000); });
      } else {
        setTimeout(tick, 1000);
      }
    }
    setTimeout(tick, 1000);
  </script>
</body>
</html>`;


const _iconCache = new Map<string, Buffer>();
let _faviconCache: Buffer | undefined;

function getIcon(size: 192 | 512 | 180, iconDir?: string): Buffer {
  const key = String(size);
  if (_iconCache.has(key)) return _iconCache.get(key)!;

  // Prefer a real icon file on disk (placed by the operator or build pipeline)
  if (iconDir) {
    const namemap: Record<number, string> = {
      192: "icon-192.png",
      512: "icon-512.png",
      180: "apple-touch-icon.png",
    };
    const filePath = join(iconDir, namemap[size]!);
    if (existsSync(filePath)) {
      const data = readFileSync(filePath);
      _iconCache.set(key, data);
      return data;
    }
  }

  // Generate a solid-brand-colour placeholder
  const { r, g, b } = BRAND_COLOR;
  const png = createSolidColorPNG(size, size, r, g, b);
  _iconCache.set(key, png);
  return png;
}


export interface PwaRouteOptions {
  /**
   * Directory on disk where real icon files may live (icon-192.png,
   * icon-512.png, apple-touch-icon.png).  If absent or files not found,
   * brand-coloured placeholder PNGs are generated in memory.
   */
  iconDir?: string | undefined;
}

export function registerPwaRoutes(app: Hono, options: PwaRouteOptions = {}): void {
  const { iconDir } = options;

  // PWA manifest
  app.get("/manifest.json", (c) => {
    return c.body(MANIFEST, 200, {
      "Content-Type":  "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
  });

  // Service worker — must be at root scope
  app.get("/sw.js", (c) => {
    return c.body(SERVICE_WORKER, 200, {
      "Content-Type":  "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    });
  });

  // Offline fallback page
  app.get("/offline.html", (c) => {
    return c.body(OFFLINE_HTML, 200, {
      "Content-Type":  "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    });
  });

  // Serve PNG icon — convert Node Buffer to Uint8Array for Hono compatibility
  function serveIcon(size: 192 | 512 | 180): Response {
    const buf  = getIcon(size, iconDir);
    const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return new Response(data, {
      status:  200,
      headers: {
        "Content-Type":  "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  app.get("/icons/icon-192.png",        () => serveIcon(192));
  app.get("/icons/icon-512.png",        () => serveIcon(512));
  app.get("/icons/apple-touch-icon.png", () => serveIcon(180));

  // Favicon (32×32 ICO containing a PNG image)
  app.get("/favicon.ico", () => {
    if (!_faviconCache) {
      const { r, g, b } = BRAND_COLOR;
      _faviconCache = createFaviconIco(r, g, b);
    }
    const buf  = _faviconCache;
    const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return new Response(data, {
      status:  200,
      headers: {
        "Content-Type":  "image/x-icon",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });
}
