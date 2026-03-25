# SIDJUA Complete Handbook

## Section 1: Welcome & First Steps

SIDJUA (Structured Intelligence for Distributed Joint Unified Automation) is an AI Agent Governance Platform that lets you run, manage, and monitor a team of AI agents from a single web interface. After running `sidjua init`, a web server starts on port 3000 (configurable) and your browser opens to the dashboard. You start with 6 pre-configured agents — no configuration needed beyond providing an LLM API key.

**The 6 Starter Agents:**
- **Guide** — Your first point of contact. Answers questions, explains concepts, directs you to the right agent.
- **HR Manager** — Creates and manages other agents. Ask HR to define new roles.
- **IT Administrator** — Handles infrastructure questions, system health, Docker, and backups.
- **Auditor** — Monitors compliance, audit trails, and budget governance (covers both financial and IT auditing).
- **Financial Controller** — Tracks budgets, generates cost reports, and analyzes spending trends.
- **Librarian** — Manages your knowledge base, searches documents, and handles archives.

**Accessing the Web GUI:**
Open your browser to `http://localhost:3000` (or the configured port). The GUI works on desktop and tablet. No installation required — it runs in your browser.

---

## Section 2: Setting Up Your LLM Provider

Agents need an LLM (Large Language Model) provider to reason, respond, and complete tasks. Without a provider, agents are visible but cannot chat or process requests.

**Step-by-step setup:**
1. Click **Settings** in the left sidebar
2. Under "LLM Provider", select a provider from the list
3. Click the signup link to create an account (if you haven't already)
4. Copy your API key from the provider's dashboard
5. Paste the key into the "API Key" field
6. Click **Test Connection** — wait for the green "Connection successful" message
7. Click **Save** — your provider is now configured

**Free Providers (recommended to start):**
- **Groq** (groq-llama70b-free) — Recommended. 1,000 requests/day free. Sign up at console.groq.com. Fast inference on Llama 3.
- **Google AI Studio** (google-gemini-flash-free) — 250 requests/day free. Sign up at aistudio.google.com. Good for longer conversations.

**Paid Providers:**
- **DeepSeek V3** — Very affordable ($0.14/M input tokens). Excellent for reasoning tasks.
- **Google Flash-Lite** — Low cost, fast responses.
- **OpenAI GPT-4o-mini** — Widely supported, strong tool use.
- **Google Gemini Flash** — Good balance of speed and quality.
- **Mistral Medium 3** — European provider, strong multilingual support.
- **Groq Paid** — Same speed as free tier, higher rate limits.

**Custom Providers:**
You can connect any OpenAI-compatible API:
- **Ollama** (local): Use `http://localhost:11434/v1` as the base URL. No API key required.
- **LM Studio** (local): Use `http://localhost:1234/v1`
- **vLLM**: Use your server URL with `/v1` suffix
- **Anthropic**: Use `https://api.anthropic.com/v1` (Claude models)

**Simple mode vs Advanced mode:**
- **Simple mode**: All agents use the same provider and model. Easiest to start.
- **Advanced mode**: Each agent can use a different provider. Useful when some agents need stronger models (T1 strategic agents) and others can use free tier (T3 simple tasks).

**Changing your provider:** Go back to Settings → select a new provider → test → save. The old config is replaced.

**Troubleshooting "Test Connection failed":**
- Double-check your API key (no extra spaces, correct prefix)
- Verify you have an active account with sufficient quota
- For custom URLs, ensure the service is running and the URL ends with `/v1`
- Check your firewall — the SIDJUA server makes outbound HTTPS requests
- Rate limit errors: wait 60 seconds and try again

---

## Section 3: Chatting with Agents

Once a provider is configured, you can have conversations with any of the 6 agents.

**Opening a chat:**
1. Click **Chat** in the left sidebar (opens Guide by default)
2. OR go to **Agents** → click any agent card → click "Chat with [Name]"
3. The chat opens immediately with a text input at the bottom

**Agent Switcher:**
At the top of the chat interface, you'll see a row of 6 agent icons. Click any icon to switch agents mid-session. Each agent has its own separate conversation history — switching agents does not lose your conversation with the previous one.

**Conversation history:**
Each agent remembers the last 100 messages in your session. Click **Clear** (top right of chat) to start a fresh conversation with that agent.

**What each agent can help with:**
- **Guide**: Getting started with SIDJUA, navigation help, understanding concepts, learning what each agent does
- **HR Manager**: Creating new agents, defining roles, assigning skills, managing agent lifecycle
- **IT Administrator**: Infrastructure questions, system health checks, Docker configuration, backup and restore, environment setup
- **Auditor**: Compliance reports, budget enforcement monitoring, audit trail queries, governance reviews — covers both finance and IT auditing
- **Financial Controller**: Budget reports, cost analysis by agent or division, spending trends, cost optimization advice
- **Librarian**: Finding documents, searching your knowledge base, archive management, document summarization

**Agent suggestions:** If an agent can't help with your request, it will suggest which agent to ask instead. You can switch using the Agent Switcher at the top.

---

## Section 4: Understanding Your Team

**The Agents page** (sidebar → Agents) shows a card grid of all 6 starter agents. Each card displays:
- Agent name and icon
- Tier badge (T1/T2/T3)
- Status dot (active/inactive)
- LLM status (green "LLM ready" / yellow "No LLM configured")
- Domain tags

**Tier system:**
- **T1 (Strategic)**: Complex multi-step reasoning across divisions. Requires the most capable LLM. Reserved for high-level orchestration.
- **T2 (Reasoning)**: Mid-level tasks like creating agents, writing reports, analyzing compliance data. Standard LLMs recommended.
- **T3 (Simple)**: FAQ responses, basic lookups, routing. Free-tier LLMs are sufficient. The Guide agent is T3.

**Divisions:**
Agents belong to organizational units called divisions. The **System Division** is a protected division that ships with every SIDJUA installation — you cannot delete it. It contains all 6 starter agents.

**Agent status:**
- **Active**: Agent is running and ready to process requests
- **Inactive**: Agent is defined but not yet started
- Agents in the starter team default to "active" once a provider is configured

**Auditor's cross-domain role:**
The Auditor agent is unusual — it covers both financial compliance and IT audit trails. When you have questions about governance, budget enforcement, or system compliance, the Auditor handles all of it.

---

## Section 5: Creating New Agents

When you need an agent for a task your starter team doesn't cover (e.g., a blog writer, a customer support agent, a code reviewer):

1. Chat with the **HR Manager** agent
2. Describe what you need in plain language: "I need an agent that reviews pull requests and suggests improvements"
3. HR will ask clarifying questions: division, required capabilities, tier level
4. HR proposes a role definition — review and confirm
5. The new agent appears in the Agents page after creation

New agents are automatically added to a division (you can specify which one, or HR will suggest). They require an LLM provider to operate — they use the same provider you configured in Settings unless you're in Advanced mode.

---

## Section 6: Budget & Costs

**Default budget (System Division):**
- $2.00 per day
- $30.00 per month
These limits apply to the total LLM API cost across all starter agents.

**Free tier providers:**
If you use Groq (free) or Google AI Studio (free), your cost is $0. The budget limits don't apply because there are no charges. However, the providers have their own rate limits (1,000 req/day for Groq, 250 req/day for Google AI Studio).

**Per-agent cost tracking:**
The system tracks how much each agent costs. Go to **Budget** in the sidebar to see:
- Total spending today / this month
- Per-agent breakdown
- Per-division breakdown

**Budget enforcement:**
When an agent exceeds its budget, it stops accepting new tasks until the next period resets. You can increase limits by editing the division budget in Settings.

---

## Section 7: Navigation Reference

**Dashboard** (`/`): System overview — agent count, recent activity, budget status.

**Chat** (`/chat`): Chat with your agents. Opens Guide by default. Use the Agent Switcher to move between agents.

**Agents** (`/agents`): Your team. Cards show all 6 starter agents. Click a card to see details. Click "Chat" to start a conversation. The table below shows operational agents created via `sidjua apply`.

**Divisions** (`/divisions`): Organizational structure. Shows the System Division and any custom divisions created via `sidjua apply`.

**Audit** (`/audit`): Compliance and activity logs. Filter by division, agent, event type, or date range.

**Budget** (`/costs`): Spending overview. Filter by period, division, or agent.

**Settings** (`/settings`): Configure your LLM provider (Simple or Advanced mode). Also contains server connection settings and theme toggle.

---

## Section 8: Troubleshooting

**"No LLM configured" warning on agent cards:**
Go to Settings → configure a provider → test → save. Refresh the Agents page.

**Chat input is disabled:**
You need to configure a provider first. The input shows "Configure an LLM provider in Settings to start chatting" when no provider is set.

**"Connection failed" when testing provider:**
Check your API key (copy-paste it fresh), check your internet connection, verify the provider's status page for outages.

**Rate limit error in chat:**
You've exceeded the provider's free-tier limit (Groq: 1,000/day, Google: 250/day). Either wait until tomorrow or switch to a paid provider in Settings.

**Agent not responding:**
Try: Settings → Test Connection. If that fails, check if your API key expired. Generate a new key and update Settings.

**Chat history lost after restart:**
Chat history is stored in your browser session — it resets on page refresh or server restart. This is expected behavior in v1. Future versions will persist history.

**Docker volume for data:**
If running SIDJUA in Docker, mount a volume at `/data` to persist configuration across container restarts. Provider config and agent definitions are stored in `/data/config/`.
