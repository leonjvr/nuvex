import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, Wrench, AlertCircle } from "lucide-react";

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchApprovals() {
  const res = await fetch("/api/approvals");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function resolve(id: string, action: "approve" | "reject") {
  const res = await fetch(`/api/approvals/${id}/${action}`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return iso; }
}

// ── Card ──────────────────────────────────────────────────────────────────────

function ApprovalCard({ a, onApprove, onReject, loading }: {
  a: any;
  onApprove: () => void;
  onReject: () => void;
  loading: boolean;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {a.agent_id && (
              <span className="text-xs text-indigo-400 font-medium">{a.agent_id}</span>
            )}
            <span className="flex items-center gap-1 text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full">
              <Wrench size={10} />
              {a.tool_name}
            </span>
          </div>
          {a.reason && (
            <p className="text-sm text-gray-300 leading-relaxed">{a.reason}</p>
          )}
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap flex-none">{fmt(a.created_at)}</span>
      </div>

      {a.tool_input && Object.keys(a.tool_input).length > 0 && (
        <details className="group">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400 select-none">
            Tool input
          </summary>
          <pre className="mt-2 p-2 rounded bg-gray-900 text-xs text-gray-400 overflow-x-auto">
            {JSON.stringify(a.tool_input, null, 2)}
          </pre>
        </details>
      )}

      {a.thread_id && (
        <p className="text-xs text-gray-600">
          Thread: <span className="font-mono">{a.thread_id.slice(-16)}</span>
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onApprove}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-900/40 hover:bg-green-700/50 text-green-400 border border-green-800/40 transition-colors disabled:opacity-40"
        >
          <CheckCircle size={12} />
          Approve
        </button>
        <button
          onClick={onReject}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-700/50 text-red-400 border border-red-800/40 transition-colors disabled:opacity-40"
        >
          <XCircle size={12} />
          Reject
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const qc = useQueryClient();

  const { data = [], isLoading, error } = useQuery<any[]>({
    queryKey: ["approvals"],
    queryFn: fetchApprovals,
    refetchInterval: 10000,
  });

  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      resolve(id, action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approvals"] }),
  });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Pending Approvals</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Agents waiting for operator approval before executing a tool.
          </p>
        </div>
        {data.length > 0 && (
          <span className="text-xs font-medium bg-orange-900/40 text-orange-400 border border-orange-800/40 px-2.5 py-1 rounded-full">
            {data.length} pending
          </span>
        )}
      </div>

      {isLoading && (
        <p className="text-sm text-gray-500 text-center py-10">Loading…</p>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-950/20 border border-red-800/20 rounded-lg px-4 py-3">
          <AlertCircle size={14} />
          {(error as Error).message}
        </div>
      )}

      {!isLoading && !error && data.length === 0 && (
        <div className="text-center py-16 space-y-2">
          <Clock size={32} className="mx-auto text-gray-700" />
          <p className="text-sm text-gray-500">No pending approvals</p>
          <p className="text-xs text-gray-600">Agents are running within their configured policy.</p>
        </div>
      )}

      {data.map((a) => (
        <ApprovalCard
          key={a.id}
          a={a}
          loading={mutation.isPending}
          onApprove={() => mutation.mutate({ id: a.id, action: "approve" })}
          onReject={() => mutation.mutate({ id: a.id, action: "reject" })}
        />
      ))}
    </div>
  );
}
