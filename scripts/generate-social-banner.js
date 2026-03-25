#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.
//
// Generates assets/social-banner.svg and assets/social-banner.png (1200x630, OpenGraph)
// Run: node scripts/generate-social-banner.js

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ASSETS = join(ROOT, "assets");

mkdirSync(ASSETS, { recursive: true });

const W = 1200;
const H = 630;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Colors — light background, teal brand
const C_BG       = "#f0fafa";
const C_BG2      = "#ffffff";
const C_TEAL     = "#1a5c5c";
const C_TEAL_MED = "#2e8b8b";
const C_TEAL_LITE= "#e6f4f4";
const C_ACCENT   = "#f59e0b";
const C_DARK     = "#0f3d3d";
const C_MUTED    = "#64748b";
const C_WHITE    = "#ffffff";
const C_BORDER   = "#c8e0e0";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const parts = [];

parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);

// Background gradient via two rects
parts.push(`<defs>
  <linearGradient id="bggrad" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${C_BG}"/>
    <stop offset="100%" stop-color="${C_BG2}"/>
  </linearGradient>
  <linearGradient id="sidegrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${C_TEAL}"/>
    <stop offset="100%" stop-color="${C_TEAL_MED}"/>
  </linearGradient>
</defs>`);

// Background
parts.push(`<rect width="${W}" height="${H}" fill="url(#bggrad)"/>`);

// Left accent bar (teal sidebar, gives identity)
parts.push(`<rect x="0" y="0" width="12" height="${H}" fill="url(#sidegrad)"/>`);

// Right decorative panel
parts.push(`<rect x="820" y="0" width="380" height="${H}" fill="${C_TEAL_LITE}" opacity="0.6"/>`);
parts.push(`<rect x="820" y="0" width="2" height="${H}" fill="${C_BORDER}"/>`);

// Horizontal accent lines on right panel
for (let i = 0; i < 6; i++) {
  const y = 80 + i * 88;
  parts.push(`<line x1="840" y1="${y}" x2="1180" y2="${y}" stroke="${C_BORDER}" stroke-width="1"/>`);
}

// Pipeline stages on right panel (mini visualization)
const STAGES = [
  { label: "S1 Forbidden",    fill: "#fee2e2", stroke: "#ef4444", text: "#991b1b" },
  { label: "S2 Approval",     fill: "#fef3c7", stroke: "#f59e0b", text: "#92400e" },
  { label: "S3 Budget",       fill: "#d1fae5", stroke: "#10b981", text: "#065f46" },
  { label: "S4 Classify",     fill: "#e0e7ff", stroke: "#6366f1", text: "#3730a3" },
  { label: "S5 Policy",       fill: "#f0fdf4", stroke: "#22c55e", text: "#15803d" },
];

const stageW = 150;
const stageH = 36;
let sy = 110;

parts.push(`<text x="1000" y="88" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="600" fill="${C_MUTED}">PRE-ACTION PIPELINE</text>`);

STAGES.forEach(({ label, fill, stroke, text }) => {
  parts.push(`<rect x="920" y="${sy}" width="${stageW}" height="${stageH}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`);
  parts.push(`<text x="995" y="${sy + 23}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="600" fill="${text}">${esc(label)}</text>`);
  if (sy + stageH + 12 < 110 + STAGES.length * (stageH + 16)) {
    const arrY = sy + stageH + 8;
    parts.push(`<line x1="995" y1="${sy + stageH + 2}" x2="995" y2="${arrY - 2}" stroke="${C_MUTED}" stroke-width="1.5"/>`);
    parts.push(`<polygon points="995,${arrY} 990,${arrY - 6} 1000,${arrY - 6}" fill="${C_MUTED}"/>`);
  }
  sy += stageH + 16;
});

// "✓ cleared" badge at bottom of pipeline
parts.push(`<rect x="940" y="${sy + 4}" width="110" height="28" rx="14" fill="${C_TEAL}" opacity="0.9"/>`);
parts.push(`<text x="995" y="${sy + 23}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="${C_WHITE}">✓ cleared</text>`);

// Left content area
// Logo/brand mark: teal square with "S"
parts.push(`<rect x="44" y="60" width="72" height="72" rx="16" fill="${C_TEAL}"/>`);
parts.push(`<text x="80" y="117" text-anchor="middle" font-family="${FONT}" font-size="48" font-weight="700" fill="${C_WHITE}">S</text>`);

// Product name
parts.push(`<text x="132" y="100" text-anchor="start" font-family="${FONT}" font-size="42" font-weight="800" fill="${C_DARK}">SIDJUA</text>`);
parts.push(`<text x="132" y="128" text-anchor="start" font-family="${FONT}" font-size="14" font-weight="400" fill="${C_MUTED}">AI Agent Governance Platform</text>`);

// Tagline
parts.push(`<text x="44" y="195" text-anchor="start" font-family="${FONT}" font-size="28" font-weight="700" fill="${C_DARK}">Governance by Architecture.</text>`);
parts.push(`<text x="44" y="235" text-anchor="start" font-family="${FONT}" font-size="28" font-weight="700" fill="${C_TEAL}">Not by hoping.</text>`);

// Sub-tagline
parts.push(`<text x="44" y="285" text-anchor="start" font-family="${FONT}" font-size="17" font-weight="400" fill="${C_MUTED}">Every agent action checked before execution —</text>`);
parts.push(`<text x="44" y="308" text-anchor="start" font-family="${FONT}" font-size="17" font-weight="400" fill="${C_MUTED}">outside the model, enforced in code.</text>`);

// Feature pills row
const PILLS = ["Self-Hosted", "Air-Gap Capable", "Any LLM", "AGPL-3.0"];
let px = 44;
const pillY = 350;
PILLS.forEach((pill) => {
  const pw = pill.length * 9 + 32;
  parts.push(`<rect x="${px}" y="${pillY}" width="${pw}" height="32" rx="16" fill="${C_TEAL_LITE}" stroke="${C_BORDER}" stroke-width="1.5"/>`);
  parts.push(`<text x="${px + pw / 2}" y="${pillY + 21}" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="500" fill="${C_TEAL}">${esc(pill)}</text>`);
  px += pw + 12;
});

// Docker quickstart box
parts.push(`<rect x="44" y="415" width="720" height="64" rx="10" fill="${C_DARK}"/>`);
parts.push(`<text x="68" y="440" text-anchor="start" font-family="'Courier New', Courier, monospace" font-size="13" font-weight="400" fill="#94a3b8">$ </text>`);
parts.push(`<text x="84" y="440" text-anchor="start" font-family="'Courier New', Courier, monospace" font-size="13" font-weight="400" fill="#4ade80">docker run</text>`);
parts.push(`<text x="168" y="440" text-anchor="start" font-family="'Courier New', Courier, monospace" font-size="13" font-weight="400" fill="${C_WHITE}"> -p 4200:4200 sidjua/sidjua:latest</text>`);
parts.push(`<text x="68" y="462" text-anchor="start" font-family="'Courier New', Courier, monospace" font-size="12" font-weight="400" fill="#94a3b8"># No API keys, no config, no signup — open http://localhost:4200</text>`);

// Bottom bar
parts.push(`<rect x="0" y="${H - 56}" width="${W}" height="56" fill="${C_TEAL}" opacity="0.07"/>`);
parts.push(`<line x1="0" y1="${H - 56}" x2="${W}" y2="${H - 56}" stroke="${C_BORDER}" stroke-width="1"/>`);

parts.push(`<text x="44" y="${H - 24}" text-anchor="start" font-family="${FONT}" font-size="14" font-weight="600" fill="${C_TEAL}">sidjua.com</text>`);
parts.push(`<text x="180" y="${H - 24}" text-anchor="start" font-family="${FONT}" font-size="14" font-weight="400" fill="${C_MUTED}">·</text>`);
parts.push(`<text x="196" y="${H - 24}" text-anchor="start" font-family="${FONT}" font-size="14" font-weight="400" fill="${C_MUTED}">Open Source · AGPL-3.0</text>`);
parts.push(`<text x="${W - 44}" y="${H - 24}" text-anchor="end" font-family="${FONT}" font-size="14" font-weight="400" fill="${C_MUTED}">v1.0.0</text>`);

parts.push(`</svg>`);

const svg = parts.join("\n");

// Write SVG
const svgPath = join(ASSETS, "social-banner.svg");
writeFileSync(svgPath, svg, "utf-8");
console.log(`Written: ${svgPath}`);

// Write PNG via sharp
let sharp;
try {
  const req = createRequire(import.meta.url);
  sharp = req("sharp");
} catch (_e) {
  console.log("sharp not available — PNG skipped (SVG only)");
  process.exit(0);
}

const pngPath = join(ASSETS, "social-banner.png");
await sharp(Buffer.from(svg))
  .png()
  .toFile(pngPath);
console.log(`Written: ${pngPath}`);
