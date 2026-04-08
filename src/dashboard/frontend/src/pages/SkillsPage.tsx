import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import {
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  LogIn,
  Puzzle,
  Save,
  Trash2,
  Upload,
  X,
  XCircle,
} from "lucide-react";

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchWorkspaceSkills(agentId: string) {
  const res = await fetch(`/api/skills?agent_id=${agentId}`);
  if (!res.ok) throw new Error("Failed to fetch skills");
  return res.json();
}

async function fetchGlobalSkills() {
  const res = await fetch("/api/skill-config/global-skills");
  if (!res.ok) throw new Error("Failed to fetch global skills");
  return res.json();
}

async function fetchSkillSettings(skillName: string, agentId: string) {
  const res = await fetch(`/api/skills/${skillName}/settings?agent_id=${agentId}`);
  if (!res.ok) throw new Error("Failed to fetch skill settings");
  return res.json();
}

async function fetchAgentSkills(agentId: string): Promise<string[]> {
  const res = await fetch(`/api/agents/${agentId}/skills`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.skills ?? [];
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CredentialSpec {
  description?: string;
  env_file?: string;
  file?: string;
  key?: string;
  readonly?: boolean;
}

interface ProjectConfig {
  repo?: string;
  repo_url?: string;
  github_pat?: string;
  contact_channel?: string;
  channel?: string;
  staging_url?: string;
  prod_url?: string;
  notes?: string;
  [key: string]: any;
}

interface WaGroup {
  jid: string;
  name?: string;
  participants?: number;
}

interface ProjectBindingsSpec {
  type: "project_bindings";
  description?: string;
  file: string;
  channels: string[];
  projects: Record<string, ProjectConfig>;
  available_groups: Record<string, WaGroup[]>;
}

interface SkillMeta {
  slug: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  scripts?: string[];
  credentials?: Record<string, CredentialSpec>;
  settings?: Record<string, ProjectBindingsSpec>;
}
// ── GitHub login action field ────────────────────────────────────────────

function GhLoginField({
  skillName,
  agentId,
  credKey,
  spec,
  currentValue,
  onTokenSaved,
}: {
  skillName: string;
  agentId: string;
  credKey: string;
  spec: CredentialSpec;
  currentValue: string;
  onTokenSaved: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenLogin, setTokenLogin] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Verify token on mount and after successful login
  const verify = async () => {
    if (!currentValue) { setTokenValid(null); return; }
    try {
      const resp = await fetch(
        `/api/skills/${skillName}/credentials/${credKey}/verify?agent_id=${agentId}`
      );
      const data = await resp.json();
      setTokenValid(data.valid);
      setTokenLogin(data.login ?? null);
    } catch {
      setTokenValid(null);
    }
  };

  useEffect(() => { verify(); }, [currentValue]);  // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setLines([]);
    setDone(false);
    setExitCode(null);
    setRunning(true);
    try {
      const resp = await fetch(
        `/api/skills/${skillName}/actions/gh-login?agent_id=${agentId}`
      );
      if (!resp.ok || !resp.body) throw new Error(await resp.text());
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const text = part.replace(/^data:\s?/, "").trim();
          if (!text) continue;
          const m = text.match(/^\[exit:(\d+)\]$/);
          if (m) {
            setExitCode(parseInt(m[1]));
            setDone(true);
            if (parseInt(m[1]) === 0) { onTokenSaved(); verify(); }
          } else {
            setLines((prev) => [...prev, text]);
          }
        }
      }
    } catch (e: any) {
      setLines((prev) => [...prev, `ERROR: ${e.message}`]);
    } finally {
      setRunning(false);
    }
  };

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const tokenPreview = currentValue
    ? currentValue.slice(0, 8) + "…" + currentValue.slice(-4)
    : null;

  return (
    <div>
      <div className="mb-1">
        <span className="text-sm font-medium text-gray-300">{credKey}</span>
        {spec.description && (
          <p className="text-xs text-gray-500 mt-0.5">{spec.description}</p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={start}
          disabled={running}
          className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-gray-300 transition-colors disabled:opacity-60"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
          {running ? "Authenticating…" : "Login with GitHub"}
        </button>
        {tokenPreview && (
          <span className="text-xs font-mono flex items-center gap-1.5">
            {tokenValid === true ? (
              <span className="flex items-center gap-1 text-green-400">
                <CheckCircle size={13} />
                {tokenLogin ? `@${tokenLogin}` : tokenPreview}
              </span>
            ) : tokenValid === false ? (
              <span className="flex items-center gap-1 text-red-400">
                <XCircle size={13} />
                {tokenPreview} — invalid
              </span>
            ) : (
              <span className="text-gray-500">Current: {tokenPreview}</span>
            )}
            {done && exitCode === 0 && (
              <span className="text-green-400">✓ saved</span>
            )}
          </span>
        )}
      </div>
      {(running || lines.length > 0) && (
        <div
          ref={scrollRef}
          className="mt-2 bg-black rounded p-2 max-h-48 overflow-y-auto text-xs font-mono text-gray-400 border border-gray-800"
        >
          {lines.map((l, i) => (
            <div key={i} className={l.startsWith("ERROR") ? "text-red-400" : ""}>{l}</div>
          ))}
          {running && <div className="animate-pulse text-gray-600">_</div>}
          {done && (
            <div className={exitCode === 0 ? "text-green-400" : "text-red-400"}>
              {exitCode === 0 ? "✓ Authentication complete" : `✗ Exited with code ${exitCode}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// ── Credential field renderer ─────────────────────────────────────────────────

function CredentialField({
  credKey,
  spec,
  value,
  onChange,
}: {
  credKey: string;
  spec: CredentialSpec;
  value: string;
  onChange: (v: string) => void;
}) {
  const isJson = spec.file?.endsWith(".json");
  const isYaml = spec.file?.endsWith(".yml") || spec.file?.endsWith(".yaml");
  const isEnv = !!spec.env_file;

  const label = (
    <div className="mb-1">
      <span className="text-sm font-medium text-gray-300">{credKey}</span>
      {spec.description && (
        <p className="text-xs text-gray-500 mt-0.5">{spec.description}</p>
      )}
      {spec.env_file && (
        <p className="text-xs text-gray-600 mt-0.5 font-mono">{spec.env_file}</p>
      )}
      {spec.file && (
        <p className="text-xs text-gray-600 mt-0.5 font-mono">{spec.file}</p>
      )}
    </div>
  );

  if (isEnv && !isJson && !isYaml) {
    return (
      <div>
        {label}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${credKey}...`}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        />
      </div>
    );
  }

  // Textarea for YAML, JSON, or multi-line env files
  return (
    <div>
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={isJson ? 8 : 5}
        placeholder={isJson ? '{"example": "value"}' : isYaml ? "key: value" : ""}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-y"
      />
    </div>
  );
}

// ── Project bindings field ───────────────────────────────────────────────────

function ProjectBindingsField({
  spec,
  value,
  onChange,
}: {
  spec: ProjectBindingsSpec;
  value: Record<string, ProjectConfig>;
  onChange: (v: Record<string, ProjectConfig>) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const allGroups = spec.available_groups ?? {};

  const update = (key: string, patch: Partial<ProjectConfig>) => {
    onChange({ ...value, [key]: { ...value[key], ...patch } });
  };

  const addProject = () => {
    const label = `project_${Object.keys(value).length + 1}`;
    onChange({ ...value, [label]: { channel: "whatsapp", contact_channel: "" } });
    setExpanded((prev) => ({ ...prev, [label]: true }));
  };

  const removeProject = (key: string) => {
    const next = { ...value };
    delete next[key];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {Object.entries(value).map(([key, config]) => {
        const channel =
          config.channel ??
          (allGroups.whatsapp?.some((g) => g.jid === config.contact_channel) ? "whatsapp" : "direct");
        const groups: WaGroup[] = allGroups[channel] ?? [];
        const isExpanded = expanded[key];

        return (
          <div key={key} className="bg-gray-800 rounded-lg border border-gray-700">
            <div className="flex items-center gap-2 px-3 py-2">
              <input
                type="text"
                value={key}
                onChange={(e) => {
                  const newKey = e.target.value;
                  const next = Object.fromEntries(
                    Object.entries(value).map(([k, v]) => [k === key ? newKey : k, v])
                  );
                  onChange(next);
                }}
                className="w-24 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 font-mono focus:outline-none focus:border-indigo-500"
              />
              <select
                value={channel}
                onChange={(e) => update(key, { channel: e.target.value, contact_channel: "" })}
                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
              >
                {[...(spec.channels ?? ["whatsapp"]), "direct"].map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </select>
              {groups.length > 0 ? (
                <select
                  value={config.contact_channel ?? ""}
                  onChange={(e) => update(key, { contact_channel: e.target.value })}
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">-- select group --</option>
                  {groups.map((g) => (
                    <option key={g.jid} value={g.jid}>{g.name ?? g.jid}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={config.contact_channel ?? ""}
                  onChange={(e) => update(key, { contact_channel: e.target.value })}
                  placeholder="contact id"
                  className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 font-mono placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
              )}
              <button
                onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
                className="text-gray-500 hover:text-gray-300 p-0.5"
                title="More fields"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <button
                onClick={() => removeProject(key)}
                className="text-gray-600 hover:text-red-400 p-0.5"
                title="Remove project"
              >
                <X size={14} />
              </button>
            </div>

            {isExpanded && (
              <div className="px-3 pb-3 space-y-2 border-t border-gray-700 pt-2">
                {(["repo", "repo_url"] as const).map((fld) => (
                  <div key={fld} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-32 flex-none">{fld === "repo" ? "Repository" : "Repo URL"}</span>
                    <input
                      type="text"
                      value={config[fld] ?? ""}
                      onChange={(e) => update(key, { [fld]: e.target.value })}
                      className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-32 flex-none">GitHub PAT</span>
                  <input
                    type="password"
                    value={config.github_pat ?? ""}
                    onChange={(e) => update(key, { github_pat: e.target.value })}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 font-mono focus:outline-none focus:border-indigo-500"
                  />
                </div>
                {(["staging_url", "prod_url"] as const).map((fld) => (
                  <div key={fld} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 w-32 flex-none">{fld === "staging_url" ? "Staging URL" : "Prod URL"}</span>
                    <input
                      type="text"
                      value={config[fld] ?? ""}
                      onChange={(e) => update(key, { [fld]: e.target.value })}
                      className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 font-mono focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                ))}
                <div className="flex items-start gap-2">
                  <span className="text-xs text-gray-500 w-32 flex-none pt-1">Notes</span>
                  <textarea
                    value={config.notes ?? ""}
                    onChange={(e) => update(key, { notes: e.target.value })}
                    rows={2}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 font-mono focus:outline-none focus:border-indigo-500 resize-y"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={addProject}
        className="w-full py-1.5 border border-dashed border-gray-700 rounded text-xs text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors"
      >
        + Add project
      </button>
    </div>
  );
}

// ── Skill detail panel ────────────────────────────────────────────────────────

const ALL_AGENTS = ["maya", "research"];

function AgentSkillToggle({
  agentId,
  skillSlug,
}: {
  agentId: string;
  skillSlug: string;
}) {
  const qc = useQueryClient();

  const { data: assignedSkills } = useQuery<string[]>({
    queryKey: ["agent-skills", agentId],
    queryFn: () => fetchAgentSkills(agentId),
  });

  const isAssigned = assignedSkills?.includes(skillSlug) ?? false;

  const toggle = useMutation({
    mutationFn: async () => {
      const current = assignedSkills ?? [];
      const next = isAssigned
        ? current.filter((s) => s !== skillSlug)
        : [...current, skillSlug];
      const res = await fetch(`/api/agents/${agentId}/skills`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: next }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
    },
  });

  return (
    <button
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ${
        isAssigned
          ? "bg-indigo-700 text-white"
          : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
      }`}
    >
      {isAssigned && <Check size={12} />}
      {agentId}
    </button>
  );
}

function SkillPanel({
  skill,
  agentId,
  onClose,
  onDelete,
}: {
  skill: SkillMeta;
  agentId: string;
  onClose: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [localSettings, setLocalSettings] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);

  const { data: settingsData, isLoading: loadingSettings } = useQuery<{
    credentials: Record<string, CredentialSpec>;
    values: Record<string, string>;
    settings: Record<string, ProjectBindingsSpec>;
  }>({
    queryKey: ["skill-settings", skill.slug, agentId],
    queryFn: () => fetchSkillSettings(skill.slug, agentId),
  });

  // Populate form when data loads
  useEffect(() => {
    if (settingsData?.values) {
      setLocalValues(settingsData.values);
    }
    if (settingsData?.settings) {
      const init: Record<string, any> = {};
      for (const [k, spec] of Object.entries(settingsData.settings)) {
        if (spec.type === "project_bindings") {
          init[k] = spec.projects ?? {};
        }
      }
      setLocalSettings(init);
    }
  }, [settingsData]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/skills/${skill.slug}/settings?agent_id=${agentId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: localValues, settings: localSettings }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? "Save failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["skill-settings", skill.slug, agentId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/skills/${skill.slug}?agent_id=${agentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills", agentId] });
      onDelete();
      onClose();
    },
  });

  const credentials: Record<string, CredentialSpec> =
    settingsData?.credentials ?? skill.credentials ?? {};

  const hasCredentials = Object.keys(credentials).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 h-full w-full max-w-lg bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 flex-none">
          <div>
            <p className="font-semibold text-white">{skill.name ?? skill.slug}</p>
            {skill.version && (
              <p className="text-xs text-gray-500 mt-0.5">v{skill.version}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="text-red-500 hover:text-red-400 p-1 rounded hover:bg-gray-800"
              title="Delete skill"
            >
              <Trash2 size={16} />
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-gray-800"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {skill.description && (
            <p className="text-sm text-gray-400">{skill.description}</p>
          )}

          {/* Agent assignment */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
              Assign to agents
            </p>
            <div className="flex flex-wrap gap-2">
              {ALL_AGENTS.map((a) => (
                <AgentSkillToggle key={a} agentId={a} skillSlug={skill.slug} />
              ))}
            </div>
          </div>

          {/* Scripts */}
          {skill.scripts && skill.scripts.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                Scripts
              </p>
              <div className="flex flex-wrap gap-2">
                {skill.scripts.map((s) => (
                  <span
                    key={s}
                    className="bg-gray-800 text-gray-400 text-xs font-mono px-2 py-1 rounded"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Credentials */}
          {loadingSettings ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader2 size={14} className="animate-spin" />
              Loading settings...
            </div>
          ) : hasCredentials ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
                Credentials &amp; Configuration
              </p>
              <div className="space-y-4">
                {Object.entries(credentials).map(([key, spec]) =>
                  spec.readonly ? (
                    <GhLoginField
                      key={key}
                      skillName={skill.slug}
                      agentId={agentId}
                      credKey={key}
                      spec={spec}
                      currentValue={localValues[key] ?? ""}
                      onTokenSaved={() =>
                        qc.invalidateQueries({ queryKey: ["skill-settings", skill.slug, agentId] })
                      }
                    />
                  ) : (
                    <CredentialField
                      key={key}
                      credKey={key}
                      spec={spec}
                      value={localValues[key] ?? ""}
                      onChange={(v) =>
                        setLocalValues((prev) => ({ ...prev, [key]: v }))
                      }
                    />
                  )
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600">No credentials required.</p>
          )}

          {/* Settings fields (e.g. project_bindings) */}
          {settingsData?.settings && Object.entries(settingsData.settings).map(([fieldKey, spec]) => {
            if (spec.type !== "project_bindings") return null;
            return (
              <div key={fieldKey}>
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                  Project Bindings
                </p>
                {spec.description && (
                  <p className="text-xs text-gray-600 mb-3">{spec.description}</p>
                )}
                <ProjectBindingsField
                  spec={spec}
                  value={localSettings[fieldKey] ?? spec.projects ?? {}}
                  onChange={(v) =>
                    setLocalSettings((prev) => ({ ...prev, [fieldKey]: v }))
                  }
                />
              </div>
            );
          })}

          {saveMutation.isError && (
            <p className="text-sm text-red-400">
              Error: {(saveMutation.error as Error).message}
            </p>
          )}
        </div>

        {/* Footer */}
        {(hasCredentials || Object.keys(settingsData?.settings ?? {}).length > 0) && (
          <div className="flex-none px-5 py-4 border-t border-gray-800">
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || saved}
              className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors ${
                saved
                  ? "bg-green-700 text-green-100"
                  : "bg-indigo-600 hover:bg-indigo-500 text-white"
              } disabled:opacity-60`}
            >
              {saveMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Save size={14} />
              )}
              {saved ? "Saved!" : "Save Settings"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Upload button ─────────────────────────────────────────────────────────────

function UploadSkillButton({
  agentId,
  endpoint,
  label,
  accept,
}: {
  agentId: string;
  endpoint: string;
  label: string;
  accept?: string;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${endpoint}?agent_id=${agentId}&overwrite=true`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? "Upload failed");
      }
      qc.invalidateQueries({ queryKey: ["skills", agentId] });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="file"
        accept={accept ?? ".zip"}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded text-sm text-gray-300 transition-colors disabled:opacity-60"
      >
        {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
        {label}
      </button>
      {error && (
        <p className="absolute top-full mt-1 left-0 text-xs text-red-400 whitespace-nowrap z-10 bg-gray-900 border border-red-800 rounded px-2 py-1">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const [agentId, setAgentId] = useState("maya");
  const [selectedSkill, setSelectedSkill] = useState<SkillMeta | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["skills", agentId],
    queryFn: () => fetchWorkspaceSkills(agentId),
  });

  const { data: libraryData } = useQuery({
    queryKey: ["global-skills"],
    queryFn: fetchGlobalSkills,
    staleTime: 30000,
  });

  const globalSkills: { name: string; display_name: string; description: string; version?: string; agent_count: number }[] = libraryData?.skills ?? [];

  const skills: SkillMeta[] = data?.skills ?? [];

  return (
    <div className="p-6 h-full">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Puzzle size={20} className="text-indigo-400" />
          <h1 className="text-xl font-semibold text-white">Skills</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Agent selector */}
          <div className="relative">
            <select
              value={agentId}
              onChange={(e) => {
                setAgentId(e.target.value);
                setSelectedSkill(null);
              }}
              className="bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded px-3 py-2 pr-8 appearance-none focus:outline-none focus:border-indigo-500"
            >
              {ALL_AGENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          </div>

          {/* Upload buttons */}
          <UploadSkillButton
            agentId={agentId}
            endpoint="/api/skills/upload"
            label="Upload skill"
          />
          <UploadSkillButton
            agentId={agentId}
            endpoint="/api/skills/import-openclaw"
            label="Import OpenClaw"
          />
        </div>
      </div>

      {/* ── Global library ── */}
      {globalSkills.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
            Global Library
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {globalSkills.map((s) => (
              <div
                key={s.name}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-1"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Puzzle size={14} className="text-indigo-400 flex-none mt-0.5" />
                    <span className="text-sm font-medium text-white">{s.display_name}</span>
                  </div>
                  {s.version && (
                    <span className="text-xs text-gray-600 font-mono flex-none">v{s.version}</span>
                  )}
                </div>
                {s.description && (
                  <p className="text-xs text-gray-500 line-clamp-2 pl-5">{s.description}</p>
                )}
                <p className="text-xs text-gray-600 pl-5">
                  {s.agent_count === 0
                    ? "Not enabled for any agent"
                    : `Enabled for ${s.agent_count} agent${s.agent_count !== 1 ? "s" : ""}`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Installed skills (per agent) ── */}
      <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
        Installed for {agentId}
      </h2>

      {/* Skill grid */}
      {isLoading && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 size={16} className="animate-spin" />
          Loading skills...
        </div>
      )}

      {isError && (
        <p className="text-red-400 text-sm">Failed to load skills.</p>
      )}

      {!isLoading && !isError && skills.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-gray-600">
          <Puzzle size={40} className="mb-3 opacity-30" />
          <p className="text-sm">No skills installed for {agentId}.</p>
          <p className="text-xs mt-1">Upload a skill ZIP to get started.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {skills.map((skill) => {
          const credCount = Object.keys(skill.credentials ?? {}).length;
          return (
            <button
              key={skill.slug}
              onClick={() => setSelectedSkill(skill)}
              className="text-left bg-gray-900 border border-gray-800 hover:border-indigo-600 rounded-xl p-4 transition-colors group"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Puzzle size={16} className="text-indigo-400 flex-none" />
                  <span className="font-medium text-white text-sm">
                    {skill.name ?? skill.slug}
                  </span>
                </div>
                {skill.version && (
                  <span className="text-xs text-gray-600 font-mono">
                    v{skill.version}
                  </span>
                )}
              </div>

              {skill.description && (
                <p className="text-xs text-gray-400 line-clamp-2 mb-3">
                  {skill.description}
                </p>
              )}

              <div className="flex items-center gap-3 text-xs text-gray-600">
                {skill.scripts && skill.scripts.length > 0 && (
                  <span>{skill.scripts.length} script{skill.scripts.length !== 1 ? "s" : ""}</span>
                )}
                {credCount > 0 && (
                  <span className="text-yellow-600">
                    {credCount} credential{credCount !== 1 ? "s" : ""}
                  </span>
                )}
                <ChevronRight
                  size={12}
                  className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-indigo-400"
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail panel */}
      {selectedSkill && (
        <SkillPanel
          skill={selectedSkill}
          agentId={agentId}
          onClose={() => setSelectedSkill(null)}
          onDelete={() => setSelectedSkill(null)}
        />
      )}
    </div>
  );
}
