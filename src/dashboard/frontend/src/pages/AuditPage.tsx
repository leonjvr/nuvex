import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

async function fetchAudit(params: string) {
  const res = await fetch(`/api/audit?${params}`);
  if (!res.ok) throw new Error("Failed to fetch audit");
  return res.json();
}

const DECISIONS = ["", "approved", "denied", "flagged", "allowed"];

export default function AuditPage() {
  const [decision, setDecision] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
  if (decision) params.set("decision", decision);

  const { data, isLoading } = useQuery({
    queryKey: ["audit", decision, page],
    queryFn: () => fetchAudit(params.toString()),
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Governance Audit</h1>
      <div className="flex gap-3 mb-4">
        <select
          value={decision}
          onChange={(e) => { setDecision(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
        >
          {DECISIONS.map((d) => (
            <option key={d} value={d}>{d || "All decisions"}</option>
          ))}
        </select>
      </div>
      {isLoading && <p className="text-gray-400">Loading…</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="pb-2 pr-4">Time</th>
              <th className="pb-2 pr-4">Agent</th>
              <th className="pb-2 pr-4">Action</th>
              <th className="pb-2 pr-4">Decision</th>
              <th className="pb-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {Array.isArray(data) &&
              data.map((row: any) => (
                <tr key={row.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">
                    {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="py-2 pr-4">{row.agent_id}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{row.action_type}</td>
                  <td className="py-2 pr-4">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        row.decision === "approved"
                          ? "bg-green-900 text-green-300"
                          : row.decision === "denied"
                          ? "bg-red-900 text-red-300"
                          : "bg-yellow-900 text-yellow-300"
                      }`}
                    >
                      {row.decision}
                    </span>
                  </td>
                  <td className="py-2 text-gray-400 text-xs">{row.reason || "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3 mt-4">
        <button
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
          className="px-3 py-1 text-sm bg-gray-800 rounded disabled:opacity-40"
        >
          Prev
        </button>
        <span className="text-sm text-gray-400 self-center">Page {page + 1}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          className="px-3 py-1 text-sm bg-gray-800 rounded"
        >
          Next
        </button>
      </div>
    </div>
  );
}
