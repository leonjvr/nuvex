/**
 * §17.2 — Installed Plugins page
 * Lists all installed plugins with id, name, version, trust tier badge, tool count, agent count.
 *
 * §17.3 — Plugin detail panel (inline side panel)
 * Shows metadata, permissions, config schema, registered tools/hooks, agents using plugin.
 *
 * §17.4 — Per-agent plugin picker
 * Checkboxes for enabling/disabling plugins on a selected agent.
 *
 * §17.5 / §17.6 — Per-agent plugin config panel + validation
 * Auto-generated form from config schema. Password inputs for secret fields.
 * Required fields validated; errors shown inline before save.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Puzzle,
  ChevronRight,
  ChevronDown,
  X,
  Save,
  Shield,
  Wrench,
  Users,
  Key,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PluginSummary {
  plugin_id: string;
  name: string;
  version: string;
  trust_tier: string;
  source: string;
  permissions: string[];
  tool_count?: number;
  agent_count?: number;
}

interface PluginDetail extends PluginSummary {
  tools: Array<{ name: string; description: string }>;
  hooks: Array<{ event: string; priority: number }>;
  config_schema: Record<string, SchemaField>;
  agents_using: string[];
}

interface SchemaField {
  type: string;
  description?: string;
  required?: boolean;
  secret?: boolean;
  default?: unknown;
}

interface AgentPlugin {
  plugin_id: string;
  name: string;
  version: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchPlugins(): Promise<PluginSummary[]> {
  const res = await fetch("/api/plugins");
  if (!res.ok) throw new Error("Failed to load plugins");
  const data = await res.json();
  return data.plugins ?? data ?? [];
}

async function fetchPluginDetail(pluginId: string): Promise<PluginDetail> {
  const res = await fetch(`/api/plugins/${pluginId}`);
  if (!res.ok) throw new Error("Failed to load plugin detail");
  return res.json();
}

async function fetchPluginSchema(pluginId: string): Promise<Record<string, SchemaField>> {
  const res = await fetch(`/api/plugins/${pluginId}/schema`);
  if (!res.ok) return {};
  const data = await res.json();
  return data.schema ?? data ?? {};
}

async function fetchAgentPlugins(agentId: string): Promise<AgentPlugin[]> {
  const res = await fetch(`/api/plugins/agents/${agentId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.plugins ?? data ?? [];
}

async function fetchAgents(): Promise<string[]> {
  const res = await fetch("/api/agents");
  if (!res.ok) return [];
  const data = await res.json();
  return (data.agents ?? data ?? []).map((a: { id?: string; name?: string } | string) =>
    typeof a === "string" ? a : (a.id ?? a.name ?? "")
  );
}

async function saveAgentPlugin(agentId: string, pluginId: string, enabled: boolean, config: Record<string, unknown>) {
  const res = await fetch(`/api/plugins/agents/${agentId}/${pluginId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, config }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Save failed");
  }
  return res.json();
}

// ── Trust tier badge ──────────────────────────────────────────────────────────

const TIER_BADGE: Record<string, string> = {
  t1: "bg-red-900/60 text-red-300 border border-red-700",
  t2: "bg-orange-900/60 text-orange-300 border border-orange-700",
  t3: "bg-yellow-900/60 text-yellow-300 border border-yellow-700",
  t4: "bg-green-900/60 text-green-300 border border-green-700",
};

function TierBadge({ tier }: { tier: string }) {
  const cls = TIER_BADGE[tier?.toLowerCase()] ?? "bg-gray-700 text-gray-300 border border-gray-600";
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-mono uppercase ${cls}`}>
      {tier ?? "—"}
    </span>
  );
}

// ── Config form field ─────────────────────────────────────────────────────────

function ConfigField({
  name,
  field,
  value,
  onChange,
  error,
}: {
  name: string;
  field: SchemaField;
  value: unknown;
  onChange: (v: string) => void;
  error?: string;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const isSecret = field.secret || field.type === "password";
  const inputType = isSecret && !showSecret ? "password" : "text";

  return (
    <div className="space-y-1">
      <label className="block text-xs text-gray-400">
        {name}
        {field.required && <span className="text-red-400 ml-1">*</span>}
        {field.description && (
          <span className="text-gray-500 ml-2 font-normal">{field.description}</span>
        )}
      </label>
      <div className="relative">
        <input
          type={inputType}
          value={value == null ? "" : String(value)}
          placeholder={field.default != null ? String(field.default) : ""}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full bg-gray-800 border rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-indigo-500 pr-${isSecret ? "9" : "3"} ${
            error ? "border-red-500" : "border-gray-700"
          }`}
        />
        {isSecret && (
          <button
            type="button"
            onClick={() => setShowSecret((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
          >
            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ── Agent plugin config panel (§17.5 + §17.6) ────────────────────────────────

function AgentPluginConfigPanel({
  agentId,
  plugin,
  onClose,
}: {
  agentId: string;
  plugin: AgentPlugin;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: schema } = useQuery({
    queryKey: ["plugin-schema", plugin.plugin_id],
    queryFn: () => fetchPluginSchema(plugin.plugin_id),
  });

  const [enabled, setEnabled] = useState(plugin.enabled);
  const [config, setConfig] = useState<Record<string, string>>(() => {
    const cfg: Record<string, string> = {};
    for (const k of Object.keys(schema ?? {})) {
      cfg[k] = plugin.config?.[k] != null ? String(plugin.config?.[k]) : "";
    }
    return cfg;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => saveAgentPlugin(agentId, plugin.plugin_id, enabled, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-plugins", agentId] });
      onClose();
    },
    onError: (err: Error) => setSaveErr(err.message),
  });

  // §17.6 — validate required fields before save
  function validate(): boolean {
    if (!schema) return true;
    const errs: Record<string, string> = {};
    for (const [k, f] of Object.entries(schema)) {
      if (f.required && !config[k]?.trim()) {
        errs[k] = `${k} is required`;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSave() {
    setSaveErr(null);
    if (!validate()) return;
    mutation.mutate();
  }

  const hasSchema = schema && Object.keys(schema).length > 0;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[480px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="font-semibold text-white">{plugin.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Configure for {agentId}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Enable toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setEnabled((e) => !e)}
              className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${
                enabled ? "bg-indigo-600" : "bg-gray-700"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                  enabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
            <span className="text-sm text-gray-300">Enabled for {agentId}</span>
          </label>

          {/* Config schema form */}
          {hasSchema ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Configuration</p>
              {Object.entries(schema!).map(([k, f]) => (
                <ConfigField
                  key={k}
                  name={k}
                  field={f}
                  value={config[k] ?? ""}
                  onChange={(v) => {
                    setConfig((c) => ({ ...c, [k]: v }));
                    if (errors[k]) setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
                  }}
                  error={errors[k]}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">No configuration fields for this plugin.</p>
          )}

          {saveErr && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertTriangle size={14} />
              {saveErr}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Agent plugin picker (§17.4) ────────────────────────────────────────────────

function AgentPluginPicker({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [configTarget, setConfigTarget] = useState<AgentPlugin | null>(null);
  const { data: plugins, isLoading } = useQuery({
    queryKey: ["agent-plugins", agentId],
    queryFn: () => fetchAgentPlugins(agentId),
  });

  if (configTarget) {
    return (
      <AgentPluginConfigPanel
        agentId={agentId}
        plugin={configTarget}
        onClose={() => setConfigTarget(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-[560px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="font-semibold text-white">Plugins for {agentId}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Enable plugins and configure credentials</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <Loader2 size={14} className="animate-spin" /> Loading...
            </div>
          )}
          {!isLoading && (!plugins || plugins.length === 0) && (
            <p className="text-sm text-gray-500 italic py-4">No plugins registered.</p>
          )}
          {plugins && plugins.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="pb-2">Plugin</th>
                  <th className="pb-2">Version</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {plugins.map((p) => (
                  <tr key={p.plugin_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="py-2.5 font-medium text-gray-200">{p.name}</td>
                    <td className="py-2.5 text-gray-400 font-mono text-xs">{p.version}</td>
                    <td className="py-2.5">
                      {p.enabled ? (
                        <span className="flex items-center gap-1 text-green-400 text-xs">
                          <CheckCircle2 size={12} /> Enabled
                        </span>
                      ) : (
                        <span className="text-gray-500 text-xs">Disabled</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        onClick={() => setConfigTarget(p)}
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                      >
                        Configure
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Plugin detail side panel (§17.3) ──────────────────────────────────────────

function PluginDetailPanel({
  plugin,
  onClose,
  onConfigureAgent,
}: {
  plugin: PluginDetail;
  onClose: () => void;
  onConfigureAgent: () => void;
}) {
  const [agentsExpanded, setAgentsExpanded] = useState(false);

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-gray-900 border-l border-gray-700 flex flex-col z-40 shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-gray-800">
        <div className="min-w-0">
          <h3 className="font-semibold text-white truncate">{plugin.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-400 font-mono">{plugin.plugin_id}</span>
            <span className="text-gray-600">·</span>
            <span className="text-xs text-gray-400">v{plugin.version}</span>
            <TierBadge tier={plugin.trust_tier} />
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white ml-4 flex-none">
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Source */}
        <Section label="Source">
          <p className="text-sm text-gray-300 font-mono">{plugin.source}</p>
        </Section>

        {/* Permissions */}
        {plugin.permissions?.length > 0 && (
          <Section label="Permissions">
            <div className="flex flex-wrap gap-1.5">
              {plugin.permissions.map((p) => (
                <span
                  key={p}
                  className="text-xs bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-gray-300 font-mono"
                >
                  {p}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Tools */}
        {plugin.tools?.length > 0 && (
          <Section label={`Tools (${plugin.tools.length})`}>
            <ul className="space-y-1.5">
              {plugin.tools.map((t) => (
                <li key={t.name} className="text-sm">
                  <span className="text-gray-200 font-medium">{t.name}</span>
                  {t.description && (
                    <span className="text-gray-500 ml-2">{t.description}</span>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Hooks */}
        {plugin.hooks?.length > 0 && (
          <Section label={`Hooks (${plugin.hooks.length})`}>
            <ul className="space-y-1.5">
              {plugin.hooks.map((h, i) => (
                <li key={i} className="text-sm flex items-center gap-2">
                  <span className="text-gray-200">{h.event}</span>
                  <span className="text-gray-500 text-xs">priority {h.priority}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Config schema */}
        {plugin.config_schema && Object.keys(plugin.config_schema).length > 0 && (
          <Section label="Config Schema">
            <ul className="space-y-1.5">
              {Object.entries(plugin.config_schema).map(([k, f]) => (
                <li key={k} className="text-sm flex items-center gap-2">
                  <span className="text-gray-200 font-mono">{k}</span>
                  <span className="text-gray-500 text-xs">{f.type}</span>
                  {f.required && <span className="text-red-400 text-xs">required</span>}
                  {f.secret && <Key size={10} className="text-yellow-400" />}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Agents using */}
        {plugin.agents_using?.length > 0 && (
          <Section label={`Used by ${plugin.agents_using.length} agent(s)`}>
            <button
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 mb-2"
              onClick={() => setAgentsExpanded((e) => !e)}
            >
              {agentsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {agentsExpanded ? "Hide" : "Show"} agents
            </button>
            {agentsExpanded && (
              <ul className="space-y-1">
                {plugin.agents_using.map((a) => (
                  <li key={a} className="text-sm text-gray-300 font-mono">
                    {a}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-gray-800">
        <button
          onClick={onConfigureAgent}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
        >
          <Users size={14} />
          Configure for Agent
        </button>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-2">{label}</p>
      {children}
    </div>
  );
}

// ── Main Plugins page (§17.2) ─────────────────────────────────────────────────

export default function PluginsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentPickerFor, setAgentPickerFor] = useState<string | null>(null);
  const [agentPluginTarget, setAgentPluginTarget] = useState<{ agentId: string; pluginId: string } | null>(null);
  const [agentSearch, setAgentSearch] = useState("");

  const { data: plugins, isLoading, error } = useQuery<PluginSummary[]>({
    queryKey: ["plugins"],
    queryFn: fetchPlugins,
    refetchInterval: 30_000,
  });

  const { data: detail } = useQuery<PluginDetail>({
    queryKey: ["plugin-detail", selectedId],
    queryFn: () => fetchPluginDetail(selectedId!),
    enabled: !!selectedId,
  });

  const { data: agents } = useQuery<string[]>({
    queryKey: ["agents-list"],
    queryFn: fetchAgents,
    enabled: !!agentPickerFor,
  });

  const filtered = (plugins ?? []).filter(
    (p) =>
      !agentSearch ||
      p.name.toLowerCase().includes(agentSearch.toLowerCase()) ||
      p.plugin_id.toLowerCase().includes(agentSearch.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Puzzle size={20} className="text-indigo-400" />
          <h1 className="text-lg font-semibold">Plugins</h1>
          {plugins && (
            <span className="text-sm text-gray-400">{plugins.length} installed</span>
          )}
        </div>
        <input
          value={agentSearch}
          onChange={(e) => setAgentSearch(e.target.value)}
          placeholder="Search plugins…"
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 w-56"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-6">
            <Loader2 size={16} className="animate-spin" /> Loading plugins…
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm py-6">
            <AlertTriangle size={16} />
            {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <Puzzle size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No plugins installed.</p>
            <p className="text-xs mt-1 text-gray-600">
              Install plugins by placing them in <code className="font-mono">/data/plugins/</code> or
              publishing as a Python package with the <code className="font-mono">nuvex_plugin</code> entry
              point.
            </p>
          </div>
        )}

        {filtered.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="pb-3 pr-4">Plugin</th>
                <th className="pb-3 pr-4">ID</th>
                <th className="pb-3 pr-4">Version</th>
                <th className="pb-3 pr-4">Tier</th>
                <th className="pb-3 pr-4">
                  <Wrench size={11} className="inline mr-1" />
                  Tools
                </th>
                <th className="pb-3 pr-4">
                  <Users size={11} className="inline mr-1" />
                  Agents
                </th>
                <th className="pb-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.plugin_id}
                  className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                    selectedId === p.plugin_id
                      ? "bg-indigo-950/40"
                      : "hover:bg-gray-800/40"
                  }`}
                  onClick={() => setSelectedId(selectedId === p.plugin_id ? null : p.plugin_id)}
                >
                  <td className="py-3 pr-4 font-medium text-gray-200">{p.name}</td>
                  <td className="py-3 pr-4 text-gray-400 font-mono text-xs">{p.plugin_id}</td>
                  <td className="py-3 pr-4 text-gray-400 font-mono text-xs">v{p.version}</td>
                  <td className="py-3 pr-4">
                    <TierBadge tier={p.trust_tier} />
                  </td>
                  <td className="py-3 pr-4 text-gray-400">{p.tool_count ?? "—"}</td>
                  <td className="py-3 pr-4 text-gray-400">{p.agent_count ?? "—"}</td>
                  <td className="py-3 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setAgentPickerFor(p.plugin_id);
                      }}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Configure
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail panel */}
      {selectedId && detail && (
        <PluginDetailPanel
          plugin={detail}
          onClose={() => setSelectedId(null)}
          onConfigureAgent={() => setAgentPickerFor(selectedId)}
        />
      )}

      {/* Agent picker — select which agent to configure for */}
      {agentPickerFor && (
        <AgentPickerModal
          agentList={agents ?? []}
          onSelect={(agentId) => {
            setAgentPickerFor(null);
            setSelectedId(null);
            setAgentPluginTarget({ agentId, pluginId: agentPickerFor });
          }}
          onClose={() => setAgentPickerFor(null)}
        />
      )}

      {/* Per-agent plugin picker */}
      {agentPluginTarget && (
        <AgentPluginPicker
          agentId={agentPluginTarget.agentId}
          onClose={() => setAgentPluginTarget(null)}
        />
      )}
    </div>
  );
}

// We need a small state object for configured agent+plugin
function usePerAgentPlugin() {
  const [state, setState] = useState<{ agentId: string; pluginId: string } | null>(null);
  return { state, setState };
}

// Inline picker modal when no agent is selected yet
function AgentPickerModal({
  agentList,
  onSelect,
  onClose,
}: {
  agentList: string[];
  onSelect: (agentId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg w-80">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h3 className="font-semibold text-white">Select Agent</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="py-2 max-h-64 overflow-y-auto">
          {agentList.length === 0 && (
            <p className="text-sm text-gray-500 px-5 py-3 italic">No agents found.</p>
          )}
          {agentList.map((a) => (
            <button
              key={a}
              onClick={() => onSelect(a)}
              className="w-full text-left px-5 py-2.5 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
            >
              {a}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
