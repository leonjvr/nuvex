import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { X, Bot, Cpu, Puzzle, Radio, DollarSign, Save, Loader2, Zap, FileText, Users, ChevronDown, ChevronRight, AlertCircle, Server, Trash2, Plus, Wand2, CheckCircle2 } from "lucide-react";

const LIFECYCLE_COLORS: Record<string, string> = {
  idle:             "bg-gray-700 text-gray-300",
  spawning:         "bg-blue-900 text-blue-300",
  ready_for_prompt: "bg-teal-900 text-teal-300",
  running:          "bg-green-900 text-green-300",
  finished:         "bg-indigo-900 text-indigo-300",
  failed:           "bg-red-900 text-red-300",
  suspended:        "bg-orange-900 text-orange-300",
  error:            "bg-red-900 text-red-300",
  terminated:       "bg-gray-800 text-gray-500",
};

type Tab = "overview" | "models" | "channels" | "budget" | "skills" | "prompts" | "a2a" | "mcp";

async function fetchConfig(agentId: string) {
  const r = await fetch(`/api/agents/${agentId}/config`);
  if (!r.ok) throw new Error("config fetch failed");
  return r.json();
}

async function fetchCard(agentId: string) {
  const r = await fetch(`/api/agents/${agentId}/card`);
  if (!r.ok) throw new Error("card fetch failed");
  return r.json();
}

async function fetchPrompts(agentId: string) {
  const r = await fetch(`/api/agents/${agentId}/prompts`);
  if (!r.ok) throw new Error("prompts fetch failed");
  return r.json();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text", disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 8 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-600 font-mono resize-y"
    />
  );
}

function Toggle({ checked, onChange, label, disabled, disabledReason }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; disabledReason?: string }) {
  return (
    <div>
      <label className={`flex items-center gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
        <div
          onClick={() => !disabled && onChange(!checked)}
          className={`w-10 h-5 rounded-full transition-colors flex-none relative ${checked ? "bg-indigo-600" : "bg-gray-700"} ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
        </div>
        <span className="text-sm text-gray-300">{label}</span>
      </label>
      {disabled && disabledReason && (
        <p className="mt-1.5 text-xs text-amber-500/70 flex items-center gap-1">
          <AlertCircle size={10} /> {disabledReason}
        </p>
      )}
    </div>
  );
}

function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: string }) {
  const colors: Record<string, string> = {
    gray: "bg-gray-800 text-gray-400 border-gray-700",
    indigo: "bg-indigo-900/40 text-indigo-300 border-indigo-800/40",
    green: "bg-green-900/30 text-green-400 border-green-800/40",
    amber: "bg-amber-900/30 text-amber-400 border-amber-800/40",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${colors[color] ?? colors.gray}`}>{children}</span>
  );
}

function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-gray-800/50 transition-colors"
      >
        {title}
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-3">{children}</div>}
    </div>
  );
}

// ── Skill picker tab (§8.3 – §8.6) ───────────────────────────────────────────

interface SkillField {
  name: string;
  required: boolean;
  secret: boolean;
  description: string;
  type: string;
}

function SkillConfigPanel({
  agentId,
  skillName,
  onSaved,
  qc,
}: {
  agentId: string;
  skillName: string;
  onSaved: () => void;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const { data: schemaData, isLoading } = useQuery<{ fields: SkillField[] }>({
    queryKey: ["skill-schema", agentId, skillName],
    queryFn: async () => {
      const r = await fetch(`/api/skill-config/agents/${agentId}/skills/${skillName}/schema`);
      if (!r.ok) return { fields: [] };
      return r.json();
    },
  });

  const fields = schemaData?.fields ?? [];
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  // Required validation: all required fields must be non-empty (8.6)
  const allRequiredFilled = fields
    .filter((f) => f.required)
    .every((f) => (values[f.name] ?? "").trim() !== "");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      // Build env dict - skip fields with empty value (empty = no change for secrets) (8.5)
      const env: Record<string, string> = {};
      for (const f of fields) {
        const v = values[f.name] ?? "";
        if (v !== "") env[f.name] = v;
      }
      const r = await fetch(`/api/skill-config/agents/${agentId}/skills/${skillName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, env: Object.keys(env).length ? env : undefined }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail ?? "Save failed");
      }
      qc.invalidateQueries({ queryKey: ["agent-skill-configs", agentId] });
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return <p className="text-xs text-gray-500 py-2">Loading schema…</p>;
  }

  if (fields.length === 0) {
    return <p className="text-xs text-gray-500 py-2">No configuration required.</p>;
  }

  return (
    <div className="mt-3 space-y-3 pl-2 border-l-2 border-indigo-900/60">
      {fields.map((f) => (
        <div key={f.name}>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {f.name}
            {f.required && <span className="text-red-400 ml-0.5">*</span>}
            {f.description && (
              <span className="ml-1 text-gray-600 font-normal">— {f.description}</span>
            )}
          </label>
          {/* Secret fields: password input + masked display (8.5) */}
          <input
            type={f.secret ? "password" : "text"}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            placeholder={f.secret ? "•••••••• (leave empty to keep existing)" : `Enter ${f.name}…`}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-600 font-mono"
          />
        </div>
      ))}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex justify-end">
        {/* Save disabled until required fields filled (8.6) */}
        <button
          onClick={save}
          disabled={saving || !allRequiredFilled}
          className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          Save config
        </button>
      </div>
    </div>
  );
}

function SkillPickerTab({
  agentId,
  globalSkills,
  agentSkillConfigs,
  isLoading,
  qc,
}: {
  agentId: string;
  globalSkills: any[];
  agentSkillConfigs: any[];
  isLoading: boolean;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [toggling, setToggling] = React.useState<string | null>(null);

  const configMap = React.useMemo(() => {
    const m: Record<string, { enabled: boolean; config_json: any }> = {};
    for (const c of agentSkillConfigs) m[c.skill_name] = c;
    return m;
  }, [agentSkillConfigs]);

  const toggle = async (skillName: string, enabled: boolean) => {
    setToggling(skillName);
    try {
      await fetch(`/api/skill-config/agents/${agentId}/skills/${skillName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      qc.invalidateQueries({ queryKey: ["agent-skill-configs", agentId] });
      if (!enabled && expanded === skillName) setExpanded(null);
    } finally {
      setToggling(null);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-gray-500 text-center py-8">Loading skills…</p>;
  }

  if (globalSkills.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <Puzzle size={28} className="mx-auto text-gray-700" />
        <p className="text-sm text-gray-500">No global skills available.</p>
        <p className="text-xs text-gray-600">Add skills to /data/skills to make them available here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 mb-3">
        Enable global skills for this agent and configure their secrets.
      </p>
      {globalSkills.map((s) => {
        const cfg = configMap[s.name];
        const isEnabled = cfg?.enabled ?? false;
        const isExpanded = expanded === s.name;
        const isToggling = toggling === s.name;

        return (
          <div key={s.name} className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2.5">
              {/* Toggle (8.3) */}
              <button
                title={isEnabled ? `Disable ${s.display_name}` : `Enable ${s.display_name}`}
                onClick={() => toggle(s.name, !isEnabled)}
                disabled={isToggling}
                className={`w-9 h-5 rounded-full transition-colors flex-none relative ${isEnabled ? "bg-indigo-600" : "bg-gray-700"} ${isToggling ? "opacity-50" : "cursor-pointer"}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-200 truncate">{s.display_name}</p>
                  {s.version && <span className="text-xs text-gray-600 font-mono">v{s.version}</span>}
                </div>
                {s.description && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">{s.description}</p>
                )}
              </div>
              {isEnabled && (
                <button
                  onClick={() => setExpanded(isExpanded ? null : s.name)}
                  className="text-gray-500 hover:text-gray-300 p-0.5 flex-none"
                  title="Configure"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              )}
            </div>
            {/* Config panel (8.4) */}
            {isEnabled && isExpanded && (
              <div className="px-3 pb-3 border-t border-gray-700/50">
                <SkillConfigPanel
                  agentId={agentId}
                  skillName={s.name}
                  qc={qc}
                  onSaved={() => setExpanded(null)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AgentSettingsModal({
  agent,
  allAgents,
  onClose,
}: {
  agent: any;
  allAgents?: any[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const state = agent.lifecycle_state ?? "idle";
  const badgeClass = LIFECYCLE_COLORS[state] ?? "bg-gray-700 text-gray-300";
  const [tab, setTab] = useState<Tab>("overview");
  const [saved, setSaved] = useState(false);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["agent-config", agent.id],
    queryFn: () => fetchConfig(agent.id),
  });

  const { data: card } = useQuery({
    queryKey: ["agent-card", agent.id],
    queryFn: () => fetchCard(agent.id),
    enabled: tab === "a2a",
  });

  const { data: installedSkills = [], isLoading: skillsLoading } = useQuery({
    queryKey: ["installed-skills", agent.id],
    queryFn: async () => {
      const r = await fetch(`/api/skills?agent_id=${agent.id}`);
      if (!r.ok) return [];
      const d = await r.json();
      return d.skills ?? [];
    },
    enabled: tab === "skills",
  });

  const { data: globalSkills = [] } = useQuery<any[]>({
    queryKey: ["global-skills"],
    queryFn: async () => {
      const r = await fetch("/api/skill-config/global-skills");
      if (!r.ok) return [];
      const d = await r.json();
      return d.skills ?? [];
    },
    enabled: tab === "skills",
    staleTime: 30000,
  });

  const { data: agentSkillConfigs = [] } = useQuery<any[]>({
    queryKey: ["agent-skill-configs", agent.id],
    queryFn: async () => {
      const r = await fetch(`/api/skill-config/agents/${agent.id}/skills`);
      if (!r.ok) return [];
      const d = await r.json();
      return d.configs ?? [];
    },
    enabled: tab === "skills",
  });

  const { data: promptsData, isLoading: promptsLoading } = useQuery({
    queryKey: ["agent-prompts", agent.id],
    queryFn: () => fetchPrompts(agent.id),
    enabled: tab === "prompts",
  });

  // ── Local editable state ──
  const [name, setName] = useState(agent.name || agent.id);
  const [description, setDescription] = useState("");
  const [modelPrimary, setModelPrimary] = useState("");
  const [modelFast, setModelFast] = useState("");
  const [modelCode, setModelCode] = useState("");
  const [modelFailover, setModelFailover] = useState("");
  const [modelMode, setModelMode] = useState("standard");
  const [routingSimple, setRoutingSimple] = useState("fast");
  const [routingConversation, setRoutingConversation] = useState("primary");
  const [routingCode, setRoutingCode] = useState("code");
  const [tier, setTier] = useState(agent.tier || "T1");
  const [division, setDivision] = useState(agent.division || "");
  const [budgetTask, setBudgetTask] = useState("");
  const [budgetDaily, setBudgetDaily] = useState("");
  const [budgetMonthly, setBudgetMonthly] = useState("");
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgToken, setTgToken] = useState("");
  const [tgAllowed, setTgAllowed] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailImapHost, setEmailImapHost] = useState("");
  const [emailImapPort, setEmailImapPort] = useState("993");
  const [emailSmtpHost, setEmailSmtpHost] = useState("");
  const [emailSmtpPort, setEmailSmtpPort] = useState("587");
  const [emailUser, setEmailUser] = useState("");
  const [emailPass, setEmailPass] = useState("");
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackToken, setSlackToken] = useState("");
  const [discordEnabled, setDiscordEnabled] = useState(false);
  const [discordToken, setDiscordToken] = useState("");
  const [waEnabled, setWaEnabled] = useState(false);
  const [waSyncHistory, setWaSyncHistory] = useState(false);
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [activePromptFile, setActivePromptFile] = useState("SOUL.md");

  // ── MCP state ──
  const [mcpServers, setMcpServers] = useState<Record<string, any>>({});
  const [mcpPaste, setMcpPaste] = useState("");
  const [mcpParsing, setMcpParsing] = useState(false);
  const [mcpParseError, setMcpParseError] = useState("");
  const [mcpParsed, setMcpParsed] = useState<any>(null); // preview before confirm
  const [mcpEditingEnv, setMcpEditingEnv] = useState<Record<string, string>>({});

  // ── WA exclusivity: find which other agent owns WA ──
  const waOwner = allAgents?.find(
    (a) => a.id !== agent.id && a.channels?.whatsapp?.enabled === true
  );
  const waBlocked = !!waOwner && !waEnabled;

  // ── Populate local state once config loads ──
  const [initialised, setInitialised] = useState(false);
  if (cfg && !initialised) {
    setName(cfg.name ?? agent.id);
    setDescription(cfg.description ?? "");
    setModelPrimary(cfg.model?.primary ?? "");
    setModelFast(cfg.model?.fast ?? "");
    setModelCode(cfg.model?.code ?? "");
    setModelFailover((cfg.model?.failover ?? []).join(", "));
    setModelMode(cfg.model?.mode ?? "standard");
    setRoutingSimple(cfg.routing?.simple_reply ?? "fast");
    setRoutingConversation(cfg.routing?.conversation ?? "primary");
    setRoutingCode(cfg.routing?.code_generation ?? "code");
    setTier(cfg.tier ?? "T1");
    setDivision(cfg.division ?? "");
    setBudgetTask(String(cfg.budget?.per_task_usd ?? 0.5));
    setBudgetDaily(String(cfg.budget?.daily_usd ?? 5));
    setBudgetMonthly(String(cfg.budget?.monthly_usd ?? 50));
    setTgEnabled(cfg.channels?.telegram?.enabled ?? false);
    setTgToken(cfg.channels?.telegram?.bot_token ?? "");
    setTgAllowed(cfg.channels?.telegram?.allowed_users ?? "");
    setEmailEnabled(cfg.channels?.email?.enabled ?? false);
    setEmailImapHost(cfg.channels?.email?.imap_host ?? "");
    setEmailImapPort(String(cfg.channels?.email?.imap_port ?? 993));
    setEmailSmtpHost(cfg.channels?.email?.smtp_host ?? "");
    setEmailSmtpPort(String(cfg.channels?.email?.smtp_port ?? 587));
    setEmailUser(cfg.channels?.email?.email_user ?? "");
    setEmailPass(cfg.channels?.email?.email_pass ?? "");
    setSlackEnabled(cfg.channels?.slack?.enabled ?? false);
    setSlackToken(cfg.channels?.slack?.bot_token ?? "");
    setDiscordEnabled(cfg.channels?.discord?.enabled ?? false);
    setDiscordToken(cfg.channels?.discord?.bot_token ?? "");
    setWaEnabled(cfg.channels?.whatsapp?.enabled ?? false);
    setWaSyncHistory(cfg.channels?.whatsapp?.sync_full_history ?? false);
    setMcpServers(cfg.mcp_servers ?? {});
    setInitialised(true);
  }

  // Populate prompts when they load
  const [promptsInitialised, setPromptsInitialised] = useState(false);
  if (promptsData && !promptsInitialised) {
    setPrompts(promptsData);
    if (Object.keys(promptsData).length > 0) {
      setActivePromptFile(Object.keys(promptsData)[0]);
    }
    setPromptsInitialised(true);
  }

  const savePromptMutation = useMutation({
    mutationFn: async ({ filename, content }: { filename: string; content: string }) => {
      const r = await fetch(`/api/agents/${agent.id}/prompts/${filename}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!r.ok) throw new Error("Prompt save failed");
    },
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["agent-prompts", agent.id] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const body: any = {
        name, description, tier, division,
        model: {
          primary: modelPrimary,
          fast: modelFast || undefined,
          code: modelCode || undefined,
          mode: modelMode,
          failover: modelFailover ? modelFailover.split(",").map((s) => s.trim()).filter(Boolean) : [],
        },
        routing: {
          simple_reply: routingSimple,
          conversation: routingConversation,
          code_generation: routingCode,
          voice_response: routingSimple,
        },
        budget: {
          per_task_usd: parseFloat(budgetTask),
          daily_usd: parseFloat(budgetDaily),
          monthly_usd: parseFloat(budgetMonthly),
        },
        channels: {
          whatsapp: { enabled: waEnabled, sync_full_history: waSyncHistory },
          telegram: { enabled: tgEnabled, bot_token: tgToken, allowed_users: tgAllowed },
          email: {
            enabled: emailEnabled,
            imap_host: emailImapHost,
            imap_port: parseInt(emailImapPort),
            smtp_host: emailSmtpHost,
            smtp_port: parseInt(emailSmtpPort),
            email_user: emailUser,
            email_pass: emailPass,
          },
          slack: { enabled: slackEnabled, bot_token: slackToken },
          discord: { enabled: discordEnabled, bot_token: discordToken },
        },
      };
      const r = await fetch(`/api/agents/${agent.id}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.detail ?? "Save failed");
      }
    },
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["agent-config", agent.id] });
      qc.invalidateQueries({ queryKey: ["agents"] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview",  label: "Overview",  icon: <Cpu size={15} /> },
    { id: "models",    label: "Models",    icon: <Zap size={15} /> },
    { id: "channels",  label: "Channels",  icon: <Radio size={15} /> },
    { id: "budget",    label: "Budget",    icon: <DollarSign size={15} /> },
    { id: "mcp",       label: "MCP Servers", icon: <Server size={15} /> },
    { id: "prompts",   label: "Prompts",   icon: <FileText size={15} /> },
    { id: "a2a",       label: "Agent Card",icon: <Users size={15} /> },
    { id: "skills",    label: "Skills",    icon: <Puzzle size={15} /> },
  ];

  const promptFiles = ["SOUL.md", "IDENTITY.md", "AGENTS.md", "TOOLS.md", "USER.md", "HEARTBEAT.md", "BOOTSTRAP.md"];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl mx-4 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800 flex-none">
          <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center flex-none">
            <Bot size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{agent.name || agent.id}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full ${badgeClass}`}>{state}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Sidebar + content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left nav */}
          <nav className="w-44 flex-none border-r border-gray-800 py-3 px-2 space-y-0.5 overflow-y-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2.5 w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t.id ? "bg-indigo-600/20 text-indigo-400" : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && <p className="text-sm text-gray-500 text-center py-8">Loading config…</p>}

          {/* ── Overview ── */}
          {!isLoading && tab === "overview" && (
            <div className="space-y-4">
              <Field label="Display name"><Input value={name} onChange={setName} /></Field>
              <Field label="Agent ID">
                <p className="font-mono text-sm text-indigo-300 bg-gray-800 rounded-lg px-3 py-2">{agent.id}</p>
              </Field>
              <Field label="Description">
                <Input value={description} onChange={setDescription} placeholder="Short description of this agent's purpose…" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tier">
                  <select value={tier} onChange={(e) => setTier(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500">
                    <option>T1</option><option>T2</option><option>T3</option>
                  </select>
                </Field>
                <Field label="Division"><Input value={division} onChange={setDivision} placeholder="personal" /></Field>
              </div>
            </div>
          )}

          {/* ── Models ── */}
          {!isLoading && tab === "models" && (
            <div className="space-y-5">
              <div>
                <p className="text-xs text-gray-500 mb-3">Configure which models handle different task types. Use <code className="bg-gray-800 px-1 rounded">provider/model</code> format.</p>
                <Field label="Mode">
                  <select value={modelMode} onChange={(e) => setModelMode(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500">
                    <option value="standard">Standard — route by task type</option>
                    <option value="budget">Budget — always use fast model (cheapest)</option>
                    <option value="failover">Failover — primary, then failover list</option>
                  </select>
                </Field>
                {modelMode === "budget" && (
                  <p className="mt-2 text-xs text-amber-500/70 bg-amber-950/20 border border-amber-800/20 rounded px-2 py-1.5">
                    Budget mode uses the fast model for all tasks regardless of complexity.
                  </p>
                )}
              </div>
              <Collapsible title="Model slots" defaultOpen>
                <Field label="Primary model (complex tasks)"><Input value={modelPrimary} onChange={setModelPrimary} placeholder="anthropic/claude-sonnet-4-20250514" /></Field>
                <Field label="Fast model (simple / budget tasks)"><Input value={modelFast} onChange={setModelFast} placeholder="groq/llama-3.3-70b-versatile" /></Field>
                <Field label="Code model (code generation)"><Input value={modelCode} onChange={setModelCode} placeholder="openai/gpt-4o" /></Field>
                <Field label="Failover models (comma-separated, tried on overload)">
                  <Input value={modelFailover} onChange={setModelFailover} placeholder="openai/gpt-4o-mini, groq/llama-3.3-70b-versatile" />
                </Field>
              </Collapsible>
              <Collapsible title="Routing rules" defaultOpen={modelMode === "standard"}>
                <p className="text-xs text-gray-600 mb-2">Maps task type → model slot. Values: <code className="bg-gray-800 rounded px-1">primary</code> | <code className="bg-gray-800 rounded px-1">fast</code> | <code className="bg-gray-800 rounded px-1">code</code></p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Simple reply"><Input value={routingSimple} onChange={setRoutingSimple} placeholder="fast" /></Field>
                  <Field label="Conversation"><Input value={routingConversation} onChange={setRoutingConversation} placeholder="primary" /></Field>
                  <Field label="Code generation"><Input value={routingCode} onChange={setRoutingCode} placeholder="code" /></Field>
                  <Field label="Voice response"><Input value={routingSimple} onChange={setRoutingSimple} placeholder="fast" disabled /></Field>
                </div>
              </Collapsible>
            </div>
          )}

          {/* ── Channels ── */}
          {!isLoading && tab === "channels" && (
            <div className="space-y-6">
              {/* WhatsApp */}
              <div>
                <Toggle
                  checked={waEnabled}
                  onChange={setWaEnabled}
                  label="WhatsApp"
                  disabled={waBlocked}
                  disabledReason={waBlocked ? `Managed by "${waOwner?.name ?? waOwner?.id}" — only one agent can handle WhatsApp` : undefined}
                />
                {waEnabled && (
                  <div className="mt-3 space-y-3 pl-2 border-l-2 border-green-900">
                    <p className="text-xs text-green-400/80 bg-green-950/30 border border-green-800/30 rounded-lg px-3 py-2 flex items-center gap-1.5">
                      <span>✓</span> This agent is the WhatsApp gateway owner. Disable here to transfer ownership to another agent.
                    </p>
                    <Toggle checked={waSyncHistory} onChange={setWaSyncHistory} label="Sync full chat history on connect" />
                    <p className="text-xs text-amber-500/80 bg-amber-950/30 border border-amber-800/30 rounded-lg px-3 py-2">
                      ⚠️ Enabling this loads your entire WhatsApp chat history into the dashboard sidebar. For accounts with hundreds of chats or large group conversations, this can cause slow startup and expose personal conversations unrelated to this agent. Leave off unless you specifically need older chats to appear.
                    </p>
                  </div>
                )}
              </div>
              {/* Telegram */}
              <div>
                <Toggle checked={tgEnabled} onChange={setTgEnabled} label="Telegram" />
                {tgEnabled && (
                  <div className="mt-3 space-y-3 pl-2 border-l-2 border-indigo-800">
                    <Field label="Bot token"><Input value={tgToken} onChange={setTgToken} placeholder="123:ABC…" /></Field>
                    <Field label="Allowed user IDs (comma-separated)"><Input value={tgAllowed} onChange={setTgAllowed} placeholder="123456789,987654321" /></Field>
                  </div>
                )}
              </div>
              {/* Email */}
              <div>
                <Toggle checked={emailEnabled} onChange={setEmailEnabled} label="Email (IMAP/SMTP)" />
                {emailEnabled && (
                  <div className="mt-3 space-y-3 pl-2 border-l-2 border-indigo-800">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="IMAP host"><Input value={emailImapHost} onChange={setEmailImapHost} placeholder="imap.gmail.com" /></Field>
                      <Field label="IMAP port"><Input value={emailImapPort} onChange={setEmailImapPort} type="number" /></Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="SMTP host"><Input value={emailSmtpHost} onChange={setEmailSmtpHost} placeholder="smtp.gmail.com" /></Field>
                      <Field label="SMTP port"><Input value={emailSmtpPort} onChange={setEmailSmtpPort} type="number" /></Field>
                    </div>
                    <Field label="Email address"><Input value={emailUser} onChange={setEmailUser} placeholder="bot@example.com" /></Field>
                    <Field label="Password / app token"><Input value={emailPass} onChange={setEmailPass} type="password" /></Field>
                  </div>
                )}
              </div>
              {/* Slack */}
              <div>
                <Toggle checked={slackEnabled} onChange={setSlackEnabled} label="Slack" />
                {slackEnabled && (
                  <div className="mt-3 pl-2 border-l-2 border-indigo-800">
                    <Field label="Bot token"><Input value={slackToken} onChange={setSlackToken} placeholder="xoxb-…" /></Field>
                  </div>
                )}
              </div>
              {/* Discord */}
              <div>
                <Toggle checked={discordEnabled} onChange={setDiscordEnabled} label="Discord" />
                {discordEnabled && (
                  <div className="mt-3 pl-2 border-l-2 border-indigo-800">
                    <Field label="Bot token"><Input value={discordToken} onChange={setDiscordToken} placeholder="Bot token from Discord developer portal" /></Field>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-600">Channel changes take effect after the gateway container restarts.</p>
            </div>
          )}

          {/* ── Budget ── */}
          {!isLoading && tab === "budget" && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">Spending limits. Governance enforcement blocks invocations when exceeded.</p>
              <Field label="Per-task limit (USD)"><Input value={budgetTask} onChange={setBudgetTask} type="number" /></Field>
              <Field label="Daily limit (USD)"><Input value={budgetDaily} onChange={setBudgetDaily} type="number" /></Field>
              <Field label="Monthly limit (USD)"><Input value={budgetMonthly} onChange={setBudgetMonthly} type="number" /></Field>
            </div>
          )}

          {/* ── Prompts ── */}
          {tab === "prompts" && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Workspace prompt files that make up the agent's system prompt. Files are assembled in order: SOUL → IDENTITY → AGENTS → TOOLS → HEARTBEAT → skills.
              </p>
              {promptsLoading && <p className="text-sm text-gray-500 text-center py-8">Loading prompts…</p>}
              {!promptsLoading && (
                <div className="flex gap-2 flex-wrap mb-2">
                  {promptFiles.map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        setActivePromptFile(f);
                        if (!prompts[f]) setPrompts((p) => ({ ...p, [f]: "" }));
                      }}
                      className={`text-xs px-2 py-1 rounded-md border transition-colors ${activePromptFile === f ? "bg-indigo-600 border-indigo-500 text-white" : prompts[f] ? "bg-gray-800 border-gray-700 text-gray-300 hover:border-indigo-600" : "bg-gray-900 border-gray-800 text-gray-600 hover:border-gray-700"}`}
                    >
                      {f} {!prompts[f] && <span className="opacity-50">(empty)</span>}
                    </button>
                  ))}
                </div>
              )}
              {!promptsLoading && (
                <>
                  <div className="text-xs text-gray-500 mb-1">
                    {activePromptFile === "SOUL.md" && "Core identity and values — never trimmed from the prompt."}
                    {activePromptFile === "IDENTITY.md" && "Role description and capabilities — never trimmed."}
                    {activePromptFile === "AGENTS.md" && "Other agents this agent knows about (auto-populated by A2A discovery)."}
                    {activePromptFile === "TOOLS.md" && "Tool usage instructions and examples."}
                    {activePromptFile === "USER.md" && "User profile and preferences — contextualises responses."}
                    {activePromptFile === "HEARTBEAT.md" && "Daily context injection (date, status, recent events)."}
                    {activePromptFile === "BOOTSTRAP.md" && "General startup instructions loaded on every invocation."}
                  </div>
                  <Textarea
                    value={prompts[activePromptFile] ?? ""}
                    onChange={(v) => setPrompts((p) => ({ ...p, [activePromptFile]: v }))}
                    placeholder={`# ${activePromptFile}\n\nWrite the content here…`}
                    rows={14}
                  />
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => savePromptMutation.mutate({ filename: activePromptFile, content: prompts[activePromptFile] ?? "" })}
                      disabled={savePromptMutation.isPending}
                      className="flex items-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition-colors"
                    >
                      {savePromptMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      Save {activePromptFile}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── A2A Agent Card ── */}
          {tab === "a2a" && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Agent card following the Google A2A (Agent-to-Agent) protocol spec. Other agents and orchestrators use this to discover capabilities.
              </p>
              {!card && <p className="text-sm text-gray-500 text-center py-6">Loading agent card…</p>}
              {card && (
                <div className="space-y-4">
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-700 flex items-center justify-center text-sm font-bold text-white flex-none">
                        {card.display_name?.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{card.display_name}</p>
                        <p className="text-xs text-gray-500 font-mono">{card.name} · v{card.version}</p>
                      </div>
                      <div className="ml-auto flex gap-1.5">
                        <Badge color="indigo">{card.tier}</Badge>
                        <Badge>{card.division}</Badge>
                      </div>
                    </div>
                    {card.description && <p className="text-xs text-gray-400">{card.description}</p>}
                    <div className="text-xs font-mono text-gray-600 bg-gray-900 rounded px-2 py-1 truncate">{card.url}</div>
                  </div>

                  <Collapsible title="Capabilities" defaultOpen>
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Available tools</p>
                      <div className="flex flex-wrap gap-1.5">
                        {card.capabilities?.tools?.map((t: string) => (
                          <Badge key={t} color="green">{t}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      {[["Streaming", card.capabilities?.streaming], ["Delegation", card.capabilities?.delegation], ["Approval gate", card.capabilities?.approval_gate]].map(([label, val]) => (
                        <div key={String(label)} className="text-center bg-gray-800 rounded p-2">
                          <p className={`text-xs font-medium ${val ? "text-green-400" : "text-gray-600"}`}>{val ? "✓" : "✗"}</p>
                          <p className="text-xs text-gray-500">{String(label)}</p>
                        </div>
                      ))}
                    </div>
                  </Collapsible>

                  <Collapsible title="Models & routing">
                    <div className="space-y-1.5 text-xs">
                      {[["Primary", card.model?.primary], ["Fast", card.model?.fast], ["Code", card.model?.code]].filter(([, v]) => v).map(([label, val]) => (
                        <div key={String(label)} className="flex justify-between">
                          <span className="text-gray-500">{String(label)}</span>
                          <span className="font-mono text-gray-300">{String(val)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between">
                        <span className="text-gray-500">Mode</span>
                        <Badge color={card.model?.mode === "budget" ? "amber" : "indigo"}>{card.model?.mode}</Badge>
                      </div>
                      {card.model?.failover?.length > 0 && (
                        <div>
                          <span className="text-gray-500">Failover</span>
                          <div className="flex flex-wrap gap-1 mt-1">{card.model.failover.map((f: string) => <Badge key={f}>{f}</Badge>)}</div>
                        </div>
                      )}
                    </div>
                  </Collapsible>

                  <Collapsible title="Routing rules">
                    <div className="space-y-1.5 text-xs">
                      {Object.entries(card.routing ?? {}).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-gray-500">{k.replace(/_/g, " ")}</span>
                          <Badge>{String(v)}</Badge>
                        </div>
                      ))}
                    </div>
                  </Collapsible>

                  <Collapsible title="Active channels">
                    <div className="flex flex-wrap gap-1.5">
                      {card.channels?.length > 0
                        ? card.channels.map((c: string) => <Badge key={c} color="green">{c}</Badge>)
                        : <span className="text-xs text-gray-600">No external channels enabled</span>
                      }
                    </div>
                  </Collapsible>

                  <Collapsible title="Skills">
                    <div className="flex flex-wrap gap-1.5">
                      {card.skills?.length > 0
                        ? card.skills.map((s: string) => <Badge key={s} color="indigo">{s}</Badge>)
                        : <span className="text-xs text-gray-600">No skills assigned</span>
                      }
                    </div>
                  </Collapsible>

                  <Collapsible title="Authentication">
                    <div className="text-xs">
                      <span className="text-gray-500">Schemes: </span>
                      {card.authentication?.schemes?.map((s: string) => <Badge key={s}>{s}</Badge>)}
                    </div>
                  </Collapsible>

                  <div className="pt-1">
                    <button
                      onClick={() => navigator.clipboard.writeText(JSON.stringify(card, null, 2))}
                      className="text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800 px-3 py-1.5 rounded-lg transition-colors border border-gray-700"
                    >
                      Copy card JSON
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── MCP Servers ── */}
          {tab === "mcp" && (
            <div className="space-y-5">
              <div>
                <p className="text-xs text-gray-500">
                  MCP (Model Context Protocol) servers extend what this agent can do. Only available to T1 agents.
                  Paste any format — JSON, YAML, npx command, SSE URL, or Claude Desktop config — and the system will parse it automatically.
                </p>
                {tier !== "T1" && (
                  <div className="mt-2 text-xs text-amber-500/80 bg-amber-950/20 border border-amber-800/20 rounded px-3 py-2 flex items-center gap-1.5">
                    <AlertCircle size={12} /> MCP tools are only loaded for T1 agents. Upgrade this agent's tier to activate them.
                  </div>
                )}
              </div>

              {/* Existing servers */}
              {Object.keys(mcpServers).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Installed</p>
                  {Object.entries(mcpServers).map(([name, srv]: [string, any]) => (
                    <div key={name} className="bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2.5 flex items-start gap-3">
                      <Server size={14} className="text-indigo-400 flex-none mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-200">{name}</p>
                        {srv.transport === "sse" ? (
                          <p className="text-xs text-gray-500 font-mono truncate mt-0.5">{srv.url}</p>
                        ) : (
                          <p className="text-xs text-gray-500 font-mono truncate mt-0.5">
                            {srv.command} {(srv.args ?? []).join(" ")}
                          </p>
                        )}
                        {srv.env && Object.keys(srv.env).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {Object.keys(srv.env).map((k) => (
                              <span key={k} className="text-xs bg-gray-700 text-amber-400 px-1.5 py-0.5 rounded font-mono">{k}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={async () => {
                          const r = await fetch(`/api/agents/${agent.id}/mcp/${name}`, { method: "DELETE" });
                          if (r.ok) {
                            const next = { ...mcpServers };
                            delete next[name];
                            setMcpServers(next);
                            qc.invalidateQueries({ queryKey: ["agent-config", agent.id] });
                          }
                        }}
                        title={`Remove ${name}`}
                        className="text-gray-600 hover:text-red-400 transition-colors flex-none"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Parse & add */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Add MCP server</p>
                <Textarea
                  value={mcpPaste}
                  onChange={(v) => { setMcpPaste(v); setMcpParseError(""); setMcpParsed(null); }}
                  placeholder={`Paste anything — examples:\n\nnpx -y @modelcontextprotocol/server-github\n\n{"command":"uvx","args":["mcp-server-git"]}\n\nhttps://mcp.example.com/sse\n\nor a Claude Desktop mcpServers snippet…`}
                  rows={6}
                />
                {mcpParseError && (
                  <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertCircle size={12} />{mcpParseError}</p>
                )}

                {/* Parsed preview */}
                {mcpParsed && (
                  <div className="bg-gray-800/60 border border-indigo-800/40 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-green-400 flex-none" />
                      <p className="text-xs font-medium text-green-400">Parsed — review before adding</p>
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex gap-2">
                        <span className="text-gray-500 w-16 flex-none">Name</span>
                        <input
                          value={mcpParsed.name}
                          onChange={(e) => setMcpParsed((p: any) => ({ ...p, name: e.target.value }))}
                          title="Server name"
                          placeholder="server-name"
                          className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-gray-200 font-mono outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      {mcpParsed.transport === "sse" ? (
                        <div className="flex gap-2">
                          <span className="text-gray-500 w-16 flex-none">URL</span>
                          <input
                            value={mcpParsed.url}
                            onChange={(e) => setMcpParsed((p: any) => ({ ...p, url: e.target.value }))}
                            title="SSE endpoint URL"
                            placeholder="https://…"
                            className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-gray-200 font-mono outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <span className="text-gray-500 w-16 flex-none">Command</span>
                          <span className="font-mono text-gray-300">{mcpParsed.command} {(mcpParsed.args ?? []).join(" ")}</span>
                        </div>
                      )}
                      {mcpParsed.env && Object.keys(mcpParsed.env).length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <p className="text-gray-500">Env vars (fill in real values before saving):</p>
                          {Object.entries(mcpParsed.env).map(([k, v]: [string, any]) => (
                            <div key={k} className="flex gap-2 items-center">
                              <span className="font-mono text-amber-400 w-40 flex-none truncate">{k}</span>
                              <input
                                value={mcpEditingEnv[k] ?? v}
                                onChange={(e) => {
                                  const updated = { ...mcpEditingEnv, [k]: e.target.value };
                                  setMcpEditingEnv(updated);
                                  setMcpParsed((p: any) => ({ ...p, env: { ...p.env, [k]: e.target.value } }));
                                }}
                                title={k}
                                placeholder={String(v)}
                                className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-0.5 text-gray-200 font-mono outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end pt-1">
                      <button
                        onClick={async () => {
                          const r = await fetch(`/api/agents/${agent.id}/mcp/${mcpParsed.name}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(mcpParsed),
                          });
                          if (r.ok) {
                            setMcpServers((prev) => ({ ...prev, [mcpParsed.name]: mcpParsed }));
                            setMcpParsed(null);
                            setMcpPaste("");
                            setMcpEditingEnv({});
                            qc.invalidateQueries({ queryKey: ["agent-config", agent.id] });
                          }
                        }}
                        className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Plus size={12} /> Add to agent
                      </button>
                    </div>
                  </div>
                )}

                {!mcpParsed && (
                  <div className="flex justify-end">
                    <button
                      disabled={mcpParsing || !mcpPaste.trim()}
                      onClick={async () => {
                        setMcpParsing(true);
                        setMcpParseError("");
                        try {
                          const r = await fetch(`/api/agents/${agent.id}/mcp/parse`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ raw: mcpPaste }),
                          });
                          if (!r.ok) {
                            const d = await r.json().catch(() => ({}));
                            throw new Error(d.detail ?? "Parse failed");
                          }
                          const parsed = await r.json();
                          setMcpParsed(parsed);
                          setMcpEditingEnv({});
                        } catch (e: any) {
                          setMcpParseError(e.message ?? "Parse failed");
                        } finally {
                          setMcpParsing(false);
                        }
                      }}
                      className="flex items-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition-colors"
                    >
                      {mcpParsing ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                      Parse &amp; Preview
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Skills ── */}
          {tab === "skills" && (
            <SkillPickerTab
              agentId={agent.id}
              globalSkills={globalSkills}
              agentSkillConfigs={agentSkillConfigs}
              isLoading={skillsLoading}
              qc={qc}
            />
          )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-800 flex items-center justify-between flex-none">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {save.isError && (
              <span className="text-xs text-red-400 max-w-xs truncate">{(save.error as Error)?.message}</span>
            )}
            {(tab === "overview" || tab === "models" || tab === "channels" || tab === "budget") && (
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending || isLoading}
                className="flex items-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-1.5 rounded-lg transition-colors"
              >
                {save.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {saved ? "Saved!" : "Save changes"}
              </button>
            )}
            {(tab === "skills" || tab === "a2a" || tab === "mcp" || tab === "prompts") && (
              <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-200 px-4 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">Close</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

