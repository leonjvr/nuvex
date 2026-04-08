import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, ShieldCheck, Clock, GitBranch } from "lucide-react";

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchCandidates(status: string) {
  const res = await fetch(`/api/policy-candidates?status=${status}&limit=50`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function approve(id: string) {
  const res = await fetch(`/api/policy-candidates/${id}/approve?reviewer_id=dashboard`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function reject(id: string) {
  const res = await fetch(`/api/policy-candidates/${id}/reject?reviewer_id=dashboard`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return iso; }
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    deny: "bg-red-900 text-red-300",
    warn: "bg-yellow-900 text-yellow-300",
    require_approval: "bg-orange-900 text-orange-300",
    allow: "bg-green-900 text-green-300",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[action] ?? "bg-gray-700 text-gray-400"}`}>
      {action}
    </span>
  );
}

function CandidateCard({ c, onApprove, onReject, loading }: {
  c: any; onApprove: () => void; onReject: () => void; loading: boolean;
}) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {c.agent_id && <span className="text-xs text-indigo-400 font-medium">{c.agent_id}</span>}
            {c.division_id && <span className="text-xs text-purple-400">{c.division_id}</span>}
            <ActionBadge action={c.action} />
          </div>
          <p className="text-sm text-gray-300 leading-relaxed">{c.rationale}</p>
        </div>
        <span className="text-xs text-gray-500 whitespace-nowrap flex-none">{fmt(c.created_at)}</span>
      </div>

      {/* Condition tree */}
      <details className="group">
        <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400 select-none flex items-center gap-1">
          <GitBranch size={11} />
          Condition&nbsp;tree
        </summary>
        <pre className="mt-2 p-2 rounded bg-gray-900 text-xs text-gray-400 overflow-x-auto">
          {JSON.stringify(c.condition_tree, null, 2)}
        </pre>
      </details>

      {/* Source threads */}
      {c.source_threads?.length > 0 && (
        <p className="text-xs text-gray-500">
          <span className="text-gray-600">From threads:</span>{" "}
          {c.source_threads.slice(0, 3).map((t: string) => (
            <span key={t} className="font-mono bg-gray-900 px-1 py-0.5 rounded mr-1">{t.slice(-8)}</span>
          ))}
          {c.source_threads.length > 3 && <span>+{c.source_threads.length - 3} more</span>}
        </p>
      )}

      {/* Action buttons */}
      {c.status === "pending_review" && (
        <div className="flex gap-2 pt-1 border-t border-gray-700/50">
          <button
            onClick={onApprove}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-md transition-colors disabled:opacity-50"
          >
            <CheckCircle size={12} />
            Approve
          </button>
          <button
            onClick={onReject}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-900 hover:bg-red-800 text-red-300 rounded-md transition-colors disabled:opacity-50"
          >
            <XCircle size={12} />
            Reject
          </button>
        </div>
      )}

      {c.status !== "pending_review" && (
        <div className="flex items-center gap-2 pt-1 border-t border-gray-700/50">
          {c.status === "approved"
            ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle size={11} /> Approved by {c.reviewed_by}</span>
            : <span className="flex items-center gap-1 text-xs text-red-400"><XCircle size={11} /> Rejected by {c.reviewed_by}</span>
          }
          <span className="text-xs text-gray-600">{fmt(c.reviewed_at)}</span>
        </div>
      )}
    </div>
  );
}

function CandidatesTab({ status }: { status: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["policy-candidates", status],
    queryFn: () => fetchCandidates(status),
    refetchInterval: 15000,
  });

  const approveMut = useMutation({
    mutationFn: approve,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["policy-candidates"] }); },
  });
  const rejectMut = useMutation({
    mutationFn: reject,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["policy-candidates"] }); },
  });

  if (isLoading) return <p className="text-gray-400 text-sm p-4">Loading...</p>;
  if (!data?.length) {
    return (
      <div className="p-8 text-center">
        <Clock size={32} className="mx-auto mb-3 text-gray-600" />
        <p className="text-gray-400 text-sm">No {status.replace("_", " ")} candidates.</p>
        {status === "pending_review" && (
          <p className="text-gray-600 text-xs mt-2">
            Candidates are generated by the weekly language gradient job from failed invocations.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {data.map((c: any) => (
        <CandidateCard
          key={c.id}
          c={c}
          onApprove={() => approveMut.mutate(c.id)}
          onReject={() => rejectMut.mutate(c.id)}
          loading={approveMut.isPending || rejectMut.isPending}
        />
      ))}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "pending_review", label: "Pending review" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

export default function PolicyCandidatesPage() {
  const [activeTab, setActiveTab] = useState("pending_review");

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <ShieldCheck size={22} className="text-indigo-400" />
        <h1 className="text-2xl font-semibold">Policy Candidates</h1>
      </div>
      <p className="text-sm text-gray-500">
        LLM-generated policy suggestions from failed invocations. Approve to activate, reject to discard.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 rounded-lg p-1 w-fit border border-gray-800">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
              activeTab === t.id
                ? "bg-indigo-600 text-white"
                : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 min-h-48">
        <CandidatesTab status={activeTab} />
      </div>
    </div>
  );
}
