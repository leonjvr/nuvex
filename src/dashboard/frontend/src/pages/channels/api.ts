// Types and fetch helpers for the Channels page

export interface WhatsAppConfig {
  enabled: boolean;
  agent_id: string;
  dm_policy: string;
  group_policy: string;
  humanise_enabled: boolean;
  humanise_read_receipt_delay_ms: number;
  humanise_thinking_delay_ms: number;
  humanise_typing_speed_wpm: number;
  humanise_chunk_messages: boolean;
}

export interface QRStatus {
  status: "offline" | "pairing" | "connected" | "logged_out";
  qr: string | null;
  ts: number | null;
}

export interface AgentChannelConfig {
  enabled?: boolean;
  [key: string]: unknown;
}

export interface ChannelFieldDef {
  key: string;
  label: string;
  secret: boolean;
  placeholder: string;
  help?: string;
  type?: "text" | "toggle" | "number";
}

export const CHANNEL_FIELDS: Record<string, ChannelFieldDef[]> = {
  whatsapp: [
    { key: "sync_full_history", label: "Sync Full History", secret: false, placeholder: "", type: "toggle", help: "Download full message history on connect" },
    { key: "humanise_enabled", label: "Humanised Responses", secret: false, placeholder: "", type: "toggle", help: "Add realistic delays and typing indicators" },
    { key: "humanise_read_receipt_delay_ms", label: "Read Receipt Delay (ms)", secret: false, placeholder: "1500", type: "number", help: "Avg delay before blue tick (randomised ±50%)" },
    { key: "humanise_thinking_delay_ms", label: "Thinking Delay (ms)", secret: false, placeholder: "2500", type: "number", help: "Avg delay before typing starts (randomised ±50%)" },
    { key: "humanise_typing_speed_wpm", label: "Typing Speed (WPM)", secret: false, placeholder: "45", type: "number", help: "Simulated words-per-minute while composing" },
    { key: "humanise_chunk_messages", label: "Chunk Long Messages", secret: false, placeholder: "", type: "toggle", help: "Split long replies into multiple messages with pauses" },
  ],
  telegram: [
    { key: "bot_token", label: "Bot Token", secret: true, placeholder: "123456:ABCdef...", help: "From @BotFather on Telegram" },
    { key: "allowed_users", label: "Allowed User IDs", secret: false, placeholder: "123456789,987654321", help: "Comma-separated. Empty = no restriction." },
  ],
  email: [
    { key: "imap_host", label: "IMAP Host", secret: false, placeholder: "imap.gmail.com" },
    { key: "imap_port", label: "IMAP Port", secret: false, placeholder: "993" },
    { key: "smtp_host", label: "SMTP Host", secret: false, placeholder: "smtp.gmail.com" },
    { key: "smtp_port", label: "SMTP Port", secret: false, placeholder: "587" },
    { key: "email_user", label: "Email Address", secret: false, placeholder: "agent@example.com" },
    { key: "email_pass", label: "Password / App Password", secret: true, placeholder: "App password" },
  ],
  slack: [
    { key: "bot_token", label: "Bot Token", secret: true, placeholder: "xoxb-...", help: "From Slack app settings" },
    { key: "signing_secret", label: "Signing Secret", secret: true, placeholder: "...", help: "From Slack app Basic Information" },
    { key: "default_channel", label: "Default Channel", secret: false, placeholder: "#general" },
  ],
  discord: [
    { key: "bot_token", label: "Bot Token", secret: true, placeholder: "...", help: "From Discord Developer Portal" },
    { key: "guild_id", label: "Server ID", secret: false, placeholder: "123456789012345678", help: "Right-click server → Copy Server ID" },
    { key: "webhook_url", label: "Webhook URL (optional)", secret: false, placeholder: "https://discord.com/api/webhooks/..." },
  ],
};

export const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  email: "Email",
  slack: "Slack",
  discord: "Discord",
};

export const GATEWAY_STATUS: Record<string, string> = {
  slack: "Gateway not yet implemented — config will be used once available.",
  discord: "Gateway not yet implemented — config will be used once available.",
};

// ── API calls ────────────────────────────────────────────────────────────────

export async function fetchAgentList(): Promise<string[]> {
  const res = await fetch("/api/channels/agents");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchWhatsAppConfig(): Promise<WhatsAppConfig> {
  const res = await fetch("/api/channels/whatsapp");
  if (!res.ok) return { enabled: false, agent_id: "maya", dm_policy: "pairing", group_policy: "allowlist", humanise_enabled: false, humanise_read_receipt_delay_ms: 1500, humanise_thinking_delay_ms: 2500, humanise_typing_speed_wpm: 45, humanise_chunk_messages: true };
  return res.json();
}

export async function saveWhatsAppConfig(cfg: WhatsAppConfig): Promise<void> {
  await fetch("/api/channels/whatsapp", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
}

export async function fetchQRStatus(): Promise<QRStatus> {
  const res = await fetch("/api/channels/whatsapp/qr");
  if (!res.ok) return { status: "offline", qr: null, ts: null };
  return res.json();
}

export async function clearWASession(): Promise<void> {
  await fetch("/api/channels/whatsapp/clear", { method: "POST" });
}

export interface GatewayStatus {
  status: "running" | "stopped" | "unavailable";
}

export async function fetchGatewayStatus(): Promise<GatewayStatus> {
  const res = await fetch("/api/channels/whatsapp/gateway");
  if (!res.ok) return { status: "unavailable" };
  return res.json();
}

export interface ChannelGatewayStatus {
  connected: boolean;
  state: string; // "starting" | "connecting" | "connected" | "reconnecting" | "error: ..." | "offline"
}

export async function fetchChannelGatewayStatus(channel: string): Promise<ChannelGatewayStatus> {
  const res = await fetch(`/api/channels/${channel}/gateway`);
  if (!res.ok) return { connected: false, state: "offline" };
  return res.json();
}

export async function startGateway(): Promise<GatewayStatus> {
  const res = await fetch("/api/channels/whatsapp/gateway/start", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function stopGateway(): Promise<GatewayStatus> {
  const res = await fetch("/api/channels/whatsapp/gateway/stop", { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchAgentChannel(agentId: string, channel: string): Promise<AgentChannelConfig> {
  const res = await fetch(`/api/channels/agents/${agentId}/${channel}`);
  if (!res.ok) return {};
  return res.json();
}

export async function saveAgentChannel(agentId: string, channel: string, config: AgentChannelConfig): Promise<void> {
  await fetch(`/api/channels/agents/${agentId}/${channel}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
}

export interface GroupBinding {
  jid: string;
  workspace: string;
  label: string;
}

export interface KnownGroup {
  id: string;
  name?: string;
  subject?: string;
  is_group: boolean;
}

export async function fetchKnownGroups(): Promise<KnownGroup[]> {
  const res = await fetch("/api/channels/whatsapp/groups");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchGroupBindings(): Promise<GroupBinding[]> {
  const res = await fetch("/api/channels/whatsapp/group-bindings");
  if (!res.ok) return [];
  return res.json();
}

export async function saveGroupBindings(bindings: GroupBinding[]): Promise<void> {
  await fetch("/api/channels/whatsapp/group-bindings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bindings }),
  });
}
