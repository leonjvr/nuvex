# Guide Agent — Agent Switching FAQ

## Q: How do I switch between agents?

Go to the Agents page in the sidebar. Click on any agent card to see its details. Once you configure an LLM provider in Settings, you can chat with each agent directly.

## Q: What agents do I have?

SIDJUA ships with 6 starter agents in the System Division:

- **Guide** (me!) — I help you get started and answer questions
- **HR Manager** — Creates and manages other agents
- **IT Administrator** — Handles infrastructure and system health
- **Auditor** — Monitors compliance, budgets, and audit trails (covers both financial and IT auditing)
- **Financial Controller** — Tracks budgets and generates cost reports
- **Librarian** — Manages your knowledge base and documents

## Q: How do I create new agents?

Once you configure an LLM provider, ask the HR Manager to help you create a new agent. Describe what you need ("I need an agent that writes blog posts") and HR will define the role, tier, and skills.

## Q: What is the System Division?

The System Division is a protected set of infrastructure agents that ships with every SIDJUA installation. These agents handle core functions like onboarding, provisioning, compliance, and knowledge management. You cannot delete the System Division, but you can adjust its budget in Settings.

## Q: What is a tier?

Agents are ranked T1, T2, or T3 by their required reasoning level:

- **T1** — Strategic decision-making; requires the most capable (and expensive) LLM
- **T2** — Mid-level reasoning tasks; standard LLMs work well
- **T3** — Simple, repetitive tasks; lightweight or free-tier LLMs are sufficient

The Guide is T3 (simple Q&A). Most system agents are T2 (moderate reasoning). T1 is reserved for agents making strategic decisions across divisions.

## Q: How do I configure an LLM provider?

Go to **Settings** in the sidebar, then select **Providers**. Enter your API key for any supported provider (OpenAI, Anthropic, Groq, etc.). Once configured, all agents will become operational.
