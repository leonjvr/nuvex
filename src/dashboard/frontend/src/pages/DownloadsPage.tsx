import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Apple, Terminal, Download, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Globe } from "lucide-react";

interface Platform {
  id: string;
  label: string;
  coming_soon: boolean;
}

interface DownloadMeta {
  version: string;
  platforms: Platform[];
  brain_url: string;
}

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  windows: Monitor,
  macos: Apple,
  linux: Terminal,
};

function SetupSteps({ platform, brainUrl }: { platform: string; brainUrl: string }) {
  const [open, setOpen] = useState(false);
  if (platform !== "windows") return null;
  return (
    <div className="mt-3 border-t border-gray-700 pt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Setup instructions
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5 text-xs text-gray-400 list-decimal list-inside">
          {brainUrl ? (
            <li>Click <span className="text-gray-300">Download</span> — you get a ZIP with the EXE and a pre-configured <span className="font-mono text-gray-300">desktop-agent.json</span> (server address already set to <span className="font-mono text-indigo-300">{brainUrl}</span>).</li>
          ) : (
            <li>Click <span className="text-gray-300">Download EXE</span> to get the installer.</li>
          )}
          <li>
            {brainUrl
              ? "Extract the ZIP and run the EXE — the setup wizard will open with the server URL already filled in."
              : "Run the EXE — the setup wizard opens. Enter your Brain URL."}
          </li>
          <li>
            Paste a Device Token (generate one in{" "}
            <a href="/device-tokens" className="text-indigo-400 underline hover:text-indigo-300">
              Infrastructure &rarr; Device Tokens
            </a>
            ).
          </li>
          <li>Choose permission mode: <span className="text-gray-300">Ask</span> (popup per task) or <span className="text-gray-300">Auto</span> (execute when idle).</li>
          <li>Click <span className="text-gray-300">Save &amp; Start</span>. The agent icon appears in your system tray.</li>
        </ol>
      )}
    </div>
  );
}

function PlatformCard({ platform, version, brainUrl }: { platform: Platform; version: string; brainUrl: string }) {
  const Icon = PLATFORM_ICONS[platform.id] ?? Monitor;
  const [downloading, setDownloading] = useState(false);
  const hasBundle = !platform.coming_soon && !!brainUrl;

  async function handleDownload(endpoint: string, filename: string) {
    setDownloading(true);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // redirect case handled by browser
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      className={`bg-gray-900 border rounded-xl p-5 flex flex-col gap-3 ${
        platform.coming_soon ? "border-gray-800 opacity-60" : "border-gray-700"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center flex-none">
          <Icon size={20} className={platform.coming_soon ? "text-gray-600" : "text-indigo-400"} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{platform.label}</p>
          {platform.coming_soon ? (
            <span className="text-xs text-gray-500">Coming soon</span>
          ) : (
            <span className="text-xs text-gray-400">v{version} &middot; Windows x64</span>
          )}
        </div>
        {!platform.coming_soon && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle2 size={12} /> Available
          </span>
        )}
      </div>

      {!platform.coming_soon && hasBundle && (
        <button
          onClick={() => handleDownload(
            `/api/downloads/desktop-agent/bundle/${platform.id}`,
            `nuvex-desktop-${version}-${platform.id}.zip`
          )}
          disabled={downloading}
          className="flex items-center justify-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Download size={14} />
          {downloading ? "Downloading…" : "Download (pre-configured)"}
        </button>
      )}

      {!platform.coming_soon && !hasBundle && (
        <button
          onClick={() => handleDownload(
            `/api/downloads/desktop-agent/file/${platform.id}`,
            `nuvex-desktop-${version}.exe`
          )}
          disabled={downloading}
          className="flex items-center justify-center gap-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Download size={14} />
          {downloading ? "Downloading…" : "Download EXE"}
        </button>
      )}

      {!platform.coming_soon && brainUrl && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-800/50 rounded-lg px-3 py-2">
          <Globe size={11} className="flex-none text-indigo-500" />
          <span className="font-mono text-indigo-300 truncate">{brainUrl}</span>
          <span className="flex-none text-gray-600">pre-configured</span>
        </div>
      )}

      {!platform.coming_soon && !brainUrl && (
        <div className="flex items-start gap-2 text-xs text-amber-500/80 bg-amber-900/10 border border-amber-800/30 rounded-lg px-3 py-2">
          <AlertCircle size={12} className="mt-0.5 flex-none" />
          <span>Set <span className="font-mono">BRAIN_PUBLIC_URL</span> on the server to enable pre-configured bundles.</span>
        </div>
      )}

      {platform.coming_soon && (
        <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-800/50 rounded-lg px-3 py-2">
          <AlertCircle size={12} />
          Support for {platform.label} is planned for a future release.
        </div>
      )}

      <SetupSteps platform={platform.id} brainUrl={brainUrl} />
    </div>
  );
}

export default function DownloadsPage() {
  const { data, isLoading, isError } = useQuery<DownloadMeta>({
    queryKey: ["desktop-agent-downloads"],
    queryFn: async () => {
      const r = await fetch("/api/downloads/desktop-agent/latest");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Desktop Agent</h1>
        <p className="mt-1 text-sm text-gray-400">
          Download and install the NUVEX Desktop Agent to give your agents the ability to control
          applications, read the screen, manage Outlook, and more — directly on your Windows PC.
        </p>
      </div>

      {isLoading && (
        <p className="text-sm text-gray-500">Loading available downloads…</p>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-3">
          <AlertCircle size={14} />
          Failed to load download information. Ensure the brain API is reachable.
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {data.platforms.map((p) => (
              <PlatformCard key={p.id} platform={p} version={data.version} brainUrl={data.brain_url ?? ""} />
            ))}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-xs text-gray-500 space-y-1">
            <p className="font-medium text-gray-400">How it works</p>
            <p>
              The desktop agent connects outbound to your NUVEX brain over a secure WebSocket. No
              inbound ports or firewall rules are required. It authenticates with a one-time device
              token you generate in the Device Tokens page, then stays resident in your system tray
              until you quit it.
            </p>
            <p>
              Agents can only use the desktop after an operator explicitly assigns a device to them.
              High-risk tools (shell execution) are restricted to Tier-1 agents only.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
