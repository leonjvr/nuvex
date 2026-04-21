// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

import React, { useState, useCallback, useEffect } from 'react';
import { RefreshCw, Plus, X, Link, Package } from 'lucide-react';

import { useAppConfig }  from '../lib/config';
import { useOrg }        from '../lib/org-context';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { formatRelative } from '../lib/format';
import { formatGuiError } from '../i18n/gui-errors';
import type { Organisation, OrgAgent, ChannelBinding, WorkPacket } from '../api/types';


// ---- Status badge -----------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:    { bg: 'var(--color-success-bg)',  text: 'var(--color-success)' },
  suspended: { bg: 'var(--color-warning-bg)',  text: 'var(--color-warning)' },
  archived:  { bg: 'var(--color-surface-alt)', text: 'var(--color-text-muted)' },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS['archived'];
  return (
    <span style={{
      padding:      '2px 8px',
      borderRadius: 'var(--radius-sm)',
      fontSize:     '11px',
      fontWeight:   600,
      textTransform: 'uppercase',
      letterSpacing: '0.04em',
      background:   colors.bg,
      color:        colors.text,
    }}>
      {status}
    </span>
  );
}


// ---- Channel bindings panel (14.7) ------------------------------------------

function ChannelsPanel({ org }: { org: Organisation }) {
  const { client } = useAppConfig();
  const [bindings, setBindings] = useState<ChannelBinding[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ channel_type: '', channel_identity: '', agent_id: '' });
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [agents, setAgents] = useState<OrgAgent[]>([]);

  const load = useCallback(() => {
    if (!client) return;
    setLoading(true);
    Promise.all([
      client.listOrgChannels(org.org_id),
      client.listOrgAgents(org.org_id),
    ])
      .then(([ch, ag]) => { setBindings(ch); setAgents(ag); setError(null); })
      .catch((e) => { setError(formatGuiError(e)); })
      .finally(() => setLoading(false));
  }, [client, org.org_id]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!client || !form.channel_type || !form.channel_identity) return;
    setSaveErr(null);
    try {
      await client.createOrgChannel(org.org_id, {
        channel_type:     form.channel_type.trim(),
        channel_identity: form.channel_identity.trim(),
        agent_id:         form.agent_id || undefined,
      });
      setCreating(false);
      setForm({ channel_type: '', channel_identity: '', agent_id: '' });
      load();
    } catch (e) {
      setSaveErr(formatGuiError(e));
    }
  }

  async function handleDelete(id: number) {
    if (!client) return;
    try {
      await client.deleteOrgChannel(org.org_id, id);
      load();
    } catch (e) {
      setError(formatGuiError(e));
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
          Channel Bindings
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={load} style={btnStyle('ghost')} title="Refresh"><RefreshCw size={14} /></button>
          {org.status === 'active' && (
            <button onClick={() => setCreating(true)} style={btnStyle('primary')}>
              <Plus size={14} /> Add Binding
            </button>
          )}
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

      {creating && (
        <div style={{ background: 'var(--color-surface-alt)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '16px', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <input
              placeholder="Channel type (e.g. whatsapp)"
              value={form.channel_type}
              onChange={(e) => setForm((f) => ({ ...f, channel_type: e.target.value }))}
              style={inputStyle}
            />
            <input
              placeholder="Channel identity (e.g. phone number)"
              value={form.channel_identity}
              onChange={(e) => setForm((f) => ({ ...f, channel_identity: e.target.value }))}
              style={inputStyle}
            />
            <select
              value={form.agent_id}
              onChange={(e) => setForm((f) => ({ ...f, agent_id: e.target.value }))}
              style={inputStyle}
            >
              <option value="">No agent (org-level)</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {saveErr && <p style={{ color: 'var(--color-danger)', fontSize: '12px', marginBottom: '8px' }}>{saveErr}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => void handleCreate()} style={btnStyle('primary')}>Save</button>
            <button onClick={() => { setCreating(false); setSaveErr(null); }} style={btnStyle('ghost')}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? <LoadingSpinner label="Loading bindings…" /> : (
        bindings.length === 0
          ? <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>No channel bindings.</p>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-surface-alt)' }}>
                  {['Type', 'Identity', 'Agent', 'Created', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bindings.map((b) => (
                  <tr key={b.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--color-text)' }}>{b.channel_type}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }}>{b.channel_identity}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)' }}>{b.agent_id ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)' }}>{formatRelative(b.created_at)}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      {org.status === 'active' && (
                        <button onClick={() => void handleDelete(b.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)' }} title="Remove">
                          <X size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}
    </div>
  );
}


// ---- Work packets panel (14.8) ----------------------------------------------

function PacketsPanel({ org }: { org: Organisation }) {
  const { client } = useAppConfig();
  const [packets,  setPackets] = useState<WorkPacket[]>([]);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState<string | null>(null);
  const [filter,   setFilter]  = useState<string>('');

  const load = useCallback(() => {
    if (!client) return;
    setLoading(true);
    client.listOrgPackets(org.org_id, { limit: 100 })
      .then((data) => { setPackets(data); setError(null); })
      .catch((e) => { setError(formatGuiError(e)); })
      .finally(() => setLoading(false));
  }, [client, org.org_id]);

  useEffect(() => { load(); }, [load]);

  const displayed = filter
    ? packets.filter((p) => p.status === filter)
    : packets;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
          Work Packets
        </h3>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...inputStyle, width: 'auto', fontSize: '12px', padding: '4px 8px' }}>
            <option value="">All statuses</option>
            {['pending', 'dispatched', 'processing', 'completed', 'failed', 'timeout'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={load} style={btnStyle('ghost')} title="Refresh"><RefreshCw size={14} /></button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-danger)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

      {loading ? <LoadingSpinner label="Loading packets…" /> : (
        displayed.length === 0
          ? <p style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>No work packets.</p>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)', background: 'var(--color-surface-alt)' }}>
                  {['ID', 'Source', 'Target', 'Type', 'Mode', 'Status', 'Created'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)', fontFamily: 'monospace', fontSize: '11px' }}>{p.id.slice(0, 8)}…</td>
                    <td style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--color-text)' }}>{p.source_org_id}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--color-text)' }}>{p.target_org_id}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }}>{p.packet_type}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-secondary)' }}>{p.mode}</td>
                    <td style={{ padding: '8px 12px' }}><StatusBadge status={p.status} /></td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)' }}>{formatRelative(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      )}
    </div>
  );
}


// ---- Org create / edit / suspend modal (14.9) --------------------------------

interface OrgFormProps {
  existing?: Organisation;
  onClose:   () => void;
  onSaved:   () => void;
}

function OrgForm({ existing, onClose, onSaved }: OrgFormProps) {
  const { client } = useAppConfig();
  const [form, setForm] = useState({
    org_id: existing?.org_id ?? '',
    name:   existing?.name   ?? '',
    status: existing?.status ?? 'active',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function handleSave() {
    if (!client || !form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (existing) {
        await client.updateOrg(existing.org_id, { name: form.name.trim(), status: form.status });
      } else {
        if (!form.org_id.trim()) { setError('Organisation ID is required'); setSaving(false); return; }
        await client.createOrg({ org_id: form.org_id.trim(), name: form.name.trim() });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(formatGuiError(e));
    } finally {
      setSaving(false);
    }
  }

  const isEdit = Boolean(existing);
  const VALID_STATUSES = existing
    ? ({ active: ['suspended'], suspended: ['active', 'archived'], archived: [] } as Record<string, string[]>)[existing.status] ?? []
    : [];

  return (
    <div style={{
      position:  'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', padding: '24px',
        width: '440px', boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
            {isEdit ? `Edit Organisation — ${existing!.org_id}` : 'Create Organisation'}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {!isEdit && (
            <div>
              <label style={labelStyle}>Organisation ID</label>
              <input
                value={form.org_id}
                onChange={(e) => setForm((f) => ({ ...f, org_id: e.target.value }))}
                placeholder="e.g. acme-corp"
                style={inputStyle}
              />
              <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                Lowercase alphanumeric + hyphens, max 64 chars. Cannot be changed.
              </p>
            </div>
          )}

          <div>
            <label style={labelStyle}>Display Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Acme Corporation"
              style={inputStyle}
            />
          </div>

          {isEdit && VALID_STATUSES.length > 0 && (
            <div>
              <label style={labelStyle}>Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                style={inputStyle}
              >
                <option value={existing!.status}>{existing!.status} (current)</option>
                {VALID_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {error && <p style={{ color: 'var(--color-danger)', fontSize: '12px', margin: 0 }}>{error}</p>}

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={btnStyle('ghost')} disabled={saving}>Cancel</button>
            <button onClick={() => void handleSave()} style={btnStyle('primary')} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ---- Org detail (tabs: channels + packets) ----------------------------------

type OrgTab = 'channels' | 'packets';

function OrgDetail({ org, onEdit, onClose }: { org: Organisation; onEdit: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<OrgTab>('channels');

  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: '20px', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>{org.name}</h2>
          <StatusBadge status={org.status} />
          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>{org.org_id}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onEdit} style={btnStyle('ghost')}>Edit</button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}><X size={16} /></button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--color-border)', marginBottom: '16px' }}>
        {([['channels', 'Channel Bindings', Link], ['packets', 'Work Packets', Package]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '13px', fontWeight: tab === key ? 600 : 400,
              color: tab === key ? 'var(--color-accent)' : 'var(--color-text-secondary)',
              borderBottom: tab === key ? '2px solid var(--color-accent)' : '2px solid transparent',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'channels' && <ChannelsPanel org={org} />}
      {tab === 'packets'  && <PacketsPanel  org={org} />}
    </div>
  );
}


// ---- Main Organisations page (14.1) -----------------------------------------

export function Organisations() {
  const { orgs, loading, refresh } = useOrg();
  const { client } = useAppConfig();
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [editTarget,    setEditTarget]     = useState<Organisation | null>(null);
  const [showCreate,    setShowCreate]     = useState(false);

  const selectedOrg = orgs.find((o) => o.org_id === selectedOrgId) ?? null;

  // Basic agent count from the org — we'll fetch it per org when we have them
  // (kept simple: show org count totals instead of live per-org queries)

  if (!client) {
    return (
      <div style={{ padding: '20px', color: 'var(--color-warning)', fontSize: '13px' }}>
        Not connected — configure server URL in Settings.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
          Organisations
        </h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={refresh} style={btnStyle('ghost')} title="Refresh">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setShowCreate(true)} style={btnStyle('primary')}>
            <Plus size={14} /> New Organisation
          </button>
        </div>
      </div>

      {/* Org list (14.1) */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)' }}>
        {loading ? (
          <div style={{ padding: '40px', display: 'flex', justifyContent: 'center' }}>
            <LoadingSpinner label="Loading organisations…" />
          </div>
        ) : orgs.length === 0 ? (
          <p style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '13px', margin: 0 }}>
            No organisations found.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-alt)', borderBottom: '2px solid var(--color-border)' }}>
                {['Organisation', 'Status', 'Created', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 16px', fontSize: '11px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr
                  key={org.org_id}
                  onClick={() => setSelectedOrgId(org.org_id === selectedOrgId ? null : org.org_id)}
                  style={{
                    borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    background: org.org_id === selectedOrgId ? 'var(--color-accent-muted)' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { if (org.org_id !== selectedOrgId) (e.currentTarget as HTMLTableRowElement).style.background = 'var(--color-bg-hover)'; }}
                  onMouseLeave={(e) => { if (org.org_id !== selectedOrgId) (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>{org.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px' }}>{org.org_id}</div>
                  </td>
                  <td style={{ padding: '12px 16px' }}><StatusBadge status={org.status} /></td>
                  <td style={{ padding: '12px 16px', color: 'var(--color-text-muted)' }}>
                    {org.created_at ? formatRelative(org.created_at) : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditTarget(org); }}
                      style={btnStyle('ghost')}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Org detail: channel bindings + work packets */}
      {selectedOrg && (
        <OrgDetail
          org={selectedOrg}
          onEdit={() => setEditTarget(selectedOrg)}
          onClose={() => setSelectedOrgId(null)}
        />
      )}

      {/* Create / edit modal (14.9) */}
      {showCreate && (
        <OrgForm onClose={() => setShowCreate(false)} onSaved={refresh} />
      )}
      {editTarget && (
        <OrgForm existing={editTarget} onClose={() => setEditTarget(null)} onSaved={refresh} />
      )}
    </div>
  );
}


// ---- Shared micro-styles ----------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: '13px',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
  background: 'var(--color-bg)', color: 'var(--color-text)',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)',
  marginBottom: '6px',
};

function btnStyle(variant: 'primary' | 'ghost'): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '6px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
    fontSize: '13px', fontWeight: 500, border: '1px solid var(--color-border)',
    background:  variant === 'primary' ? 'var(--color-accent)' : 'var(--color-surface)',
    color:       variant === 'primary' ? '#fff' : 'var(--color-text-secondary)',
  };
}
