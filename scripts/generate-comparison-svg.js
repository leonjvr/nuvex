#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.
//
// Generates assets/comparison-table.svg and assets/comparison-table.png
// Run: node scripts/generate-comparison-svg.js

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ASSETS = join(ROOT, "assets");

mkdirSync(ASSETS, { recursive: true });

// ---------------------------------------------------------------------------
// Table data
// ---------------------------------------------------------------------------

const FEATURES = [
  { label: "External Governance Layer",    sidjua: "✅",           crewai: "❌",     autogen: "❌",    langgraph: "❌",   openclaw: "❌"    },
  { label: "Pre-Action Enforcement",       sidjua: "✅ 5-Step",    crewai: "❌",     autogen: "❌",    langgraph: "❌",   openclaw: "❌"    },
  { label: "EU AI Act Ready",              sidjua: "✅",           crewai: "❌",     autogen: "❌",    langgraph: "❌",   openclaw: "❌"    },
  { label: "Self-Hosted",                  sidjua: "✅",           crewai: "Cloud",  autogen: "Cloud", langgraph: "Cloud",openclaw: "Plugin"},
  { label: "Air-Gap Capable",              sidjua: "✅",           crewai: "❌",     autogen: "❌",    langgraph: "❌",   openclaw: "❌"    },
  { label: "Any LLM Provider",             sidjua: "✅",           crewai: "Partial",autogen: "Partial",langgraph:"Partial",openclaw:"✅"   },
  { label: "Email Communication",          sidjua: "✅",           crewai: "❌",     autogen: "❌",    langgraph: "❌",   openclaw: "❌"    },
  { label: "Budget Enforcement",           sidjua: "✅",           crewai: "❌",     autogen: "❌",    langgraph: "❌",   openclaw: "❌"    },
  { label: "Independent Security Audits",  sidjua: "✅ 2 Auditors",crewai: "❌",     autogen: "❌",    langgraph: "❌",   openclaw: "❌"    },
  { label: "Open Source License",          sidjua: "AGPL-3.0",    crewai: "MIT",    autogen: "MIT",   langgraph: "MIT",  openclaw: "Mixed" },
  { label: "Docker One-Liner",             sidjua: "✅",           crewai: "❌",     autogen: "❌",    langgraph: "❌",   openclaw: "❌"    },
];

const HEADERS = ["Feature", "SIDJUA", "CrewAI", "AutoGen", "LangGraph", "OpenClaw"];

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const W = 1200;
const H = 800;
const TITLE_H = 60;
const FOOTER_H = 36;
const TABLE_TOP = TITLE_H + 16;
const TABLE_BOTTOM = H - FOOTER_H - 8;
const TABLE_H = TABLE_BOTTOM - TABLE_TOP;

const HEADER_ROW_H = 48;
const DATA_ROW_H = Math.floor((TABLE_H - HEADER_ROW_H) / FEATURES.length);

const COL_WIDTHS = [340, 148, 118, 118, 118, 118]; // sum = 960
const COL_X = [];
let cx = (W - COL_WIDTHS.reduce((a, b) => a + b, 0)) / 2;
for (const w of COL_WIDTHS) { COL_X.push(cx); cx += w; }

const TABLE_LEFT = COL_X[0];
const TABLE_RIGHT = COL_X[COL_X.length - 1] + COL_WIDTHS[COL_WIDTHS.length - 1];

// Colors
const C_HEADER_BG  = "#1a5c5c";
const C_HEADER_FG  = "#ffffff";
const C_SIDJUA_COL = "#e6f4f4";
const C_ROW_ODD    = "#ffffff";
const C_ROW_EVEN   = "#f5f9f9";
const C_BORDER     = "#d0e4e4";
const C_TITLE      = "#0f3d3d";
const C_FOOTER     = "#888888";
const C_CHECK      = "#16a34a";
const C_CROSS      = "#dc2626";
const C_PARTIAL    = "#b45309";
const C_NEUTRAL    = "#475569";
const FONT         = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellColor(value) {
  if (value.startsWith("✅")) return C_CHECK;
  if (value === "❌") return C_CROSS;
  if (value === "Partial" || value === "Plugin" || value === "Mixed") return C_PARTIAL;
  return C_NEUTRAL;
}

function cellText(value) {
  return value.replace("✅", "✓").replace("❌", "✗");
}

// ---------------------------------------------------------------------------
// Build SVG
// ---------------------------------------------------------------------------

const parts = [];

parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);

// Background
parts.push(`<rect width="${W}" height="${H}" fill="white" rx="12"/>`);

// Drop shadow on table (fake with a rect)
parts.push(`<rect x="${TABLE_LEFT - 1}" y="${TABLE_TOP - 1}" width="${TABLE_RIGHT - TABLE_LEFT + 2}" height="${TABLE_H + 2}" rx="8" fill="none" stroke="${C_BORDER}" stroke-width="1.5"/>`);

// Title
parts.push(`<text x="${W / 2}" y="${TITLE_H - 10}" text-anchor="middle" font-family="${FONT}" font-size="26" font-weight="700" fill="${C_TITLE}">How SIDJUA Compares</text>`);

// Header row background
parts.push(`<rect x="${TABLE_LEFT}" y="${TABLE_TOP}" width="${TABLE_RIGHT - TABLE_LEFT}" height="${HEADER_ROW_H}" rx="8" fill="${C_HEADER_BG}"/>`);
// Clip bottom rounded corners for subsequent rows
parts.push(`<rect x="${TABLE_LEFT}" y="${TABLE_TOP + HEADER_ROW_H / 2}" width="${TABLE_RIGHT - TABLE_LEFT}" height="${HEADER_ROW_H / 2}" fill="${C_HEADER_BG}"/>`);

// SIDJUA column highlight (full column behind data rows)
const sidjuaColIdx = 1;
const sidjuaX = COL_X[sidjuaColIdx];
const sidjuaW = COL_WIDTHS[sidjuaColIdx];
parts.push(`<rect x="${sidjuaX}" y="${TABLE_TOP + HEADER_ROW_H}" width="${sidjuaW}" height="${TABLE_H - HEADER_ROW_H}" fill="${C_SIDJUA_COL}"/>`);

// Data rows
FEATURES.forEach((row, i) => {
  const y = TABLE_TOP + HEADER_ROW_H + i * DATA_ROW_H;
  const bg = i % 2 === 0 ? C_ROW_ODD : C_ROW_EVEN;
  // Row background (except SIDJUA col which has its own tint)
  parts.push(`<rect x="${TABLE_LEFT}" y="${y}" width="${sidjuaX - TABLE_LEFT}" height="${DATA_ROW_H}" fill="${bg}"/>`);
  const afterSidjuaX = sidjuaX + sidjuaW;
  parts.push(`<rect x="${afterSidjuaX}" y="${y}" width="${TABLE_RIGHT - afterSidjuaX}" height="${DATA_ROW_H}" fill="${bg}"/>`);

  // Row separator
  if (i > 0) {
    parts.push(`<line x1="${TABLE_LEFT}" y1="${y}" x2="${TABLE_RIGHT}" y2="${y}" stroke="${C_BORDER}" stroke-width="0.75"/>`);
  }
});

// Last row — round bottom corners by clipping
const lastRowBottom = TABLE_TOP + TABLE_H;
parts.push(`<rect x="${TABLE_LEFT}" y="${lastRowBottom - 8}" width="${TABLE_RIGHT - TABLE_LEFT}" height="8" rx="0" fill="${C_ROW_EVEN}"/>`);

// Column separators (vertical lines within data area)
COL_X.slice(1).forEach((x) => {
  parts.push(`<line x1="${x}" y1="${TABLE_TOP}" x2="${x}" y2="${lastRowBottom}" stroke="${C_BORDER}" stroke-width="0.75"/>`);
});

// Header text
HEADERS.forEach((header, i) => {
  const x = COL_X[i] + COL_WIDTHS[i] / 2;
  const y = TABLE_TOP + HEADER_ROW_H / 2 + 6;
  const weight = i === 1 ? "700" : "600";
  parts.push(`<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="${weight}" fill="${C_HEADER_FG}">${esc(header)}</text>`);
});

// Data cells
FEATURES.forEach((row, rowIdx) => {
  const rowY = TABLE_TOP + HEADER_ROW_H + rowIdx * DATA_ROW_H + DATA_ROW_H / 2 + 5;

  const values = [row.label, row.sidjua, row.crewai, row.autogen, row.langgraph, row.openclaw];

  values.forEach((val, colIdx) => {
    const x = COL_X[colIdx] + (colIdx === 0 ? 12 : COL_WIDTHS[colIdx] / 2);
    const anchor = colIdx === 0 ? "start" : "middle";
    const color = colIdx === 0 ? C_TITLE : cellColor(val);
    const weight = colIdx === 0 ? "500" : (val.startsWith("✅") ? "600" : "400");
    const display = colIdx === 0 ? esc(val) : esc(cellText(val));
    const fontSize = colIdx === 0 ? "14" : "13";

    parts.push(`<text x="${x}" y="${rowY}" text-anchor="${anchor}" font-family="${FONT}" font-size="${fontSize}" font-weight="${weight}" fill="${color}">${display}</text>`);
  });
});

// SIDJUA column label ("Highlighted")
parts.push(`<rect x="${sidjuaX + 16}" y="${TABLE_TOP + 4}" width="${sidjuaW - 32}" height="18" rx="9" fill="rgba(255,255,255,0.25)"/>`);
parts.push(`<text x="${sidjuaX + sidjuaW / 2}" y="${TABLE_TOP + 17}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="rgba(255,255,255,0.9)">★ OUR PICK</text>`);

// Footer
parts.push(`<text x="${W / 2}" y="${H - 12}" text-anchor="middle" font-family="${FONT}" font-size="12" fill="${C_FOOTER}">sidjua.com · AGPL-3.0 Open Source · v1.0.0</text>`);

parts.push(`</svg>`);

const svg = parts.join("\n");

// ---------------------------------------------------------------------------
// Write SVG
// ---------------------------------------------------------------------------

const svgPath = join(ASSETS, "comparison-table.svg");
writeFileSync(svgPath, svg, "utf-8");
console.log(`Written: ${svgPath}`);

// ---------------------------------------------------------------------------
// Write PNG via sharp
// ---------------------------------------------------------------------------

let sharp;
try {
  const req = createRequire(import.meta.url);
  sharp = req("sharp");
} catch (_e) {
  console.log("sharp not available — PNG skipped (SVG only)");
  process.exit(0);
}

const pngPath = join(ASSETS, "comparison-table.png");
await sharp(Buffer.from(svg))
  .png()
  .toFile(pngPath);
console.log(`Written: ${pngPath}`);
