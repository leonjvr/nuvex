import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemoryNode {
  id: string;
  memoryId: number;
  content: string;
  scope: string;
  agentId: string;
  confidence: number;
}

interface MemoryLink {
  source: string;
  target: string;
  edgeType: string;
  confidence: number;
}

interface GraphData {
  nodes: MemoryNode[];
  links: MemoryLink[];
}

interface Edge {
  id: number;
  source_id: number;
  target_id: number;
  edge_type: string;
  confidence: number;
  agent_id: string;
  created_at: string;
  source_content: string;
  source_scope: string;
  target_content: string;
  target_scope: string;
}

// ── Colours ───────────────────────────────────────────────────────────────────

const SCOPE_COLORS: Record<string, string> = {
  personal: "#6366f1",   // indigo
  division: "#a855f7",   // purple
  org: "#f59e0b",        // amber
  archived: "#6b7280",   // gray
};

const EDGE_COLORS: Record<string, string> = {
  supports: "#22c55e",
  contradicts: "#ef4444",
  evolved_into: "#a855f7",
  depends_on: "#f59e0b",
  related_to: "#9ca3af",
};

const EDGE_LABEL_COLORS: Record<string, string> = {
  supports: "bg-green-900 text-green-300",
  contradicts: "bg-red-900 text-red-300",
  evolved_into: "bg-purple-900 text-purple-300",
  depends_on: "bg-amber-900 text-amber-300",
  related_to: "bg-gray-700 text-gray-400",
};

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchEdges(agentId: string): Promise<Edge[]> {
  const params = new URLSearchParams({ limit: "500" });
  if (agentId) params.set("agent_id", agentId);
  const res = await fetch(`/api/memory/edges?${params}`);
  if (!res.ok) throw new Error("Failed to fetch edges");
  return res.json();
}

async function fetchAllMemories(agentId: string): Promise<{
  id: number; content: string; scope: string; agent_id: string; confidence: number;
}[]> {
  const params = new URLSearchParams({ limit: "500" });
  if (agentId) params.set("agent_id", agentId);
  const res = await fetch(`/api/memory?${params}`);
  if (!res.ok) throw new Error("Failed to fetch memories");
  return res.json();
}

function buildGraphData(
  edges: Edge[],
  allMemories: { id: number; content: string; scope: string; agent_id: string; confidence: number }[]
): GraphData {
  const nodeMap = new Map<string, MemoryNode>();

  // Add all memories first (including isolated ones)
  for (const m of allMemories) {
    const key = `m-${m.id}`;
    nodeMap.set(key, {
      id: key,
      memoryId: m.id,
      content: m.content,
      scope: m.scope,
      agentId: m.agent_id,
      confidence: m.confidence,
    });
  }

  // Edges may reference memories not in the current page — add those too
  for (const e of edges) {
    const srcKey = `m-${e.source_id}`;
    const tgtKey = `m-${e.target_id}`;
    if (!nodeMap.has(srcKey)) {
      nodeMap.set(srcKey, {
        id: srcKey,
        memoryId: e.source_id,
        content: e.source_content,
        scope: e.source_scope,
        agentId: e.agent_id,
        confidence: e.confidence,
      });
    }
    if (!nodeMap.has(tgtKey)) {
      nodeMap.set(tgtKey, {
        id: tgtKey,
        memoryId: e.target_id,
        content: e.target_content,
        scope: e.target_scope,
        agentId: e.agent_id,
        confidence: e.confidence,
      });
    }
  }

  const links: MemoryLink[] = edges.map(e => ({
    source: `m-${e.source_id}`,
    target: `m-${e.target_id}`,
    edgeType: e.edge_type,
    confidence: e.confidence,
  }));

  return { nodes: Array.from(nodeMap.values()), links };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MemoryGraph() {
  const [agentFilter, setAgentFilter] = useState("");
  // Both selection and hover stored in refs so canvas callbacks never change
  // identity and ForceGraph2D never reinitialises the canvas on interaction.
  const selectedNodeRef = useRef<MemoryNode | null>(null);
  const hoveredNodeRef = useRef<MemoryNode | null>(null);
  // Separate state drives only the React detail-pane render (not the canvas).
  const [detailNode, setDetailNode] = useState<MemoryNode | null>(null);
  const graphRef = useRef<ForceGraphMethods<object, object>>();

  // fetch agent list for filter dropdown
  const { data: agents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => fetch("/api/agents").then(r => r.json()) as Promise<{ id: string; name: string }[]>,
  });

  const { data: edges, isLoading: edgesLoading, isError } = useQuery({
    queryKey: ["memory-edges-graph", agentFilter],
    queryFn: () => fetchEdges(agentFilter),
    refetchInterval: 60_000,
  });

  const { data: allMemories, isLoading: memoriesLoading } = useQuery({
    queryKey: ["memory-all-graph", agentFilter],
    queryFn: () => fetchAllMemories(agentFilter),
    refetchInterval: 60_000,
  });

  const isLoading = edgesLoading || memoriesLoading;

  const graphData = (edges && allMemories) ? buildGraphData(edges, allMemories) : { nodes: [], links: [] };

  // edges for the detail pane (uses detailNode state, not the canvas ref)
  const selectedEdges = detailNode && edges
    ? edges.filter(e => e.source_id === detailNode.memoryId || e.target_id === detailNode.memoryId)
    : [];

  // Stable callback — reads from refs, never changes identity, never causes
  // ForceGraph2D to tear down and recreate the canvas.
  const paintNode = useCallback((node: object, ctx: CanvasRenderingContext2D) => {
    const n = node as MemoryNode & { x: number; y: number };
    const r = 5 + n.confidence * 4;
    const color = SCOPE_COLORS[n.scope] ?? "#6b7280";
    const isSelected = selectedNodeRef.current?.id === n.id;
    const isHovered = hoveredNodeRef.current?.id === n.id;

    ctx.beginPath();
    ctx.arc(n.x, n.y, r + (isSelected || isHovered ? 2 : 0), 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = isSelected ? 1 : 0.85;
    ctx.fill();

    if (isSelected || isHovered) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paintLink = useCallback((link: object, ctx: CanvasRenderingContext2D) => {
    const l = link as MemoryLink & { source: { x: number; y: number }; target: { x: number; y: number } };
    ctx.strokeStyle = EDGE_COLORS[l.edgeType] ?? "#9ca3af";
    ctx.lineWidth = 0.8 + l.confidence * 0.8;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(l.source.x, l.source.y);
    ctx.lineTo(l.target.x, l.target.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }, []);

  // No useEffect needed for canvas redraws — the animation loop handles it.

  // After data loads, zoom to fit so whole graph is visible and centred.
  const nodeCount = graphData.nodes.length;
  useEffect(() => {
    if (nodeCount === 0) return;
    const t = setTimeout(() => graphRef.current?.zoomToFit(400, 40), 800);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCount]);

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 flex items-center justify-center h-64">
        <p className="text-gray-500 text-sm">Loading memory graph…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-gray-800 rounded-xl p-6 flex items-center justify-center h-64">
        <p className="text-red-400 text-sm">Failed to load memory graph.</p>
      </div>
    );
  }

  if (graphData.nodes.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-6 flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-gray-500 text-sm">No memories yet.</p>
        <p className="text-gray-600 text-xs text-center max-w-sm">
          Memories appear here as nodes once the agent has processed threads.
          Relationship edges form during self-reflection and nightly dreaming.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-4 flex-wrap">
        <select
          value={agentFilter}
          onChange={e => { setAgentFilter(e.target.value); selectedNodeRef.current = null; setDetailNode(null); }}
          className="bg-gray-700 text-gray-200 text-xs rounded px-2 py-1.5"
        >
          <option value="">All agents</option>
          {agents?.map(a => <option key={a.id} value={a.id}>{a.name ?? a.id}</option>)}
        </select>

        {/* Legend */}
        <div className="flex items-center gap-3 text-xs text-gray-400">
          {Object.entries(SCOPE_COLORS).map(([scope, color]) => (
            <span key={scope} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              {scope}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-400 ml-auto">
          {Object.entries(EDGE_COLORS).map(([type, color]) => (
            <span key={type} className="flex items-center gap-1">
              <span className="inline-block w-5 h-0.5" style={{ backgroundColor: color }} />
              {type.replace("_", " ")}
            </span>
          ))}
        </div>
      </div>

      {/* Graph + detail pane — detail pane is always visible */}
      <div className="flex gap-4">
        {/* Graph canvas — no explicit width prop; ForceGraph2D self-sizes to parent */}
        <div
          className="bg-gray-900 rounded-xl overflow-hidden flex-1 min-w-0"
          style={{ height: 480 }}
        >
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData as { nodes: object[]; links: object[] }}
            nodeCanvasObject={paintNode}
            linkCanvasObject={paintLink}
            nodeLabel={(n: any) => {
              const node = n as MemoryNode;
              return `[${node.scope}] ${node.content.slice(0, 80)}…`;
            }}
            onNodeClick={(n: any) => {
              selectedNodeRef.current = n as MemoryNode;
              setDetailNode(n as MemoryNode);
            }}
            onNodeHover={(n: any) => { hoveredNodeRef.current = n as MemoryNode | null; }}
            enableNodeDrag={false}
            backgroundColor="#111827"
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            warmupTicks={200}
            cooldownTicks={0}
            nodeRelSize={5}
            height={480}
          />
        </div>

        {/* Detail pane — always open, shows placeholder when nothing selected */}
        <div className="w-72 shrink-0 bg-gray-800 rounded-xl p-4 text-xs flex flex-col gap-3 overflow-y-auto" style={{ height: 480 }}>
          {detailNode ? (
            <>
              <div className="flex items-center justify-between">
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: SCOPE_COLORS[detailNode.scope] + "33", color: SCOPE_COLORS[detailNode.scope] }}
                >
                  {detailNode.scope}
                </span>
                <button onClick={() => { selectedNodeRef.current = null; setDetailNode(null); }} className="text-gray-500 hover:text-gray-300 text-base leading-none">×</button>
              </div>
              <p className="text-gray-200 leading-relaxed">{detailNode.content}</p>
              <div className="flex items-center justify-between text-gray-500">
                <span>{detailNode.agentId}</span>
                <span>{(detailNode.confidence * 100).toFixed(0)}% conf</span>
              </div>

              {selectedEdges.length > 0 && (
                <div className="border-t border-gray-700 pt-3">
                  <p className="text-gray-500 uppercase tracking-wider text-xs mb-2">Connections ({selectedEdges.length})</p>
                  <div className="space-y-2">
                    {selectedEdges.map(e => {
                      const isSource = e.source_id === detailNode!.memoryId;
                      const other = isSource ? e.target_content : e.source_content;
                      const direction = isSource ? "→" : "←";
                      return (
                        <div key={e.id} className="bg-gray-750 rounded p-2">
                          <div className="flex items-center gap-1 mb-1">
                            <span className="text-gray-500">{direction}</span>
                            <span className={`px-1.5 py-0.5 rounded text-xs ${EDGE_LABEL_COLORS[e.edge_type] ?? "bg-gray-700 text-gray-400"}`}>
                              {e.edge_type.replace("_", " ")}
                            </span>
                          </div>
                          <p className="text-gray-400 leading-relaxed">{other}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedEdges.length === 0 && (
                <div className="border-t border-gray-700 pt-3 text-gray-600 text-xs">
                  No relationships yet for this memory.
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <svg className="w-8 h-8 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <p className="text-gray-500 text-xs">Click any node in the graph to explore its content and connections.</p>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-600">
        {graphData.nodes.length} memories · {graphData.links.length} relationship{graphData.links.length !== 1 ? "s" : ""} · click a node to explore
      </p>
    </div>
  );
}
