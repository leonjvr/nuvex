import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

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
  sanction_reason?: string;
  message_count: number;
  last_seen_at: string | null;
  handles: ContactHandle[];
}

interface HistoryEvent {
  id: number;
  action: string;
  decision: string;
  reason: string | null;
  created_at: string | null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchContact(id: string): Promise<Contact> {
  const res = await fetch(`/api/contacts/${id}`);
  if (!res.ok) throw new Error("Contact not found");
  return res.json();
}

async function fetchHistory(id: string): Promise<HistoryEvent[]> {
  const res = await fetch(`/api/contacts/${id}/history`);
  if (!res.ok) throw new Error("Failed to load history");
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
    <span className={`text-sm px-3 py-1 rounded font-mono font-bold ${TIER_COLORS[tier] ?? "bg-gray-700 text-gray-300"}`}>
      T{tier}
    </span>
  );
}

function SanctionBadge({ sanction }: { sanction: string | null }) {
  if (!sanction) return <span className="text-gray-500 text-sm">None</span>;
  return (
    <span className={`text-sm px-3 py-1 rounded ${SANCTION_COLORS[sanction] ?? "bg-gray-700 text-gray-400"}`}>
      {sanction}
    </span>
  );
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ContactDetailPage() {
  const { contactId } = useParams<{ contactId: string }>();
  const qc = useQueryClient();

  const { data: contact, isLoading } = useQuery({
    queryKey: ["contact", contactId],
    queryFn: () => fetchContact(contactId!),
    enabled: !!contactId,
  });

  const { data: history } = useQuery({
    queryKey: ["contact-history", contactId],
    queryFn: () => fetchHistory(contactId!),
    enabled: !!contactId,
  });

  if (isLoading) return <div className="p-6 text-gray-400">Loading...</div>;
  if (!contact) return <div className="p-6 text-red-400">Contact not found</div>;

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <button
          className="text-gray-400 hover:text-white text-sm"
          onClick={() => window.history.back()}
        >
          ← Back
        </button>
        <h1 className="text-xl font-bold text-white">{contact.display_name}</h1>
      </div>

      {/* Identity summary */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Identity</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-500">Trust tier</span>
            <div className="mt-1"><TierBadge tier={contact.trust_tier} /></div>
          </div>
          <div>
            <span className="text-gray-500">Sanction</span>
            <div className="mt-1"><SanctionBadge sanction={contact.sanction} /></div>
          </div>
          <div>
            <span className="text-gray-500">Messages</span>
            <div className="mt-1 text-white">{contact.message_count}</div>
          </div>
          <div>
            <span className="text-gray-500">Last seen</span>
            <div className="mt-1 text-white">{fmt(contact.last_seen_at)}</div>
          </div>
        </div>
      </div>

      {/* Channel handles */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 mb-4">
        <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">Channels</h2>
        {contact.handles.length === 0 ? (
          <p className="text-gray-600 text-sm">No handles registered</p>
        ) : (
          <ul className="space-y-1">
            {contact.handles.map((h, i) => (
              <li key={i} className="text-sm text-gray-300">
                <span className="text-gray-500">{h.channel_type}</span>
                <span className="text-gray-600 mx-2">·</span>
                <span className="font-mono">{h.handle}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Trust history */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
        <h2 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider">History</h2>
        {!history || history.length === 0 ? (
          <p className="text-gray-600 text-sm">No history events</p>
        ) : (
          <ul className="space-y-2">
            {history.map((ev) => (
              <li key={ev.id} className="text-sm border-b border-gray-800/50 pb-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    ev.decision === "approved" ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"
                  }`}>{ev.decision}</span>
                  <span className="text-gray-300">{ev.action}</span>
                </div>
                {ev.reason && <p className="text-gray-500 mt-0.5">{ev.reason}</p>}
                <p className="text-gray-600 text-xs mt-0.5">{fmt(ev.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
