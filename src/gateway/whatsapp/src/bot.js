import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import pino from "pino";
import fetch from "node-fetch";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const BRAIN_URL = process.env.BRAIN_URL || "http://brain:8100";
const AGENT_ID = process.env.NUVEX_AGENT_ID || "maya";
const ORG_ID = (() => {
  const id = process.env.NUVEX_ORG_ID || "";
  if (!id) logger.warn("NUVEX_ORG_ID is not set — defaulting to 'default'. Set this env var to avoid this warning.");
  return id || "default";
})();
const CREDS_PATH = process.env.WA_CREDS_PATH || "/data/wa-creds";
const GROUP_POLICY = (process.env.WA_GROUP_POLICY || "allowlist").toLowerCase();
const DM_POLICY = (process.env.WA_DM_POLICY || "pairing").toLowerCase();
const QR_FILE = process.env.WA_QR_FILE || "/data/wa-qr.json";

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function randomBetween(min, max) { return Math.floor(min + Math.random() * (max - min)); }

// ── Humanise config (refreshed every 5 min) ───────────────────────────────────
let _humanise = null;
async function getHumanise() {
  if (_humanise) return _humanise;
  try {
    const res = await fetch(`${BRAIN_URL}/agents/whatsapp-config`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const waCfg = await res.json();
      _humanise = {
        enabled:                  waCfg.humanise_enabled                 ?? false,
        read_receipt_delay_ms:    Number(waCfg.humanise_read_receipt_delay_ms ?? 1500),
        thinking_delay_ms:        Number(waCfg.humanise_thinking_delay_ms     ?? 2500),
        typing_speed_wpm:         Number(waCfg.humanise_typing_speed_wpm      ?? 45),
        chunk_messages:           waCfg.humanise_chunk_messages          ?? true,
        group_bindings:           Array.isArray(waCfg.group_bindings) ? waCfg.group_bindings : [],
      };
      setTimeout(() => { _humanise = null; }, 5 * 60 * 1000); // refresh every 5 min
    }
  } catch { /* keep defaults */ }
  if (!_humanise) _humanise = { enabled: false, read_receipt_delay_ms: 1500, thinking_delay_ms: 2500, typing_speed_wpm: 45, chunk_messages: true, group_bindings: [] };
  return _humanise;
}

// ── Projects registry (refreshed every 10 min) ────────────────────────────────
let _projects = null;
let _projectsClearTimer = null;
async function getProjects() {
  if (_projects) return _projects;
  try {
    const res = await fetch(`${BRAIN_URL}/agents/${AGENT_ID}/projects`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      _projects = await res.json();
      if (_projectsClearTimer) clearTimeout(_projectsClearTimer);
      _projectsClearTimer = setTimeout(() => { _projects = null; }, 10 * 60 * 1000);
    }
  } catch (err) {
    logger.warn({ err }, "Could not fetch projects from brain (non-fatal)");
  }
  if (!_projects) _projects = {};
  return _projects;
}

/** Resolve a group JID to a project label by matching contact_channel to the
 *  group's name in chatMap, or to the JID directly. Returns null if no match. */
async function resolveProjectForGroup(jid) {
  const projects = await getProjects();
  const groupInfo = chatMap.get(jid);
  const groupName = (groupInfo && groupInfo.name) ? groupInfo.name.toLowerCase() : null;
  for (const [label, proj] of Object.entries(projects)) {
    const cc = (proj.contact_channel || "").toLowerCase();
    if (cc === jid || (groupName && cc === groupName)) {
      return label;
    }
  }
  return null;
}

function splitIntoChunks(text, maxLen = 500) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  // split on double newline first, then sentence boundaries
  const paragraphs = text.split(/\n{2,}/);
  let current = "";
  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > maxLen && current) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function writeQrState(state) {
  try { writeFileSync(QR_FILE, JSON.stringify({ ...state, ts: Date.now() })); } catch {}
}

// ── Per-contact session tracking ─────────────────────────────────────────────
// contactSessions[jid] = [ threadId1, threadId2, … ]
// activeSession[jid] = threadId (currently active)
const contactSessions = {};
const activeSession = {};

function defaultThread(jid) { return `${ORG_ID}:${AGENT_ID}:whatsapp:${jid}`; }

function getActiveThread(jid) {
  if (!activeSession[jid]) activeSession[jid] = defaultThread(jid);
  if (!contactSessions[jid]) contactSessions[jid] = [activeSession[jid]];
  return activeSession[jid];
}

function newSession(jid, name) {
  const slug = name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) : `s${Date.now()}`;
  const threadId = `${ORG_ID}:${AGENT_ID}:whatsapp:${jid}:${slug}`;
  if (!contactSessions[jid]) contactSessions[jid] = [defaultThread(jid)];
  contactSessions[jid].push(threadId);
  activeSession[jid] = threadId;
  return { threadId, slug };
}

// ── Slash command help text ───────────────────────────────────────────────────
const HELP_TEXT = `*Available commands:*

/new [name]   — Start a new focused session
/sessions     — List your sessions
/switch <n>   — Switch to session number N
/clear        — Start fresh (same as /new)
/status       — Show agent status
/who          — Who is this agent
/help         — Show this list

*Tips:*
• Use sessions to separate topics (e.g. /new skill-building)
• Messages in each session keep their own context`;

let sock = null;
// Simple in-process chat list populated from messaging-history.set events
const chatMap = new Map(); // jid → { id, name, subject, isGroup }
const CHATMAP_FILE = join(CREDS_PATH, "chatmap.json");

/** Persist chatMap to disk so group names survive container restarts. */
function saveChatMap() {
  try {
    const data = {};
    for (const [jid, info] of chatMap) data[jid] = info;
    writeFileSync(CHATMAP_FILE, JSON.stringify(data), "utf8");
  } catch (err) {
    logger.warn({ err }, "Could not save chatmap (non-fatal)");
  }
}

/** Load persisted chatMap from disk on startup. */
function loadChatMap() {
  try {
    if (existsSync(CHATMAP_FILE)) {
      const data = JSON.parse(readFileSync(CHATMAP_FILE, "utf8"));
      let count = 0;
      for (const [jid, info] of Object.entries(data)) {
        chatMap.set(jid, info);
        count++;
      }
      logger.info({ count }, "Restored chatmap from disk");
    }
  } catch (err) {
    logger.warn({ err }, "Could not load chatmap (non-fatal)");
  }
}
loadChatMap();

// ── Brain invoke ──────────────────────────────────────────────────────────────
async function invokeAgent(message, threadId, sender, channel, workspacePath, projectLabel, senderName) {
  try {
    const body = {
      agent_id: AGENT_ID,
      org_id: ORG_ID,
      message,
      thread_id: threadId,
      channel,
      sender,
      metadata: { channel, sender, ...(senderName ? { sender_name: senderName } : {}), ...(projectLabel ? { project_label: projectLabel } : {}) },
    };
    if (workspacePath) body.workspace_path = workspacePath;
    const res = await fetch(`${BRAIN_URL}/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1_200_000), // 20 min — dev-server tasks can take 15-20 min
    });
    if (!res.ok) throw new Error(`Brain returned ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.error({ err }, "Brain invoke failed");
    return { reply: `[Error] ${err.message}` };
  }
}

// ── Streaming invoke — sends each AI reply to WA as it arrives ───────────────
// Used for project-scoped messages so Maya's "On it!" and final reply are
// delivered immediately without waiting for the full LangGraph run to finish.
// Humanise settings (thinking_delay, typing_speed, chunk_messages) are honoured
// for each message chunk that arrives from the stream.
async function invokeAgentStream(message, threadId, sender, channel, workspacePath, projectLabel, jid, humanise, senderName) {
  try {
    const body = JSON.stringify({
      agent_id: AGENT_ID,
      org_id: ORG_ID,
      message,
      thread_id: threadId,
      channel,
      sender,
      metadata: { channel, sender, ...(senderName ? { sender_name: senderName } : {}), ...(projectLabel ? { project_label: projectLabel } : {}) },
      ...(workspacePath ? { workspace_path: workspacePath } : {}),
    });
    const res = await fetch(`${BRAIN_URL}/invoke/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(1_200_000), // 20 min — same as sync invoke
    });
    if (!res.ok) throw new Error(`Brain stream returned ${res.status}`);

    const h = humanise;
    let buffer = "";
    const sentSet = new Set();
    let isFirstChunk = true;
    const streamStart = Date.now();

    for await (const chunk of res.body) {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        let event;
        try { event = JSON.parse(raw); } catch { continue; }
        if (event.done) return;
        // Only forward real AI prose — skip tool_call announcements (they look like "I'll use X...")
        const content = event.content?.trim();
        if (!content || event.tool_calls || sentSet.has(content)) continue;
        sentSet.add(content);

        // For the first chunk: honour thinking_delay but cap at 5 s so "On it!" still
        // feels prompt. Subsequent chunks arrive much later (mid-task updates / final reply)
        // so no extra delay is needed — brain already takes real time between them.
        if (isFirstChunk && h?.enabled) {
          const target = Math.min(
            randomBetween(h.thinking_delay_ms * 0.5, h.thinking_delay_ms * 1.5),
            5000,
          );
          const elapsed = Date.now() - streamStart;
          const remainder = target - elapsed;
          if (remainder > 0) await sleep(remainder);
          isFirstChunk = false;
        } else {
          isFirstChunk = false;
        }

        logger.info({ jid, node: event.node }, "Streaming partial reply to WA");
        try {
          if (h?.enabled && h?.chunk_messages) {
            // Apply typing indicator proportional to word count, same as sync path
            const words = content.split(/\s+/).length;
            const typingMs = Math.min(12000, Math.floor((words / (h.typing_speed_wpm || 60)) * 60000));
            try { await sock.sendPresenceUpdate("composing", jid); } catch {}
            await sleep(typingMs);
            await sock.sendMessage(jid, { text: content.slice(0, 4096) });
            try { await sock.sendPresenceUpdate("paused", jid); } catch {}
          } else {
            await sock.sendMessage(jid, { text: content.slice(0, 4096) });
          }
        } catch (e) {
          logger.warn({ e }, "Stream: failed to send WA message");
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "Brain stream invoke failed");
    try { await sock.sendMessage(jid, { text: `[Error] Dev task failed: ${err.message}` }); } catch {}
  }
}

// ── Chat sync: push known chats to brain on connect ───────────────────────────
async function syncChatsToBrain() {
  try {
    const chats = Array.from(chatMap.values());
    if (chats.length === 0) return;
    const items = chats.slice(0, 500).map((c) => {
      const jid = c.id || "";
      const isGroup = jid.endsWith("@g.us");
      return {
        thread_id: `${ORG_ID}:${AGENT_ID}:whatsapp:${jid}`,
        agent_id: AGENT_ID,
        channel: isGroup ? "whatsapp-group" : "whatsapp",
        contact: jid,
        display_name: c.name || c.subject || null,
        is_group: isGroup,
      };
    }).filter((c) => c.contact);
    if (items.length === 0) return;
    const res = await fetch(`${BRAIN_URL}/threads/bulk-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chats: items }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const d = await res.json();
      logger.info({ inserted: d.inserted, total: d.total }, "WA chat sync complete");
    }
  } catch (err) {
    logger.warn({ err }, "WA chat sync failed (non-fatal)");
  }
}

// ── Slash command handler ─────────────────────────────────────────────────────
async function handleCommand(jid, cmd, args, sender) {
  const reply = async (text) => { try { await sock.sendMessage(jid, { text }); } catch (e) { logger.warn({ e }, "reply failed"); } };

  switch (cmd) {
    case "/new":
    case "/clear": {
      const name = args.trim() || "";
      const { slug } = newSession(jid, name || null);
      const label = name || `session-${Date.now()}`;
      reply(`New session started: *${label}*\nThread: ${slug}\nSend your first message to begin.`);
      break;
    }
    case "/sessions": {
      const sessions = contactSessions[jid] || [defaultThread(jid)];
      const current = getActiveThread(jid);
      const lines = sessions.map((s, i) => {
        const label = s.split(":").slice(2).join(":") || s;
        return `${i + 1}. ${label}${s === current ? " ✅ (active)" : ""}`;
      });
      reply(`*Your sessions:*\n${lines.join("\n")}\n\nUse /switch <n> to change.`);
      break;
    }
    case "/switch": {
      const n = parseInt(args.trim(), 10);
      const sessions = contactSessions[jid] || [defaultThread(jid)];
      if (isNaN(n) || n < 1 || n > sessions.length) {
        reply(`Invalid session number. You have ${sessions.length} session(s). Use /sessions to list them.`);
      } else {
        activeSession[jid] = sessions[n - 1];
        const label = sessions[n - 1].split(":").slice(2).join(":") || sessions[n - 1];
        reply(`Switched to session ${n}: *${label}*`);
      }
      break;
    }
    case "/status": {
      try {
        const r = await fetch(`${BRAIN_URL}/health`, { signal: AbortSignal.timeout(5_000) });
        const d = await r.json();
        reply(`*Agent status:* ${d.status}\n*DB:* ${d.db}\n*Version:* ${d.version}`);
      } catch { reply("Could not reach brain. Check your connection."); }
      break;
    }
    case "/who": {
      const result = await invokeAgent("Who are you? Briefly introduce yourself in one paragraph.", getActiveThread(jid), sender, "whatsapp");
      reply(result.reply || "I'm your AI assistant.");
      break;
    }
    case "/help":
    default:
      reply(HELP_TEXT);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
async function handleMessage(msg) {
  const jid = msg.key.remoteJid || "";
  const isGroup = jid.endsWith("@g.us");
  const sender = isGroup ? msg.key.participant || jid : jid;
  const senderName = msg.pushName || null;
  const channel = isGroup ? "whatsapp-group" : "whatsapp";

  if (isGroup && GROUP_POLICY !== "allowlist") return;

  // Ensure group name is in chatMap — fetch from WA if missing (needed for project resolution)
  if (isGroup && (!chatMap.has(jid) || !chatMap.get(jid)?.name)) {
    try {
      const meta = await sock.groupMetadata(jid);
      if (meta?.subject) {
        chatMap.set(jid, { id: jid, name: meta.subject });
        saveChatMap();
        logger.info({ jid, name: meta.subject }, "Fetched and cached group metadata");
      }
    } catch (e) {
      logger.warn({ e, jid }, "Could not fetch group metadata (non-fatal)");
    }
  }

  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    "";

  let text = body;
  if (msg.message?.audioMessage) {
    text = `[Audio]\nTranscript: (audio not transcribed in gateway)`;
  }

  if (!text.trim()) return;

  const h = await getHumanise();

  // 1. Delay before read receipt (feels like opening chat)
  if (h.enabled) {
    const d = randomBetween(h.read_receipt_delay_ms * 0.5, h.read_receipt_delay_ms * 1.5);
    await sleep(d);
  }
  try { await sock.readMessages([msg.key]); } catch (e) { logger.warn({ e }, "readMessages failed"); }

  // Slash command routing (no further humanise needed for commands)
  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.split(" ");
    await handleCommand(jid, cmd.toLowerCase(), rest.join(" "), sender);
    return;
  }

  const threadId = getActiveThread(jid);

  // Look up group workspace binding and project context.
  // Project bindings (from Dev Server skill's projects.json) take priority over
  // manual nuvex.yaml group_bindings for project context injection.
  let workspacePath = null;
  let projectLabel = null;
  if (isGroup) {
    projectLabel = await resolveProjectForGroup(jid);
    if (!projectLabel) {
      // Fall back to manual nuvex.yaml group_bindings
      const h0 = await getHumanise();
      const binding = (h0.group_bindings || []).find((b) => b.jid === jid);
      if (binding) workspacePath = binding.workspace;
    }
  }

  // 2. Invoke brain.
  //    Project-scoped group messages use streaming so Maya's "On it!" ack arrives
  //    in WA within seconds while the long dev-server task runs in the background.
  //    Regular messages use the sync endpoint.
  if (projectLabel) {
    await invokeAgentStream(text, threadId, sender, channel, workspacePath, projectLabel, jid, h, senderName);
    return; // replies already sent inside invokeAgentStream
  }

  const _brainStart = Date.now();
  const result = await invokeAgent(text, threadId, sender, channel, workspacePath, projectLabel, senderName);
  const reply = result.reply || "";
  if (h.enabled) {
    const target = randomBetween(h.thinking_delay_ms * 0.5, h.thinking_delay_ms * 1.5);
    const elapsed = Date.now() - _brainStart;
    const remainder = target - elapsed;
    if (remainder > 0) await sleep(remainder);
  }

  if (!reply) return;

  try {
    if (h.enabled && h.chunk_messages) {
      const chunks = splitIntoChunks(reply.slice(0, 4096));
      for (let i = 0; i < chunks.length; i++) {
        const words = chunks[i].split(/\s+/).length;
        const typingMs = Math.min(12000, Math.floor((words / h.typing_speed_wpm) * 60000));
        try { await sock.sendPresenceUpdate("composing", jid); } catch (e) {}
        await sleep(typingMs);
        await sock.sendMessage(jid, { text: chunks[i] });
        if (i < chunks.length - 1) {
          try { await sock.sendPresenceUpdate("paused", jid); } catch (e) {}
          await sleep(randomBetween(600, 1800));
        }
      }
      try { await sock.sendPresenceUpdate("paused", jid); } catch (e) {}
    } else {
      await sock.sendMessage(jid, { text: reply.slice(0, 4096) });
    }
  } catch (err) {
    logger.error({ err, jid }, "Failed to send reply");
  }
}

// ── Connect ───────────────────────────────────────────────────────────────────

async function fetchAgentChannelConfig() {
  try {
    const res = await fetch(`${BRAIN_URL}/agents/${AGENT_ID}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    const cfg = await res.json();
    return cfg?.channels?.whatsapp ?? {};
  } catch {
    return {};
  }
}

async function connectToWhatsApp() {
  const waCfg = await fetchAgentChannelConfig();
  const envSyncOverride = process.env.WA_SYNC_FULL_HISTORY;
  const syncFullHistory =
    envSyncOverride != null
      ? String(envSyncOverride).toLowerCase() === "true"
      : waCfg.sync_full_history === true;
  logger.info({ syncFullHistory }, "WA channel config loaded");

  const { state, saveCreds } = await useMultiFileAuthState(CREDS_PATH);
  const { version } = await fetchLatestBaileysVersion();

  const socketOptions = {
    version,
    logger: logger.child({ level: "silent" }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    generateHighQualityLinkPreview: false,
  };

  if (syncFullHistory) {
    socketOptions.syncFullHistory = true;
    socketOptions.getMessage = async () => ({ conversation: "" });
  }

  sock = makeWASocket(socketOptions);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrcode.generate(qr, { small: true });
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
        writeQrState({ status: "pairing", qr: dataUrl });
      } catch (e) { logger.warn({ err: e }, "QR gen failed"); }
    }
    if (connection === "close") {
      const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.info({ code: lastDisconnect?.error?.output?.statusCode }, "WA disconnected");
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      } else {
        logger.error("WhatsApp logged out — remove credentials and restart");
        writeQrState({ status: "logged_out", qr: null });
      }
    } else if (connection === "open") {
      logger.info("WhatsApp connected");
      writeQrState({ status: "connected", qr: null });
      // Sync known chats to brain after history arrives (delay for history sync)
      setTimeout(syncChatsToBrain, 8000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      await handleMessage(msg);
    }
  });

  // Populate chatMap from history sync event, then sync to brain
  sock.ev.on("messaging-history.set", ({ chats, isLatest }) => {
    if (chats && chats.length) {
      for (const c of chats) {
        if (c.id) chatMap.set(c.id, { id: c.id, name: c.name || c.subject || null });
      }
    }
    logger.info({ count: chatMap.size, isLatest }, "WA history sync received");
    saveChatMap();
    setTimeout(syncChatsToBrain, 1500);
  });

  // Also capture chats seen in real-time messages
  sock.ev.on("chats.upsert", (chats) => {
    for (const c of chats) {
      if (c.id) chatMap.set(c.id, { id: c.id, name: c.name || c.subject || null });
    }
    saveChatMap();
  });
}

// ---------------------------------------------------------------------------
// Cross-channel action dispatch — supports extended action types
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = parseInt(process.env.WA_POLL_INTERVAL_MS || "5000", 10);
const CHANNEL_TAG = "whatsapp";

async function pollAndDispatch() {
  if (!sock) return;
  try {
    const url = `${BRAIN_URL}/actions/pending?channel=${CHANNEL_TAG}&limit=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const actions = await res.json();
    for (const action of actions) await dispatchAction(action);
  } catch (err) { logger.debug({ err }, "action poll error"); }
}

async function dispatchAction(action) {
  const { id, payload } = action;
  const type = payload?.action_type || "send_message";
  try {
    switch (type) {
      case "send_message": {
        const jid = payload?.to || payload?.jid;
        const text = payload?.text || payload?.message || "";
        if (!jid || !text) { await ackAction(id, "failed", "missing jid or text"); return; }
        await sock.sendMessage(jid, { text: String(text).slice(0, 4096) });
        break;
      }

      case "send_image": {
        const jid = payload?.to || payload?.jid;
        const url = payload?.url;
        const caption = payload?.caption || "";
        if (!jid || !url) { await ackAction(id, "failed", "missing jid or url"); return; }
        const imgRes = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!imgRes.ok) { await ackAction(id, "failed", `image fetch failed: ${imgRes.status}`); return; }
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        await sock.sendMessage(jid, { image: buffer, caption });
        break;
      }

      case "send_document": {
        const jid = payload?.to || payload?.jid;
        const url = payload?.url;
        const mimetype = payload?.mimetype || "application/octet-stream";
        const filename = payload?.filename || "file";
        const caption = payload?.caption || "";
        if (!jid || !url) { await ackAction(id, "failed", "missing jid or url"); return; }
        const docRes = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        const buffer = Buffer.from(await docRes.arrayBuffer());
        await sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename, caption });
        break;
      }

      case "send_location": {
        const jid = payload?.to || payload?.jid;
        const lat = parseFloat(payload?.lat || "0");
        const lon = parseFloat(payload?.lon || "0");
        const name = payload?.name || "";
        if (!jid) { await ackAction(id, "failed", "missing jid"); return; }
        await sock.sendMessage(jid, { location: { degreesLatitude: lat, degreesLongitude: lon, name } });
        break;
      }

      case "send_reaction": {
        const jid = payload?.to || payload?.jid;
        const key = payload?.message_key; // { remoteJid, id, fromMe }
        const emoji = payload?.emoji || "👍";
        if (!jid || !key) { await ackAction(id, "failed", "missing jid or message_key"); return; }
        await sock.sendMessage(jid, { react: { text: emoji, key } });
        break;
      }

      case "create_group": {
        const name = payload?.name || "New Group";
        const participants = payload?.participants || [];
        if (participants.length === 0) { await ackAction(id, "failed", "no participants"); return; }
        const result = await sock.groupCreate(name, participants);
        await ackAction(id, "sent", null, { group_id: result.id });
        return;
      }

      case "add_to_group": {
        const groupJid = payload?.group_id;
        const participants = payload?.participants || [];
        if (!groupJid || participants.length === 0) { await ackAction(id, "failed", "missing group_id or participants"); return; }
        await sock.groupParticipantsUpdate(groupJid, participants, "add");
        break;
      }

      case "get_chat_list": {
        const chats = Array.from(chatMap.values()).slice(0, 200).map((c) => ({
          jid: c.id, name: c.name || c.id, is_group: (c.id || "").endsWith("@g.us"),
        }));
        await ackAction(id, "sent", null, { chats });
        return;
      }

      case "get_contact_info": {
        const jid = payload?.jid;
        if (!jid) { await ackAction(id, "failed", "missing jid"); return; }
        const contact = store.contacts?.[jid] || {};
        await ackAction(id, "sent", null, { jid, name: contact.name || contact.notify || jid });
        return;
      }

      case "update_profile_name": {
        const name = payload?.name;
        if (!name) { await ackAction(id, "failed", "missing name"); return; }
        await sock.updateProfileName(name);
        break;
      }

      default:
        await ackAction(id, "failed", `unknown action_type: ${type}`);
        return;
    }
    await ackAction(id, "sent");
    logger.info({ id, type }, "action dispatched");
  } catch (err) {
    logger.error({ err, id, type }, "action dispatch failed");
    await ackAction(id, "failed", String(err.message));
  }
}

async function ackAction(id, status, error = null, result = null) {
  try {
    const params = new URLSearchParams({ status });
    if (error) params.set("error", error);
    const body = result ? JSON.stringify(result) : undefined;
    await fetch(`${BRAIN_URL}/actions/${id}/ack?${params}`, {
      method: "POST",
      headers: result ? { "Content-Type": "application/json" } : {},
      body,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) { logger.debug({ err, id }, "ack failed"); }
}

function startActionPoller() {
  setInterval(pollAndDispatch, POLL_INTERVAL_MS);
  logger.info("WA action poller started (interval=%dms)", POLL_INTERVAL_MS);
}

/** Return all WhatsApp groups the connected account is a member of. */
async function getGroups() {
  if (!sock) return [];
  try {
    const participating = await sock.groupFetchAllParticipating();
    return Object.entries(participating).map(([jid, meta]) => ({
      jid,
      name: meta.subject || null,
      participants: meta.participants ? meta.participants.length : 0,
    }));
  } catch (err) {
    logger.warn({ err }, "groupFetchAllParticipating failed");
    return [];
  }
}

export { connectToWhatsApp, sock, startActionPoller, invokeAgent, handleMessage, pollAndDispatch, dispatchAction, getGroups };
