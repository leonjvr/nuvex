import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Brain, CheckCircle, Clock, Hash, Trash2, ChevronDown, ChevronRight } from "lucide-react";

async function fetchAgents() {
  const res = await fetch("/api/agents");
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json() as Promise<{ id: string; name: string }[]>;
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchStats() {
  const res = await fetch("/api/memory/stats/summary");
  if (!res.ok) throw new Error("Failed to fetch memory stats");
  return res.json();
}

async function fetchPendingApprovals() {
  const res = await fetch("/api/memory/pending-approvals");
  if (!res.ok) throw new Error("Failed to fetch pending approvals");
  return res.json();
}

async function fetchMemories(agentId: string, scope: string) {
  const params = new URLSearchParams({ limit: "100" });
  if (agentId) params.set("agent_id", agentId);
  if (scope) params.set("scope", scope);
  const res = await fetch(`/api/memory?${params}`);
  if (!res.ok) throw new Error("Failed to fetch memories");
  return res.json();
}

async function deleteMemory(id: number) {
  const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete memory");
}

async function approveMemory(id: number) {
  const res = await fetch(`/api/memory/${id}/approve?approver_agent_id=dashboard`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to approve memory");
}

// ── Scope badge ────────────────────────────────────────────────────────────────

const SCOPE_COLORS: Record<string, string> = {
  personal: "bg-blue-900 text-blue-300",
  division: "bg-purple-900 text-purple-300",
  org: "bg-amber-900 text-amber-300",
};

function ScopeBadge({ scope }: { scope: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SCOPE_COLORS[scope] ?? "bg-gray-700 text-gray-400"}`}>
      {scope}
    </span>
  );
}

// ── Confidence bar ─────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 85 ? "bg-green-500" : pct >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400">{pct}%</span>
    </div>
  );
}

// ── Stats panel ────────────────────────────────────────────────────────────────

function StatsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["memory-stats"],
    queryFn: fetchStats,
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-gray-500 text-sm">Loading stats…</p>;
  if (!data) return null;

  const agents = Object.keys(data.counts_by_agent ?? {});

  return (
    <div className="grid grid-cols-1 gap-4">
      {agents.length === 0 && (
        <p className="text-gray-500 text-sm">No memory entries yet.</p>
      )}
      {agents.map((agentId) => {
        const scopes: Record<string, number> = data.counts_by_agent[agentId];
        const total = Object.values(scopes).reduce((s: number, v) => s + (v as number), 0);
        const tokenStats = data.token_stats?.[agentId];
        return (
          <div key={agentId} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium text-sm">{agentId}</span>
              <span className="text-xs text-gray-500">{total} total</span>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              {Object.entries(scopes).map(([scope, cnt]) => (
                <div key={scope} className="flex items-center gap-1.5">
                  <ScopeBadge scope={scope} />
                  <span className="text-xs text-gray-400">{cnt as number}</span>
                </div>
              ))}
            </div>
            {tokenStats && (
              <div className="flex gap-4 text-xs text-gray-500 mt-2 border-t border-gray-700 pt-2">
                <span>
                  <Hash size={11} className="inline mr-1 opacity-60" />
                  ~{tokenStats.avg_tokens_per_memory} tokens/memory
                </span>
                <span>
                  <Brain size={11} className="inline mr-1 opacity-60" />
                  {tokenStats.total_retrievals} retrievals
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Recent consolidations ─────────────────────────────────────────────────────

function RecentConsolidations() {
  const { data, isLoading } = useQuery({
    queryKey: ["memory-stats"],
    queryFn: fetchStats,
    refetchInterval: 30_000,
  });

  const rows: any[] = data?.recent_consolidations ?? [];

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (rows.length === 0) return <p className="text-gray-500 text-sm">No consolidations yet.</p>;

  return (
    <div className="space-y-2">
      {rows.map((r: any) => (
        <div key={r.id} className="flex gap-3 items-start bg-gray-800/50 rounded p-3 border border-gray-700/50">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-200 leading-relaxed truncate">{r.content}</p>
            <div className="flex items-center gap-3 mt-1.5">
              <span className="text-xs text-gray-500">{r.agent_id}</span>
              <ScopeBadge scope={r.scope} />
              <ConfidenceBar value={r.confidence} />
              {r.source_thread && (
                <a
                  href={`/threads?thread_id=${encodeURIComponent(r.source_thread)}`}
                  className="text-xs text-indigo-400 hover:text-indigo-300 underline truncate max-w-[180px]"
                  title={r.source_thread}
                >
                  {r.source_thread.split(":").slice(-1)[0] || r.source_thread}
                </a>
              )}
            </div>
          </div>
          <span className="text-xs text-gray-600 shrink-0">
            {new Date(r.created_at).toLocaleDateString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Pending approvals ─────────────────────────────────────────────────────────

function PendingApprovals() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["memory-pending"],
    queryFn: fetchPendingApprovals,
    refetchInterval: 15_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approveMemory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memory-pending"] });
      qc.invalidateQueries({ queryKey: ["memory-stats"] });
    },
  });

  const rows: any[] = Array.isArray(data) ? data : [];

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (rows.length === 0) return <p className="text-gray-500 text-sm">No pending approvals.</p>;

  return (
    <div className="space-y-2">
      {rows.map((r: any) => (
        <div key={r.id} className="flex items-start gap-3 bg-amber-900/20 border border-amber-800/40 rounded-lg p-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-amber-300 font-medium">Promotion #{r.id}</span>
              <ScopeBadge scope={r.target_scope} />
            </div>
            <p className="text-xs text-gray-400">
              Source memory #{r.source_memory_id} · Requested by {r.requested_by}
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              <Clock size={10} className="inline mr-1" />
              {new Date(r.requested_at).toLocaleString()}
            </p>
          </div>
          <button
            onClick={() => approveMutation.mutate(r.source_memory_id)}
            disabled={approveMutation.isPending}
            className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-green-700 hover:bg-green-600 disabled:opacity-40 transition-colors"
          >
            <CheckCircle size={12} />
            Approve
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Memory browser ────────────────────────────────────────────────────────────

function MemoryBrowser() {
  const qc = useQueryClient();
  const [agentFilter, setAgentFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [expanded, setExpanded] = useState(false);

  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["memories", agentFilter, scopeFilter],
    queryFn: () => fetchMemories(agentFilter, scopeFilter),
    enabled: expanded,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteMemory(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memories"] }),
  });

  const rows: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-800/60 hover:bg-gray-800 text-sm text-left"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-medium flex-1">Browse Memories</span>
        <span className="text-xs text-gray-500">Click to expand</span>
      </button>
      {expanded && (
        <div className="p-4">
          <div className="flex gap-3 mb-4">
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              title="Filter by agent"
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm"
            >
              <option value="">All agents</option>
              {(agents ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name ?? a.id}</option>
              ))}
            </select>
            <select
              value={scopeFilter}
              onChange={(e) => setScopeFilter(e.target.value)}
              title="Filter by memory scope"
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm"
            >
              <option value="">All scopes</option>
              <option value="personal">personal</option>
              <option value="division">division</option>
              <option value="org">org</option>
            </select>
          </div>
          {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
          {!isLoading && rows.length === 0 && (
            <p className="text-gray-500 text-sm">No memories found.</p>
          )}
          <div className="space-y-2">
            {rows.map((r: any) => (
              <div key={r.id} className="flex items-start gap-3 bg-gray-800/40 rounded p-3 border border-gray-700/50">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-200 leading-relaxed">{r.content}</p>
                  <div className="flex items-center flex-wrap gap-2 mt-1.5">
                    <span className="text-xs text-gray-500">{r.agent_id}</span>
                    <ScopeBadge scope={r.scope} />
                    <ConfidenceBar value={r.confidence} />
                    <span className="text-xs text-gray-600">
                      retrieved {r.retrieval_count}×
                    </span>
                    {r.approved_by === null && r.scope === "org" && (
                      <span className="text-xs text-amber-400">pending approval</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteMutation.mutate(r.id)}
                  disabled={deleteMutation.isPending}
                  className="text-gray-600 hover:text-red-400 transition-colors mt-0.5"
                  title="Delete memory"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MemoryPage() {
  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-6">
        <Brain size={22} className="text-indigo-400" />
        <h1 className="text-2xl font-semibold">Memory</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Counts by scope per agent */}
        <section>
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
            Counts by Agent
          </h2>
          <StatsPanel />
        </section>

        {/* Pending org approvals */}
        <section>
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
            Pending Org Approvals
          </h2>
          <PendingApprovals />
        </section>
      </div>

      {/* Recent consolidations */}
      <section className="mb-6">
        <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          Recent Consolidations
        </h2>
        <RecentConsolidations />
      </section>

      {/* Memory browser */}
      <MemoryBrowser />
    </div>
  );
}
