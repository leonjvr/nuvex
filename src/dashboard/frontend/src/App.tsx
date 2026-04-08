import { Routes, Route, NavLink } from "react-router-dom";
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
} from "lucide-react";
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

const NAV = [
  { to: "/", label: "Agents", icon: Bot },
  { to: "/audit", label: "Audit", icon: Shield },
  { to: "/threads", label: "Threads", icon: MessageSquare },
  { to: "/costs", label: "Costs", icon: DollarSign },
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/events", label: "Events", icon: Activity },
  { to: "/cron", label: "Cron", icon: Clock },
  { to: "/services", label: "Services", icon: Cpu },
  { to: "/workspace", label: "Workspace", icon: FolderOpen },
  { to: "/lifecycle", label: "Lifecycle", icon: GitBranch },
  { to: "/skills", label: "Skills", icon: Puzzle },
  { to: "/channels", label: "Channels", icon: Radio },
  { to: "/memory", label: "Memory", icon: BrainCircuit },
  { to: "/outcomes", label: "Outcomes", icon: Activity },
  { to: "/policy", label: "Policy", icon: ShieldCheck },
  { to: "/approvals", label: "Approvals", icon: CheckCircle },
];

export default function App() {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Sidebar */}
      <nav className="w-48 flex-none bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="px-4 py-5 border-b border-gray-800">
          <span className="text-lg font-bold tracking-tight text-indigo-400">NUVEX</span>
        </div>
        <ul className="flex-1 py-4 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-2 text-sm rounded mx-2 transition-colors ${
                    isActive
                      ? "bg-indigo-600 text-white"
                      : "text-gray-400 hover:text-white hover:bg-gray-800"
                  }`
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Main content */}
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
        </Routes>
      </main>
    </div>
  );
}
