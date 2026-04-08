import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Save, File, Folder, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchAgents() {
  const res = await fetch("/api/agents");
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

async function fetchFiles(agentId: string) {
  const res = await fetch(`/api/workspace/${agentId}/files`);
  if (!res.ok) throw new Error("Failed to fetch file list");
  return res.json();
}

async function fetchFile(agentId: string, filePath: string): Promise<{ path: string; content: string }> {
  const res = await fetch(`/api/workspace/${agentId}/files/${filePath}`);
  if (!res.ok) throw new Error(`Failed to read ${filePath}`);
  return res.json();
}

async function saveFile(agentId: string, filePath: string, content: string) {
  const res = await fetch(`/api/workspace/${agentId}/files/${filePath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to save file");
}

// ── File tree ─────────────────────────────────────────────────────────────────

interface FileEntry {
  path: string;
  size: number;
}

interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
  size?: number;
}

function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: new Map(), isFile: false };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          fullPath: parts.slice(0, i + 1).join("/"),
          children: new Map(),
          isFile: isLast,
          size: isLast ? f.size : undefined,
        });
      }
      node = node.children.get(part)!;
    }
  }
  return root;
}

function TreeItem({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.size > 0;

  if (node.isFile) {
    return (
      <button
        onClick={() => onSelect(node.fullPath)}
        className={`w-full text-left flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-gray-800 rounded transition-colors ${
          selected === node.fullPath ? "bg-gray-800 text-indigo-300" : "text-gray-400"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <File size={11} className="flex-none text-gray-500" />
        {node.name}
      </button>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800 rounded"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {hasChildren ? (
          expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />
        ) : (
          <span className="w-[11px]" />
        )}
        <Folder size={11} className="flex-none text-indigo-400" />
        {node.name}
      </button>
      {expanded &&
        Array.from(node.children.values()).map((child) => (
          <TreeItem
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkspacePage() {
  const qc = useQueryClient();
  const [agentId, setAgentId] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const { data: agents } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });

  const { data: filesData, isLoading: filesLoading } = useQuery({
    queryKey: ["workspace-files", agentId],
    queryFn: () => fetchFiles(agentId),
    enabled: !!agentId,
  });

  const fileList: FileEntry[] = filesData?.files ?? [];
  const tree = buildTree(fileList);

  const { isLoading: fileLoading } = useQuery({
    queryKey: ["workspace-file", agentId, selectedFile],
    queryFn: async () => {
      const { content } = await fetchFile(agentId, selectedFile!);
      setEditorContent(content);
      setDirty(false);
      return content;
    },
    enabled: !!agentId && !!selectedFile,
  });

  const saveMutation = useMutation({
    mutationFn: () => saveFile(agentId, selectedFile!, editorContent),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      setSaveStatus("saved");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["workspace-files", agentId] });
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: () => setSaveStatus("error"),
  });

  function handleSelect(path: string) {
    if (dirty) {
      if (!window.confirm("You have unsaved changes. Switch file?")) return;
    }
    setSelectedFile(path);
    setDirty(false);
    setSaveStatus("idle");
  }

  function handleEdit(val: string) {
    setEditorContent(val);
    setDirty(true);
    setSaveStatus("idle");
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-60 flex-none border-r border-gray-800 flex flex-col">
        <div className="p-3 border-b border-gray-800">
          <h1 className="text-base font-semibold mb-2">Workspace</h1>
          <select
            value={agentId}
            onChange={(e) => { setAgentId(e.target.value); setSelectedFile(null); setEditorContent(""); }}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
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

        <div className="flex-1 overflow-y-auto py-1">
          {filesLoading && <p className="p-3 text-xs text-gray-500">Loading files…</p>}
          {agentId && !filesLoading && fileList.length === 0 && (
            <p className="p-3 text-xs text-gray-500">No files found</p>
          )}
          {Array.from(tree.children.values()).map((node) => (
            <TreeItem
              key={node.fullPath}
              node={node}
              depth={0}
              selected={selectedFile}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </div>

      {/* Editor pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-10 border-b border-gray-800 flex items-center px-4 gap-3 flex-none">
          <span className="text-sm text-gray-400 font-mono truncate flex-1">
            {selectedFile ?? "No file selected"}
          </span>
          {fileLoading && <Loader2 size={14} className="animate-spin text-gray-500" />}
          {dirty && <span className="text-xs text-yellow-400">unsaved</span>}
          {saveStatus === "saved" && <span className="text-xs text-green-400">saved</span>}
          {saveStatus === "error" && <span className="text-xs text-red-400">save failed</span>}
          <button
            disabled={!selectedFile || !dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saveMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save
          </button>
        </div>

        {/* CodeMirror editor */}
        {selectedFile ? (
          <div className="flex-1 overflow-auto">
            <CodeMirror
              value={editorContent}
              height="100%"
              theme={oneDark}
              extensions={selectedFile.endsWith(".md") ? [markdown()] : []}
              onChange={(val) => handleEdit(val)}
              style={{ height: "100%", fontSize: "13px" }}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-600">
              {agentId ? "Select a file from the tree" : "Select an agent to browse workspace"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
