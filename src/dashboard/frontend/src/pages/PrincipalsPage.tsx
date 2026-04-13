import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Principal {
  id: string;
  org_id: string;
  contact_id: string | null;
  role: string;
  created_at: string | null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchPrincipals(orgId: string): Promise<Principal[]> {
  const res = await fetch(`/api/principals?org_id=${orgId}`);
  if (!res.ok) throw new Error("Failed to fetch principals");
  return res.json();
}

async function createPrincipal(body: { org_id: string; contact_id?: string; role: string }) {
  const res = await fetch("/api/principals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? "Failed to create principal");
  }
  return res.json();
}

async function deletePrincipal(id: string) {
  const res = await fetch(`/api/principals/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete principal");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-purple-900 text-purple-200",
  admin: "bg-blue-900 text-blue-200",
  operator: "bg-gray-700 text-gray-300",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_COLORS[role] ?? "bg-gray-700 text-gray-400"}`}>
      {role}
    </span>
  );
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PrincipalsPage() {
  const [orgId] = useState("default");
  const [showForm, setShowForm] = useState(false);
  const [formRole, setFormRole] = useState("operator");
  const [formContactId, setFormContactId] = useState("");
  const [formError, setFormError] = useState("");

  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["principals", orgId],
    queryFn: () => fetchPrincipals(orgId),
    refetchInterval: 30000,
  });

  const createMut = useMutation({
    mutationFn: createPrincipal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["principals"] });
      setShowForm(false);
      setFormContactId("");
      setFormRole("operator");
      setFormError("");
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: deletePrincipal,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["principals"] }),
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    createMut.mutate({
      org_id: orgId,
      role: formRole,
      contact_id: formContactId || undefined,
    });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Principals</h1>
        <button
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1.5 rounded"
          onClick={() => setShowForm((v) => !v)}
        >
          + Add principal
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6 space-y-3"
        >
          <h2 className="text-sm font-semibold text-gray-300">New principal</h2>
          <div className="flex gap-3">
            <select
              className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1"
              value={formRole}
              onChange={(e) => setFormRole(e.target.value)}
            >
              <option value="owner">owner</option>
              <option value="admin">admin</option>
              <option value="operator">operator</option>
            </select>
            <input
              className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1"
              placeholder="Contact ID (optional)"
              value={formContactId}
              onChange={(e) => setFormContactId(e.target.value)}
            />
            <button
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-3 py-1 rounded"
              disabled={createMut.isPending}
            >
              {createMut.isPending ? "Adding..." : "Add"}
            </button>
          </div>
          {formError && <p className="text-red-400 text-sm">{formError}</p>}
        </form>
      )}

      {isLoading && <p className="text-gray-400 text-sm">Loading...</p>}
      {error && <p className="text-red-400 text-sm">Error loading principals</p>}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-800">
                <th className="pb-2 pr-4">Role</th>
                <th className="pb-2 pr-4">Contact ID</th>
                <th className="pb-2 pr-4">Added</th>
                <th className="pb-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id} className="border-b border-gray-800/50">
                  <td className="py-2 pr-4"><RoleBadge role={p.role} /></td>
                  <td className="py-2 pr-4 text-gray-400 font-mono text-xs">{p.contact_id ?? "—"}</td>
                  <td className="py-2 pr-4 text-gray-400">{fmt(p.created_at)}</td>
                  <td className="py-2">
                    <button
                      className="text-red-400 hover:text-red-300 text-xs"
                      onClick={() => deleteMut.mutate(p.id)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-gray-500">No principals configured</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
