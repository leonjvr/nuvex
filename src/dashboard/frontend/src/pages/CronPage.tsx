import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useOrg } from "../OrgContext";

async function fetchCron(orgId?: string) {
  const url = orgId ? `/api/cron?org_id=${encodeURIComponent(orgId)}` : "/api/cron";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function fetchAgents() {
  const res = await fetch("/api/agents");
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

export default function CronPage() {
  const qc = useQueryClient();
  const { activeOrg } = useOrg();
  const { data, isLoading } = useQuery({ queryKey: ["cron", activeOrg], queryFn: () => fetchCron(activeOrg) });
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const [form, setForm] = useState({ name: "", agent_id: "", schedule: "" });

  const create = useMutation({
    mutationFn: async (body: typeof form) => {
      const res = await fetch("/api/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cron"] }); setForm({ name: "", agent_id: "", schedule: "" }); },
  });

  const deleteCron = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/cron/${name}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });

  const toggle = useMutation({
    mutationFn: async ({ name, enabled }: { name: string; enabled: boolean }) => {
      const res = await fetch(`/api/cron/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron"] }),
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Cron Jobs</h1>

      {/* Create form */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6 border border-gray-700">
        <h2 className="text-sm font-medium mb-3">New job</h2>
        <div className="flex gap-3 flex-wrap">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="name"
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm w-44"
          />
          <select
            value={form.agent_id}
            onChange={(e) => setForm((f) => ({ ...f, agent_id: e.target.value }))}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm w-44"
          >
            <option value="">select agent…</option>
            {Array.isArray(agents) && agents.map((a: any) => (
              <option key={a.id} value={a.id}>{a.id}</option>
            ))}
          </select>
          <input
            value={form.schedule}
            onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
            placeholder="schedule (cron)"
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm w-44"
          />
          <button
            onClick={() => create.mutate(form)}
            disabled={!form.name || !form.agent_id || !form.schedule}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-500 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>

      {isLoading && <p className="text-gray-400">Loading…</p>}
      {Array.isArray(data) && data.length === 0 && (
        <p className="text-gray-400">No scheduled jobs yet.</p>
      )}
      <div className="space-y-2">
        {Array.isArray(data) &&
          data.map((job: any) => (
            <div
              key={job.name}
              className="bg-gray-800 rounded-lg px-4 py-3 border border-gray-700 flex items-center gap-4"
            >
              <div className="flex-1">
                <p className="text-sm font-medium">{job.name}</p>
                <p className="text-xs text-gray-400">{job.agent_id} · <span className="font-mono">{job.schedule}</span></p>
                {job.last_run_at && (
                  <p className="text-xs text-gray-600 mt-0.5">Last: {new Date(job.last_run_at).toLocaleString()}</p>
                )}
              </div>
              <button
                onClick={() => toggle.mutate({ name: job.name, enabled: !job.enabled })}
                className={`text-xs px-2 py-0.5 rounded ${job.enabled ? "bg-green-900 text-green-300" : "bg-gray-700 text-gray-400"}`}
              >
                {job.enabled ? "enabled" : "disabled"}
              </button>
              <button
                onClick={() => deleteCron.mutate(job.name)}
                className="text-gray-600 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
