import { useState } from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import {
  Bot,
  Shield,
  MessageSquare,
  DollarSign,
  ListTodo,
  Activity,
  Clock,
  Cpu,
  FolderOpen,
  GitBranch,
  Puzzle,
  Radio,
  BrainCircuit,
  ShieldCheck,
  CheckCircle,
  Users,
  UserCheck,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Globe,
  Download,
  Key,
} from "lucide-react";
import { OrgProvider, useOrg } from "./OrgContext";
import AgentsPage from "./pages/AgentsPage";
import AuditPage from "./pages/AuditPage";
import ThreadsPage from "./pages/ThreadsPage";
import CostsPage from "./pages/CostsPage";
import TasksPage from "./pages/TasksPage";
import EventsPage from "./pages/EventsPage";
import CronPage from "./pages/CronPage";
import ServicesPage from "./pages/ServicesPage";
import WorkspacePage from "./pages/WorkspacePage";
import LifecyclePage from "./pages/LifecyclePage";
import SkillsPage from "./pages/SkillsPage";
import ChannelsPage from "./pages/ChannelsPage";
import MemoryPage from "./pages/MemoryPage";
import OutcomesPage from "./pages/OutcomesPage";
import PolicyCandidatesPage from "./pages/PolicyCandidatesPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import ContactsPage from "./pages/ContactsPage";
import ContactDetailPage from "./pages/ContactDetailPage";
import PrincipalsPage from "./pages/PrincipalsPage";
import PluginsPage from "./pages/PluginsPage";
import OrgsPage from "./pages/OrgsPage";
import DownloadsPage from "./pages/DownloadsPage";
import DeviceTokensPage from "./pages/DeviceTokensPage";

type NavItem = { to: string; label: string; icon: React.ElementType };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { to: "/", label: "Agents", icon: Bot },
      { to: "/threads", label: "Threads", icon: MessageSquare },
      { to: "/tasks", label: "Tasks", icon: ListTodo },
      { to: "/events", label: "Events", icon: Activity },
      { to: "/cron", label: "Cron", icon: Clock },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/memory", label: "Memory", icon: BrainCircuit },
      { to: "/skills", label: "Skills", icon: Puzzle },
      { to: "/outcomes", label: "Outcomes", icon: Activity },
    ],
  },
  {
    label: "Governance",
    items: [
      { to: "/audit", label: "Audit", icon: Shield },
      { to: "/policy", label: "Policy", icon: ShieldCheck },
      { to: "/approvals", label: "Approvals", icon: CheckCircle },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { to: "/services", label: "Services", icon: Cpu },
      { to: "/workspace", label: "Workspace", icon: FolderOpen },
      { to: "/lifecycle", label: "Lifecycle", icon: GitBranch },
      { to: "/channels", label: "Channels", icon: Radio },
      { to: "/plugins", label: "Plugins", icon: Puzzle },
      { to: "/device-tokens", label: "Device Tokens", icon: Key },
      { to: "/downloads", label: "Downloads", icon: Download },
    ],
  },
  {
    label: "Organisation",
    items: [
      { to: "/orgs", label: "Organisations", icon: Building2 },
      { to: "/contacts", label: "Contacts", icon: Users },
      { to: "/principals", label: "Principals", icon: UserCheck },
      { to: "/costs", label: "Costs", icon: DollarSign },
    ],
  },
];

function TopBar() {
  const { activeOrg, setActiveOrg, orgs } = useOrg();
  const active = orgs.find((o) => o.org_id === activeOrg);
  const activeOrgs = orgs.filter((o) => o.status === "active");

  return (
    <header className="h-12 flex-none flex items-center justify-between px-5 bg-gray-900 border-b border-gray-800 z-10">
      {/* Left: breadcrumb / page context */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Globe size={14} className="text-gray-500" />
        <span className="text-gray-500">Organisation</span>
        <ChevronRight size={12} className="text-gray-600" />
        <span className="font-medium text-white">{active?.name ?? activeOrg ?? "—"}</span>
        {active?.status === "active" && (
          <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/60 text-green-400 border border-green-800/50">active</span>
        )}
      </div>

      {/* Right: org selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 hidden sm:block">Switch org:</span>
        <div className="relative">
          <select
            value={activeOrg ?? ""}
            onChange={(e) => setActiveOrg(e.target.value)}
            className="appearance-none bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-1.5 pr-7 focus:outline-none focus:border-indigo-500 cursor-pointer hover:bg-gray-700 transition-colors"
          >
            {activeOrgs.length === 0 && (
              <option value={activeOrg ?? ""}>{active?.name ?? activeOrg ?? "No organisations"}</option>
            )}
            {activeOrgs.map((o) => (
              <option key={o.org_id} value={o.org_id}>{o.name}</option>
            ))}
          </select>
          <ChevronsUpDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>
      </div>
    </header>
  );
}

function NavGroup({ group, defaultOpen }: { group: NavGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const location = useLocation();
  const hasActive = group.items.some(
    (item) => item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)
  );

  return (
    <li>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
          hasActive ? "text-indigo-400" : "text-gray-500 hover:text-gray-300"
        }`}
      >
        {group.label}
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && (
        <ul className="space-y-0.5 mb-1">
          {group.items.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-1.5 text-sm rounded mx-2 transition-colors ${
                    isActive
                      ? "bg-indigo-600 text-white"
                      : "text-gray-400 hover:text-white hover:bg-gray-800"
                  }`
                }
              >
                <Icon size={15} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function App() {
  return (
    <OrgProvider>
      <AppInner />
    </OrgProvider>
  );
}

function AppInner() {
  const location = useLocation();

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <nav className="w-48 flex-none bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-4 border-b border-gray-800">
          <a href="/" className="text-lg font-bold tracking-tight text-indigo-400 hover:text-indigo-300 transition-colors">NUVEX</a>
        </div>
        <ul className="flex-1 py-3 space-y-1 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <NavGroup
              key={group.label}
              group={group}
              defaultOpen={group.items.some(
                (item) => item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to)
              )}
            />
          ))}
        </ul>
      </nav>

      {/* Main content: top bar + page */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<AgentsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/threads" element={<ThreadsPage />} />
          <Route path="/costs" element={<CostsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/cron" element={<CronPage />} />
          <Route path="/services" element={<ServicesPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/lifecycle" element={<LifecyclePage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/channels" element={<ChannelsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/outcomes" element={<OutcomesPage />} />
          <Route path="/policy" element={<PolicyCandidatesPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/contacts/:contactId" element={<ContactDetailPage />} />
          <Route path="/principals" element={<PrincipalsPage />} />
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/orgs" element={<OrgsPage />} />
          <Route path="/device-tokens" element={<DeviceTokensPage />} />
          <Route path="/downloads" element={<DownloadsPage />} />
        </Routes>
        </main>
      </div>
    </div>
  );
}
