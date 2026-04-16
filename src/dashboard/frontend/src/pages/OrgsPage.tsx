import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, X, ChevronRight, Archive, Globe } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Org {
  org_id: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  policies: Record<string, unknown>;
  communication_links: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchOrgs(): Promise<Org[]> {
  const res = await fetch("/api/orgs");
  if (!res.ok) throw new Error("Failed to fetch organisations");
  return res.json();
}

async function createOrg(body: { org_id: string; name: string }) {
  const res = await fetch("/api/orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? "Failed to create organisation");
  }
  return res.json();
}

async function archiveOrg(org_id: string) {
  const res = await fetch(`/api/orgs/${org_id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? "Failed to archive organisation");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-900 text-green-200",
  suspended: "bg-yellow-900 text-yellow-200",
  archived: "bg-gray-700 text-gray-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[status] ?? "bg-gray-700 text-gray-400"}`}>
      {status}
    </span>
  );
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

// ── Org Switcher (exported for use in other pages) ────────────────────────────

export const ORG_KEY = "nuvex_active_org";

export function useActiveOrg() {
  const [activeOrg, setActiveOrgState] = useState<string>(() =>
    localStorage.getItem(ORG_KEY) ?? "default"
  );

  function setActiveOrg(id: string) {
    localStorage.setItem(ORG_KEY, id);
    setActiveOrgState(id);
  }

  return { activeOrg, setActiveOrg };
}

// ── Create Org Form ───────────────────────────────────────────────────────────

function CreateOrgForm({ onClose }: { onClose: () => void }) {
  const [orgId, setOrgId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: createOrg,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["orgs"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    if (!orgId.trim() || !name.trim()) {
      setError("Both ID and name are required");
      return;
    }
    mut.mutate({ org_id: orgId.trim(), name: name.trim() });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">New Organisation</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Organisation ID</label>
            <input
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="my-org"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-gray-500 mt-1">Lowercase letters, numbers and hyphens only</p>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Display Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Organisation"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mut.isPending}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50"
            >
              {mut.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OrgsPage() {
  const [showForm, setShowForm] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const { activeOrg, setActiveOrg } = useActiveOrg();
  const qc = useQueryClient();

  const { data: orgs = [], isLoading, error } = useQuery<Org[]>({
    queryKey: ["orgs"],
    queryFn: fetchOrgs,
    refetchInterval: 30000,
  });

  const archiveMut = useMutation({
    mutationFn: archiveOrg,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["orgs"] }),
    onError: (e: Error) => setArchiveError(e.message),
  });

  return (
    <div className="p-6">
      {showForm && <CreateOrgForm onClose={() => setShowForm(false)} />}

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Building2 size={22} className="text-indigo-400" />
          <h1 className="text-xl font-bold text-white">Organisations</h1>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded"
        >
          <Plus size={15} />
          New Organisation
        </button>
      </div>

      {/* Active org banner */}
      <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 mb-6 text-sm">
        <Globe size={14} className="text-indigo-400" />
        <span className="text-gray-400">Active organisation:</span>
        <span className="text-white font-medium">{activeOrg}</span>
        <span className="ml-auto text-xs text-gray-500">
          Click an org row to switch
        </span>
      </div>

      {archiveError && (
        <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded text-sm text-red-300 flex justify-between">
          {archiveError}
          <button onClick={() => setArchiveError(null)}><X size={14} /></button>
        </div>
      )}

      {isLoading && (
        <p className="text-sm text-gray-500 text-center py-8">Loading…</p>
      )}
      {error && (
        <p className="text-sm text-red-400 text-center py-8">Error loading organisations</p>
      )}

      {!isLoading && !error && orgs.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <Building2 size={40} className="mx-auto mb-4 opacity-30" />
          <p>No organisations yet.</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 text-indigo-400 hover:text-indigo-300 text-sm"
          >
            Create your first organisation
          </button>
        </div>
      )}

      {!isLoading && orgs.length > 0 && (
        <div className="space-y-2">
          {orgs.map((org) => (
            <div
              key={org.org_id}
              onClick={() => org.status !== "archived" && setActiveOrg(org.org_id)}
              className={`flex items-center gap-4 bg-gray-900 border rounded-lg px-4 py-3 cursor-pointer transition-colors ${
                activeOrg === org.org_id
                  ? "border-indigo-500 bg-indigo-950/30"
                  : "border-gray-800 hover:border-gray-600"
              } ${org.status === "archived" ? "opacity-50 cursor-default" : ""}`}
            >
              <Building2 size={18} className={activeOrg === org.org_id ? "text-indigo-400" : "text-gray-500"} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{org.name}</p>
                <p className="text-xs text-gray-500 font-mono">{org.org_id}</p>
              </div>
              <StatusBadge status={org.status} />
              <span className="text-xs text-gray-600">{fmt(org.created_at)}</span>
              {activeOrg === org.org_id ? (
                <ChevronRight size={14} className="text-indigo-400" />
              ) : (
                org.status === "active" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Archive "${org.name}"?`)) archiveMut.mutate(org.org_id);
                    }}
                    className="text-gray-600 hover:text-red-400 transition-colors"
                    title="Archive"
                  >
                    <Archive size={14} />
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
