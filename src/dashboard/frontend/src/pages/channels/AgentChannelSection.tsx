import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Save, Wifi, WifiOff } from "lucide-react";
import { CHANNEL_FIELDS, GATEWAY_STATUS, fetchAgentChannel, fetchAgentList, fetchChannelGatewayStatus, saveAgentChannel, type AgentChannelConfig } from "./api";

function SecretInput({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 pr-9 focus:outline-none focus:border-indigo-500"
      />
      <button type="button" onClick={() => setVisible((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function AgentCard({ agentId, channel }: { agentId: string; channel: string }) {
  const qc = useQueryClient();
  const fields = CHANNEL_FIELDS[channel] ?? [];
  const { data: saved } = useQuery({
    queryKey: ["agent-channel", agentId, channel],
    queryFn: () => fetchAgentChannel(agentId, channel),
  });
  const [values, setValues] = useState<AgentChannelConfig>({});

  useEffect(() => { if (saved) setValues(saved); }, [saved]);

  const mut = useMutation({
    mutationFn: () => saveAgentChannel(agentId, channel, values),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-channel", agentId, channel] }),
  });

  function set(key: string, val: unknown) { setValues((v) => ({ ...v, [key]: val })); }

  const enabled = Boolean(values.enabled);

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-200 capitalize">{agentId}</span>
        <div className="flex items-center gap-2">
          {enabled && <CheckCircle2 size={14} className="text-green-500" />}
          <button
            onClick={() => set("enabled", !enabled)}
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${enabled ? "bg-indigo-600" : "bg-gray-700"}`}
          >
            <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transform transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      {enabled && (
        <>
          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs text-gray-400 mb-1">
                {field.label}
                {field.help && <span className="ml-1 text-gray-600">— {field.help}</span>}
              </label>
              {field.type === "toggle" ? (
                <button
                  onClick={() => set(field.key, !values[field.key])}
                  className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${values[field.key] ? "bg-indigo-600" : "bg-gray-700"}`}
                >
                  <span className={`inline-block h-4 w-4 mt-0.5 rounded-full bg-white shadow transform transition-transform ${values[field.key] ? "translate-x-4" : "translate-x-0.5"}`} />
                </button>
              ) : field.type === "number" ? (
                <input
                  type="number"
                  value={String(values[field.key] ?? field.placeholder ?? "")}
                  placeholder={field.placeholder}
                  onChange={(e) => set(field.key, e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
                />
              ) : field.secret ? (
                <SecretInput
                  value={String(values[field.key] ?? "")}
                  placeholder={field.placeholder}
                  onChange={(v) => set(field.key, v)}
                />
              ) : (
                <input
                  type="text"
                  value={String(values[field.key] ?? "")}
                  placeholder={field.placeholder}
                  onChange={(e) => set(field.key, e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-indigo-500"
                />
              )}
            </div>
          ))}

          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending}
            className="flex items-center gap-2 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-xs font-medium transition-colors"
          >
            {mut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
          {mut.isSuccess && <span className="text-xs text-green-400">Saved</span>}
        </>
      )}
    </div>
  );
}

const GATEWAY_CHANNELS = ["telegram", "email"];

export default function AgentChannelSection({ channel }: { channel: string }) {
  const { data: agents = [], isLoading } = useQuery({ queryKey: ["channel-agents"], queryFn: fetchAgentList });
  const [open, setOpen] = useState(true);
  const note = GATEWAY_STATUS[channel];
  const hasGateway = GATEWAY_CHANNELS.includes(channel);

  const { data: gwStatus } = useQuery({
    queryKey: ["channel-gateway", channel],
    queryFn: () => fetchChannelGatewayStatus(channel),
    enabled: hasGateway,
    refetchInterval: 8000,
  });

  if (isLoading) return <div className="text-gray-500 text-sm"><Loader2 size={14} className="animate-spin inline mr-1" />Loading agents…</div>;

  return (
    <div className="space-y-3">
      {hasGateway && gwStatus && (
        <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded border ${
          gwStatus.connected
            ? "bg-green-900/20 border-green-700/40 text-green-300"
            : "bg-red-900/20 border-red-700/40 text-red-300"
        }`}>
          {gwStatus.connected
            ? <Wifi size={13} />
            : <WifiOff size={13} />}
          <span className="capitalize">{gwStatus.state}</span>
        </div>
      )}
      {note && (
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded p-3 text-xs text-yellow-300">
          {note}
        </div>
      )}
      {agents.map((agentId) => (
        <AgentCard key={agentId} agentId={agentId} channel={channel} />
      ))}
    </div>
  );
}
