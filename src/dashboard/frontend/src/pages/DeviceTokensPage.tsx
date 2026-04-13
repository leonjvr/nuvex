import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, Plus, Trash2, Loader2, AlertCircle, Copy, CheckCircle2, Monitor } from "lucide-react";

interface DeviceToken {
  id: string;
  device_id: string | null;
  device_name: string | null;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
  status: "active" | "revoked" | "expired";
}

function StatusBadge({ status }: { status: DeviceToken["status"] }) {
  const cls =
    status === "active"
      ? "bg-green-900/40 text-green-400 border border-green-700/40"
      : "bg-gray-700/40 text-gray-500 border border-gray-700/40";
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{status}</span>;
}

function CreateTokenDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/device-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, created_by: createdBy }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail ?? "Failed to create token");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setPlaintext(data.token);
      qc.invalidateQueries({ queryKey: ["device-tokens"] });
    },
  });

  function copyToken() {
    if (!plaintext) return;
    navigator.clipboard.writeText(plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4">
        <h2 className="font-semibold text-base">Create Device Token</h2>

        {plaintext ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-900/20 border border-amber-700/40 rounded-lg px-3 py-2">
              <AlertCircle size={14} className="mt-0.5 flex-none" />
              <span>Copy this token now. It will not be shown again.</span>
            </div>
            <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2 font-mono text-xs text-gray-200 break-all">
              <span className="flex-1">{plaintext}</span>
              <button onClick={copyToken} className="flex-none text-gray-400 hover:text-white transition-colors">
                {copied ? <CheckCircle2 size={14} className="text-green-400" /> : <Copy size={14} />}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Paste this token into the NUVEX Desktop Agent setup wizard on your device.
            </p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">Token name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My Work PC"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 font-medium">Created by</label>
              <input
                value={createdBy}
                onChange={(e) => setCreatedBy(e.target.value)}
                placeholder="e.g. admin or your name"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            {create.isError && (
              <p className="text-xs text-red-400">{(create.error as Error).message}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => create.mutate()}
                disabled={create.isPending || !name}
                className="flex items-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                {create.isPending && <Loader2 size={13} className="animate-spin" />}
                Create
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RevokeDialog({ token, onClose }: { token: DeviceToken; onClose: () => void }) {
  const qc = useQueryClient();
  const revoke = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/device-tokens/${token.id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail ?? "Failed to revoke token");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["device-tokens"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
        <h2 className="font-semibold text-base">Revoke token?</h2>
        <p className="text-sm text-gray-400">
          Revoking <span className="text-gray-200 font-medium">{token.device_name ?? token.id}</span> will
          immediately disconnect the device and prevent it from reconnecting. This cannot be undone.
        </p>
        {revoke.isError && (
          <p className="text-xs text-red-400">{(revoke.error as Error).message}</p>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending}
            className="flex items-center gap-2 text-sm bg-red-700 hover:bg-red-600 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition-colors"
          >
            {revoke.isPending && <Loader2 size={13} className="animate-spin" />}
            Revoke
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DeviceTokensPage() {
  const { data: tokens = [], isLoading } = useQuery<DeviceToken[]>({
    queryKey: ["device-tokens"],
    queryFn: async () => {
      const r = await fetch("/api/device-tokens");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 15000,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [revoking, setRevoking] = useState<DeviceToken | null>(null);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Device Tokens</h1>
          <p className="mt-1 text-sm text-gray-400">
            Generate one-time tokens that desktop agents use to register with this brain.
            Each token is stored only as a hash — the plaintext is shown once at creation.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition-colors flex-none"
        >
          <Plus size={14} />
          New Token
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading tokens…</p>}

      {!isLoading && tokens.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center space-y-2">
          <Key size={28} className="text-gray-700 mx-auto" />
          <p className="text-sm text-gray-500">No device tokens yet.</p>
          <p className="text-xs text-gray-600">
            Create a token and paste it into the desktop agent setup wizard.
          </p>
        </div>
      )}

      {tokens.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500">
                <th className="text-left px-4 py-2.5 font-medium">Name / Device</th>
                <th className="text-left px-4 py-2.5 font-medium">Created by</th>
                <th className="text-left px-4 py-2.5 font-medium">Created</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/20">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Monitor size={14} className="text-gray-600 flex-none" />
                      <div>
                        <p className="text-gray-200">{t.device_name ?? <span className="text-gray-600 italic">Not yet registered</span>}</p>
                        <p className="text-xs text-gray-600 font-mono">{t.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{t.created_by}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                    {t.revoked_at && (
                      <p className="text-xs text-gray-600 mt-0.5">
                        {new Date(t.revoked_at).toLocaleDateString()}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {t.status === "active" && (
                      <button
                        onClick={() => setRevoking(t)}
                        className="text-gray-600 hover:text-red-400 transition-colors p-1 rounded"
                        title="Revoke"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateTokenDialog onClose={() => setShowCreate(false)} />}
      {revoking && <RevokeDialog token={revoking} onClose={() => setRevoking(null)} />}
    </div>
  );
}
