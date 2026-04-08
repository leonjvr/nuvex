import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

// ── State colour mapping ──────────────────────────────────────────────────────

const STATE_COLORS: Record<string, { dot: string; label: string }> = {
  spawning:        { dot: "bg-blue-400",   label: "text-blue-300" },
  trust_required:  { dot: "bg-yellow-400", label: "text-yellow-300" },
  ready_for_prompt:{ dot: "bg-teal-400",   label: "text-teal-300" },
  running:         { dot: "bg-green-400",  label: "text-green-300" },
  finished:        { dot: "bg-indigo-400", label: "text-indigo-300" },
  failed:          { dot: "bg-red-400",    label: "text-red-300" },
  // legacy
  idle:            { dot: "bg-gray-400",   label: "text-gray-300" },
  active:          { dot: "bg-green-400",  label: "text-green-300" },
  suspended:       { dot: "bg-orange-400", label: "text-orange-300" },
  error:           { dot: "bg-red-400",    label: "text-red-300" },
  terminated:      { dot: "bg-gray-600",   label: "text-gray-500" },
};

function stateMeta(state: string) {
  return STATE_COLORS[state] ?? { dot: "bg-gray-400", label: "text-gray-300" };
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchAgents() {
  const res = await fetch("/api/agents");
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

async function fetchLifecycle(agentId: string) {
  const res = await fetch(`/api/agents/${agentId}/lifecycle`);
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ── Timeline group: all events for one invocation ────────────────────────────

function InvocationGroup({ invocationId, events }: { invocationId: string; events: any[] }) {
  // events are newest-first from server; display oldest-first within a group
  const sorted = [...events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <div className="mb-6">
      <p className="text-xs font-mono text-gray-600 mb-2">
        invocation: {invocationId}
      </p>
      <div className="relative pl-6">
        {/* vertical connector */}
        <div className="absolute left-2 top-2 bottom-2 w-px bg-gray-700" />
        <div className="space-y-3">
          {sorted.map((e: any, i: number) => {
            const meta = stateMeta(e.to_state);
            return (
              <div key={e.id} className="relative flex items-start gap-3">
                {/* dot */}
                <span className={`absolute -left-6 mt-1.5 w-2.5 h-2.5 rounded-full border-2 border-gray-900 ${meta.dot}`} />
                <div>
                  <div className="flex items-center gap-2">
                    {e.from_state && (
                      <>
                        <span className={`text-xs ${stateMeta(e.from_state).label}`}>
                          {e.from_state}
                        </span>
                        <span className="text-gray-600 text-xs">→</span>
                      </>
                    )}
                    <span className={`text-xs font-medium ${meta.label}`}>{e.to_state}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {e.created_at ? new Date(e.created_at).toLocaleString() : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LifecyclePage() {
  const [agentId, setAgentId] = useState<string>("");

  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const { data: events, isLoading, error } = useQuery({
    queryKey: ["lifecycle", agentId],
    queryFn: () => fetchLifecycle(agentId),
    enabled: !!agentId,
  });

  // Group events by invocation_id; events with no invocation get their own null group
  const groups = new Map<string, any[]>();
  if (Array.isArray(events)) {
    for (const e of events) {
      const key = e.invocation_id ?? `__no_inv_${e.id}`;
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-4">Agent Lifecycle</h1>

      {/* Agent picker */}
      <div className="mb-6">
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 w-64"
        >
          <option value="">Select agent…</option>
          {Array.isArray(agents) &&
            agents.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
        </select>
      </div>

      {/* Current state summary */}
      {agentId && Array.isArray(agents) && (() => {
        const agent = agents.find((a: any) => a.id === agentId);
        const state = agent?.lifecycle_state ?? "unknown";
        const meta = stateMeta(state);
        return (
          <div className="flex items-center gap-2 mb-6 p-3 bg-gray-800 rounded-lg border border-gray-700 w-fit">
            <span className={`w-2.5 h-2.5 rounded-full ${meta.dot}`} />
            <span className="text-sm">Current state:</span>
            <span className={`text-sm font-medium ${meta.label}`}>{state}</span>
          </div>
        );
      })()}

      {/* Timeline */}
      {isLoading && <p className="text-gray-400 text-sm">Loading lifecycle events…</p>}
      {error && <p className="text-red-400 text-sm">Failed to load lifecycle events</p>}

      {!isLoading && agentId && groups.size === 0 && (
        <p className="text-gray-500 text-sm">No lifecycle events recorded for this agent</p>
      )}

      {groups.size > 0 && (
        <div>
          <p className="text-xs text-gray-600 mb-4">{events.length} events across {groups.size} invocations</p>
          {Array.from(groups.entries()).map(([invId, evts]) => (
            <InvocationGroup key={invId} invocationId={invId} events={evts} />
          ))}
        </div>
      )}

      {!agentId && (
        <p className="text-gray-600 text-sm">Select an agent to see its lifecycle timeline</p>
      )}
    </div>
  );
}
