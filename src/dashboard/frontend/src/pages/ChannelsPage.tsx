import { useState } from "react";
import { ChevronDown, ChevronRight, Globe, Hash, Mail, MessageSquare, Radio } from "lucide-react";
import WhatsAppSection from "./channels/WhatsAppSection";
import AgentChannelSection from "./channels/AgentChannelSection";

type ChannelDef = {
  id: string;
  label: string;
  icon: React.ElementType;
  iconColor: string;
  scope: string;
  description: string;
};

const CHANNELS: ChannelDef[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageSquare,
    iconColor: "text-green-400",
    scope: "Org-wide",
    description: "One WhatsApp number per organisation. Pair via QR from this screen.",
  },
  {
    id: "telegram",
    label: "Telegram",
    icon: Radio,
    iconColor: "text-sky-400",
    scope: "Per-agent",
    description: "Each agent can run its own Telegram bot with a dedicated token.",
  },
  {
    id: "email",
    label: "Email",
    icon: Mail,
    iconColor: "text-amber-400",
    scope: "Per-agent",
    description: "Assign an email address to any agent. IMAP + SMTP credentials stored per agent.",
  },
  {
    id: "slack",
    label: "Slack",
    icon: Hash,
    iconColor: "text-purple-400",
    scope: "Per-agent",
    description: "Connect an agent to a Slack workspace using a bot token.",
  },
  {
    id: "discord",
    label: "Discord",
    icon: Globe,
    iconColor: "text-indigo-400",
    scope: "Per-agent",
    description: "Connect an agent to a Discord server via bot token or webhook.",
  },
];

function ChannelCard({ ch, defaultOpen = false }: { ch: ChannelDef; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = ch.icon;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-4 px-5 py-4 bg-gray-900 hover:bg-gray-800/60 transition-colors text-left"
      >
        <span className={`shrink-0 ${ch.iconColor}`}>
          <Icon size={20} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-100">{ch.label}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700">
              {ch.scope}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{ch.description}</p>
        </div>
        <Chevron size={16} className="shrink-0 text-gray-600" />
      </button>

      {open && (
        <div className="border-t border-gray-800 bg-gray-950 px-5 py-5">
          {ch.id === "whatsapp" ? (
            <WhatsAppSection />
          ) : (
            <AgentChannelSection channel={ch.id} />
          )}
        </div>
      )}
    </div>
  );
}

export default function ChannelsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-2">
        <Radio size={22} className="text-indigo-400" />
        <h1 className="text-xl font-semibold text-gray-100">Communication Channels</h1>
      </div>
      <p className="text-sm text-gray-400 mb-6">
        All channels are optional. Configure only what you need. Credentials are stored in{" "}
        <code className="text-xs font-mono text-indigo-300">config/nuvex.yaml</code>.
      </p>

      <div className="flex flex-col gap-3">
        {CHANNELS.map((ch, i) => (
          <ChannelCard key={ch.id} ch={ch} defaultOpen={i === 0} />
        ))}
      </div>
    </div>
  );
}
