import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useOrg } from "../OrgContext";

const API = "/api/costs";

async function fetchSummary() {
  const res = await fetch(`${API}/summary`);
  if (!res.ok) throw new Error("Failed to fetch summary");
  return res.json() as Promise<AgentSummary[]>;
}

interface LedgerItem {
  id: string;
  agent_id: string;
  org_id: string;
  division: string;
  model: string;
  provider: string;
  thread_id: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  routed_from: string | null;
  primary_cost_usd: number | null;
  timestamp: string;
}

interface LedgerPage {
  total: number;
  page: number;
  page_size: number;
  items: LedgerItem[];
}

async function fetchLedger(params: Record<string, string | number | null | undefined>): Promise<LedgerPage> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  }
  const res = await fetch(`${API}/ledger?${p}`);
  if (!res.ok) throw new Error("Failed to fetch ledger");
  return res.json();
}

function LedgerPanel() {
  const { activeOrg } = useOrg();
  const [agentFilter, setAgentFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["costs-ledger", activeOrg, agentFilter, modelFilter, page],
    queryFn: () => fetchLedger({ org_id: activeOrg, agent_id: agentFilter || null, model: modelFilter || null, page, page_size: PAGE_SIZE }),
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const totalCost = items.reduce((s, r) => s + r.cost_usd, 0);
  const totalIn = items.reduce((s, r) => s + r.input_tokens, 0);
  const totalOut = items.reduce((s, r) => s + r.output_tokens, 0);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          value={agentFilter}
          onChange={(e) => { setAgentFilter(e.target.value); setPage(1); }}
          placeholder="Filter by agent…"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-600 w-48"
        />
        <input
          value={modelFilter}
          onChange={(e) => { setModelFilter(e.target.value); setPage(1); }}
          placeholder="Filter by model…"
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-gray-600 w-48"
        />
        {(agentFilter || modelFilter) && (
          <button onClick={() => { setAgentFilter(""); setModelFilter(""); setPage(1); }}
            className="text-xs text-gray-500 hover:text-gray-300 px-2">Clear</button>
        )}
        <span className="ml-auto text-xs text-gray-500 self-center">{total.toLocaleString()} transactions</span>
      </div>

      {/* Page totals — always visible */}
      {!isLoading && (
        <div className="flex gap-6 text-xs text-gray-400 bg-gray-800/40 px-4 py-2 rounded-lg">
          <span>Page total: <span className="font-mono text-yellow-300">${totalCost.toFixed(6)}</span></span>
          <span>Tokens in: <span className="font-mono">{totalIn.toLocaleString()}</span></span>
          <span>Tokens out: <span className="font-mono">{totalOut.toLocaleString()}</span></span>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Agent</th>
                <th className="pb-2 pr-4">Model</th>
                <th className="pb-2 pr-4">Thread</th>
                <th className="pb-2 pr-4 text-right">Tokens In</th>
                <th className="pb-2 pr-4 text-right">Tokens Out</th>
                <th className="pb-2 pr-4 text-right">Cost (USD)</th>
                <th className="pb-2 text-right">Savings</th>
              </tr>
            </thead>
          </table>
          <p className="text-gray-500 text-sm py-8 text-center">No transactions recorded yet. Transactions appear here after each LLM call.</p>
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Agent</th>
                <th className="pb-2 pr-4">Model</th>
                <th className="pb-2 pr-4">Thread</th>
                <th className="pb-2 pr-4 text-right">Tokens In</th>
                <th className="pb-2 pr-4 text-right">Tokens Out</th>
                <th className="pb-2 pr-4 text-right">Cost (USD)</th>
                <th className="pb-2 text-right">Savings</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const savings = r.primary_cost_usd != null ? Math.max(0, r.primary_cost_usd - r.cost_usd) : null;
                return (
                  <tr key={r.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                    <td className="py-1.5 pr-4 text-gray-500 whitespace-nowrap">
                      {new Date(r.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td className="py-1.5 pr-4 font-medium text-gray-200">{r.agent_id}</td>
                    <td className="py-1.5 pr-4 font-mono text-gray-400 max-w-[160px] truncate" title={r.model}>
                      {r.routed_from ? (
                        <span className="text-emerald-400" title={`Routed from ${r.routed_from}`}>{r.model} ↩</span>
                      ) : r.model}
                    </td>
                    <td className="py-1.5 pr-4 font-mono text-gray-600 max-w-[100px] truncate" title={r.thread_id}>
                      {r.thread_id ? r.thread_id.slice(0, 8) + "…" : "—"}
                    </td>
                    <td className="py-1.5 pr-4 text-right font-mono">{r.input_tokens.toLocaleString()}</td>
                    <td className="py-1.5 pr-4 text-right font-mono">{r.output_tokens.toLocaleString()}</td>
                    <td className="py-1.5 pr-4 text-right font-mono text-yellow-300">${r.cost_usd.toFixed(6)}</td>
                    <td className="py-1.5 text-right font-mono">
                      {savings != null && savings > 0 ? (
                        <span className="text-emerald-400">-${savings.toFixed(6)}</span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination — always visible */}
      {!isLoading && (
        <div className="flex items-center justify-between pt-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-30">
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-30">
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}


async function fetchBreakdown(groupBy: string) {
  const res = await fetch(`${API}/breakdown?group_by=${groupBy}`);
  if (!res.ok) throw new Error("Failed to fetch breakdown");
  return res.json() as Promise<BreakdownRow[]>;
}

async function fetchSavings() {
  const res = await fetch(`${API}/savings`);
  if (!res.ok) throw new Error("Failed to fetch savings");
  return res.json() as Promise<SavingsRow[]>;
}

async function fetchAlerts() {
  const res = await fetch(`${API}/alerts`);
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json() as Promise<AlertRow[]>;
}

interface AgentSummary {
  agent_id: string;
  daily_cost: number;
  monthly_cost: number;
  budget_limit: number | null;
  budget_remaining: number | null;
  projected_eom: number;
  routing_savings_mtd: number;
}

interface BreakdownRow {
  model?: string;
  division?: string;
  call_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  pct_of_spend: number;
}

interface SavingsRow {
  agent_id: string;
  primary_cost_sum: number;
  actual_cost_sum: number;
  savings_usd: number;
  savings_pct: number;
}

interface AlertRow {
  id: string;
  agent_id: string | null;
  division: string | null;
  threshold_pct: number;
  window: string;
  channels: string[] | null;
  last_fired_at: string | null;
}

function SpendGauge({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    clamped >= 90 ? "bg-red-500" : clamped >= 80 ? "bg-yellow-400" : "bg-emerald-500";
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>Budget used</span>
        <span>{clamped.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function SummaryCards({ rows }: { rows: AgentSummary[] }) {
  return (
    <div className="grid gap-4 mb-8" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {rows.map((r) => {
        const pct =
          r.budget_limit && r.budget_limit > 0
            ? (r.monthly_cost / r.budget_limit) * 100
            : 0;
        return (
          <div key={r.agent_id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.agent_id}</span>
              {r.routing_savings_mtd > 0 && (
                <span className="text-xs bg-emerald-900/50 text-emerald-400 px-2 py-0.5 rounded-full">
                  saves ${r.routing_savings_mtd.toFixed(3)}
                </span>
              )}
            </div>
            {r.budget_limit && <SpendGauge pct={pct} />}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-gray-400 text-xs">Monthly</p>
                <p className="font-mono text-yellow-300">${r.monthly_cost.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">Projected EOM</p>
                <p className="font-mono">${r.projected_eom.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">Daily</p>
                <p className="font-mono text-xs">${r.daily_cost.toFixed(4)}</p>
              </div>
              <div>
                <p className="text-gray-400 text-xs">Remaining</p>
                <p className={`font-mono text-xs ${r.budget_remaining !== null && r.budget_remaining < 0 ? "text-red-400" : ""}`}>
                  {r.budget_remaining !== null ? `$${r.budget_remaining.toFixed(4)}` : "—"}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownTable({ rows, groupBy }: { rows: BreakdownRow[]; groupBy: string }) {
  if (!rows.length) return <p className="text-gray-500 text-sm">No data.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-800">
            <th className="pb-2 pr-6">{groupBy === "model" ? "Model" : "Division"}</th>
            <th className="pb-2 pr-6">Calls</th>
            <th className="pb-2 pr-6">Tokens In</th>
            <th className="pb-2 pr-6">Tokens Out</th>
            <th className="pb-2 pr-6">Cost (USD)</th>
            <th className="pb-2">% of Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="py-2 pr-6 font-mono text-xs">{r.model ?? r.division ?? "—"}</td>
              <td className="py-2 pr-6">{r.call_count}</td>
              <td className="py-2 pr-6 font-mono text-xs">{r.input_tokens?.toLocaleString()}</td>
              <td className="py-2 pr-6 font-mono text-xs">{r.output_tokens?.toLocaleString()}</td>
              <td className="py-2 pr-6 font-mono text-yellow-300">${r.cost_usd.toFixed(6)}</td>
              <td className="py-2">
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.min(100, r.pct_of_spend)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">{r.pct_of_spend.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavingsPanel({ rows }: { rows: SavingsRow[] }) {
  if (!rows.length) return <p className="text-gray-500 text-sm">No routing savings data yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-400 border-b border-gray-800">
            <th className="pb-2 pr-6">Agent</th>
            <th className="pb-2 pr-6">Primary Cost</th>
            <th className="pb-2 pr-6">Actual Cost</th>
            <th className="pb-2 pr-6">Saved (USD)</th>
            <th className="pb-2">Saved (%)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.agent_id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
              <td className="py-2 pr-6">{r.agent_id}</td>
              <td className="py-2 pr-6 font-mono text-xs">${r.primary_cost_sum.toFixed(4)}</td>
              <td className="py-2 pr-6 font-mono text-xs">${r.actual_cost_sum.toFixed(4)}</td>
              <td className="py-2 pr-6 font-mono text-emerald-400">${r.savings_usd.toFixed(4)}</td>
              <td className="py-2 font-mono text-emerald-400">{r.savings_pct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertsPanel() {
  const qc = useQueryClient();
  const { data: alerts = [], isLoading } = useQuery({ queryKey: ["cost-alerts"], queryFn: fetchAlerts });

  const [form, setForm] = useState({
    agent_id: "",
    threshold_pct: "80",
    window: "month",
    channels: "email",
  });

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`${API}/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create alert");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-alerts"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/alerts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete alert");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cost-alerts"] }),
  });

  const handleCreate = () => {
    createMutation.mutate({
      agent_id: form.agent_id || null,
      threshold_pct: parseFloat(form.threshold_pct),
      window: form.window,
      channels: form.channels ? form.channels.split(",").map((s) => s.trim()) : [],
    });
  };

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-medium mb-3">Add Alert</h3>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs text-gray-400">Agent ID (optional)</label>
            <input
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
              value={form.agent_id}
              onChange={(e) => setForm({ ...form, agent_id: e.target.value })}
              placeholder="all agents"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Threshold %</label>
            <input
              type="number"
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
              value={form.threshold_pct}
              onChange={(e) => setForm({ ...form, threshold_pct: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400">Window</label>
            <select
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
              value={form.window}
              onChange={(e) => setForm({ ...form, window: e.target.value })}
            >
              <option value="month">Month</option>
              <option value="day">Day</option>
              <option value="week">Week</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400">Channels (comma-separated)</label>
            <input
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
              value={form.channels}
              onChange={(e) => setForm({ ...form, channels: e.target.value })}
              placeholder="email, telegram"
            />
          </div>
        </div>
        <button
          onClick={handleCreate}
          disabled={createMutation.isPending}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-1.5 rounded"
        >
          {createMutation.isPending ? "Saving…" : "Add Alert"}
        </button>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Loading alerts…</p>}
      {!isLoading && alerts.length === 0 && (
        <p className="text-gray-500 text-sm">No alerts configured.</p>
      )}
      <div className="space-y-2">
        {alerts.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-lg px-4 py-2"
          >
            <div className="text-sm">
              <span className="font-medium">{a.agent_id ?? "all agents"}</span>
              <span className="text-gray-400"> — alert at </span>
              <span className="text-yellow-300">{a.threshold_pct}%</span>
              <span className="text-gray-500 ml-2 text-xs">({a.window})</span>
              {a.last_fired_at && (
                <span className="text-gray-500 text-xs ml-2">
                  last fired: {new Date(a.last_fired_at).toLocaleString()}
                </span>
              )}
            </div>
            <button
              onClick={() => deleteMutation.mutate(a.id)}
              className="text-red-400 hover:text-red-300 text-xs ml-4"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const COST_TABS = ["Overview", "Transactions"] as const;
type CostTab = (typeof COST_TABS)[number];

export default function CostsPage() {
  const [tab, setTab] = useState<CostTab>("Overview");
  const [groupBy, setGroupBy] = useState<"model" | "division">("model");

  const { data: summary = [], isLoading: loadingSummary } = useQuery({
    queryKey: ["costs-summary"],
    queryFn: fetchSummary,
  });
  const { data: breakdown = [], isLoading: loadingBreakdown } = useQuery({
    queryKey: ["costs-breakdown", groupBy],
    queryFn: () => fetchBreakdown(groupBy),
  });
  const { data: savings = [], isLoading: loadingSavings } = useQuery({
    queryKey: ["costs-savings"],
    queryFn: fetchSavings,
  });

  return (
    <div className="p-6">
      {/* Header + tabs */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Cost Analytics</h1>
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {COST_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-sm px-4 py-1.5 rounded ${
                tab === t
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "Overview" && (
        <div className="space-y-8">
          {/* Summary Cards */}
          <section>
            <h2 className="text-lg font-medium mb-4">Agent Budget Summary</h2>
            {loadingSummary ? (
              <p className="text-gray-400 text-sm">Loading…</p>
            ) : summary.length === 0 ? (
              <p className="text-gray-500 text-sm">No cost data recorded yet.</p>
            ) : (
              <SummaryCards rows={summary} />
            )}
          </section>

          {/* Breakdown Table */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium">Cost Breakdown</h2>
              <div className="flex gap-2">
                {(["model", "division"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGroupBy(g)}
                    className={`text-xs px-3 py-1 rounded ${
                      groupBy === g
                        ? "bg-blue-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    By {g}
                  </button>
                ))}
              </div>
            </div>
            {loadingBreakdown ? (
              <p className="text-gray-400 text-sm">Loading…</p>
            ) : (
              <BreakdownTable rows={breakdown} groupBy={groupBy} />
            )}
          </section>

          {/* Routing Savings */}
          <section>
            <h2 className="text-lg font-medium mb-4">Routing Savings</h2>
            {loadingSavings ? (
              <p className="text-gray-400 text-sm">Loading…</p>
            ) : (
              <SavingsPanel rows={savings} />
            )}
          </section>

          {/* Alert Configuration */}
          <section>
            <h2 className="text-lg font-medium mb-4">Budget Alerts</h2>
            <AlertsPanel />
          </section>
        </div>
      )}

      {tab === "Transactions" && <LedgerPanel />}
    </div>
  );
}

