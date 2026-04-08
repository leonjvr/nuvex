import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2, X, CheckCircle2, AlertTriangle, XCircle, ChevronDown } from "lucide-react";

// ---- API helpers ----
async function fetchProviders() {
  const res = await fetch("/api/providers");
  if (!res.ok) throw new Error("Failed to load providers");
  return res.json();
}

async function fetchHealth() {
  const res = await fetch("/api/health/services");
  if (!res.ok) throw new Error("Failed to load health");
  return res.json();
}

// ---- Constants ----
const PROVIDER_OPTIONS = ["anthropic", "openai", "groq", "deepseek", "minimax", "custom"];

const PROVIDER_DEFAULTS: Record<string, { model: string; base_url?: string }> = {
  anthropic: { model: "claude-sonnet-4-20250514" },
  openai: { model: "gpt-4o" },
  groq: { model: "llama-3.3-70b-versatile" },
  deepseek: { model: "deepseek-chat", base_url: "https://api.deepseek.com" },
  minimax: { model: "abab7-chat-preview", base_url: "https://api.minimax.io/v1" },
  custom: { model: "" },
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  Healthy: <CheckCircle2 size={14} className="text-green-400" />,
  Degraded: <AlertTriangle size={14} className="text-yellow-400" />,
  Failed: <XCircle size={14} className="text-red-400" />,
  healthy: <CheckCircle2 size={14} className="text-green-400" />,
  degraded: <AlertTriangle size={14} className="text-yellow-400" />,
  down: <XCircle size={14} className="text-red-400" />,
  failed: <XCircle size={14} className="text-red-400" />,
};

const STATUS_BADGE: Record<string, string> = {
  Healthy: "bg-green-900/60 text-green-300",
  Degraded: "bg-yellow-900/60 text-yellow-300",
  Failed: "bg-red-900/60 text-red-300",
  healthy: "bg-green-900/60 text-green-300",
  degraded: "bg-yellow-900/60 text-yellow-300",
  down: "bg-red-900/60 text-red-300",
  failed: "bg-red-900/60 text-red-300",
};

// ---- Types ----
interface Provider {
  id: number;
  name: string;
  provider: string;
  model: string;
  api_key: string | null;
  api_key_env: string;
  api_key_env_set: boolean;
  base_url: string | null;
  enabled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface HealthRow {
  service: string;
  status: string;
  latency_ms: number | null;
  error: string | null;
  checked_at: string | null;
}

const EMPTY_FORM = {
  name: "",
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  api_key: "",
  base_url: "",
  enabled: true,
  notes: "",
};

// ---- Modal ----
function ProviderModal({
  initial,
  onClose,
  onSave,
  saving,
}: {
  initial: typeof EMPTY_FORM & { id?: number };
  onClose: () => void;
  onSave: (data: typeof EMPTY_FORM & { id?: number }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState(initial);

  const set = (field: string, value: unknown) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleProviderChange = (prov: string) => {
    const defaults = PROVIDER_DEFAULTS[prov] ?? { model: "" };
    setForm((f) => ({
      ...f,
      provider: prov,
      model: defaults.model,
      base_url: defaults.base_url ?? "",
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <h2 className="font-semibold text-sm">
            {form.id ? "Edit Provider" : "Add Provider"}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name (unique slug)</label>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              disabled={!!form.id}
              placeholder="e.g. deepseek/deepseek-chat"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>

          {/* Provider type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Provider</label>
            <div className="relative">
              <select
                value={form.provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full appearance-none bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm pr-8"
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-gray-500 pointer-events-none" />
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Model name</label>
            <input
              value={form.model}
              onChange={(e) => set("model", e.target.value)}
              placeholder="e.g. deepseek-chat"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              API Key <span className="text-gray-600">(leave blank to use env var)</span>
            </label>
            <input
              type="password"
              value={form.api_key}
              onChange={(e) => set("api_key", e.target.value)}
              placeholder="sk-..."
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Base URL <span className="text-gray-600">(optional, for custom endpoints)</span>
            </label>
            <input
              value={form.base_url}
              onChange={(e) => set("base_url", e.target.value)}
              placeholder="https://api.deepseek.com"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Notes</label>
            <input
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional description"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            />
          </div>

          {/* Enabled */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled-cb"
              checked={form.enabled}
              onChange={(e) => set("enabled", e.target.checked)}
              className="w-4 h-4 accent-indigo-500"
            />
            <label htmlFor="enabled-cb" className="text-sm">Enabled</label>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.name || !form.model}
            className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded font-medium"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Main page ----
export default function ServicesPage() {
  const qc = useQueryClient();
  const [modal, setModal] = useState<(typeof EMPTY_FORM & { id?: number }) | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: providers = [], isLoading: provLoading } = useQuery<Provider[]>({
    queryKey: ["providers"],
    queryFn: fetchProviders,
    refetchInterval: 15000,
  });

  const { data: health = [] } = useQuery<HealthRow[]>({
    queryKey: ["services-health"],
    queryFn: fetchHealth,
    refetchInterval: 15000,
  });

  // Build a status lookup keyed by model name
  const healthMap = Object.fromEntries(
    health.map((h) => [h.service.toLowerCase(), h])
  );

  const getHealth = (p: Provider) =>
    healthMap[p.model.toLowerCase()] ??
    healthMap[`${p.provider}/${p.model}`.toLowerCase()] ??
    null;

  const createMut = useMutation({
    mutationFn: async (body: typeof EMPTY_FORM) => {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          api_key: body.api_key || null,
          base_url: body.base_url || null,
          notes: body.notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Failed to create");
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["providers"] }); setModal(null); },
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, ...body }: typeof EMPTY_FORM & { id: number }) => {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body,
          api_key: body.api_key || null,
          base_url: body.base_url || null,
          notes: body.notes || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to update");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["providers"] }); setModal(null); },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["providers"] }); setDeleteId(null); },
  });

  const toggleMut = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["providers"] }),
  });

  const handleSave = (form: typeof EMPTY_FORM & { id?: number }) => {
    if (form.id) {
      updateMut.mutate(form as typeof EMPTY_FORM & { id: number });
    } else {
      createMut.mutate(form);
    }
  };

  const openEdit = (p: Provider) =>
    setModal({
      id: p.id,
      name: p.name,
      provider: p.provider,
      model: p.model,
      api_key: p.api_key ?? "",
      base_url: p.base_url ?? "",
      enabled: p.enabled,
      notes: p.notes ?? "",
    });

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">LLM Providers</h1>
        <button
          onClick={() => setModal({ ...EMPTY_FORM })}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-sm font-medium"
        >
          <Plus size={14} /> Add Provider
        </button>
      </div>

      {provLoading && <p className="text-gray-400 text-sm">Loading…</p>}

      {/* Provider cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((p) => {
          const h = getHealth(p);
          return (
            <div
              key={p.id}
              className={`bg-gray-800 rounded-lg border ${p.enabled ? "border-gray-700" : "border-gray-700/40 opacity-60"} p-4 flex flex-col gap-3`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{p.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{p.provider} · {p.model}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {h && (
                    <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[h.status] ?? "bg-gray-700 text-gray-400"}`}>
                      {STATUS_ICON[h.status]}
                      {h.status}
                    </span>
                  )}
                  {!p.enabled && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-500">disabled</span>
                  )}
                </div>
              </div>

              {/* Key status */}
              <div className="text-xs text-gray-500 space-y-0.5">
                {p.api_key ? (
                  <span className="text-green-400">● stored key</span>
                ) : p.api_key_env_set ? (
                  <span className="text-blue-400">● key via {p.api_key_env}</span>
                ) : (
                  <span className="text-red-400">✗ no API key ({p.api_key_env || "unknown env"})</span>
                )}
                {p.base_url && (
                  <p className="truncate text-gray-600">{p.base_url}</p>
                )}
                {h?.latency_ms != null && (
                  <p>Latency: {h.latency_ms.toFixed(0)} ms</p>
                )}
                {h?.error && (
                  <p className="text-red-400 truncate">{h.error}</p>
                )}
              </div>

              {p.notes && <p className="text-xs text-gray-500 italic">{p.notes}</p>}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-gray-700/50 mt-auto">
                <button
                  onClick={() => toggleMut.mutate({ id: p.id, enabled: !p.enabled })}
                  className="text-xs text-gray-400 hover:text-gray-200"
                >
                  {p.enabled ? "Disable" : "Enable"}
                </button>
                <span className="text-gray-700">·</span>
                <button
                  onClick={() => openEdit(p)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-400"
                >
                  <Pencil size={11} /> Edit
                </button>
                <span className="text-gray-700 ml-auto">·</span>
                <button
                  onClick={() => setDeleteId(p.id)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-400"
                >
                  <Trash2 size={11} /> Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Health monitor section */}
      {health.length > 0 && (
        <div className="mt-10">
          <h2 className="text-base font-medium mb-4 text-gray-400">Live Health Monitor</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {health.map((h) => (
              <div key={h.service} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium truncate pr-2">{h.service}</span>
                  <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full ${STATUS_BADGE[h.status] ?? "bg-gray-700 text-gray-400"}`}>
                    {STATUS_ICON[h.status]}
                    {h.status}
                  </span>
                </div>
                {h.latency_ms != null && (
                  <p className="text-xs text-gray-500">{h.latency_ms.toFixed(1)} ms</p>
                )}
                {h.error && <p className="text-xs text-red-400 mt-1 truncate">{h.error}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit modal */}
      {modal && (
        <ProviderModal
          initial={modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}

      {/* Delete confirmation */}
      {deleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
            <p className="font-medium mb-2">Delete this provider?</p>
            <p className="text-sm text-gray-400 mb-5">This only removes it from the management list. It does not revoke the API key.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteId(null)}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(deleteId)}
                disabled={deleteMut.isPending}
                className="px-4 py-1.5 text-sm bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded font-medium"
              >
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

