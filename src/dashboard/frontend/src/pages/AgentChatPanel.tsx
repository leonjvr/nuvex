import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Users,
  Wrench,
  Mail,
  Smartphone,
  X,
  Hash,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseThreadId(threadId: string) {
  const parts = threadId.split(":");
  if (parts.length < 3) return { agent: parts[0] ?? "", channel: "dashboard", contact: threadId };
  const [agent, channel, ...rest] = parts;
  const contact = rest.join(":");
  const isGroup = contact.endsWith("@g.us") || contact.endsWith("@g");
  return { agent, channel, contact, isGroup };
}

function sessionLabel(threadId: string): string {
  const { contact } = parseThreadId(threadId);
  if (contact === "operator") return "Direct message";
  // strip leading "session-" or timestamp prefix for display
  return contact.replace(/^session-\d+-?/, "").replace(/-/g, " ") || contact;
}

function channelIcon(channel: string) {
  if (channel === "whatsapp" || channel === "whatsapp-group") return <Smartphone size={13} className="text-green-400" />;
  if (channel === "telegram") return <MessageCircle size={13} className="text-blue-400" />;
  if (channel === "email") return <Mail size={13} className="text-yellow-400" />;
  if (channel === "delegation") return <Bot size={13} className="text-purple-400" />;
  return <Hash size={13} className="text-indigo-400" />;
}

function channelColor(channel: string) {
  if (channel === "whatsapp" || channel === "whatsapp-group") return "bg-green-900/30 border-green-800/40 text-green-200";
  if (channel === "telegram") return "bg-blue-900/30 border-blue-800/40 text-blue-200";
  if (channel === "email") return "bg-yellow-900/30 border-yellow-800/40 text-yellow-200";
  if (channel === "delegation") return "bg-purple-900/30 border-purple-800/40 text-purple-200";
  return "bg-gray-800 border-gray-700 text-gray-300";
}

function agentInitials(id: string) { return id.slice(0, 2).toUpperCase(); }
function agentColor(id: string) {
  const colors = ["bg-indigo-600","bg-purple-600","bg-rose-600","bg-teal-600","bg-orange-600","bg-cyan-600","bg-pink-600"];
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[h % colors.length];
}

function formatTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchThreads(agentId: string) {
  const r = await fetch(`/api/threads?agent_id=${agentId}&limit=200`);
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

async function fetchMessages(threadId: string) {
  const r = await fetch(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=300`);
  if (!r.ok) throw new Error("Failed");
  return r.json();
}

// ── Status helpers ───────────────────────────────────────────────────────────

const NODE_LABELS: Record<string, string> = {
  lifecycle_start: "Starting…",
  route_model: "Selecting model…",
  auto_compact: "Compacting context…",
  call_llm: "Thinking…",
  check_forbidden: "Checking permissions…",
  check_classification: "Reviewing content…",
  approval_gate: "Waiting for approval…",
  check_policy: "Checking policy…",
  execute_tools: "Using tools…",
  persist_budget: "Recording usage…",
  lifecycle_end: "Finishing…",
};

function toolCallLabel(calls: { name: string }[]): string {
  const names = calls.map((t) => t.name);
  const delegate = names.find((n) => n.startsWith("delegate_to_") || n === "delegate");
  if (delegate) {
    const target = delegate.replace("delegate_to_", "").replace(/_/g, " ");
    return `Delegating to ${target}\u2026`;
  }
  if (names.some((n) => /shell|bash|run_command/.test(n))) return "Running command\u2026";
  if (names.some((n) => /filesystem|read_file|write_file/.test(n))) return "Reading files\u2026";
  return `Using ${names[0]}\u2026`;
}

type SendStatus = { label: string; received: boolean } | null;

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg, agentId }: { msg: any; agentId: string }) {
  const isUser = msg.role === "user", isTool = msg.role === "tool";
  const color = agentColor(agentId);
  if (msg.role === "system") return null;
  if (isTool) return (
    <div className="flex justify-center my-1">
      <div className="flex items-center gap-1.5 bg-yellow-900/20 border border-yellow-800/30 text-yellow-300 text-xs px-3 py-1 rounded-full">
        <Wrench size={11} /><span className="font-mono truncate max-w-xs">{msg.content?.slice(0, 80)}</span>
      </div>
    </div>
  );
  if (isUser) return (
    <div className="flex items-end justify-end gap-2">
      <div className="flex flex-col items-end max-w-[70%]">
        <div className="bg-indigo-700 text-indigo-50 rounded-2xl rounded-br-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</div>
        <span className="text-xs text-gray-600 mt-0.5 mr-1">{formatTime(msg.created_at)}</span>
      </div>
    </div>
  );
  return (
    <div className="flex items-end gap-2">
      <div className={`w-7 h-7 rounded-full flex-none flex items-center justify-center text-xs font-bold text-white ${color}`}>{agentInitials(agentId)}</div>
      <div className="flex flex-col max-w-[70%]">
        <div className="bg-gray-800 border border-gray-700 text-gray-100 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</div>
        <span className="text-xs text-gray-600 mt-0.5 ml-1">{formatTime(msg.created_at)}</span>
      </div>
    </div>
  );
}

// ── ChatPane ──────────────────────────────────────────────────────────────────

function ChatPane({ thread, agent }: { thread: any; agent: any }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sendStatus, setSendStatus] = useState<SendStatus>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const parsed = parseThreadId(thread.id);
  // Prefer thread.channel from API over ID-inferred channel
  const channel = thread.channel ?? parsed.channel;
  const { contact, isGroup } = parsed;
  const isDashboard = channel === "dashboard";
  const isDelegation = channel === "delegation";

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages", thread.id],
    queryFn: () => fetchMessages(thread.id),
    refetchInterval: sendStatus ? 1000 : 3000,
  });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sendStatus]);

  async function handleSend() {
    if (!text.trim() || sendStatus) return;
    const messageText = text;
    setText("");
    setSendStatus({ label: "Sending\u2026", received: false });
    setSendError(null);
    let pendingToolCalls: { name: string }[] | null = null;
    try {
      const resp = await fetch("/api/invoke/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id, message: messageText, thread_id: thread.id, channel: "dashboard" }),
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      setSendStatus({ label: "Connected\u2026", received: true });
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let ev: any;
          try { ev = JSON.parse(raw); } catch { continue; }
          if (ev.done) {
            setSendStatus(null);
            qc.invalidateQueries({ queryKey: ["messages", thread.id] });
            return;
          }
          if (ev.error) { setSendError(ev.error); setSendStatus(null); return; }
          if (ev.node) {
            if (ev.node === "call_llm" && ev.tool_calls?.length) {
              pendingToolCalls = ev.tool_calls;
              setSendStatus({ label: toolCallLabel(ev.tool_calls), received: true });
            } else if (ev.node === "execute_tools" && pendingToolCalls) {
              setSendStatus({ label: toolCallLabel(pendingToolCalls), received: true });
            } else {
              if (ev.node !== "execute_tools") pendingToolCalls = null;
              setSendStatus({ label: NODE_LABELS[ev.node] ?? ev.node, received: true });
            }
          }
        }
      }
      setSendStatus(null);
      qc.invalidateQueries({ queryKey: ["messages", thread.id] });
    } catch (err: any) {
      setSendError(err.message ?? "Failed to send \u2014 brain may be unavailable");
      setText(messageText); // restore so user can retry
      setSendStatus(null);
    }
  }

  const displayName = isDashboard ? sessionLabel(thread.id)
    : isDelegation
      ? (() => {
          const caller = Object.keys(thread.participants ?? {}).find(k => k !== "agent" && k !== "assistant");
          const uuid = parseThreadId(thread.id).contact.slice(0, 8);
          return caller ? `from ${caller} · #${uuid}` : `A2A · #${uuid}`;
        })()
    : isGroup ? `Group \u00b7 ${contact.split("@")[0]}` : contact;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 flex-none">
        <div className={`w-9 h-9 rounded-full flex-none flex items-center justify-center border ${isDashboard ? "bg-indigo-900/40 border-indigo-700/50" : channelColor(channel)}`}>
          {isDashboard ? <Hash size={16} className="text-indigo-400" /> : isDelegation ? <Bot size={16} className="text-purple-400" /> : isGroup ? <Users size={16} /> : channelIcon(channel)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{displayName}</p>
          <p className="text-xs text-gray-500 flex items-center gap-1 capitalize">
            {channelIcon(channel)} {isDashboard ? "Dashboard session" : isDelegation ? "Agent-to-Agent delegation" : `${channel}${isGroup ? " · group" : " · DM"}`}
          </p>
        </div>
      </div>

      {isDelegation && (
        <div className="flex-none px-4 py-2 bg-purple-950/30 border-b border-purple-900/30 flex items-center gap-2">
          <Bot size={13} className="text-purple-400 flex-none" />
          <p className="text-xs text-purple-300/80">
            {(() => {
              const caller = Object.keys(thread.participants ?? {}).find(k => k !== "agent" && k !== "assistant");
              return caller
                ? `Delegated by ${caller}. This is a read-only A2A conversation.`
                : `Agent-to-Agent delegation. Read-only.`;
            })()}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading && <p className="text-center text-gray-500 text-sm">Loading…</p>}
        {!isLoading && messages.length === 0 && (
          <p className="text-center text-gray-600 text-sm mt-8">No messages yet — type below to start</p>
        )}
        {messages.map((m: any) => <MessageBubble key={m.id} msg={m} agentId={agent.id} />)}
        {sendStatus && (
          <div className="flex items-end gap-2">
            <div className={`w-7 h-7 rounded-full flex-none flex items-center justify-center text-xs font-bold text-white ${agentColor(agent.id)}`}>
              {agentInitials(agent.id)}
            </div>
            <div className="bg-gray-800 border border-gray-700/60 text-gray-400 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm flex items-center gap-2">
              <Loader2 size={13} className="animate-spin flex-none text-indigo-400" />
              <span>{sendStatus.label}</span>
              {!sendStatus.received && <span className="text-xs text-gray-600">(connecting)</span>}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!isDelegation && (
        <div className="flex-none border-t border-gray-800 px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim() && !sendStatus) { e.preventDefault(); handleSend(); } }}
              placeholder={isDashboard ? "Message… (Enter to send, Shift+Enter for newline)" : `Reply in ${channel}…`}
              rows={2}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-1 focus:ring-indigo-500 text-gray-200 placeholder:text-gray-600"
            />
            <button onClick={handleSend} disabled={!text.trim() || !!sendStatus}
              className="flex-none p-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl transition-colors">
              {sendStatus ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          {sendError && <p className="text-xs text-red-400 mt-1">{sendError}</p>}
        </div>
      )}
    </div>
  );
}

// ── New-session modal ─────────────────────────────────────────────────────────

function NewSessionModal({ agentId, onConfirm, onCancel }: { agentId: string; onConfirm: (id: string, label: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const create = () => {
    const slug = name.trim() ? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) : `session-${Date.now()}`;
    const label = name.trim() || "New session";
    onConfirm(`${agentId}:dashboard:${slug}`, label);
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="font-semibold text-sm">New session</p>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>
        <p className="text-xs text-gray-500 mb-3">Give this session a name so you can find it later. Leave blank for a timestamped session.</p>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") onCancel(); }}
          placeholder="e.g. Skill building, Plugin config…"
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-600 mb-4"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-800">Cancel</button>
          <button onClick={create} className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg">Start session</button>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar items ─────────────────────────────────────────────────────────────

function SessionItem({ thread, selected, onClick }: { thread: any; selected: boolean; onClick: () => void }) {
  const label = thread._pendingLabel ?? sessionLabel(thread.id);
  const isPending = !!thread._pending;
  return (
    <button onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-lg mx-1 mb-0.5 flex items-center gap-2 text-sm transition-colors ${selected ? "bg-indigo-600/20 text-indigo-300 border border-indigo-700/40" : "hover:bg-gray-800 text-gray-300"}`}>
      <Hash size={13} className="flex-none text-indigo-500" />
      <span className="flex-1 truncate">{label}</span>
      {isPending && <span className="text-xs text-gray-600">new</span>}
      {!isPending && thread.message_count > 0 && <span className="text-xs text-gray-600">{thread.message_count}</span>}
    </button>
  );
}

function ExternalItem({ thread, selected, onClick }: { thread: any; selected: boolean; onClick: () => void }) {
  const parsed = parseThreadId(thread.id);
  // Always prefer the authoritative channel from the API over what's inferred from the ID
  const channel = thread.channel ?? parsed.channel;
  const contact = parsed.contact;
  const isGroup = parsed.isGroup;
  // For delegation threads, extract caller from participants
  const callerAgent: string | null = channel === "delegation"
    ? (Object.keys(thread.participants ?? {}).find(k => k !== "agent" && k !== "assistant") ?? null)
    : null;
  const displayName = channel === "delegation"
    ? contact.slice(0, 8)   // UUID prefix for distinguishing multiple calls
    : isGroup ? `Group \u00b7 ${contact.split("@")[0]}` : contact;
  return (
    <button onClick={onClick}
      className={`w-full text-left px-4 py-2.5 border-b border-gray-800/60 hover:bg-gray-800/60 flex items-center gap-3 ${selected ? "bg-gray-800" : ""}`}>
      <div className={`w-8 h-8 rounded-full flex-none flex items-center justify-center border text-xs ${channelColor(channel)}`}>
        {isGroup ? <Users size={13} /> : channelIcon(channel)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium truncate">
            {channel === "delegation" ? `#${displayName}` : displayName}
          </span>
          <span className="text-xs text-gray-600 flex-none">{formatTime(thread.updated_at ?? thread.created_at)}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-gray-500">{thread.message_count} msgs</span>
          {isGroup && <span className="text-xs text-purple-400 bg-purple-900/30 px-1.5 rounded-full">group</span>}
        </div>
      </div>
    </button>
  );
}

// ── A2A delegation section — grouped by caller agent ─────────────────────────

function DelegationSection({
  threads, selected, onSelect,
}: {
  threads: any[];
  selected: any | null;
  onSelect: (t: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (threads.length === 0) return null;

  // Group by caller agent (stored as first participant key, or "unknown")
  const byAgent = new Map<string, any[]>();
  for (const t of threads) {
    const participants = t.participants ?? {};
    const caller = Object.keys(participants).find(k => k !== "agent" && k !== "assistant") ?? "unknown";
    if (!byAgent.has(caller)) byAgent.set(caller, []);
    byAgent.get(caller)!.push(t);
  }

  const totalCount = threads.length;

  return (
    <div className="flex-none">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 pt-3 pb-1 hover:bg-gray-800/40 group"
      >
        <div className="flex items-center gap-1.5">
          <Bot size={11} className="text-purple-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent-to-Agent</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-600 bg-gray-800 px-1.5 rounded-full">{totalCount}</span>
          <span className="text-xs text-gray-600 group-hover:text-gray-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div>
          {[...byAgent.entries()].map(([caller, callerThreads]) => (
            <CallerGroup
              key={caller}
              caller={caller}
              threads={callerThreads}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CallerGroup({
  caller, threads, selected, onSelect,
}: {
  caller: string;
  threads: any[];
  selected: any | null;
  onSelect: (t: any) => void;
}) {
  const SHOW = 4;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? threads : threads.slice(0, SHOW);
  const color = agentColor(caller);

  return (
    <div className="mb-1">
      {/* Caller sub-header */}
      <div className="flex items-center gap-2 px-4 py-1.5">
        <div className={`w-5 h-5 rounded-full flex-none flex items-center justify-center text-white text-xs font-bold ${color}`}>
          {caller === "unknown" ? "?" : caller.slice(0, 1).toUpperCase()}
        </div>
        <span className="text-xs text-gray-400 font-medium">
          {caller === "unknown" ? "Unknown caller" : `from ${caller}`}
        </span>
        <span className="text-xs text-gray-600 ml-auto">{threads.length}</span>
      </div>
      {/* Thread list */}
      {visible.map(t => (
        <button key={t.id} onClick={() => onSelect(t)}
          className={`w-full text-left pl-10 pr-4 py-2 border-b border-gray-800/40 hover:bg-gray-800/60 flex items-center gap-2 ${
            selected?.id === t.id ? "bg-gray-800" : ""
          }`}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-300 font-mono truncate">
                #{parseThreadId(t.id).contact.slice(0, 8)}
              </span>
              <span className="text-xs text-gray-600">{formatTime(t.updated_at ?? t.created_at)}</span>
            </div>
            <span className="text-xs text-gray-600">{t.message_count} msgs</span>
          </div>
        </button>
      ))}
      {threads.length > SHOW && (
        <button onClick={() => setShowAll(v => !v)}
          className="w-full pl-10 pr-4 py-1.5 text-xs text-gray-600 hover:text-gray-400 text-left">
          {showAll ? "Show less" : `+ ${threads.length - SHOW} more`}
        </button>
      )}
    </div>
  );
}

// ── Channel section in sidebar ────────────────────────────────────────────────

function ChannelSection({ label, threads, selected, onSelect }: {
  label: string;
  threads: any[];
  selected: any | null;
  onSelect: (t: any) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (threads.length === 0) return null;
  return (
    <div className="flex-none">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 pt-3 pb-1 hover:bg-gray-800/40 group"
      >
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
        <span className="text-xs text-gray-600 group-hover:text-gray-400">{threads.length}</span>
      </button>
      {!collapsed && threads.map((t: any) => (
        <ExternalItem key={t.id} thread={t} selected={selected?.id === t.id} onClick={() => onSelect(t)} />
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AgentChatPanel({ agent, onClose }: { agent: any; onClose: () => void }) {
  const [selectedThread, setSelectedThread] = useState<any | null>(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const color = agentColor(agent.id);

  const { data: threads = [], isLoading } = useQuery({
    queryKey: ["threads-agent", agent.id],
    queryFn: () => fetchThreads(agent.id),
    refetchInterval: 5000,
  });

  const dashboardThreads: any[] = threads.filter((t: any) => t.channel === "dashboard")
    .sort((a: any, b: any) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime());

  const delegationThreads: any[] = threads.filter((t: any) => t.channel === "delegation")
    .sort((a: any, b: any) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime());

  // Build dynamic channel groups from actual thread data (excludes dashboard + delegation)
  const EXCLUDED_CHANNELS = new Set(["dashboard", "delegation"]);
  const CHANNEL_LABEL: Record<string, string> = {
    "whatsapp": "WhatsApp",
    "whatsapp-group": "WhatsApp Groups",
    "telegram": "Telegram",
    "email": "Email",
    "slack": "Slack",
    "discord": "Discord",
  };
  const CHANNEL_ORDER = ["whatsapp", "whatsapp-group", "telegram", "email", "slack", "discord"];

  const channelGroups: Map<string, any[]> = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const t of threads) {
      if (EXCLUDED_CHANNELS.has(t.channel)) continue;
      if (!groups.has(t.channel)) groups.set(t.channel, []);
      groups.get(t.channel)!.push(t);
    }
    // Sort each group's threads by recency
    for (const [, arr] of groups) {
      arr.sort((a: any, b: any) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime());
    }
    // Return sorted: known channels first (in fixed order), then unknown alphabetically
    const known = CHANNEL_ORDER.filter((ch) => groups.has(ch)).map((ch) => [ch, groups.get(ch)!] as [string, any[]]);
    const unknown = [...groups.entries()].filter(([ch]) => !CHANNEL_ORDER.includes(ch)).sort((a, b) => a[0].localeCompare(b[0]));
    return new Map([...known, ...unknown]);
  }, [threads]);

  // Auto-select default session on first load
  useEffect(() => {
    if (!selectedThread && dashboardThreads.length > 0) setSelectedThread(dashboardThreads[0]);
  }, [dashboardThreads.length]);

  const handleNewSession = (threadId: string, label: string) => {
    setShowNewSession(false);
    const pending = { id: threadId, channel: "dashboard", message_count: 0, _pending: true, _pendingLabel: label, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    setSelectedThread(pending);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900">
      {showNewSession && <NewSessionModal agentId={agent.id} onConfirm={handleNewSession} onCancel={() => setShowNewSession(false)} />}

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 flex-none">
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-800"><ArrowLeft size={18} /></button>
        <div className={`w-9 h-9 rounded-full flex-none flex items-center justify-center text-sm font-bold text-white ${color}`}>{agentInitials(agent.id)}</div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{agent.name || agent.id}</p>
          <p className="text-xs text-gray-500">{threads.length} conversation{threads.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-64 flex-none border-r border-gray-800 overflow-y-auto flex flex-col">
          {/* Sessions section */}
          <div className="flex-none px-3 pt-3 pb-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Sessions</span>
              <button onClick={() => setShowNewSession(true)}
                className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors" title="New session">
                <Plus size={14} />
              </button>
            </div>
            {isLoading && <p className="text-xs text-gray-600 px-1">Loading…</p>}
            {!isLoading && dashboardThreads.length === 0 && (
              <button onClick={() => setShowNewSession(true)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-gray-600 hover:bg-gray-800 hover:text-gray-400 transition-colors flex items-center gap-2">
                <Plus size={12} /> Start your first session
              </button>
            )}
            {dashboardThreads.map((t: any) => (
              <SessionItem key={t.id} thread={t} selected={selectedThread?.id === t.id} onClick={() => setSelectedThread(t)} />
            ))}
            {/* Pending session not yet in DB */}
            {selectedThread?._pending && !dashboardThreads.find((t: any) => t.id === selectedThread.id) && (
              <SessionItem thread={selectedThread} selected={true} onClick={() => {}} />
            )}
          </div>

          {/* External threads section — dynamically derived from thread data */}
          {channelGroups.size > 0 ? (
            <>
              {[...channelGroups.entries()].map(([ch, chThreads]) => (
                <ChannelSection
                  key={ch}
                  label={CHANNEL_LABEL[ch] ?? ch.charAt(0).toUpperCase() + ch.slice(1)}
                  threads={chThreads}
                  selected={selectedThread}
                  onSelect={setSelectedThread}
                />
              ))}
            </>
          ) : (
            !isLoading && (
              <div className="px-4 py-3 flex-none">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Channels</span>
                <p className="text-xs text-gray-700 mt-1.5">WhatsApp &amp; Telegram conversations appear here automatically.</p>
              </div>
            )
          )}
          {delegationThreads.length > 0 && (
            <DelegationSection threads={delegationThreads} selected={selectedThread} onSelect={setSelectedThread} />
          )}
        </div>

        {/* Chat area */}
        <div className="flex-1 min-w-0">
          {selectedThread ? (
            <ChatPane thread={selectedThread} agent={agent} />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center px-10 select-none">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold text-white mb-5 ${color}`}>{agentInitials(agent.id)}</div>
              <p className="text-xl font-semibold">{agent.name || agent.id}</p>
              <p className="text-sm text-gray-500 mt-2 max-w-xs">Select a session or create a new one to start chatting.</p>
              <button onClick={() => setShowNewSession(true)}
                className="mt-5 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-xl transition-colors">
                <Plus size={15} /> New session
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

