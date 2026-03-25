#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.
//
// Generates dashboard screenshot mockups as SVG/PNG
// Run: node scripts/generate-screenshots.js

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ASSETS = join(ROOT, "assets", "screenshots");

mkdirSync(ASSETS, { recursive: true });

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Courier New', Courier, monospace";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Shared chrome (browser frame + sidebar)
// ---------------------------------------------------------------------------

function browserChrome(W, H, url) {
  const parts = [];
  // Outer frame
  parts.push(`<rect width="${W}" height="${H}" rx="10" fill="#f1f5f9" stroke="#d1d5db" stroke-width="1.5"/>`);
  // Title bar
  parts.push(`<rect x="0" y="0" width="${W}" height="40" rx="10" fill="#e2e8f0"/>`);
  parts.push(`<rect x="0" y="20" width="${W}" height="20" fill="#e2e8f0"/>`);
  // Traffic lights
  parts.push(`<circle cx="20" cy="20" r="6" fill="#ef4444"/>`);
  parts.push(`<circle cx="38" cy="20" r="6" fill="#f59e0b"/>`);
  parts.push(`<circle cx="56" cy="20" r="6" fill="#22c55e"/>`);
  // URL bar
  parts.push(`<rect x="90" y="10" width="${W - 160}" height="20" rx="4" fill="white" stroke="#d1d5db" stroke-width="1"/>`);
  parts.push(`<text x="${W / 2}" y="25" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#64748b">${esc(url)}</text>`);
  return parts.join("\n");
}

function sidebar(x, y, w, h, activeItem) {
  const ITEMS = ["Overview", "Agents", "Audit Trail", "Costs", "Settings"];
  const parts = [];
  // Sidebar bg
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#0f3d3d"/>`);
  // Logo area
  parts.push(`<rect x="${x + 14}" y="${y + 14}" width="32" height="32" rx="8" fill="#2e8b8b"/>`);
  parts.push(`<text x="${x + 30}" y="${y + 36}" text-anchor="middle" font-family="${FONT}" font-size="18" font-weight="700" fill="white">S</text>`);
  parts.push(`<text x="${x + 56}" y="${y + 28}" text-anchor="start" font-family="${FONT}" font-size="13" font-weight="700" fill="white">SIDJUA</text>`);
  parts.push(`<text x="${x + 56}" y="${y + 42}" text-anchor="start" font-family="${FONT}" font-size="10" fill="#94a3b8">v1.0.0</text>`);
  // Nav items
  ITEMS.forEach((item, i) => {
    const iy = y + 80 + i * 44;
    const active = item === activeItem;
    if (active) {
      parts.push(`<rect x="${x + 8}" y="${iy - 4}" width="${w - 16}" height="32" rx="6" fill="#1a5c5c"/>`);
    }
    const fill = active ? "white" : "#94a3b8";
    parts.push(`<text x="${x + 24}" y="${iy + 17}" text-anchor="start" font-family="${FONT}" font-size="13" font-weight="${active ? '600' : '400'}" fill="${fill}">${esc(item)}</text>`);
  });
  // Status indicator
  parts.push(`<circle cx="${x + 18}" cy="${y + h - 24}" r="5" fill="#22c55e"/>`);
  parts.push(`<text x="${x + 30}" y="${y + h - 20}" text-anchor="start" font-family="${FONT}" font-size="11" fill="#94a3b8">System healthy</text>`);
  return parts.join("\n");
}

function statCard(x, y, w, h, label, value, sub, color = "#1a5c5c") {
  return [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="white" stroke="#e2e8f0" stroke-width="1"/>`,
    `<text x="${x + 16}" y="${y + 22}" text-anchor="start" font-family="${FONT}" font-size="11" fill="#64748b">${esc(label)}</text>`,
    `<text x="${x + 16}" y="${y + 50}" text-anchor="start" font-family="${FONT}" font-size="26" font-weight="700" fill="${color}">${esc(value)}</text>`,
    `<text x="${x + 16}" y="${y + 68}" text-anchor="start" font-family="${FONT}" font-size="11" fill="#94a3b8">${esc(sub)}</text>`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Screenshot 1: Dashboard Overview
// ---------------------------------------------------------------------------

function generateOverview() {
  const W = 1280, H = 800;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#f8fafc"/>`);
  parts.push(browserChrome(W, H, "localhost:4200"));

  const contentY = 40;
  const sideW = 200;
  parts.push(sidebar(0, contentY, sideW, H - contentY, "Overview"));

  // Main content area
  const mx = sideW + 24;
  const mw = W - sideW - 48;
  const topH = 80;

  // Page header
  parts.push(`<text x="${mx}" y="${contentY + 36}" text-anchor="start" font-family="${FONT}" font-size="22" font-weight="700" fill="#0f3d3d">Overview</text>`);
  parts.push(`<text x="${mx}" y="${contentY + 56}" text-anchor="start" font-family="${FONT}" font-size="13" fill="#64748b">System status and governance metrics</text>`);

  // Stat cards row
  const cardY = contentY + topH;
  const cardW = Math.floor((mw - 48) / 4);
  const cardH = 88;
  const STATS = [
    { label: "Active Agents",    value: "12",      sub: "3 running now",       color: "#1a5c5c" },
    { label: "Tasks Today",      value: "247",     sub: "+18% vs yesterday",   color: "#1a5c5c" },
    { label: "Governance Checks",value: "1,483",   sub: "0 violations today",  color: "#16a34a" },
    { label: "Monthly Cost",     value: "$4.82",   sub: "$50.00 budget limit", color: "#0f3d3d" },
  ];
  STATS.forEach(({ label, value, sub, color }, i) => {
    parts.push(statCard(mx + i * (cardW + 16), cardY, cardW, cardH, label, value, sub, color));
  });

  // Agents table
  const tableY = cardY + cardH + 24;
  const tableH = H - tableY - 32;
  parts.push(`<rect x="${mx}" y="${tableY}" width="${mw}" height="${tableH}" rx="8" fill="white" stroke="#e2e8f0" stroke-width="1"/>`);
  parts.push(`<text x="${mx + 16}" y="${tableY + 24}" text-anchor="start" font-family="${FONT}" font-size="14" font-weight="600" fill="#0f3d3d">Agents</text>`);
  // Table header
  const thY = tableY + 36;
  parts.push(`<rect x="${mx}" y="${thY}" width="${mw}" height="32" fill="#f8fafc"/>`);
  parts.push(`<line x1="${mx}" y1="${thY}" x2="${mx + mw}" y2="${thY}" stroke="#e2e8f0" stroke-width="1"/>`);
  parts.push(`<line x1="${mx}" y1="${thY + 32}" x2="${mx + mw}" y2="${thY + 32}" stroke="#e2e8f0" stroke-width="1"/>`);
  const COLS = [{ x: 16, label: "Name" }, { x: 240, label: "Division" }, { x: 400, label: "Model" }, { x: 580, label: "Status" }, { x: 720, label: "Tasks" }, { x: 820, label: "Cost" }, { x: 920, label: "Tier" }];
  COLS.forEach(({ x, label }) => {
    parts.push(`<text x="${mx + x}" y="${thY + 21}" text-anchor="start" font-family="${FONT}" font-size="11" font-weight="600" fill="#64748b">${esc(label.toUpperCase())}</text>`);
  });

  // Agent rows
  const AGENTS = [
    { name: "research-agent",  div: "engineering",  model: "claude-haiku-4-5", status: "active",  tasks: "41", cost: "$0.82",  tier: "2" },
    { name: "ops-agent",       div: "operations",   model: "claude-haiku-4-5", status: "active",  tasks: "87", cost: "$1.74",  tier: "1" },
    { name: "report-agent",    div: "analytics",    model: "groq/llama-3.1",   status: "idle",    tasks: "23", cost: "$0.12",  tier: "2" },
    { name: "email-agent",     div: "comms",        model: "claude-haiku-4-5", status: "active",  tasks: "62", cost: "$1.24",  tier: "2" },
    { name: "audit-agent",     div: "compliance",   model: "claude-sonnet-4-6",status: "idle",    tasks: "18", cost: "$0.72",  tier: "1" },
    { name: "data-agent",      div: "engineering",  model: "ollama/mistral",   status: "stopped", tasks: "16", cost: "$0.00",  tier: "3" },
  ];
  const STATUS_COLORS = { active: "#16a34a", idle: "#f59e0b", stopped: "#94a3b8", error: "#ef4444" };
  AGENTS.forEach((agent, i) => {
    const ry = thY + 32 + i * 36;
    if (i % 2 === 0) {
      parts.push(`<rect x="${mx}" y="${ry}" width="${mw}" height="36" fill="#fafbfc"/>`);
    }
    if (i < AGENTS.length - 1) {
      parts.push(`<line x1="${mx + 16}" y1="${ry + 36}" x2="${mx + mw - 16}" y2="${ry + 36}" stroke="#f1f5f9" stroke-width="1"/>`);
    }
    const ty = ry + 23;
    parts.push(`<text x="${mx + 16}" y="${ty}" font-family="${FONT}" font-size="13" font-weight="500" fill="#0f3d3d">${esc(agent.name)}</text>`);
    parts.push(`<text x="${mx + 240}" y="${ty}" font-family="${FONT}" font-size="12" fill="#64748b">${esc(agent.div)}</text>`);
    parts.push(`<text x="${mx + 400}" y="${ty}" font-family="${FONT}" font-size="11" fill="#64748b">${esc(agent.model)}</text>`);
    // Status pill
    const sc = STATUS_COLORS[agent.status] || "#94a3b8";
    parts.push(`<rect x="${mx + 580}" y="${ry + 9}" width="60" height="18" rx="9" fill="${sc}" opacity="0.12"/>`);
    parts.push(`<circle cx="${mx + 592}" cy="${ry + 18}" r="4" fill="${sc}"/>`);
    parts.push(`<text x="${mx + 600}" y="${ry + 22}" font-family="${FONT}" font-size="11" fill="${sc}">${esc(agent.status)}</text>`);
    parts.push(`<text x="${mx + 720}" y="${ty}" font-family="${FONT}" font-size="12" fill="#64748b">${esc(agent.tasks)}</text>`);
    parts.push(`<text x="${mx + 820}" y="${ty}" font-family="${FONT}" font-size="12" fill="#64748b">${esc(agent.cost)}</text>`);
    parts.push(`<rect x="${mx + 920}" y="${ry + 9}" width="24" height="18" rx="4" fill="#e6f4f4"/>`);
    parts.push(`<text x="${mx + 932}" y="${ry + 22}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#1a5c5c">T${agent.tier}</text>`);
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Screenshot 2: Agent Detail
// ---------------------------------------------------------------------------

function generateAgentDetail() {
  const W = 1280, H = 800;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#f8fafc"/>`);
  parts.push(browserChrome(W, H, "localhost:4200/agents/ops-agent"));

  const contentY = 40;
  const sideW = 200;
  parts.push(sidebar(0, contentY, sideW, H - contentY, "Agents"));

  const mx = sideW + 24;
  const mw = W - sideW - 48;

  // Breadcrumb
  parts.push(`<text x="${mx}" y="${contentY + 26}" font-family="${FONT}" font-size="12" fill="#94a3b8">Agents</text>`);
  parts.push(`<text x="${mx + 52}" y="${contentY + 26}" font-family="${FONT}" font-size="12" fill="#94a3b8"> / </text>`);
  parts.push(`<text x="${mx + 64}" y="${contentY + 26}" font-family="${FONT}" font-size="12" font-weight="600" fill="#1a5c5c">ops-agent</text>`);

  // Agent header card
  const headerY = contentY + 36;
  parts.push(`<rect x="${mx}" y="${headerY}" width="${mw}" height="80" rx="8" fill="white" stroke="#e2e8f0" stroke-width="1"/>`);
  // Agent icon
  parts.push(`<rect x="${mx + 16}" y="${headerY + 16}" width="48" height="48" rx="12" fill="#1a5c5c"/>`);
  parts.push(`<text x="${mx + 40}" y="${headerY + 46}" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="700" fill="white">O</text>`);
  parts.push(`<text x="${mx + 80}" y="${headerY + 36}" font-family="${FONT}" font-size="20" font-weight="700" fill="#0f3d3d">ops-agent</text>`);
  parts.push(`<text x="${mx + 80}" y="${headerY + 55}" font-family="${FONT}" font-size="12" fill="#64748b">Division: operations · Tier 1 · claude-haiku-4-5-20251001</text>`);
  // Status badge
  parts.push(`<rect x="${mx + mw - 100}" y="${headerY + 24}" width="84" height="28" rx="14" fill="#dcfce7"/>`);
  parts.push(`<circle cx="${mx + mw - 87}" cy="${headerY + 38}" r="5" fill="#16a34a"/>`);
  parts.push(`<text x="${mx + mw - 78}" y="${headerY + 43}" font-family="${FONT}" font-size="12" font-weight="600" fill="#16a34a">● active</text>`);

  // Two-column layout
  const colY = headerY + 96;
  const col1W = Math.floor(mw * 0.62) - 12;
  const col2X = mx + col1W + 24;
  const col2W = mw - col1W - 24;

  // Tasks panel (left)
  const taskH = H - colY - 32;
  parts.push(`<rect x="${mx}" y="${colY}" width="${col1W}" height="${taskH}" rx="8" fill="white" stroke="#e2e8f0" stroke-width="1"/>`);
  parts.push(`<text x="${mx + 16}" y="${colY + 24}" font-family="${FONT}" font-size="14" font-weight="600" fill="#0f3d3d">Recent Tasks</text>`);

  const TASKS = [
    { id: "t-8821", desc: "Analyze Q1 sales report", status: "done",    cost: "$0.024", dur: "4.2s",  time: "2m ago"  },
    { id: "t-8820", desc: "Generate weekly summary", status: "done",    cost: "$0.018", dur: "3.1s",  time: "8m ago"  },
    { id: "t-8819", desc: "Check inventory levels",  status: "done",    cost: "$0.009", dur: "1.8s",  time: "15m ago" },
    { id: "t-8818", desc: "Email digest compilation",status: "done",    cost: "$0.031", dur: "5.6s",  time: "1h ago"  },
    { id: "t-8817", desc: "Policy compliance scan",  status: "failed",  cost: "$0.007", dur: "1.2s",  time: "2h ago"  },
    { id: "t-8816", desc: "Data export to CSV",      status: "done",    cost: "$0.011", dur: "2.4s",  time: "3h ago"  },
  ];
  const ST_COLORS = { done: "#16a34a", failed: "#dc2626", running: "#2563eb", cancelled: "#94a3b8" };
  // Table header
  parts.push(`<line x1="${mx}" y1="${colY + 32}" x2="${mx + col1W}" y2="${colY + 32}" stroke="#e2e8f0" stroke-width="1"/>`);
  [{ x: 16, l: "ID" }, { x: 80, l: "Description" }, { x: 360, l: "Status" }, { x: 460, l: "Cost" }, { x: 540, l: "Duration" }, { x: 630, l: "When" }].forEach(({ x, l }) => {
    parts.push(`<text x="${mx + x}" y="${colY + 50}" font-family="${FONT}" font-size="11" font-weight="600" fill="#64748b">${l.toUpperCase()}</text>`);
  });
  parts.push(`<line x1="${mx}" y1="${colY + 56}" x2="${mx + col1W}" y2="${colY + 56}" stroke="#e2e8f0" stroke-width="1"/>`);
  TASKS.forEach((t, i) => {
    const ry = colY + 56 + i * 40;
    if (i % 2 === 1) parts.push(`<rect x="${mx}" y="${ry}" width="${col1W}" height="40" fill="#fafbfc"/>`);
    const ty = ry + 25;
    parts.push(`<text x="${mx + 16}" y="${ty}" font-family="${MONO}" font-size="11" fill="#94a3b8">${esc(t.id)}</text>`);
    parts.push(`<text x="${mx + 80}" y="${ty}" font-family="${FONT}" font-size="12" fill="#0f3d3d">${esc(t.desc)}</text>`);
    const sc = ST_COLORS[t.status] || "#94a3b8";
    parts.push(`<rect x="${mx + 460}" y="${ry + 10}" width="64" height="20" rx="10" fill="${sc}" opacity="0.12"/>`);
    parts.push(`<text x="${mx + 492}" y="${ry + 24}" text-anchor="middle" font-family="${FONT}" font-size="11" fill="${sc}">${esc(t.status)}</text>`);
    parts.push(`<text x="${mx + 540}" y="${ty}" font-family="${MONO}" font-size="11" fill="#64748b">${esc(t.cost)}</text>`);
    parts.push(`<text x="${mx + 620}" y="${ty}" font-family="${MONO}" font-size="11" fill="#64748b">${esc(t.dur)}</text>`);
    parts.push(`<text x="${mx + 710}" y="${ty}" font-family="${FONT}" font-size="11" fill="#94a3b8">${esc(t.time)}</text>`);
  });

  // Right panel: stats + governance
  // Monthly stats
  parts.push(`<rect x="${col2X}" y="${colY}" width="${col2W}" height="160" rx="8" fill="white" stroke="#e2e8f0" stroke-width="1"/>`);
  parts.push(`<text x="${col2X + 16}" y="${colY + 24}" font-family="${FONT}" font-size="14" font-weight="600" fill="#0f3d3d">This Month</text>`);
  const MSTATS = [
    { label: "Tasks completed", value: "87" },
    { label: "Cost used",       value: "$1.74 / $25.00" },
    { label: "Avg task cost",   value: "$0.020" },
    { label: "Violations",      value: "0" },
  ];
  MSTATS.forEach(({ label, value }, i) => {
    const sy = colY + 44 + i * 28;
    parts.push(`<text x="${col2X + 16}" y="${sy}" font-family="${FONT}" font-size="12" fill="#64748b">${esc(label)}</text>`);
    parts.push(`<text x="${col2X + col2W - 16}" y="${sy}" text-anchor="end" font-family="${FONT}" font-size="12" font-weight="600" fill="#0f3d3d">${esc(value)}</text>`);
  });

  // Governance config
  const govY = colY + 172;
  parts.push(`<rect x="${col2X}" y="${govY}" width="${col2W}" height="180" rx="8" fill="white" stroke="#e2e8f0" stroke-width="1"/>`);
  parts.push(`<text x="${col2X + 16}" y="${govY + 24}" font-family="${FONT}" font-size="14" font-weight="600" fill="#0f3d3d">Governance</text>`);
  const GRULES = [
    { rule: "Tier",              val: "1 (full autonomy)" },
    { rule: "Per-task budget",   val: "$0.25 USD" },
    { rule: "Monthly budget",    val: "$25.00 USD" },
    { rule: "Human approval",    val: "delete, send_email" },
    { rule: "Forbidden actions", val: "delete_database" },
  ];
  GRULES.forEach(({ rule, val }, i) => {
    const ry2 = govY + 44 + i * 26;
    parts.push(`<text x="${col2X + 16}" y="${ry2}" font-family="${FONT}" font-size="11" fill="#64748b">${esc(rule)}</text>`);
    parts.push(`<text x="${col2X + col2W - 16}" y="${ry2}" text-anchor="end" font-family="${FONT}" font-size="11" font-weight="500" fill="#0f3d3d">${esc(val)}</text>`);
  });

  parts.push(`</svg>`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Screenshot 3: Audit Trail
// ---------------------------------------------------------------------------

function generateAuditTrail() {
  const W = 1280, H = 800;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#f8fafc"/>`);
  parts.push(browserChrome(W, H, "localhost:4200/audit"));

  const contentY = 40;
  const sideW = 200;
  parts.push(sidebar(0, contentY, sideW, H - contentY, "Audit Trail"));

  const mx = sideW + 24;
  const mw = W - sideW - 48;

  // Header
  parts.push(`<text x="${mx}" y="${contentY + 36}" font-family="${FONT}" font-size="22" font-weight="700" fill="#0f3d3d">Audit Trail</text>`);
  parts.push(`<text x="${mx}" y="${contentY + 56}" font-family="${FONT}" font-size="13" fill="#64748b">Append-only · WAL-integrity-verified · Tamper-evident</text>`);

  // Summary cards
  const cardY = contentY + 68;
  const cardH = 72;
  const cardW = Math.floor((mw - 32) / 3);
  const ACARDS = [
    { label: "Total Entries",         value: "5,281",  sub: "since installation",    color: "#1a5c5c" },
    { label: "Governance Decisions",  value: "1,483",  sub: "0 violations this week", color: "#16a34a" },
    { label: "Integrity Status",      value: "✓ Clean", sub: "last verified: 2m ago", color: "#16a34a" },
  ];
  ACARDS.forEach(({ label, value, sub, color }, i) => {
    parts.push(statCard(mx + i * (cardW + 16), cardY, cardW, cardH, label, value, sub, color));
  });

  // Filter bar
  const filterY = cardY + cardH + 16;
  parts.push(`<rect x="${mx}" y="${filterY}" width="${mw}" height="40" rx="6" fill="white" stroke="#e2e8f0" stroke-width="1"/>`);
  parts.push(`<text x="${mx + 16}" y="${filterY + 25}" font-family="${FONT}" font-size="12" fill="#94a3b8">🔍  Filter entries...</text>`);
  // Filter chips
  const CHIPS = ["All", "ALLOWED", "DENIED", "APPROVAL_PENDING"];
  const CHIP_COLORS = { All: "#1a5c5c", ALLOWED: "#16a34a", DENIED: "#dc2626", APPROVAL_PENDING: "#f59e0b" };
  let chipX = mx + 260;
  CHIPS.forEach((chip) => {
    const active = chip === "All";
    const cc = CHIP_COLORS[chip] || "#64748b";
    const chipW = chip.length * 8 + 24;
    parts.push(`<rect x="${chipX}" y="${filterY + 8}" width="${chipW}" height="24" rx="12" fill="${active ? cc : 'white'}" stroke="${cc}" stroke-width="1.5"/>`);
    parts.push(`<text x="${chipX + chipW / 2}" y="${filterY + 24}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="${active ? '600' : '400'}" fill="${active ? 'white' : cc}">${esc(chip)}</text>`);
    chipX += chipW + 8;
  });

  // Audit log table
  const tableY = filterY + 56;
  const tableH = H - tableY - 32;
  parts.push(`<rect x="${mx}" y="${tableY}" width="${mw}" height="${tableH}" rx="8" fill="white" stroke="#e2e8f0" stroke-width="1"/>`);

  // Table header
  parts.push(`<rect x="${mx}" y="${tableY}" width="${mw}" height="32" rx="8" fill="#f8fafc"/>`);
  parts.push(`<rect x="${mx}" y="${tableY + 16}" width="${mw}" height="16" fill="#f8fafc"/>`);
  parts.push(`<line x1="${mx}" y1="${tableY + 32}" x2="${mx + mw}" y2="${tableY + 32}" stroke="#e2e8f0" stroke-width="1"/>`);
  const HCOLS = [{ x: 16, l: "Timestamp" }, { x: 190, l: "Agent" }, { x: 350, l: "Action" }, { x: 600, l: "Stage" }, { x: 700, l: "Decision" }, { x: 820, l: "Detail" }];
  HCOLS.forEach(({ x, l }) => {
    parts.push(`<text x="${mx + x}" y="${tableY + 21}" font-family="${FONT}" font-size="11" font-weight="600" fill="#64748b">${esc(l.toUpperCase())}</text>`);
  });

  // Audit entries
  const ENTRIES = [
    { ts: "2026-03-20 14:23:11", agent: "ops-agent",      action: "write_file /reports/q1.csv",   stage: "S3 Budget",   decision: "ALLOWED",           detail: "cost: $0.024" },
    { ts: "2026-03-20 14:22:58", agent: "email-agent",     action: "send_email to: cto@corp.com",  stage: "S2 Approval", decision: "APPROVAL_PENDING",  detail: "awaiting: admin" },
    { ts: "2026-03-20 14:21:44", agent: "research-agent",  action: "web_fetch https://docs.ai/",   stage: "S5 Policy",   decision: "ALLOWED",           detail: "rate limit ok" },
    { ts: "2026-03-20 14:20:37", agent: "data-agent",      action: "delete_database prod.sqlite",  stage: "S1 Forbidden",decision: "DENIED",            detail: "forbidden action" },
    { ts: "2026-03-20 14:19:12", agent: "audit-agent",     action: "read_file /compliance/soc2.md",stage: "S4 Classify", decision: "ALLOWED",           detail: "class: INTERNAL" },
    { ts: "2026-03-20 14:18:03", agent: "ops-agent",       action: "shell_exec ls -la /data",      stage: "S5 Policy",   decision: "ALLOWED",           detail: "sandboxed" },
    { ts: "2026-03-20 14:17:51", agent: "report-agent",    action: "llm_call claude-haiku",        stage: "S3 Budget",   decision: "ALLOWED",           detail: "remaining: $23.26" },
    { ts: "2026-03-20 14:16:28", agent: "email-agent",     action: "imap_fetch inbox",             stage: "S5 Policy",   decision: "ALLOWED",           detail: "whitelist ok" },
  ];
  const DEC_COLORS = { ALLOWED: "#16a34a", DENIED: "#dc2626", APPROVAL_PENDING: "#f59e0b" };
  ENTRIES.forEach((e, i) => {
    const ry = tableY + 32 + i * 36;
    if (i % 2 === 0) parts.push(`<rect x="${mx}" y="${ry}" width="${mw}" height="36" fill="#fafbfc"/>`);
    parts.push(`<line x1="${mx + 16}" y1="${ry + 36}" x2="${mx + mw - 16}" y2="${ry + 36}" stroke="#f1f5f9" stroke-width="1"/>`);
    const ty = ry + 23;
    parts.push(`<text x="${mx + 16}" y="${ty}" font-family="${MONO}" font-size="10" fill="#94a3b8">${esc(e.ts)}</text>`);
    parts.push(`<text x="${mx + 190}" y="${ty}" font-family="${FONT}" font-size="12" font-weight="500" fill="#1a5c5c">${esc(e.agent)}</text>`);
    parts.push(`<text x="${mx + 350}" y="${ty}" font-family="${MONO}" font-size="11" fill="#0f3d3d">${esc(e.action)}</text>`);
    // Stage pill
    parts.push(`<text x="${mx + 600}" y="${ty}" font-family="${FONT}" font-size="11" fill="#64748b">${esc(e.stage)}</text>`);
    // Decision badge
    const dc = DEC_COLORS[e.decision] || "#64748b";
    const dw = e.decision.length * 7 + 16;
    parts.push(`<rect x="${mx + 700}" y="${ry + 9}" width="${dw}" height="18" rx="9" fill="${dc}" opacity="0.12"/>`);
    parts.push(`<text x="${mx + 700 + dw / 2}" y="${ry + 22}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="600" fill="${dc}">${esc(e.decision)}</text>`);
    parts.push(`<text x="${mx + 820}" y="${ty}" font-family="${FONT}" font-size="11" fill="#94a3b8">${esc(e.detail)}</text>`);
  });

  // WAL integrity badge (bottom right of table)
  const badgeY = tableY + tableH - 40;
  parts.push(`<rect x="${mx + mw - 200}" y="${badgeY}" width="184" height="28" rx="6" fill="#f0fdf4" stroke="#bbf7d0" stroke-width="1"/>`);
  parts.push(`<text x="${mx + mw - 108}" y="${badgeY + 19}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="500" fill="#16a34a">✓ WAL integrity verified</text>`);

  parts.push(`</svg>`);
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Write all screenshots
// ---------------------------------------------------------------------------

let sharp;
try {
  const req = createRequire(import.meta.url);
  sharp = req("sharp");
} catch (_e) {
  sharp = null;
}

const SCREENSHOTS = [
  { name: "dashboard-overview", svg: generateOverview() },
  { name: "agent-detail",       svg: generateAgentDetail() },
  { name: "audit-trail",        svg: generateAuditTrail() },
];

for (const { name, svg } of SCREENSHOTS) {
  const svgPath = join(ASSETS, `${name}.svg`);
  writeFileSync(svgPath, svg, "utf-8");
  console.log(`Written: ${svgPath}`);

  if (sharp) {
    const pngPath = join(ASSETS, `${name}.png`);
    await sharp(Buffer.from(svg)).png().toFile(pngPath);
    console.log(`Written: ${pngPath}`);
  }
}

if (!sharp) {
  console.log("sharp not available — PNG output skipped (SVG only)");
}
