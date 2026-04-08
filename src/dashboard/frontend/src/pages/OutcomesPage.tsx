import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, Activity, Zap, RefreshCw } from "lucide-react";

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchSummary() {
  const res = await fetch("/api/outcomes/summary");
  if (!res.ok) throw new Error("Failed to fetch outcome summary");
  return res.json();
}

async function fetchRecent() {
  const res = await fetch("/api/outcomes/recent?limit=50");
  if (!res.ok) throw new Error("Failed to fetch recent outcomes");
  return res.json();
}

async function fetchArousal() {
  const res = await fetch("/api/outcomes/arousal");
  if (!res.ok) throw new Error("Failed to fetch arousal state");
  return res.json();
}

async function fetchRouting() {
  const res = await fetch("/api/outcomes/routing?limit=200");
  if (!res.ok) throw new Error("Failed to fetch routing outcomes");
  return res.json();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return iso; }
}

function ArousalBar({ score }: { score: number }) {
  const pctVal = Math.round(score * 100);
  const color =
    pctVal >= 75 ? "bg-red-500" :
    pctVal >= 60 ? "bg-yellow-500" :
    pctVal >= 20 ? "bg-green-500" : "bg-blue-400";
  const label =
    pctVal >= 75 ? "high" :
    pctVal >= 60 ? "elevated" :
    pctVal >= 20 ? "normal" : "idle";
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pctVal}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-12">{pctVal}%</span>
      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
        label === "high" ? "bg-red-900 text-red-300" :
        label === "elevated" ? "bg-yellow-900 text-yellow-300" :
        label === "normal" ? "bg-green-900 text-green-300" : "bg-blue-900 text-blue-300"
      }`}>{label}</span>
    </div>
  );
}

// ── Panels ─────────────────────────────────────────────────────────────────────

function SummaryPanel() {
  const { data, isLoading } = useQuery({ queryKey: ["outcome-summary"], queryFn: fetchSummary, refetchInterval: 15000 });

  if (isLoading) return <p className="text-gray-400 text-sm">Loading...</p>;
  if (!data?.length) return <p className="text-gray-400 text-sm">No outcomes recorded yet.</p>;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((row: any) => {
        const rate = pct(Number(row.succeeded), Number(row.total));
        const rateColor = rate >= 80 ? "text-green-400" : rate >= 50 ? "text-yellow-400" : "text-red-400";
        return (
          <div key={row.agent_id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium text-sm">{row.agent_id}</span>
              <span className={`text-2xl font-bold ${rateColor}`}>{rate}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full ${rate >= 80 ? "bg-green-500" : rate >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                style={{ width: `${rate}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-400">
              <div>
                <span className="text-gray-500">Total</span>
                <p className="text-gray-200 font-medium">{row.total}</p>
              </div>
              <div>
                <span className="text-gray-500">Succeeded</span>
                <p className="text-green-400 font-medium">{row.succeeded}</p>
              </div>
              <div>
                <span className="text-gray-500">Avg cost</span>
                <p className="text-gray-200 font-medium">${Number(row.avg_cost_usd ?? 0).toFixed(4)}</p>
              </div>
              <div>
                <span className="text-gray-500">Avg time</span>
                <p className="text-gray-200 font-medium">{Number(row.avg_duration_s ?? 0).toFixed(2)}s</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ArousalPanel() {
  const { data, isLoading } = useQuery({ queryKey: ["arousal"], queryFn: fetchArousal, refetchInterval: 10000 });

  if (isLoading) return <p className="text-gray-400 text-sm">Loading...</p>;
  if (!data?.length) return <p className="text-gray-400 text-sm">No arousal data yet. Cron updates every 5 minutes.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 text-xs border-b border-gray-700">
            <th className="pb-2 pr-4">Agent</th>
            <th className="pb-2 pr-4">Arousal</th>
            <th className="pb-2 pr-4">Idle (s)</th>
            <th className="pb-2 pr-4">Pressure</th>
            <th className="pb-2 pr-4">Unread</th>
            <th className="pb-2 pr-4">Recoveries 24h</th>
            <th className="pb-2">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {data.map((row: any) => (
            <tr key={row.agent_id} className="hover:bg-gray-800/50">
              <td className="py-2 pr-4 font-medium">{row.agent_id}</td>
              <td className="py-2 pr-4"><ArousalBar score={Number(row.last_arousal_score ?? 0)} /></td>
              <td className="py-2 pr-4 text-gray-400">{Math.round(Number(row.idle_seconds ?? 0))}</td>
              <td className="py-2 pr-4 text-gray-400">{row.pending_task_pressure ?? 0}</td>
              <td className="py-2 pr-4 text-gray-400">{row.unread_channel_messages ?? 0}</td>
              <td className="py-2 pr-4 text-gray-400">{row.recovery_event_count_24h ?? 0}</td>
              <td className="py-2 text-gray-500 text-xs">{fmt(row.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentOutcomesPanel() {
  const { data, isLoading } = useQuery({ queryKey: ["recent-outcomes"], queryFn: fetchRecent, refetchInterval: 10000 });

  if (isLoading) return <p className="text-gray-400 text-sm">Loading...</p>;
  if (!data?.length) return <p className="text-gray-400 text-sm">No outcomes yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 text-xs border-b border-gray-700">
            <th className="pb-2 pr-4">Agent</th>
            <th className="pb-2 pr-4">Result</th>
            <th className="pb-2 pr-4">Error</th>
            <th className="pb-2 pr-4">Cost</th>
            <th className="pb-2 pr-4">Time</th>
            <th className="pb-2 pr-4">Iters</th>
            <th className="pb-2">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {data.map((row: any, i: number) => (
            <tr key={i} className="hover:bg-gray-800/50">
              <td className="py-2 pr-4 font-medium">{row.agent_id}</td>
              <td className="py-2 pr-4">
                {row.succeeded
                  ? <span className="flex items-center gap-1 text-green-400"><CheckCircle size={12} /> ok</span>
                  : <span className="flex items-center gap-1 text-red-400"><XCircle size={12} /> fail</span>
                }
              </td>
              <td className="py-2 pr-4 text-xs text-gray-500">{row.error_class || "—"}</td>
              <td className="py-2 pr-4 text-gray-400">${Number(row.cost_usd ?? 0).toFixed(4)}</td>
              <td className="py-2 pr-4 text-gray-400">{Number(row.duration_s ?? 0).toFixed(2)}s</td>
              <td className="py-2 pr-4 text-gray-400">{row.iteration_count ?? 0}</td>
              <td className="py-2 text-gray-500 text-xs">{fmt(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoutingPanel() {
  const { data, isLoading } = useQuery({ queryKey: ["routing-outcomes"], queryFn: fetchRouting, refetchInterval: 30000 });

  if (isLoading) return <p className="text-gray-400 text-sm">Loading...</p>;
  if (!data?.length) return <p className="text-gray-400 text-sm">No routing data yet.</p>;

  // Aggregate by (agent_id, task_type, model_name)
  const groups: Record<string, { total: number; succeeded: number }> = {};
  for (const row of data) {
    const key = `${row.agent_id} · ${row.task_type} · ${row.model_name}`;
    if (!groups[key]) groups[key] = { total: 0, succeeded: 0 };
    groups[key].total++;
    if (row.succeeded) groups[key].succeeded++;
  }

  const sorted = Object.entries(groups).sort((a, b) => b[1].total - a[1].total);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 text-xs border-b border-gray-700">
            <th className="pb-2 pr-4">Agent · Task · Model</th>
            <th className="pb-2 pr-4">Total</th>
            <th className="pb-2 pr-4">Success rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {sorted.map(([key, stats]) => {
            const rate = pct(stats.succeeded, stats.total);
            const color = rate >= 80 ? "text-green-400" : rate >= 50 ? "text-yellow-400" : "text-red-400";
            return (
              <tr key={key} className="hover:bg-gray-800/50">
                <td className="py-2 pr-4 font-mono text-xs text-gray-300">{key}</td>
                <td className="py-2 pr-4 text-gray-400">{stats.total}</td>
                <td className="py-2 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${rate >= 80 ? "bg-green-500" : rate >= 50 ? "bg-yellow-500" : "bg-red-500"}`} style={{ width: `${rate}%` }} />
                    </div>
                    <span className={`text-xs font-medium ${color}`}>{rate}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function OutcomesPage() {
  return (
    <div className="p-6 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <Activity size={22} className="text-indigo-400" />
        <h1 className="text-2xl font-semibold">Brain Transparency</h1>
        <span className="ml-2 text-xs text-gray-500 flex items-center gap-1">
          <RefreshCw size={11} /> live
        </span>
      </div>

      {/* Arousal */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Zap size={15} className="text-yellow-400" />
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Arousal State</h2>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <ArousalPanel />
        </div>
      </section>

      {/* Per-agent success summary */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle size={15} className="text-green-400" />
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Outcome Summary (all time)</h2>
        </div>
        <SummaryPanel />
      </section>

      {/* Recent outcomes feed */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Activity size={15} className="text-indigo-400" />
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Recent Outcomes</h2>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <RecentOutcomesPanel />
        </div>
      </section>

      {/* Routing telemetry */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Zap size={15} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Model Routing Telemetry</h2>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <RoutingPanel />
        </div>
      </section>
    </div>
  );
}
