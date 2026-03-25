#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.
//
// Generates assets/architecture-diagram.svg
// Run: node scripts/generate-architecture-svg.js

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ASSETS = join(ROOT, "assets");

mkdirSync(ASSETS, { recursive: true });

const W = 1200;
const H = 900;
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Colors
const C_BG        = "#ffffff";
const C_BORDER    = "#d1e7e7";
const C_TEAL      = "#1a5c5c";
const C_TEAL_LITE = "#e6f4f4";
const C_TEAL_MED  = "#2e8b8b";
const C_BLUE      = "#dbeafe";
const C_BLUE_DARK = "#1e40af";
const C_GRAY      = "#f1f5f9";
const C_GRAY_DARK = "#475569";
const C_TITLE     = "#0f3d3d";
const C_SHADOW    = "rgba(0,0,0,0.07)";
const C_ARROW     = "#64748b";
const C_GOVERN_BG = "#fff7ed";
const C_GOVERN_BD = "#f59e0b";
const C_GOVERN_TXT= "#92400e";
const C_WHITE     = "#ffffff";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function box(x, y, w, h, opts = {}) {
  const {
    fill = C_GRAY, stroke = C_BORDER, rx = 8, sw = 1.5,
    shadow = false,
  } = opts;
  const parts = [];
  if (shadow) {
    parts.push(`<rect x="${x + 3}" y="${y + 3}" width="${w}" height="${h}" rx="${rx}" fill="${C_SHADOW}"/>`);
  }
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
  return parts.join("\n");
}

function label(x, y, text, opts = {}) {
  const { size = 14, weight = "500", fill = C_GRAY_DARK, anchor = "middle" } = opts;
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`;
}

function arrow(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = dx / len;
  const ny = dy / len;
  const ax = x2 - nx * 8 - ny * 5;
  const ay = y2 - ny * 8 + nx * 5;
  const bx = x2 - nx * 8 + ny * 5;
  const by = y2 - ny * 8 - nx * 5;
  return [
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C_ARROW}" stroke-width="1.5" marker-end="url(#arr)"/>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// Build SVG
// ---------------------------------------------------------------------------

const parts = [];

parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);

// Defs: arrowhead
parts.push(`<defs>
  <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L0,6 L8,3 z" fill="${C_ARROW}"/>
  </marker>
</defs>`);

// Background
parts.push(`<rect width="${W}" height="${H}" fill="${C_BG}"/>`);

// Title
parts.push(label(W / 2, 44, "SIDJUA Platform Architecture", { size: 28, weight: "700", fill: C_TITLE }));
parts.push(label(W / 2, 68, "Governance by Architecture — Every action checked before execution", { size: 14, weight: "400", fill: "#64748b" }));

// --- Row 1: Entry points ---
const R1_Y = 100;
const R1_H = 60;
const ENTRY_BOXES = [
  { x: 80,  label: "CLI", sub: "sidjua command" },
  { x: 350, label: "Dashboard", sub: "Port 4200" },
  { x: 620, label: "REST API", sub: "/api/v1/*" },
  { x: 890, label: "SSE Stream", sub: "Real-time events" },
];
ENTRY_BOXES.forEach(({ x, label: lbl, sub }) => {
  parts.push(box(x, R1_Y, 200, R1_H, { fill: C_BLUE, stroke: C_BLUE_DARK, rx: 8 }));
  parts.push(label(x + 100, R1_Y + 26, lbl, { size: 14, weight: "600", fill: C_BLUE_DARK }));
  parts.push(label(x + 100, R1_Y + 44, sub, { size: 11, weight: "400", fill: "#60a5fa" }));
});

// --- Arrow: entry → agent manager ---
const AGT_MGR_Y = 210;
const AGT_MGR_H = 54;
const AGT_MGR_X = 100;
const AGT_MGR_W = 1000;
const AGT_MID_Y = (R1_Y + R1_H + AGT_MGR_Y) / 2;

// Collect line down from each entry box center
ENTRY_BOXES.forEach(({ x }) => {
  const bx = x + 100;
  parts.push(`<line x1="${bx}" y1="${R1_Y + R1_H}" x2="${bx}" y2="${AGT_MID_Y}" stroke="${C_ARROW}" stroke-width="1.5"/>`);
});
// Horizontal bar
parts.push(`<line x1="${ENTRY_BOXES[0].x + 100}" y1="${AGT_MID_Y}" x2="${ENTRY_BOXES[3].x + 100}" y2="${AGT_MID_Y}" stroke="${C_ARROW}" stroke-width="1.5"/>`);
// Line down to manager
const midX = (ENTRY_BOXES[0].x + 100 + ENTRY_BOXES[3].x + 100) / 2;
parts.push(arrow(midX, AGT_MID_Y, midX, AGT_MGR_Y));

// Agent lifecycle manager box
parts.push(box(AGT_MGR_X, AGT_MGR_Y, AGT_MGR_W, AGT_MGR_H, { fill: C_TEAL_LITE, stroke: C_TEAL_MED, rx: 8, shadow: true }));
parts.push(label(AGT_MGR_X + AGT_MGR_W / 2, AGT_MGR_Y + 25, "Agent Lifecycle Manager", { size: 15, weight: "600", fill: C_TEAL }));
parts.push(label(AGT_MGR_X + AGT_MGR_W / 2, AGT_MGR_Y + 43, "Orchestrator · Task pipeline · Division routing · Budget accounting", { size: 11, weight: "400", fill: "#2e8b8b" }));

// --- Arrow: manager → governance ---
const GOV_Y = 310;
const GOV_H = 110;
parts.push(arrow(midX, AGT_MGR_Y + AGT_MGR_H, midX, GOV_Y));

// Governance Pipeline (highlighted — THE differentiator)
parts.push(box(AGT_MGR_X, GOV_Y, AGT_MGR_W, GOV_H, { fill: C_GOVERN_BG, stroke: C_GOVERN_BD, rx: 8, sw: 2, shadow: true }));
parts.push(label(AGT_MGR_X + AGT_MGR_W / 2, GOV_Y + 22, "Stage 0 — Pre-Action Governance Pipeline", { size: 16, weight: "700", fill: C_GOVERN_TXT }));
parts.push(label(AGT_MGR_X + AGT_MGR_W / 2, GOV_Y + 40, "Every agent action is checked here BEFORE execution", { size: 11, weight: "400", fill: "#b45309" }));

const STAGES = [
  { label: "S1\nForbidden", fill: "#fee2e2", stroke: "#ef4444", text: "#991b1b" },
  { label: "S2\nApproval",  fill: "#fef3c7", stroke: "#f59e0b", text: "#92400e" },
  { label: "S3\nBudget",    fill: "#d1fae5", stroke: "#10b981", text: "#065f46" },
  { label: "S4\nClassify",  fill: "#e0e7ff", stroke: "#6366f1", text: "#3730a3" },
  { label: "S5\nPolicy",    fill: "#f0fdf4", stroke: "#22c55e", text: "#15803d" },
];

const STAGE_W = 148;
const STAGE_H = 54;
const STAGE_GAP = 28;
const STAGES_TOTAL = STAGES.length * STAGE_W + (STAGES.length - 1) * STAGE_GAP;
let sx = AGT_MGR_X + (AGT_MGR_W - STAGES_TOTAL) / 2;
const STAGE_Y = GOV_Y + 48;

STAGES.forEach(({ label: lbl, fill, stroke, text }, i) => {
  parts.push(box(sx, STAGE_Y, STAGE_W, STAGE_H, { fill, stroke, rx: 6, sw: 1.5 }));
  const lines = lbl.split("\n");
  parts.push(label(sx + STAGE_W / 2, STAGE_Y + 20, lines[0], { size: 13, weight: "700", fill: text }));
  parts.push(label(sx + STAGE_W / 2, STAGE_Y + 36, lines[1], { size: 11, weight: "500", fill: text }));
  if (i < STAGES.length - 1) {
    const arrX = sx + STAGE_W;
    const arrY = STAGE_Y + STAGE_H / 2;
    parts.push(`<line x1="${arrX + 2}" y1="${arrY}" x2="${arrX + STAGE_GAP - 4}" y2="${arrY}" stroke="${C_ARROW}" stroke-width="1.5" marker-end="url(#arr)"/>`);
  }
  sx += STAGE_W + STAGE_GAP;
});

// "✅ cleared" label
const clearedX = AGT_MGR_X + AGT_MGR_W + 8;
parts.push(label(clearedX, GOV_Y + GOV_H / 2 + 4, "✓ cleared", { size: 12, weight: "600", fill: "#16a34a", anchor: "start" }));

// --- Arrow: governance → bottom row ---
const BOT_Y = 470;
const BOT_H = 80;
parts.push(arrow(midX, GOV_Y + GOV_H, midX, BOT_Y));

// Bottom row: 3 boxes
const BOT_BOXES = [
  { x: 80,  w: 280, label: "Agent Runtime", sub: "Any LLM provider\nAnthropic · Groq · Ollama · Any", fill: C_TEAL_LITE, stroke: C_TEAL_MED, tc: C_TEAL },
  { x: 460, w: 280, label: "Division Config", sub: "YAML governance rules\nTiers · Budgets · Secrets", fill: C_GRAY, stroke: C_BORDER, tc: C_GRAY_DARK },
  { x: 840, w: 280, label: "Communication Channels", sub: "Email · Discord · Telegram\nBidirectional agents", fill: C_GRAY, stroke: C_BORDER, tc: C_GRAY_DARK },
];

const BOT_MID_Y = (GOV_Y + GOV_H + BOT_Y) / 2;
// Fan-out arrows
BOT_BOXES.forEach(({ x, w }) => {
  const bx = x + w / 2;
  parts.push(`<line x1="${midX}" y1="${BOT_MID_Y}" x2="${bx}" y2="${BOT_MID_Y}" stroke="${C_ARROW}" stroke-width="1.5"/>`);
  parts.push(arrow(bx, BOT_MID_Y, bx, BOT_Y));
});
parts.push(`<line x1="${BOT_BOXES[0].x + BOT_BOXES[0].w / 2}" y1="${BOT_MID_Y}" x2="${BOT_BOXES[2].x + BOT_BOXES[2].w / 2}" y2="${BOT_MID_Y}" stroke="${C_ARROW}" stroke-width="1.5"/>`);

BOT_BOXES.forEach(({ x, w, label: lbl, sub, fill, stroke, tc }) => {
  parts.push(box(x, BOT_Y, w, BOT_H, { fill, stroke, rx: 8 }));
  parts.push(label(x + w / 2, BOT_Y + 26, lbl, { size: 14, weight: "600", fill: tc }));
  sub.split("\n").forEach((line, i) => {
    parts.push(label(x + w / 2, BOT_Y + 44 + i * 16, line, { size: 11, weight: "400", fill: tc === C_TEAL ? "#2e8b8b" : C_GRAY_DARK }));
  });
});

// --- Bottom row 2: SQLite + Audit ---
const BOT2_Y = 600;
const BOT2_H = 70;
const BOT2_BOXES = [
  { x: 80,  w: 280, label: "SQLite per Agent", sub: "No external database\nAll data local + portable" },
  { x: 840, w: 280, label: "Audit Trail (WAL)", sub: "Append-only · Integrity-verified\nTampered entries detected" },
];

BOT_BOXES.slice(0, 1).concat(BOT_BOXES.slice(2)).forEach(({ x, w }, i) => {
  const bx = x + w / 2;
  const destBx = BOT2_BOXES[i].x + BOT2_BOXES[i].w / 2;
  parts.push(arrow(bx, BOT_Y + BOT_H, destBx, BOT2_Y));
});

BOT2_BOXES.forEach(({ x, w, label: lbl, sub }) => {
  parts.push(box(x, BOT2_Y, w, BOT2_H, { fill: C_GRAY, stroke: C_BORDER, rx: 8 }));
  parts.push(label(x + w / 2, BOT2_Y + 24, lbl, { size: 13, weight: "600", fill: C_GRAY_DARK }));
  sub.split("\n").forEach((line, i) => {
    parts.push(label(x + w / 2, BOT2_Y + 40 + i * 15, line, { size: 10, weight: "400", fill: "#94a3b8" }));
  });
});

// Provider logos row
const PROV_Y = 720;
const PROVIDERS = ["Anthropic", "Google", "Groq", "Cloudflare", "Ollama", "Any OpenAI-compatible"];
const PROV_W = 150;
const PROV_TOTAL = PROVIDERS.length * PROV_W + (PROVIDERS.length - 1) * 20;
let px = (W - PROV_TOTAL) / 2;

parts.push(label(W / 2, PROV_Y - 8, "Supported LLM Providers", { size: 12, weight: "600", fill: "#94a3b8" }));

PROVIDERS.forEach((p) => {
  parts.push(box(px, PROV_Y, PROV_W, 36, { fill: C_GRAY, stroke: C_BORDER, rx: 18 }));
  parts.push(label(px + PROV_W / 2, PROV_Y + 23, p, { size: 11, weight: "500", fill: C_GRAY_DARK }));
  px += PROV_W + 20;
});

// Footer
parts.push(label(W / 2, H - 14, "sidjua.com · AGPL-3.0 Open Source · v1.0.0", { size: 12, weight: "400", fill: "#94a3b8" }));

parts.push(`</svg>`);

const svg = parts.join("\n");
const svgPath = join(ASSETS, "architecture-diagram.svg");
writeFileSync(svgPath, svg, "utf-8");
console.log(`Written: ${svgPath}`);
