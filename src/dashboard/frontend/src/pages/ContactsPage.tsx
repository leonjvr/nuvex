import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactHandle {
  channel_type: string;
  handle: string;
}

interface Contact {
  id: string;
  display_name: string;
  trust_tier: number;
  sanction: string | null;
  sanction_until: string | null;
  message_count: number;
  last_seen_at: string | null;
  handles: ContactHandle[];
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchContacts(tier: string, sanction: string): Promise<{ items: Contact[] }> {
  const params = new URLSearchParams();
  if (tier) params.set("tier", tier);
  if (sanction) params.set("sanction", sanction);
  const res = await fetch(`/api/contacts?${params}`);
  if (!res.ok) throw new Error("Failed to fetch contacts");
  return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<number, string> = {
  0: "bg-gray-700 text-gray-300",
  1: "bg-blue-800 text-blue-200",
  2: "bg-green-800 text-green-200",
  3: "bg-yellow-800 text-yellow-200",
  4: "bg-purple-800 text-purple-200",
};

const SANCTION_COLORS: Record<string, string> = {
  hard_ban: "bg-red-900 text-red-300",
  temp_ban: "bg-orange-900 text-orange-300",
  shadowban: "bg-gray-800 text-gray-400",
  under_review: "bg-yellow-900 text-yellow-300",
};

function TierBadge({ tier }: { tier: number }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-mono font-bold ${TIER_COLORS[tier] ?? "bg-gray-700 text-gray-300"}`}>
      T{tier}
    </span>
  );
}

function SanctionBadge({ sanction }: { sanction: string | null }) {
  if (!sanction) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${SANCTION_COLORS[sanction] ?? "bg-gray-700 text-gray-400"}`}>
      {sanction}
    </span>
  );
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ContactsPage() {
  const [tierFilter, setTierFilter] = useState("");
  const [sanctionFilter, setSanctionFilter] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["contacts", tierFilter, sanctionFilter],
    queryFn: () => fetchContacts(tierFilter, sanctionFilter),
    refetchInterval: 30000,
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Contact Directory</h1>
        <div className="flex gap-3">
          <select
            className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1"
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
          >
            <option value="">All tiers</option>
            {[0, 1, 2, 3, 4].map((t) => (
              <option key={t} value={String(t)}>T{t}</option>
            ))}
          </select>
          <select
            className="bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded px-2 py-1"
            value={sanctionFilter}
            onChange={(e) => setSanctionFilter(e.target.value)}
          >
            <option value="">All sanctions</option>
            <option value="hard_ban">hard_ban</option>
            <option value="temp_ban">temp_ban</option>
            <option value="shadowban">shadowban</option>
            <option value="under_review">under_review</option>
          </select>
        </div>
      </div>

      {isLoading && <p className="text-gray-400 text-sm">Loading contacts...</p>}
      {error && <p className="text-red-400 text-sm">Error loading contacts</p>}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-left border-b border-gray-800">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Tier</th>
                <th className="pb-2 pr-4">Sanction</th>
                <th className="pb-2 pr-4">Channels</th>
                <th className="pb-2 pr-4">Messages</th>
                <th className="pb-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                  onClick={() => window.location.href = `/contacts/${c.id}`}
                >
                  <td className="py-2 pr-4 font-medium text-white">{c.display_name}</td>
                  <td className="py-2 pr-4"><TierBadge tier={c.trust_tier} /></td>
                  <td className="py-2 pr-4"><SanctionBadge sanction={c.sanction} /></td>
                  <td className="py-2 pr-4 text-gray-400 text-xs">
                    {c.handles.map((h) => `${h.channel_type}:${h.handle}`).join(", ") || "—"}
                  </td>
                  <td className="py-2 pr-4 text-gray-400">{c.message_count}</td>
                  <td className="py-2 text-gray-400">{fmt(c.last_seen_at)}</td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500">No contacts found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
