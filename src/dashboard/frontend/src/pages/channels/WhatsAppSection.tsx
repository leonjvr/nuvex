import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { CheckCircle2, Loader2, Play, Plus, RefreshCw, Save, Square, Trash2, Wifi, WifiOff } from "lucide-react";
import {
  clearWASession,
  fetchAgentList,
  fetchGatewayStatus,
  fetchGroupBindings,
  fetchKnownGroups,
  fetchQRStatus,
  fetchWhatsAppConfig,
  saveGroupBindings,
  saveWhatsAppConfig,
  startGateway,
  stopGateway,
  type GroupBinding,
  type WhatsAppConfig,
} from "./api";

const QR_POLL_MS = 4000;

export default function WhatsAppSection() {
  const qc = useQueryClient();
  const [editCfg, setEditCfg] = useState<WhatsAppConfig | null>(null);

  const { data: agents = [] } = useQuery({ queryKey: ["channel-agents"], queryFn: fetchAgentList });
  const { data: waCfg } = useQuery({ queryKey: ["wa-config"], queryFn: fetchWhatsAppConfig });
  const { data: knownGroups = [] } = useQuery({ queryKey: ["wa-groups"], queryFn: fetchKnownGroups });
  const { data: savedBindings = [] } = useQuery({ queryKey: ["wa-group-bindings"], queryFn: fetchGroupBindings });
  const [bindings, setBindings] = useState<GroupBinding[]>([]);
  useEffect(() => { if (savedBindings.length > 0 || bindings.length === 0) setBindings(savedBindings); }, [savedBindings]);
  const { data: qrStatus, refetch: refetchQR } = useQuery({
    queryKey: ["wa-qr"],
    queryFn: fetchQRStatus,
    refetchInterval: (q) => (q.state.data?.status === "pairing" ? QR_POLL_MS : false),
  });
  const { data: gw, refetch: refetchGW } = useQuery({
    queryKey: ["wa-gateway"],
    queryFn: fetchGatewayStatus,
    refetchInterval: 5000,
  });

  useEffect(() => { if (waCfg && !editCfg) setEditCfg(waCfg); }, [waCfg]);

  const saveMut = useMutation({
    mutationFn: saveWhatsAppConfig,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-config"] }),
  });

  const saveBindingsMut = useMutation({
    mutationFn: saveGroupBindings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-group-bindings"] }),
  });

  const clearMut = useMutation({
    mutationFn: clearWASession,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa-qr"] }); refetchQR(); },
  });

  const startMut = useMutation({
    mutationFn: startGateway,
    onSuccess: () => { refetchGW(); setTimeout(refetchQR, 3000); },
  });

  const stopMut = useMutation({
    mutationFn: stopGateway,
    onSuccess: () => { refetchGW(); qc.invalidateQueries({ queryKey: ["wa-qr"] }); },
  });

  if (!editCfg) return null;

  const status = qrStatus?.status ?? "offline";
  const gwStatus = gw?.status ?? "unavailable";
  const gwBusy = startMut.isPending || stopMut.isPending;

  const qrBadge = {
    connected: <span className="flex items-center gap-1 text-green-400 text-xs"><Wifi size={12} /> Connected</span>,
    pairing: <span className="flex items-center gap-1 text-yellow-400 text-xs"><Loader2 size={12} className="animate-spin" /> Awaiting scan…</span>,
    logged_out: <span className="flex items-center gap-1 text-red-400 text-xs"><WifiOff size={12} /> Logged out</span>,
    offline: <span className="flex items-center gap-1 text-gray-500 text-xs"><WifiOff size={12} /> Offline</span>,
  }[status];

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">
        One WhatsApp number per organisation. The selected agent handles all incoming messages.
      </p>

      {/* Config form */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Enabled</label>
          <button
            onClick={() => setEditCfg((c) => c && { ...c, enabled: !c.enabled })}
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${editCfg.enabled ? "bg-indigo-600" : "bg-gray-700"}`}
          >
            <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transform transition-transform ${editCfg.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
          </button>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Handling Agent</label>
          <select
            value={editCfg.agent_id}
            onChange={(e) => setEditCfg((c) => c && { ...c, agent_id: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 w-full focus:outline-none focus:border-indigo-500"
          >
            {agents.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">DM Policy</label>
          <select value={editCfg.dm_policy} onChange={(e) => setEditCfg((c) => c && { ...c, dm_policy: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 w-full focus:outline-none focus:border-indigo-500">
            <option value="pairing">pairing — only paired numbers</option>
            <option value="open">open — anyone</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Group Policy</label>
          <select value={editCfg.group_policy} onChange={(e) => setEditCfg((c) => c && { ...c, group_policy: e.target.value })}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 w-full focus:outline-none focus:border-indigo-500">
            <option value="allowlist">allowlist — only allowed groups</option>
            <option value="open">open — any group</option>
          </select>
        </div>
      </div>

      <button
        onClick={() => saveMut.mutate(editCfg)}
        disabled={saveMut.isPending}
        className="flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-sm font-medium transition-colors"
      >
        {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Save
      </button>

      {/* Humanise Settings */}
      <div className="border-t border-gray-800 pt-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Humanised Responses</h3>
          <p className="text-xs text-gray-500 mb-3">Simulate human typing speed, reading delays, and chunked messages.</p>
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => setEditCfg((c) => c && { ...c, humanise_enabled: !c.humanise_enabled })}
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${editCfg.humanise_enabled ? "bg-indigo-600" : "bg-gray-700"}`}
            >
              <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transform transition-transform ${editCfg.humanise_enabled ? "translate-x-4" : "translate-x-0.5"}`} />
            </button>
            <span className="text-sm text-gray-300">Enable humanised behaviour</span>
          </div>
          {editCfg.humanise_enabled && (
            <div className="grid grid-cols-2 gap-4 pl-1">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Read Receipt Delay (ms)</label>
                <input
                  type="number" min={0} step={100}
                  value={editCfg.humanise_read_receipt_delay_ms}
                  onChange={(e) => setEditCfg((c) => c && { ...c, humanise_read_receipt_delay_ms: parseInt(e.target.value) || 0 })}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 w-full focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Thinking Delay (ms)</label>
                <input
                  type="number" min={0} step={100}
                  value={editCfg.humanise_thinking_delay_ms}
                  onChange={(e) => setEditCfg((c) => c && { ...c, humanise_thinking_delay_ms: parseInt(e.target.value) || 0 })}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 w-full focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Typing Speed (WPM)</label>
                <input
                  type="number" min={10} max={200} step={5}
                  value={editCfg.humanise_typing_speed_wpm}
                  onChange={(e) => setEditCfg((c) => c && { ...c, humanise_typing_speed_wpm: parseInt(e.target.value) || 45 })}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 w-full focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setEditCfg((c) => c && { ...c, humanise_chunk_messages: !c.humanise_chunk_messages })}
                  className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${editCfg.humanise_chunk_messages ? "bg-indigo-600" : "bg-gray-700"}`}
                >
                  <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transform transition-transform ${editCfg.humanise_chunk_messages ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
                <span className="text-xs text-gray-400">Chunk long messages</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Group → Workspace Bindings */}
      <div className="border-t border-gray-800 pt-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-1">Group Workspace Bindings</h3>
          <p className="text-xs text-gray-500 mb-3">Link a WhatsApp group to a project workspace so Maya knows the context without asking.</p>
          <div className="space-y-2">
            {bindings.map((b, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                <select
                  value={b.jid}
                  onChange={(e) => setBindings((bs) => bs.map((x, j) => j === i ? { ...x, jid: e.target.value } : x))}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">— select group —</option>
                  {knownGroups.map((g) => <option key={g.id} value={g.id}>{g.subject || g.name || g.id}</option>)}
                  {b.jid && !knownGroups.find((g) => g.id === b.jid) && <option value={b.jid}>{b.jid}</option>}
                </select>
                <input
                  type="text"
                  placeholder="/workspace/path or label"
                  value={b.workspace}
                  onChange={(e) => setBindings((bs) => bs.map((x, j) => j === i ? { ...x, workspace: e.target.value } : x))}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-indigo-500"
                />
                <button onClick={() => setBindings((bs) => bs.filter((_, j) => j !== i))} className="p-1 text-red-400 hover:text-red-300">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => setBindings((bs) => [...bs, { jid: "", workspace: "", label: "" }])}
              className="flex items-center gap-1.5 px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300 transition-colors"
            >
              <Plus size={12} /> Add binding
            </button>
            <button
              onClick={() => saveBindingsMut.mutate(bindings)}
              disabled={saveBindingsMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-xs text-white transition-colors"
            >
              {saveBindingsMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save bindings
            </button>
          </div>
        </div>
      </div>

      {/* Gateway + QR Pairing */}
      <div className="border-t border-gray-800 pt-5 space-y-4">
        {/* Gateway control row */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-300">WhatsApp Gateway</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {gwStatus === "running" ? "Gateway is running and connected to WhatsApp Web." : gwStatus === "stopped" ? "Gateway is stopped. Start it to link your phone." : "Docker socket not available."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {qrBadge}
            {gwStatus !== "unavailable" && (
              gwStatus === "running" ? (
                <button
                  onClick={() => stopMut.mutate()}
                  disabled={gwBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/40 hover:bg-red-900/70 disabled:opacity-50 rounded text-xs text-red-300 transition-colors"
                >
                  {stopMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => startMut.mutate()}
                  disabled={gwBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-900/40 hover:bg-green-900/70 disabled:opacity-50 rounded text-xs text-green-300 transition-colors"
                >
                  {startMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  Start
                </button>
              )
            )}
          </div>
        </div>

        {/* QR display */}
        {status === "pairing" && qrStatus?.qr && (
          <div className="flex flex-col items-start gap-2">
            <img src={qrStatus.qr} alt="WhatsApp QR" className="w-52 h-52 rounded border border-gray-700 bg-white p-1" />
            <p className="text-xs text-gray-400">Open WhatsApp → Linked Devices → Link a device, then scan.</p>
          </div>
        )}

        {status === "connected" && (
          <div className="flex items-center gap-2 text-green-400 text-sm">
            <CheckCircle2 size={16} /> WhatsApp is linked and active.
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={() => { refetchQR(); refetchGW(); }} className="flex items-center gap-1.5 px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-xs text-gray-300 transition-colors">
            <RefreshCw size={12} /> Refresh status
          </button>
          <button
            onClick={() => clearMut.mutate()}
            disabled={clearMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1 bg-red-900/40 hover:bg-red-900/70 rounded text-xs text-red-300 transition-colors"
          >
            <Trash2 size={12} /> Clear session
          </button>
        </div>
      </div>
    </div>
  );
}
