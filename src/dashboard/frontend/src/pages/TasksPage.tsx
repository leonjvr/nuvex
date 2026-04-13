import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { useOrg } from "../OrgContext";

async function fetchTasks(orgId?: string) {
  const url = orgId ? `/api/tasks?org_id=${encodeURIComponent(orgId)}` : "/api/tasks";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function fetchAgents() {
  const res = await fetch("/api/agents");
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-700 text-gray-300",
  active: "bg-blue-900 text-blue-300",
  running: "bg-blue-900 text-blue-300",
  done: "bg-green-900 text-green-300",
  completed: "bg-green-900 text-green-300",
  failed: "bg-red-900 text-red-300",
  cancelled: "bg-gray-700 text-gray-500",
};

const VERIFICATION_COLORS: Record<string, string> = {
  targeted: "bg-gray-700 text-gray-300",
  module: "bg-cyan-900 text-cyan-300",
  workspace: "bg-indigo-900 text-indigo-300",
  "merge-ready": "bg-green-900 text-green-300",
  auto: "bg-gray-700 text-gray-400",
};

const STATUSES = ["pending", "active", "done", "failed", "cancelled"] as const;

interface CreateForm {
  title: string;
  description: string;
  assigned_agent: string;
  priority: number;
  verification_level: string;
  acceptance_criteria: string;
}

const DEFAULT_FORM: CreateForm = {
  title: "",
  description: "",
  assigned_agent: "",
  priority: 5,
  verification_level: "auto",
  acceptance_criteria: "",
};

function CreateTaskModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateForm>(DEFAULT_FORM);
  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });

  const createTask = useMutation({
    mutationFn: async (f: CreateForm) => {
      const criteria = f.acceptance_criteria
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: f.title,
          description: f.description || undefined,
          assigned_agent: f.assigned_agent,
          priority: f.priority,
          verification_level: f.verification_level,
          acceptance_criteria: criteria,
        }),
      });
      if (!res.ok) throw new Error("Failed to create task");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">New Task</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Task title"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <textarea
              rows={2}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm resize-none"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Agent *</label>
              <select
                className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm"
                value={form.assigned_agent}
                onChange={(e) => setForm({ ...form, assigned_agent: e.target.value })}
              >
                <option value="">Select agent…</option>
                {Array.isArray(agents) &&
                  agents.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name || a.id}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Priority (1-10)</label>
              <input
                type="number"
                min={1}
                max={10}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Verification level</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm"
              value={form.verification_level}
              onChange={(e) => setForm({ ...form, verification_level: e.target.value })}
            >
              {["auto", "targeted", "module", "workspace", "merge-ready"].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Acceptance criteria (one per line)
            </label>
            <textarea
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono resize-none"
              value={form.acceptance_criteria}
              onChange={(e) => setForm({ ...form, acceptance_criteria: e.target.value })}
              placeholder="Must return HTTP 200&#10;Must persist to DB"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded border border-gray-600 text-gray-300 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            disabled={!form.title || !form.assigned_agent || createTask.isPending}
            onClick={() => createTask.mutate(form)}
            className="px-4 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40"
          >
            {createTask.isPending ? "Creating…" : "Create"}
          </button>
        </div>
        {createTask.isError && (
          <p className="text-xs text-red-400 mt-2">Failed to create task.</p>
        )}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const qc = useQueryClient();
  const { activeOrg } = useOrg();
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["tasks", activeOrg], queryFn: () => fetchTasks(activeOrg) });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await fetch(`/api/tasks/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  return (
    <div className="p-6">
      {showCreate && <CreateTaskModal onClose={() => setShowCreate(false)} />}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Task Board</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-500 transition-colors"
        >
          <Plus size={14} /> New Task
        </button>
      </div>
      {isLoading && <p className="text-gray-400">Loading…</p>}
      {Array.isArray(data) && data.length === 0 && (
        <p className="text-gray-400">No tasks yet.</p>
      )}
      <div className="space-y-3">
        {Array.isArray(data) &&
          data.map((t: any) => (
            <div
              key={t.id}
              className="bg-gray-800 rounded-lg p-4 border border-gray-700 flex items-start gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.title || t.id}</p>
                <p className="text-xs text-gray-400 mt-1">
                  Agent: {t.assigned_agent || t.agent_id}
                  {t.priority != null && (
                    <span className="ml-2 text-gray-500">· P{t.priority}</span>
                  )}
                </p>
                {t.description && (
                  <p className="text-xs text-gray-500 mt-1 truncate">{t.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-none">
                {t.verification_level && t.verification_level !== "auto" && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      VERIFICATION_COLORS[t.verification_level] ?? "bg-gray-700 text-gray-400"
                    }`}
                  >
                    {t.verification_level}
                  </span>
                )}
                <select
                  value={t.status}
                  onChange={(e) =>
                    updateStatus.mutate({ id: t.id, status: e.target.value })
                  }
                  className={`text-xs px-2 py-0.5 rounded-full border-0 outline-none cursor-pointer ${
                    STATUS_COLORS[t.status] ?? "bg-gray-700 text-gray-400"
                  }`}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
