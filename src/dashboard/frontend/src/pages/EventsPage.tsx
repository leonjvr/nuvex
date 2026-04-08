import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

async function fetchEvents(params: string) {
  const res = await fetch(`/api/events?${params}`);
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

const STATUS_COLORS: Record<string, string> = {
  pending: "text-gray-400",
  delivered: "text-green-400",
  failed: "text-red-400",
  "dead-lettered": "text-orange-400",
};

const FAILURE_CLASS_COLORS: Record<string, string> = {
  SourceBug: "text-red-400",
  TestBug: "text-yellow-400",
  EnvIssue: "text-orange-400",
  MissingSpec: "text-purple-400",
  transient: "text-amber-400",
};

function groupByLane(events: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const e of events) {
    const lane = e.lane || "(unknown)";
    if (!map.has(lane)) map.set(lane, []);
    map.get(lane)!.push(e);
  }
  return map;
}

function LaneGroup({ lane, events }: { lane: string; events: any[] }) {
  const [expanded, setExpanded] = useState(true);
  const failCount = events.filter((e) => e.status === "failed" || e.status === "dead-lettered").length;

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden mb-3">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 bg-gray-800/60 hover:bg-gray-800 text-sm text-left"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="text-indigo-300 font-mono font-medium flex-1">{lane}</span>
        <span className="text-xs text-gray-500">{events.length} event{events.length !== 1 ? "s" : ""}</span>
        {failCount > 0 && (
          <span className="text-xs text-red-400 ml-2">{failCount} failed</span>
        )}
      </button>
      {expanded && (
        <div className="divide-y divide-gray-800/50">
          {events.map((e) => (
            <div key={e.id} className="flex gap-4 items-center px-4 py-1.5 font-mono text-xs hover:bg-gray-800/30">
              <span className="text-gray-600 w-36 shrink-0">
                {e.created_at ? new Date(e.created_at).toLocaleTimeString() : "—"}
              </span>
              <span className={`w-24 shrink-0 ${STATUS_COLORS[e.status] ?? "text-gray-400"}`}>
                {e.status}
              </span>
              <span className="text-gray-500 shrink-0">{e.agent_id || ""}</span>
              {e.failure_class && (
                <span className={`ml-auto ${FAILURE_CLASS_COLORS[e.failure_class] ?? "text-red-400"}`}>
                  {e.failure_class}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EventsPage() {
  const [laneFilter, setLaneFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const params = new URLSearchParams({ limit: "200" });
  if (statusFilter) params.set("status", statusFilter);

  const { data, isLoading } = useQuery({
    queryKey: ["events", statusFilter],
    queryFn: () => fetchEvents(params.toString()),
    refetchInterval: 5000,
  });

  const events: any[] = Array.isArray(data) ? data : [];
  const filtered = events.filter((e) =>
    laneFilter ? (e.lane ?? "").toLowerCase().includes(laneFilter.toLowerCase()) : true
  );
  const grouped = groupByLane(filtered);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Event Stream</h1>
        <span className="text-xs text-gray-500">Auto-refreshes every 5 s</span>
      </div>
      <div className="flex gap-3 mb-5">
        <input
          value={laneFilter}
          onChange={(e) => setLaneFilter(e.target.value)}
          placeholder="Filter lane…"
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm w-48"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="delivered">delivered</option>
          <option value="failed">failed</option>
          <option value="dead-lettered">dead-lettered</option>
        </select>
      </div>
      {isLoading && <p className="text-gray-400">Loading…</p>}
      {!isLoading && grouped.size === 0 && (
        <p className="text-gray-500 text-sm">No events found.</p>
      )}
      {Array.from(grouped.entries()).map(([lane, laneEvents]) => (
        <LaneGroup key={lane} lane={lane} events={laneEvents} />
      ))}
    </div>
  );
}
