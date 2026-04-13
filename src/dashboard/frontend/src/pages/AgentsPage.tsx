import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Loader2, MessageCircle, MessageSquare, Plus, Puzzle, Send, Settings, Shield, Terminal, X } from "lucide-react";
import AgentChatPanel from "./AgentChatPanel";
import AgentSettingsModal from "./AgentSettingsModal";
import { useOrg } from "../OrgContext";

// ── Agent Log Modal ───────────────────────────────────────────────────────────

interface TraceEntry {
  type: string;
  content: string;
  tool_calls?: { id: string; name: string; args: Record<string, unknown> }[];
  tool_call_id?: string;
  tool_name?: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  model?: string | null;
  stop_reason?: string | null;
}

const CHANNEL_LABELS: Record<string, string> = {
  "whatsapp-group": "WA group",
  "whatsapp":       "WA",
  "telegram":       "TG",
  "dashboard":      "dash",
  "email":          "email",
};

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  } catch { return "—"; }
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function threadLabel(id: string): string {
  // maya:whatsapp:120363407... → last segment, truncated
  const parts = id.split(":");
  const tail = parts.slice(2).join(":");
  return tail.length > 32 ? tail.slice(0, 32) + "…" : tail || id;
}

function AgentLogModal({ agent, onClose }: { agent: any; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  type ThreadRow = { id: string; channel: string; updated_at: string; created_at: string; message_count: number };

  const { data: threads } = useQuery<ThreadRow[]>({
    queryKey: ["threads-for-log", agent.id],
    queryFn: async () => {
      const res = await fetch(`/api/threads?agent_id=${agent.id}&limit=100`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 10000,
  });

  // Auto-select most recent thread
  useEffect(() => {
    if (threads && threads.length > 0 && !selectedThread) {
      setSelectedThread(threads[0].id);
    }
  }, [threads, selectedThread]);

  const { data: trace, isLoading, error, refetch } = useQuery<TraceEntry[]>({
    queryKey: ["thread-trace", selectedThread],
    queryFn: async () => {
      const res = await fetch(`/api/threads/${encodeURIComponent(selectedThread!)}/trace`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!selectedThread,
    refetchInterval: 4000,
  });

  useEffect(() => {
    if (trace && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [trace]);

  const filteredThreads = (threads ?? [])
    .slice()
    .sort((a, b) => {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    })
    .filter((t) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return t.id.toLowerCase().includes(q) || t.channel.toLowerCase().includes(q);
    });

  const TYPE_COLORS: Record<string, string> = {
    human: "text-cyan-400",
    ai: "text-green-400",
    tool: "text-yellow-400",
    system: "text-gray-500",
  };

  const TYPE_LABELS: Record<string, string> = {
    human: "USER",
    ai: "ASSISTANT",
    tool: "TOOL RESULT",
    system: "SYSTEM",
  };

  function renderEntry(entry: TraceEntry, idx: number) {
    const color = TYPE_COLORS[entry.type] ?? "text-gray-400";
    const label = TYPE_LABELS[entry.type] ?? entry.type.toUpperCase();
    const seq = `[${String(idx + 1).padStart(3, "0")}]`;

    return (
      <div key={idx} className="font-mono text-xs leading-relaxed border-b border-gray-800/60 py-2">
        <div className={`flex items-center gap-2 ${color} mb-1 flex-wrap`}>
          <span className="text-gray-600">{seq}</span>
          <span className="font-bold">{label}</span>
          {entry.tool_name && <span className="text-yellow-500/80">← {entry.tool_name}</span>}
          <span className="flex-1" />
          {entry.model && <span className="text-gray-600 text-[10px]">{entry.model}</span>}
          {(entry.input_tokens != null || entry.output_tokens != null) && (
            <span className="text-gray-600 text-[10px]">
              in:{entry.input_tokens ?? "?"} out:{entry.output_tokens ?? "?"}
            </span>
          )}
          {entry.stop_reason && <span className="text-gray-600 text-[10px]">[{entry.stop_reason}]</span>}
        </div>

        {entry.content && (
          <pre className="text-gray-300 whitespace-pre-wrap break-all pl-8 pr-2 overflow-x-auto">
            {entry.content}
          </pre>
        )}

        {entry.tool_calls && entry.tool_calls.length > 0 && (
          <div className="pl-8 mt-1 space-y-1">
            {entry.tool_calls.map((tc, ti) => (
              <div key={ti} className="bg-gray-900 border border-yellow-800/40 rounded px-2 py-1.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-yellow-400 font-bold">CALL</span>
                  <span className="text-yellow-300">{tc.name}</span>
                  <span className="text-gray-600 text-[10px] ml-auto">id:{tc.id.slice(0, 12)}</span>
                </div>
                <pre className="text-gray-400 whitespace-pre-wrap break-all text-[10px]">
                  {JSON.stringify(tc.args, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const selectedThreadRow = (threads ?? []).find((t) => t.id === selectedThread);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-gray-950 border border-gray-700 rounded-xl shadow-2xl w-full max-w-6xl mx-4 h-[88vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 flex-none bg-gray-900 rounded-t-xl">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-green-400" />
            <span className="font-mono text-sm text-green-400 font-semibold">
              {agent.name || agent.id} — trace log
            </span>
            {isLoading && <Loader2 size={12} className="text-gray-500 animate-spin" />}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="text-[11px] font-mono text-gray-500 hover:text-gray-300 px-2 py-0.5 rounded hover:bg-gray-800"
            >
              refresh
            </button>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-800" aria-label="Close log">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── Body: sidebar + trace ── */}
        <div className="flex flex-1 min-h-0">

          {/* Thread sidebar */}
          <div className="w-60 flex-none border-r border-gray-800 flex flex-col bg-gray-900/40">
            {/* Search */}
            <div className="px-2 py-2 border-b border-gray-800 flex-none">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter threads…"
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-[11px] font-mono text-gray-300 placeholder:text-gray-600 outline-none focus:ring-1 focus:ring-green-700"
              />
            </div>

            {/* Thread list */}
            <div className="flex-1 overflow-y-auto">
              {filteredThreads.length === 0 && (
                <p className="text-[10px] text-gray-600 font-mono px-3 py-3">No threads.</p>
              )}
              {filteredThreads.map((t) => {
                const isActive = t.id === selectedThread;
                const channelLabel = CHANNEL_LABELS[t.channel] ?? t.channel;
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedThread(t.id)}
                    className={`w-full text-left px-3 py-2.5 border-b border-gray-800/50 transition-colors group ${
                      isActive
                        ? "bg-green-950/60 border-l-2 border-l-green-500"
                        : "hover:bg-gray-800/50 border-l-2 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[9px] font-mono px-1 py-0 rounded ${
                        isActive ? "bg-green-800/60 text-green-300" : "bg-gray-700/60 text-gray-400"
                      }`}>
                        {channelLabel}
                      </span>
                      <span className={`text-[9px] font-mono ml-auto ${isActive ? "text-green-500" : "text-gray-600"}`}>
                        {t.message_count} msg
                      </span>
                    </div>
                    <p className={`text-[11px] font-mono truncate leading-tight ${isActive ? "text-green-200" : "text-gray-400 group-hover:text-gray-200"}`}>
                      {threadLabel(t.id)}
                    </p>
                    <p className="text-[9px] text-gray-600 mt-0.5" title={formatAbsolute(t.updated_at)}>
                      {formatRelative(t.updated_at)}
                      {t.created_at && t.updated_at !== t.created_at && (
                        <span className="ml-1 text-gray-700">· {formatAbsolute(t.created_at)}</span>
                      )}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Trace panel */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Active thread info bar */}
            {selectedThreadRow && (
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 flex-none bg-gray-900/30">
                <span className="font-mono text-[10px] text-gray-500 truncate flex-1" title={selectedThreadRow.id}>
                  {selectedThreadRow.id}
                </span>
                <span className="font-mono text-[9px] text-gray-600 flex-none">
                  created {formatAbsolute(selectedThreadRow.created_at)}
                </span>
                <span className="font-mono text-[9px] text-gray-600 flex-none">
                  updated {formatRelative(selectedThreadRow.updated_at)}
                </span>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto bg-gray-950 px-4 py-3">
              {!selectedThread && (
                <p className="font-mono text-xs text-gray-600">Select a thread on the left.</p>
              )}
              {error && (
                <p className="font-mono text-xs text-red-400">Error: {(error as Error).message}</p>
              )}
              {trace && trace.length === 0 && (
                <p className="font-mono text-xs text-gray-600">No checkpoint data yet for this thread.</p>
              )}
              {trace && trace.map((entry, i) => renderEntry(entry, i))}
              <div ref={bottomRef} />
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-t border-gray-800 flex-none bg-gray-900/40 rounded-br-xl">
              <span className="font-mono text-[10px] text-gray-700 ml-auto">
                {trace ? `${trace.length} entries` : isLoading ? "loading…" : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Diagnostics modal ─────────────────────────────────────────────────────────

const ERROR_STATES = new Set(["error", "failed"]);

interface DiagnosticsData {
  agent_id: string;
  lifecycle_state: string;
  last_error: string | null;
  last_error_at: string | null;
  lifecycle_events: { id: number; from_state: string; to_state: string; reason: string | null; created_at: string | null }[];
  recent_messages: { role: string; content: string; created_at: string | null }[];
}

function AgentDiagnosticsModal({ agent, onClose }: { agent: any; onClose: () => void }) {
  const { data, isLoading, error } = useQuery<DiagnosticsData>({
    queryKey: ["agent-diagnostics", agent.id],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agent.id}/diagnostics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });

  const formatTime = (iso: string | null) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  const stateBadge = (s: string) => {
    const cls = ERROR_STATES.has(s) ? "text-red-400" : "text-gray-400";
    return <span className={`font-mono text-xs ${cls}`}>{s}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-none">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-red-400" />
            <p className="font-semibold">Diagnostics — {agent.name || agent.id}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300" aria-label="Close diagnostics"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">          {isLoading && <p className="text-gray-400 text-sm">Loading diagnostics…</p>}
          {error && <p className="text-red-400 text-sm">Failed to load diagnostics: {(error as Error).message}</p>}

          {data && (
            <>
              {/* Last error */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Last Error</h3>
                {data.last_error ? (
                  <div className="bg-red-950/40 border border-red-800/40 rounded-lg p-3">
                    <p className="text-red-300 text-sm font-mono break-all whitespace-pre-wrap">{data.last_error}</p>
                    <p className="text-xs text-gray-500 mt-1">{formatTime(data.last_error_at)}</p>
                  </div>
                ) : (() => {
                  const fallback = data.lifecycle_events.find(
                    (e: { to_state: string; reason: string | null; created_at: string | null }) => e.to_state === "error" && e.reason
                  );
                  return fallback ? (
                    <div className="bg-red-950/40 border border-red-800/40 rounded-lg p-3">
                      <p className="text-red-300 text-sm font-mono break-all whitespace-pre-wrap">{fallback.reason}</p>
                      <p className="text-xs text-gray-500 mt-1">{formatTime(fallback.created_at)} (from lifecycle event)</p>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No error recorded. Current state: {stateBadge(data.lifecycle_state)}</p>
                  );
                })()}
              </section>

              {/* Lifecycle events */}
              {data.lifecycle_events.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent Lifecycle Events</h3>
                  <div className="space-y-1">
                    {data.lifecycle_events.map((e) => (
                      <div key={e.id} className="bg-gray-800 rounded-lg px-3 py-2 flex items-start gap-3">
                        <div className="flex items-center gap-1.5 flex-none text-xs">
                          {stateBadge(e.from_state ?? "—")}
                          <span className="text-gray-600">→</span>
                          {stateBadge(e.to_state)}
                        </div>
                        <div className="flex-1 min-w-0">
                          {e.reason && (
                            <p className="text-xs text-gray-300 font-mono break-all truncate" title={e.reason}>{e.reason}</p>
                          )}
                          <p className="text-xs text-gray-600">{formatTime(e.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Recent messages */}
              {data.recent_messages.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent Messages</h3>
                  <div className="space-y-1.5">
                    {data.recent_messages.map((m, i) => (
                      <div key={i} className={`rounded-lg px-3 py-2 text-xs ${m.role === "user" ? "bg-gray-800" : "bg-gray-800/60"}`}>
                        <span className={`font-semibold mr-2 ${m.role === "user" ? "text-indigo-400" : "text-green-400"}`}>{m.role}</span>
                        <span className="text-gray-300 font-mono break-all">{m.content}</span>
                        <span className="text-gray-600 ml-2">{formatTime(m.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {data.lifecycle_events.length === 0 && data.recent_messages.length === 0 && !data.last_error && (
                <p className="text-gray-500 text-sm">No diagnostic data available yet. The agent may not have been invoked.</p>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-800 flex-none flex justify-end">
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-200 px-4 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Skill helpers ─────────────────────────────────────────────────────────────

async function fetchAgentSkills(agentId: string): Promise<string[]> {
  const res = await fetch(`/api/agents/${agentId}/skills`);
  if (!res.ok) return [];
  return (await res.json()).skills ?? [];
}

async function fetchInstalledSkills(agentId: string): Promise<string[]> {
  const res = await fetch(`/api/skills?agent_id=${agentId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.skills ?? []).map((s: any) => s.slug as string);
}

function AgentSkillsEditor({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: assigned = [] } = useQuery<string[]>({
    queryKey: ["agent-skills", agentId],
    queryFn: () => fetchAgentSkills(agentId),
  });

  const { data: available = [] } = useQuery<string[]>({
    queryKey: ["installed-skills", agentId],
    queryFn: () => fetchInstalledSkills(agentId),
    enabled: open,
  });

  const toggle = useMutation({
    mutationFn: async (slug: string) => {
      const next = assigned.includes(slug)
        ? assigned.filter((s) => s !== slug)
        : [...assigned, slug];
      const res = await fetch(`/api/agents/${agentId}/skills`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: next }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-skills", agentId] }),
  });

  return (
    <div className="mt-2 pt-2 border-t border-gray-700/50">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-gray-500 flex items-center gap-1">
          <Puzzle size={11} /> Skills
        </span>
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-700"
          >
            Manage <ChevronDown size={11} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]">
                {available.length === 0 ? (
                  <p className="text-xs text-gray-500 px-3 py-2">No skills installed</p>
                ) : (
                  available.map((slug) => (
                    <button
                      key={slug}
                      onClick={() => toggle.mutate(slug)}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-700 transition-colors"
                    >
                      <span className={`w-3 flex-none ${assigned.includes(slug) ? "text-indigo-400" : "text-transparent"}`}>
                        <Check size={11} />
                      </span>
                      {slug}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {assigned.length === 0 ? (
          <span className="text-xs text-gray-600">None assigned</span>
        ) : (
          assigned.map((s) => (
            <span key={s} className="flex items-center gap-1 bg-indigo-900/50 text-indigo-300 text-xs px-2 py-0.5 rounded-full">
              <Puzzle size={9} /> {s}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

const LIFECYCLE_COLORS: Record<string, string> = {
  idle:             "bg-gray-700 text-gray-300",
  spawning:         "bg-blue-900 text-blue-300",
  trust_required:   "bg-yellow-900 text-yellow-300",
  ready_for_prompt: "bg-teal-900 text-teal-300",
  running:          "bg-green-900 text-green-300",
  finished:         "bg-indigo-900 text-indigo-300",
  failed:           "bg-red-900 text-red-300",
  suspended:        "bg-orange-900 text-orange-300",
  error:            "bg-red-900 text-red-300",
  terminated:       "bg-gray-800 text-gray-500",
};

const AGENT_AVATAR_COLORS = [
  "bg-indigo-600", "bg-purple-600", "bg-rose-600", "bg-teal-600",
  "bg-orange-600", "bg-cyan-600", "bg-pink-600",
];

function agentAvatarColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AGENT_AVATAR_COLORS[h % AGENT_AVATAR_COLORS.length];
}

async function fetchAgents(orgId?: string) {
  const url = orgId ? `/api/agents?org_id=${encodeURIComponent(orgId)}` : "/api/agents";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

// ── Invoke modal ──────────────────────────────────────────────────────────────

function InvokeModal({ agent, onClose }: { agent: any; onClose: () => void }) {
  const qc = useQueryClient();
  const { activeOrg } = useOrg();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ reply?: string; error?: string; thread_id?: string } | null>(null);

  const invoke = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/invoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent_id: agent.id, message, channel: "dashboard", org_id: activeOrg || "default" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? "Invoke failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data);
      setMessage("");
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["threads"] });
    },
    onError: (err: Error) => setResult({ error: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <p className="font-semibold">{agent.name || agent.id}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {agent.model ?? "—"} · {agent.lifecycle_state ?? "idle"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        {/* Result area */}
        {result && (
          <div
            className={`mx-5 mt-4 p-3 rounded-lg text-sm ${
              result.error ? "bg-red-900/30 text-red-300" : "bg-gray-800 text-gray-200"
            }`}
          >
            {result.error ? (
              <p>Error: {result.error}</p>
            ) : (
              <>
                <p className="whitespace-pre-wrap">{result.reply || "(no reply)"}</p>
                {result.thread_id && (
                  <p className="text-xs text-gray-500 mt-2">Thread: {result.thread_id}</p>
                )}
              </>
            )}
          </div>
        )}

        {/* Input */}
        <div className="p-5">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && message.trim() && !invoke.isPending) {
                invoke.mutate();
              }
            }}
            placeholder="Type a message... (Ctrl+Enter to send)"
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={() => invoke.mutate()}
              disabled={!message.trim() || invoke.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
            >
              {invoke.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {invoke.isPending ? "Running..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create Agent Modal ────────────────────────────────────────────────────────

function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [agentId, setAgentId] = useState("");
  const [description, setDescription] = useState("");
  const [tier, setTier] = useState("T2");
  const [division, setDivision] = useState("personal");
  const [primaryModel, setPrimaryModel] = useState("anthropic/claude-sonnet-4-20250514");

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId.trim().toLowerCase().replace(/\s+/g, "-"),
          description: description.trim() || undefined,
          tier,
          division: division.trim() || "personal",
          primary_model: primaryModel.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "Create failed");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      onClose();
    },
  });

  const slug = agentId.trim().toLowerCase().replace(/\s+/g, "-");
  const valid = slug.length > 0 && /^[a-z0-9-]+$/.test(slug);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <p className="font-semibold">New Agent</p>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1">
            <label className="text-xs text-gray-500 font-medium uppercase tracking-wide">Agent ID <span className="text-red-400">*</span></label>
            <input
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              placeholder="e.g. research-bot"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-600"
            />
            {agentId && !valid && (
              <p className="text-xs text-amber-500/80">ID must be lowercase letters, numbers and hyphens only.</p>
            )}
            {slug && valid && slug !== agentId && (
              <p className="text-xs text-gray-500">Will be saved as: <span className="font-mono text-indigo-400">{slug}</span></p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500 font-medium uppercase tracking-wide">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of what this agent does…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium uppercase tracking-wide">Tier</label>
              <select value={tier} onChange={(e) => setTier(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500">
                <option value="T1">T1 — Full tools</option>
                <option value="T2">T2 — Standard</option>
                <option value="T3">T3 — Read-only</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium uppercase tracking-wide">Division</label>
              <input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="personal"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-600"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500 font-medium uppercase tracking-wide">Primary Model</label>
            <input value={primaryModel} onChange={(e) => setPrimaryModel(e.target.value)}
              placeholder="anthropic/claude-sonnet-4-20250514"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 font-mono placeholder:text-gray-600"
            />
          </div>
          {create.isError && (
            <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/30 rounded-lg px-3 py-2">
              {(create.error as Error)?.message}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-gray-800">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">Cancel</button>
          <button
            onClick={() => create.mutate()}
            disabled={!valid || create.isPending}
            className="flex items-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {create.isPending ? "Creating…" : "Create Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const { activeOrg } = useOrg();
  const { data, isLoading, error } = useQuery({ queryKey: ["agents", activeOrg], queryFn: () => fetchAgents(activeOrg) });
  const [invokingAgent, setInvokingAgent] = useState<any | null>(null);
  const [chatAgent, setChatAgent] = useState<any | null>(null);
  const [settingsAgent, setSettingsAgent] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [diagnosticsAgent, setDiagnosticsAgent] = useState<any | null>(null);
  const [logAgent, setLogAgent] = useState<any | null>(null);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Agents</h1>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
        >
          <Plus size={15} /> New Agent
        </button>
      </div>
      {isLoading && <p className="text-gray-400">Loading...</p>}
      {error && <p className="text-red-400">Error loading agents</p>}
      {Array.isArray(data) && data.length === 0 && (
        <p className="text-gray-400">No agents configured yet.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.isArray(data) &&
          data.filter((a: any) => !a.system).map((agent: any) => {
            const state = agent.lifecycle_state ?? "idle";
            const badgeClass = LIFECYCLE_COLORS[state] ?? "bg-gray-700 text-gray-300";
            const avatarColor = agentAvatarColor(agent.id);
            const initials = (agent.name || agent.id).slice(0, 2).toUpperCase();
            return (
              <div key={agent.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex flex-col gap-3">
                {/* Header row with avatar + name + badges */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setChatAgent(agent)}
                    className={`w-10 h-10 rounded-full flex-none flex items-center justify-center text-sm font-bold text-white ${avatarColor} hover:opacity-80 transition-opacity cursor-pointer`}
                    title="Open chat"
                  >
                    {initials}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{agent.name || agent.id}</p>
                    {ERROR_STATES.has(state) ? (
                      <button
                        onClick={() => setDiagnosticsAgent(agent)}
                        className={`text-xs px-2 py-0.5 rounded-full ${badgeClass} hover:opacity-80 transition-opacity underline-offset-2 hover:underline cursor-pointer`}
                        title="Click to view diagnostics"
                      >
                        {state} ↗
                      </button>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${badgeClass}`}>{state}</span>
                    )}
                  </div>
                  <button
                    onClick={() => setSettingsAgent(agent)}
                    className="text-gray-500 hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-700 transition-colors"
                    title="Agent settings"
                  >
                    <Settings size={15} />
                  </button>
                </div>

                {/* Details */}
                <div className="space-y-1">
                  <p className="text-sm text-gray-400">
                    <span className="text-gray-500">Model</span>{" "}
                    <span className="font-mono text-xs text-gray-300">{agent.model ?? "—"}</span>
                  </p>
                  <p className="text-sm text-gray-400">
                    <span className="text-gray-500">Tier</span> {agent.tier ?? "—"}
                  </p>
                  {agent.division && (
                    <p className="text-sm text-gray-400">
                      <span className="text-gray-500">Division</span> {agent.division}
                    </p>
                  )}
                </div>

                {/* Skills */}
                <AgentSkillsEditor agentId={agent.id} />

                {/* Actions */}
                <div className="pt-1 border-t border-gray-700/50 flex items-center gap-2">
                  <button
                    onClick={() => setChatAgent(agent)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
                  >
                    <MessageCircle size={12} />
                    Chats
                  </button>
                  <button
                    onClick={() => setInvokingAgent(agent)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md transition-colors"
                  >
                    <MessageSquare size={12} />
                    Invoke
                  </button>
                  <button
                    onClick={() => setLogAgent(agent)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md transition-colors ml-auto"
                    title="View LLM trace log"
                  >
                    <Terminal size={12} />
                    Log
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      {Array.isArray(data) && data.some((a: any) => a.system) && (
        <>
          <div className="flex items-center gap-2 mt-6 mb-3">
            <Shield size={15} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">System Agents</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.filter((a: any) => a.system).map((agent: any) => {
              const state = agent.lifecycle_state ?? "idle";
              const badgeClass = LIFECYCLE_COLORS[state] ?? "bg-gray-700 text-gray-300";
              const avatarColor = agentAvatarColor(agent.id);
              const initials = (agent.name || agent.id).slice(0, 2).toUpperCase();
              return (
                <div key={agent.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700/60 flex flex-col gap-3 opacity-90">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setChatAgent(agent)}
                      className={`w-10 h-10 rounded-full flex-none flex items-center justify-center text-sm font-bold text-white ${avatarColor} hover:opacity-80 transition-opacity cursor-pointer`}
                      title="Open chat"
                    >
                      {initials}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium truncate">{agent.name || agent.id}</p>
                        <span title="System agent"><Shield size={10} className="text-gray-500 flex-none" /></span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${badgeClass}`}>{state}</span>
                    </div>
                    <button
                      onClick={() => setSettingsAgent(agent)}
                      className="text-gray-500 hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-700 transition-colors"
                      title="Agent settings"
                    >
                      <Settings size={15} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-gray-400">
                      <span className="text-gray-500">Model</span>{" "}
                      <span className="font-mono text-xs text-gray-300">{agent.model ?? "—"}</span>
                    </p>
                    <p className="text-sm text-gray-400">
                      <span className="text-gray-500">Tier</span> {agent.tier ?? "—"}
                    </p>
                    {agent.division && (
                      <p className="text-sm text-gray-400">
                        <span className="text-gray-500">Division</span> {agent.division}
                      </p>
                    )}
                  </div>
                  <AgentSkillsEditor agentId={agent.id} />
                  <div className="pt-1 border-t border-gray-700/50 flex items-center gap-2">
                    <button
                      onClick={() => setChatAgent(agent)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
                    >
                      <MessageCircle size={12} />
                      Chats
                    </button>
                    <button
                      onClick={() => setInvokingAgent(agent)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md transition-colors"
                    >
                      <MessageSquare size={12} />
                      Invoke
                    </button>
                    <button
                      onClick={() => setLogAgent(agent)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-md transition-colors ml-auto"
                      title="View LLM trace log"
                    >
                      <Terminal size={12} />
                      Log
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {creating && (
        <CreateAgentModal onClose={() => setCreating(false)} />
      )}

      {invokingAgent && (
        <InvokeModal agent={invokingAgent} onClose={() => setInvokingAgent(null)} />
      )}

      {chatAgent && (
        <AgentChatPanel
          agent={chatAgent}
          onClose={() => setChatAgent(null)}
        />
      )}

      {settingsAgent && (
        <AgentSettingsModal
          agent={settingsAgent}
          allAgents={Array.isArray(data) ? data : []}
          onClose={() => setSettingsAgent(null)}
        />
      )}

      {diagnosticsAgent && (
        <AgentDiagnosticsModal
          agent={diagnosticsAgent}
          onClose={() => setDiagnosticsAgent(null)}
        />
      )}

      {logAgent && (
        <AgentLogModal
          agent={logAgent}
          onClose={() => setLogAgent(null)}
        />
      )}
    </div>
  );
}
