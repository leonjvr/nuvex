import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Wrench, ShieldCheck, ShieldX, ChevronDown, ChevronRight } from "lucide-react";

async function fetchThreads() {
  const res = await fetch("/api/threads");
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function fetchMessages(threadId: string) {
  const res = await fetch(`/api/threads/${threadId}/messages`);
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function fetchAuditForThread(threadId: string) {
  const res = await fetch(`/api/audit?thread_id=${encodeURIComponent(threadId)}&limit=200`);
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ── Governance badge grouped by invocation ───────────────────────────────────
function GovernanceAnnotations({ entries }: { entries: any[] }) {
  const [open, setOpen] = useState(false);
  if (!entries || entries.length === 0) return null;
  const denied = entries.filter((e: any) => e.decision === "denied");
  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-gray-500 hover:text-gray-300"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {entries.length} governance decision{entries.length !== 1 ? "s" : ""}
        {denied.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-red-900/60 text-red-300">
            {denied.length} denied
          </span>
        )}
      </button>
      {open && (
        <ul className="mt-1 space-y-1 pl-4 border-l border-gray-700">
          {entries.map((e: any) => (
            <li key={e.id} className="flex items-start gap-1.5">
              {e.decision === "approved" ? (
                <ShieldCheck size={11} className="mt-0.5 text-green-400 flex-none" />
              ) : (
                <ShieldX size={11} className="mt-0.5 text-red-400 flex-none" />
              )}
              <span className={e.decision === "approved" ? "text-green-300" : "text-red-300"}>
                {e.tool_name || e.action}
              </span>
              {e.reason && <span className="text-gray-500">— {e.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg, auditByInvocation }: { msg: any; auditByInvocation: Map<string, any[]> }) {
  const isUser = msg.role === "user";
  const isTool = msg.role === "tool";
  const invocationId = msg.metadata_?.invocation_id ?? null;
  const govEntries = invocationId ? (auditByInvocation.get(invocationId) ?? []) : [];

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-xl rounded-lg p-3 text-sm ${
          isUser
            ? "bg-indigo-900/50 text-indigo-100"
            : isTool
            ? "bg-yellow-900/20 border border-yellow-800/40 text-yellow-200 font-mono text-xs"
            : "bg-gray-800 text-gray-200"
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          {isTool && <Wrench size={12} className="text-yellow-400 flex-none" />}
          <span className="text-xs text-gray-500">
            {msg.role}
            {msg.created_at ? " · " + new Date(msg.created_at).toLocaleTimeString() : ""}
            {msg.tokens ? " · " + msg.tokens + " tok" : ""}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        {!isUser && govEntries.length > 0 && <GovernanceAnnotations entries={govEntries} />}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ThreadsPage() {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: threads, isLoading } = useQuery({ queryKey: ["threads"], queryFn: fetchThreads });
  const { data: messages } = useQuery({
    queryKey: ["messages", selected],
    queryFn: () => fetchMessages(selected!),
    enabled: !!selected,
  });
  const { data: auditEntries } = useQuery({
    queryKey: ["threadAudit", selected],
    queryFn: () => fetchAuditForThread(selected!),
    enabled: !!selected,
  });

  // Group governance decisions by invocation_id for inline annotation
  const auditByInvocation = new Map<string, any[]>();
  if (Array.isArray(auditEntries)) {
    for (const e of auditEntries) {
      if (!e.invocation_id) continue;
      const list = auditByInvocation.get(e.invocation_id) ?? [];
      list.push(e);
      auditByInvocation.set(e.invocation_id, list);
    }
  }

  return (
    <div className="flex h-full">
      {/* Thread list */}
      <div className="w-72 flex-none border-r border-gray-800 overflow-y-auto">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-semibold">Threads</h1>
        </div>
        {isLoading && <p className="p-4 text-gray-400 text-sm">Loading…</p>}
        <ul>
          {Array.isArray(threads) &&
            threads.map((t: any) => (
              <li key={t.id}>
                <button
                  onClick={() => setSelected(t.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors ${
                    selected === t.id ? "bg-gray-800" : ""
                  }`}
                >
                  <p className="text-sm font-medium truncate">{t.id}</p>
                  <p className="text-xs text-gray-500">
                    {t.agent_id} · {t.channel} · {t.message_count} msgs
                  </p>
                  {t.created_at && (
                    <p className="text-xs text-gray-600 mt-0.5">
                      {new Date(t.created_at).toLocaleDateString()}
                    </p>
                  )}
                </button>
              </li>
            ))}
        </ul>
      </div>

      {/* Conversation detail */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected && (
          <p className="text-gray-500 text-sm mt-8 text-center">
            Select a thread to view the conversation
          </p>
        )}
        {selected && Array.isArray(messages) && (
          <div className="space-y-3 max-w-3xl mx-auto">
            <p className="text-xs text-gray-600 mb-4">
              Thread: <span className="font-mono text-gray-500">{selected}</span>
              {auditEntries && auditEntries.length > 0 && (
                <button
                  onClick={() => {
                    const first = document.querySelector('[data-gov-toggle]') as HTMLButtonElement;
                    first?.click();
                  }}
                  className="ml-3 px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs"
                >
                  {auditEntries.length} governance {auditEntries.length === 1 ? 'decision' : 'decisions'} ↕
                </button>
              )}
            </p>
            {messages.map((m: any) => (
              <MessageBubble key={m.id} msg={m} auditByInvocation={auditByInvocation} />
            ))}
            {messages.length === 0 && (
              <p className="text-gray-500 text-sm text-center">No messages in this thread</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
