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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const BRAIN_URL = process.env.BRAIN_URL || "http://brain:8100";
const ORG_ID = (() => {
  const id = process.env.NUVEX_ORG_ID || "";
  if (!id) logger.warn("NUVEX_ORG_ID is not set - defaulting to 'default'. Set this env var to avoid this warning.");
  return id || "default";
})();
const DEFAULT_AGENT_ID = process.env.NUVEX_AGENT_ID || "maya";
const CREDS_BASE = process.env.WA_CREDS_BASE || process.env.WA_CREDS_PATH || "/data/wa-creds";
const QR_BASE = process.env.WA_QR_DIR || "/data/wa-qr";
const GROUP_POLICY = (process.env.WA_GROUP_POLICY || "allowlist").toLowerCase();
const POLL_INTERVAL_MS = parseInt(process.env.WA_POLL_INTERVAL_MS || "5000", 10);
const CHANNEL_TAG = "whatsapp";

const runtimeByAgent = new Map();
const projectCacheByAgent = new Map();
let primaryRuntimeAgent = DEFAULT_AGENT_ID;

// Backwards compatibility for existing imports/tests that mutate exported sock.
let sock = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function randomBetween(min, max) { return Math.floor(min + Math.random() * (max - min)); }

function sanitizeId(raw) {
  const clean = String(raw || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return clean || "agent";
}

function normalizeWaIdentity(raw) {
  if (!raw) return null;
  const txt = String(raw).trim().toLowerCase();
  const at = txt.indexOf("@");
  if (at === -1) return txt;
  const local = txt.slice(0, at).split(":")[0];
  const domain = txt.slice(at + 1);
  return `${local}@${domain}`;
}

function getRuntime(agentId = primaryRuntimeAgent) {
  return runtimeByAgent.get(agentId) || null;
}

function listRuntimes() {
  return Array.from(runtimeByAgent.values());
}

function defaultRuntimeIdentity() {
  return process.env.WA_CHANNEL_IDENTITY ? normalizeWaIdentity(process.env.WA_CHANNEL_IDENTITY) : null;
}

function makeRuntime(binding) {
  const agentId = binding?.agent_id || DEFAULT_AGENT_ID;
  const safeAgent = sanitizeId(agentId);
  const runtime = {
    agentId,
    identity: normalizeWaIdentity(binding?.channel_identity || defaultRuntimeIdentity()),
    sock: null,
    credsPath: join(CREDS_BASE, safeAgent),
    qrFile: process.env.WA_QR_FILE || join(QR_BASE, `${safeAgent}.json`),
    chatMapFile: join(CREDS_BASE, safeAgent, "chatmap.json"),
    chatMap: new Map(),
    contactSessions: {},
    activeSession: {},
  };
  return runtime;
}

function writeQrState(runtime, state) {
  try {
    mkdirSync(dirname(runtime.qrFile), { recursive: true });
    writeFileSync(runtime.qrFile, JSON.stringify({ ...state, ts: Date.now() }));
  } catch {}
}

function saveChatMap(runtime) {
  try {
    mkdirSync(dirname(runtime.chatMapFile), { recursive: true });
    const data = {};
    for (const [jid, info] of runtime.chatMap) data[jid] = info;
    writeFileSync(runtime.chatMapFile, JSON.stringify(data), "utf8");
  } catch (err) {
    logger.warn({ err, agent_id: runtime.agentId }, "Could not save chatmap (non-fatal)");
  }
}

function loadChatMap(runtime) {
  try {
    if (!existsSync(runtime.chatMapFile)) return;
    const data = JSON.parse(readFileSync(runtime.chatMapFile, "utf8"));
    let count = 0;
    for (const [jid, info] of Object.entries(data)) {
      runtime.chatMap.set(jid, info);
      count++;
    }
    logger.info({ count, agent_id: runtime.agentId }, "Restored chatmap from disk");
  } catch (err) {
    logger.warn({ err, agent_id: runtime.agentId }, "Could not load chatmap (non-fatal)");
  }
}

let _humanise = null;
async function getHumanise() {
  if (_humanise) return _humanise;
  try {
    const res = await fetch(`${BRAIN_URL}/agents/whatsapp-config`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const waCfg = await res.json();
      _humanise = {
        enabled: waCfg.humanise_enabled ?? false,
        read_receipt_delay_ms: Number(waCfg.humanise_read_receipt_delay_ms ?? 1500),
        thinking_delay_ms: Number(waCfg.humanise_thinking_delay_ms ?? 2500),
        typing_speed_wpm: Number(waCfg.humanise_typing_speed_wpm ?? 45),
        chunk_messages: waCfg.humanise_chunk_messages ?? true,
        group_bindings: Array.isArray(waCfg.group_bindings) ? waCfg.group_bindings : [],
      };
      setTimeout(() => { _humanise = null; }, 5 * 60 * 1000);
    }
  } catch {}
  if (!_humanise) {
    _humanise = {
      enabled: false,
      read_receipt_delay_ms: 1500,
      thinking_delay_ms: 2500,
      typing_speed_wpm: 45,
      chunk_messages: true,
      group_bindings: [],
    };
  }
  return _humanise;
}

async function getProjects(agentId) {
  const cached = projectCacheByAgent.get(agentId);
  if (cached) return cached;
  let projects = {};
  try {
    const res = await fetch(`${BRAIN_URL}/agents/${agentId}/projects`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) projects = await res.json();
  } catch (err) {
    logger.warn({ err, agent_id: agentId }, "Could not fetch projects from brain (non-fatal)");
  }
  projectCacheByAgent.set(agentId, projects || {});
  setTimeout(() => projectCacheByAgent.delete(agentId), 10 * 60 * 1000);
  return projects || {};
}

async function resolveProjectForGroup(runtime, jid) {
  const projects = await getProjects(runtime.agentId);
  const groupInfo = runtime.chatMap.get(jid);
  const groupName = (groupInfo && groupInfo.name) ? String(groupInfo.name).toLowerCase() : null;
  for (const [label, proj] of Object.entries(projects)) {
    const cc = String(proj.contact_channel || "").toLowerCase();
    if (cc === jid || (groupName && cc === groupName)) return label;
  }
  return null;
}

function splitIntoChunks(text, maxLen = 500) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
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

function defaultThread(runtime, jid) {
  return `${ORG_ID}:${runtime.agentId}:whatsapp:${jid}`;
}

function getActiveThread(runtime, jid) {
  if (!runtime.activeSession[jid]) runtime.activeSession[jid] = defaultThread(runtime, jid);
  if (!runtime.contactSessions[jid]) runtime.contactSessions[jid] = [runtime.activeSession[jid]];
  return runtime.activeSession[jid];
}

function newSession(runtime, jid, name) {
  const slug = name ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) : `s${Date.now()}`;
  const threadId = `${ORG_ID}:${runtime.agentId}:whatsapp:${jid}:${slug}`;
  if (!runtime.contactSessions[jid]) runtime.contactSessions[jid] = [defaultThread(runtime, jid)];
  runtime.contactSessions[jid].push(threadId);
  runtime.activeSession[jid] = threadId;
  return { threadId, slug };
}

const HELP_TEXT = `*Available commands:*

/new [name]   - Start a new focused session
/sessions     - List your sessions
/switch <n>   - Switch to session number N
/clear        - Start fresh (same as /new)
/status       - Show agent status
/who          - Who is this agent
/help         - Show this list

*Tips:*
* Use sessions to separate topics (e.g. /new skill-building)
* Messages in each session keep their own context`;

async function invokeAgent(
  message,
  threadId,
  sender,
  channel,
  workspacePath,
  projectLabel,
  senderName,
  options = {},
) {
  try {
    const agentId = options.agentId || DEFAULT_AGENT_ID;
    const channelIdentity = options.channelIdentity || null;
    const body = {
      agent_id: agentId,
      org_id: ORG_ID,
      message,
      thread_id: threadId,
      channel,
      sender,
      metadata: {
        channel,
        sender,
        ...(channelIdentity ? { channel_identity: channelIdentity } : {}),
        ...(senderName ? { sender_name: senderName } : {}),
        ...(projectLabel ? { project_label: projectLabel } : {}),
      },
    };
    if (workspacePath) body.workspace_path = workspacePath;
    const res = await fetch(`${BRAIN_URL}/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1_200_000),
    });
    if (!res.ok) throw new Error(`Brain returned ${res.status}`);
    return await res.json();
  } catch (err) {
    logger.error({ err }, "Brain invoke failed");
    return { reply: `[Error] ${err.message}` };
  }
}

async function invokeAgentStream(runtime, message, threadId, sender, channel, workspacePath, projectLabel, jid, humanise, senderName) {
  try {
    const body = JSON.stringify({
      agent_id: runtime.agentId,
      org_id: ORG_ID,
      message,
      thread_id: threadId,
      channel,
      sender,
      metadata: {
        channel,
        sender,
        ...(runtime.identity ? { channel_identity: runtime.identity } : {}),
        ...(senderName ? { sender_name: senderName } : {}),
        ...(projectLabel ? { project_label: projectLabel } : {}),
      },
      ...(workspacePath ? { workspace_path: workspacePath } : {}),
    });
    const res = await fetch(`${BRAIN_URL}/invoke/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(1_200_000),
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

        const content = event.content?.trim();
        if (!content || event.tool_calls || sentSet.has(content)) continue;
        sentSet.add(content);

        if (isFirstChunk && h?.enabled) {
          const target = Math.min(randomBetween(h.thinking_delay_ms * 0.5, h.thinking_delay_ms * 1.5), 5000);
          const elapsed = Date.now() - streamStart;
          const remainder = target - elapsed;
          if (remainder > 0) await sleep(remainder);
          isFirstChunk = false;
        } else {
          isFirstChunk = false;
        }

        logger.info({ jid, agent_id: runtime.agentId, node: event.node }, "Streaming partial reply to WA");
        try {
          if (h?.enabled && h?.chunk_messages) {
            const words = content.split(/\s+/).length;
            const typingMs = Math.min(12000, Math.floor((words / (h.typing_speed_wpm || 60)) * 60000));
            try { await runtime.sock.sendPresenceUpdate("composing", jid); } catch {}
            await sleep(typingMs);
            await runtime.sock.sendMessage(jid, { text: content.slice(0, 4096) });
            try { await runtime.sock.sendPresenceUpdate("paused", jid); } catch {}
          } else {
            await runtime.sock.sendMessage(jid, { text: content.slice(0, 4096) });
          }
        } catch (e) {
          logger.warn({ e, agent_id: runtime.agentId }, "Stream: failed to send WA message");
        }
      }
    }
  } catch (err) {
    logger.error({ err, agent_id: runtime.agentId }, "Brain stream invoke failed");
    try { await runtime.sock.sendMessage(jid, { text: `[Error] Dev task failed: ${err.message}` }); } catch {}
  }
}

async function syncChatsToBrain(runtime) {
  try {
    const chats = Array.from(runtime.chatMap.values());
    if (chats.length === 0) return;
    const items = chats.slice(0, 500).map((c) => {
      const jid = c.id || "";
      const isGroup = jid.endsWith("@g.us");
      return {
        thread_id: `${ORG_ID}:${runtime.agentId}:whatsapp:${jid}`,
        agent_id: runtime.agentId,
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
      logger.info({ inserted: d.inserted, total: d.total, agent_id: runtime.agentId }, "WA chat sync complete");
    }
  } catch (err) {
    logger.warn({ err, agent_id: runtime.agentId }, "WA chat sync failed (non-fatal)");
  }
}

async function handleCommand(runtime, jid, cmd, args, sender) {
  const reply = async (text) => {
    try { await runtime.sock.sendMessage(jid, { text }); } catch (e) { logger.warn({ e, agent_id: runtime.agentId }, "reply failed"); }
  };

  switch (cmd) {
    case "/new":
    case "/clear": {
      const name = args.trim() || "";
      const { slug } = newSession(runtime, jid, name || null);
      const label = name || `session-${Date.now()}`;
      reply(`New session started: *${label}*\nThread: ${slug}\nSend your first message to begin.`);
      break;
    }
    case "/sessions": {
      const sessions = runtime.contactSessions[jid] || [defaultThread(runtime, jid)];
      const current = getActiveThread(runtime, jid);
      const lines = sessions.map((s, i) => {
        const label = s.split(":").slice(2).join(":") || s;
        return `${i + 1}. ${label}${s === current ? " ✅ (active)" : ""}`;
      });
      reply(`*Your sessions:*\n${lines.join("\n")}\n\nUse /switch <n> to change.`);
      break;
    }
    case "/switch": {
      const n = parseInt(args.trim(), 10);
      const sessions = runtime.contactSessions[jid] || [defaultThread(runtime, jid)];
      if (isNaN(n) || n < 1 || n > sessions.length) {
        reply(`Invalid session number. You have ${sessions.length} session(s). Use /sessions to list them.`);
      } else {
        runtime.activeSession[jid] = sessions[n - 1];
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
      } catch {
        reply("Could not reach brain. Check your connection.");
      }
      break;
    }
    case "/who": {
      const result = await invokeAgent(
        "Who are you? Briefly introduce yourself in one paragraph.",
        getActiveThread(runtime, jid),
        sender,
        "whatsapp",
        null,
        null,
        null,
        { agentId: runtime.agentId, channelIdentity: runtime.identity },
      );
      reply(result.reply || "I'm your AI assistant.");
      break;
    }
    case "/help":
    default:
      reply(HELP_TEXT);
  }
}

async function handleMessageWithRuntime(runtime, msg) {
  const jid = msg.key.remoteJid || "";
  const isGroup = jid.endsWith("@g.us");
  const sender = isGroup ? msg.key.participant || jid : jid;
  const senderName = msg.pushName || null;
  const channel = isGroup ? "whatsapp-group" : "whatsapp";

  if (isGroup && GROUP_POLICY !== "allowlist") return;

  if (isGroup && (!runtime.chatMap.has(jid) || !runtime.chatMap.get(jid)?.name)) {
    try {
      const meta = await runtime.sock.groupMetadata(jid);
      if (meta?.subject) {
        runtime.chatMap.set(jid, { id: jid, name: meta.subject });
        saveChatMap(runtime);
      }
    } catch (e) {
      logger.warn({ e, jid, agent_id: runtime.agentId }, "Could not fetch group metadata (non-fatal)");
    }
  }

  const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || "";
  let text = body;
  if (msg.message?.audioMessage) text = `[Audio]\nTranscript: (audio not transcribed in gateway)`;
  if (!text.trim()) return;

  const h = await getHumanise();
  if (h.enabled) {
    const d = randomBetween(h.read_receipt_delay_ms * 0.5, h.read_receipt_delay_ms * 1.5);
    await sleep(d);
  }
  try { await runtime.sock.readMessages([msg.key]); } catch {}

  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.split(" ");
    await handleCommand(runtime, jid, cmd.toLowerCase(), rest.join(" "), sender);
    return;
  }

  const threadId = getActiveThread(runtime, jid);

  let workspacePath = null;
  let projectLabel = null;
  if (isGroup) {
    projectLabel = await resolveProjectForGroup(runtime, jid);
    if (!projectLabel) {
      const h0 = await getHumanise();
      const binding = (h0.group_bindings || []).find((b) => b.jid === jid);
      if (binding) workspacePath = binding.workspace;
    }
  }

  if (projectLabel) {
    await invokeAgentStream(runtime, text, threadId, sender, channel, workspacePath, projectLabel, jid, h, senderName);
    return;
  }

  const brainStart = Date.now();
  const result = await invokeAgent(
    text,
    threadId,
    sender,
    channel,
    workspacePath,
    projectLabel,
    senderName,
    { agentId: runtime.agentId, channelIdentity: runtime.identity },
  );
  const reply = result.reply || "";
  if (h.enabled) {
    const target = randomBetween(h.thinking_delay_ms * 0.5, h.thinking_delay_ms * 1.5);
    const elapsed = Date.now() - brainStart;
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
        try { await runtime.sock.sendPresenceUpdate("composing", jid); } catch {}
        await sleep(typingMs);
        await runtime.sock.sendMessage(jid, { text: chunks[i] });
        if (i < chunks.length - 1) {
          try { await runtime.sock.sendPresenceUpdate("paused", jid); } catch {}
          await sleep(randomBetween(600, 1800));
        }
      }
      try { await runtime.sock.sendPresenceUpdate("paused", jid); } catch {}
    } else {
      await runtime.sock.sendMessage(jid, { text: reply.slice(0, 4096) });
    }
  } catch (err) {
    logger.error({ err, jid, agent_id: runtime.agentId }, "Failed to send reply");
  }
}

async function handleMessage(msg) {
  const runtime = getRuntime() || {
    agentId: DEFAULT_AGENT_ID,
    identity: defaultRuntimeIdentity(),
    sock,
    chatMap: new Map(),
    contactSessions: {},
    activeSession: {},
  };
  if (!runtime.sock) return;
  await handleMessageWithRuntime(runtime, msg);
}

async function fetchAgentChannelConfig(agentId) {
  try {
    const res = await fetch(`${BRAIN_URL}/agents/${agentId}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return {};
    const cfg = await res.json();
    return cfg?.channels?.whatsapp ?? {};
  } catch {
    return {};
  }
}

async function connectRuntime(runtime) {
  loadChatMap(runtime);
  const waCfg = await fetchAgentChannelConfig(runtime.agentId);
  const envSyncOverride = process.env.WA_SYNC_FULL_HISTORY;
  const syncFullHistory = envSyncOverride != null
    ? String(envSyncOverride).toLowerCase() === "true"
    : waCfg.sync_full_history === true;

  const { state, saveCreds } = await useMultiFileAuthState(runtime.credsPath);
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

  const runtimeSock = makeWASocket(socketOptions);
  runtime.sock = runtimeSock;
  runtimeByAgent.set(runtime.agentId, runtime);
  if (runtime.agentId === primaryRuntimeAgent || !sock) sock = runtimeSock;

  runtimeSock.ev.on("creds.update", saveCreds);

  runtimeSock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrcode.generate(qr, { small: true });
      try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
        writeQrState(runtime, { status: "pairing", qr: dataUrl, agent_id: runtime.agentId });
      } catch (e) {
        logger.warn({ err: e, agent_id: runtime.agentId }, "QR generation failed");
      }
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      logger.info({ code, agent_id: runtime.agentId }, "WA disconnected");
      if (shouldReconnect) {
        setTimeout(() => connectRuntime(runtime).catch((err) => logger.error({ err, agent_id: runtime.agentId }, "WA reconnect failed")), 5000);
      } else {
        writeQrState(runtime, { status: "logged_out", qr: null, agent_id: runtime.agentId });
      }
      return;
    }

    if (connection === "open") {
      const rawIdentity = runtimeSock.user?.id || runtime.identity;
      runtime.identity = normalizeWaIdentity(rawIdentity);
      writeQrState(runtime, {
        status: "connected",
        qr: null,
        agent_id: runtime.agentId,
        channel_identity: runtime.identity,
      });
      logger.info({ agent_id: runtime.agentId, channel_identity: runtime.identity }, "WhatsApp connected");
      setTimeout(() => syncChatsToBrain(runtime), 8000);
    }
  });

  runtimeSock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      await handleMessageWithRuntime(runtime, msg);
    }
  });

  runtimeSock.ev.on("messaging-history.set", ({ chats, isLatest }) => {
    if (chats && chats.length) {
      for (const c of chats) {
        if (c.id) runtime.chatMap.set(c.id, { id: c.id, name: c.name || c.subject || null });
      }
    }
    logger.info({ count: runtime.chatMap.size, isLatest, agent_id: runtime.agentId }, "WA history sync received");
    saveChatMap(runtime);
    setTimeout(() => syncChatsToBrain(runtime), 1500);
  });

  runtimeSock.ev.on("chats.upsert", (chats) => {
    for (const c of chats) {
      if (c.id) runtime.chatMap.set(c.id, { id: c.id, name: c.name || c.subject || null });
    }
    saveChatMap(runtime);
  });
}

async function fetchWhatsAppBindings() {
  try {
    const res = await fetch(`${BRAIN_URL}/api/v1/orgs/${encodeURIComponent(ORG_ID)}/channels`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`bindings endpoint status ${res.status}`);
    const rows = await res.json();
    const waRows = Array.isArray(rows)
      ? rows.filter((r) => r && r.channel_type === "whatsapp" && r.agent_id)
      : [];

    if (waRows.length > 0) {
      return waRows.map((r) => ({ agent_id: r.agent_id, channel_identity: normalizeWaIdentity(r.channel_identity) }));
    }
  } catch (err) {
    logger.warn({ err }, "Could not fetch WhatsApp bindings from brain; using env fallback");
  }

  return [{ agent_id: DEFAULT_AGENT_ID, channel_identity: defaultRuntimeIdentity() }];
}

async function connectToWhatsApp() {
  const bindings = await fetchWhatsAppBindings();
  const uniqueByAgent = new Map();
  for (const b of bindings) {
    if (!uniqueByAgent.has(b.agent_id)) uniqueByAgent.set(b.agent_id, b);
  }

  const targets = Array.from(uniqueByAgent.values());
  primaryRuntimeAgent = targets[0]?.agent_id || DEFAULT_AGENT_ID;

  logger.info({ count: targets.length, org_id: ORG_ID }, "Starting WhatsApp runtimes for bindings");

  for (const binding of targets) {
    const runtime = makeRuntime(binding);
    try {
      await connectRuntime(runtime);
    } catch (err) {
      logger.error({ err, agent_id: runtime.agentId }, "Failed to start WA runtime for binding");
    }
  }
}

function chooseRuntimeForAction(payload) {
  const preferredAgent = payload?.agent_id;
  if (preferredAgent && runtimeByAgent.has(preferredAgent)) return runtimeByAgent.get(preferredAgent);
  for (const rt of listRuntimes()) {
    if (rt.sock) return rt;
  }
  return null;
}

async function pollAndDispatch() {
  if (listRuntimes().every((r) => !r.sock)) return;
  try {
    const url = `${BRAIN_URL}/actions/pending?channel=${CHANNEL_TAG}&limit=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const actions = await res.json();
    for (const action of actions) await dispatchAction(action);
  } catch (err) {
    logger.debug({ err }, "action poll error");
  }
}

async function dispatchAction(action) {
  const { id, payload } = action;
  const type = payload?.action_type || "send_message";
  const runtime = chooseRuntimeForAction(payload);
  if (!runtime || !runtime.sock) {
    await ackAction(id, "failed", "no connected whatsapp runtime");
    return;
  }

  try {
    switch (type) {
      case "send_message": {
        const jid = payload?.to || payload?.jid;
        const text = payload?.text || payload?.message || "";
        if (!jid || !text) { await ackAction(id, "failed", "missing jid or text"); return; }
        await runtime.sock.sendMessage(jid, { text: String(text).slice(0, 4096) });
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
        await runtime.sock.sendMessage(jid, { image: buffer, caption });
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
        await runtime.sock.sendMessage(jid, { document: buffer, mimetype, fileName: filename, caption });
        break;
      }
      case "send_location": {
        const jid = payload?.to || payload?.jid;
        const lat = parseFloat(payload?.lat || "0");
        const lon = parseFloat(payload?.lon || "0");
        const name = payload?.name || "";
        if (!jid) { await ackAction(id, "failed", "missing jid"); return; }
        await runtime.sock.sendMessage(jid, { location: { degreesLatitude: lat, degreesLongitude: lon, name } });
        break;
      }
      case "send_reaction": {
        const jid = payload?.to || payload?.jid;
        const key = payload?.message_key;
        const emoji = payload?.emoji || "👍";
        if (!jid || !key) { await ackAction(id, "failed", "missing jid or message_key"); return; }
        await runtime.sock.sendMessage(jid, { react: { text: emoji, key } });
        break;
      }
      case "create_group": {
        const name = payload?.name || "New Group";
        const participants = payload?.participants || [];
        if (participants.length === 0) { await ackAction(id, "failed", "no participants"); return; }
        const result = await runtime.sock.groupCreate(name, participants);
        await ackAction(id, "sent", null, { group_id: result.id });
        return;
      }
      case "add_to_group": {
        const groupJid = payload?.group_id;
        const participants = payload?.participants || [];
        if (!groupJid || participants.length === 0) { await ackAction(id, "failed", "missing group_id or participants"); return; }
        await runtime.sock.groupParticipantsUpdate(groupJid, participants, "add");
        break;
      }
      case "get_chat_list": {
        const chats = Array.from(runtime.chatMap.values()).slice(0, 200).map((c) => ({
          jid: c.id,
          name: c.name || c.id,
          is_group: (c.id || "").endsWith("@g.us"),
        }));
        await ackAction(id, "sent", null, { chats, agent_id: runtime.agentId });
        return;
      }
      case "get_contact_info": {
        const jid = payload?.jid;
        if (!jid) { await ackAction(id, "failed", "missing jid"); return; }
        const info = runtime.chatMap.get(jid) || {};
        await ackAction(id, "sent", null, { jid, name: info.name || jid, agent_id: runtime.agentId });
        return;
      }
      case "update_profile_name": {
        const name = payload?.name;
        if (!name) { await ackAction(id, "failed", "missing name"); return; }
        await runtime.sock.updateProfileName(name);
        break;
      }
      default:
        await ackAction(id, "failed", `unknown action_type: ${type}`);
        return;
    }

    await ackAction(id, "sent", null, { agent_id: runtime.agentId });
    logger.info({ id, type, agent_id: runtime.agentId }, "action dispatched");
  } catch (err) {
    logger.error({ err, id, type, agent_id: runtime.agentId }, "action dispatch failed");
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
  } catch (err) {
    logger.debug({ err, id }, "ack failed");
  }
}

function startActionPoller() {
  setInterval(pollAndDispatch, POLL_INTERVAL_MS);
  logger.info("WA action poller started (interval=%dms)", POLL_INTERVAL_MS);
}

async function getGroups() {
  const out = [];
  for (const runtime of listRuntimes()) {
    if (!runtime.sock) continue;
    try {
      const participating = await runtime.sock.groupFetchAllParticipating();
      for (const [jid, meta] of Object.entries(participating)) {
        out.push({
          agent_id: runtime.agentId,
          channel_identity: runtime.identity,
          jid,
          name: meta.subject || null,
          participants: meta.participants ? meta.participants.length : 0,
        });
      }
    } catch (err) {
      logger.warn({ err, agent_id: runtime.agentId }, "groupFetchAllParticipating failed");
    }
  }
  return out;
}

function getConnectionSummary() {
  return listRuntimes().map((runtime) => ({
    agent_id: runtime.agentId,
    connected: Boolean(runtime.sock),
    channel_identity: runtime.identity,
  }));
}

export {
  connectToWhatsApp,
  startActionPoller,
  getGroups,
  getConnectionSummary,
  invokeAgent,
  handleMessage,
  pollAndDispatch,
  dispatchAction,
  sock,
};
