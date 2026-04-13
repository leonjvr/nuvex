# OpenClaw GitHub — Feature Requests (sorted by popularity)

Source: github.com/openclaw/openclaw/issues?q=is:issue+is:open+sort:reactions-desc  
Collected: April 9, 2026  
Open issues: 11,365 | Closed: 15,985

---

## Category 1: Platform & OS Expansion

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #75 | **Linux/Windows Clawdbot Desktop Apps** | 78 | Opened Jan 1 by @steipete — oldest open issue, signals massive demand |
| #10880 | Support Intel (x86_64) Macs for macOS desktop app | 0 | Old Intel Macs not supported |

**Signal:** The oldest open issue is a desktop app for Linux/Windows. OpenClaw runs as a CLI/server but has no native GUI app outside macOS. Community is vocal about this repeatedly.

---

## Category 2: LLM Provider Integration

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #9979 | Add Support for Google Cloud Vertex AI Provider | 0 | Enterprise segment |
| #7309 | Support DeepSeek API as a first-class LLM provider | 6 | Open-source/cost |
| #11533 | Support DeepInfra as an LLM provider | 1 | Inference hosting |
| #9837 | Support Anthropic adaptive thinking / effort param for Opus 4.6 | 12 | Model capability |
| #16910 | Allow openclaw to use Cursor credits | 1 | Cost reuse |

**Signal:** Users want to plug in any LLM provider — not just Anthropic/OpenAI. DeepSeek demand is high (cost-driven). Vertex AI is enterprise-driven.

---

## Category 3: Messaging Channel Integration

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #12602 | Slack Block Kit support for agent messages | 11 | Richer Slack UX |
| #7520 | Rocket.Chat integration | 2 | Self-hosted comms |
| #14008 | Add WeChat Work (企业微信) channel extension | 0 | China market |
| #3460 | Internationalization (i18n) & Localization Support | 120 | 120 comments — massive signal |

**Signal:** i18n (#3460 with 120 comments) is the single most-discussed feature request by comment count, suggesting a large non-English speaking user base is blocked. Channel expansion beyond WhatsApp/Telegram/Discord/Slack/Signal/iMessage is continually requested.

---

## Category 4: Memory & Knowledge Architecture

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #14049 | Qdrant-based Persistent Memory for OpenClaw Agents | 0 | Vector/semantic memory |

**Signal:** Only one filed issue but skill download data (self-improving-agent at 368k) reveals this is the #1 community gap. Current memory is session/file-based, not vector-indexed.

---

## Category 5: Multi-user / Team / Enterprise

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #8081 | Multi-user permission management with role-based access control | 8 | RBAC |

**Signal:** OpenClaw is currently single-user by design. Teams and families want shared agents with access controls.

---

## Category 6: Voice & Audio

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #7200 | Real-time Voice Conversation Support | 15 | 15 comments |

**Signal:** Users want voice-in/voice-out (not just TTS callbacks). Social proof: @mirthtime got OpenClaw to call their phone via ElevenLabs — a workaround, not native.

---

## Category 7: Security & Execution Granularity

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #58772 | Support allow-always exec security policy | 2 | Trust permanently-approved commands |
| #6615 | Add denylist support for exec-approvals | 4 | Block specific commands always |

**Signal:** Current approval model is binary. Power users want per-command trust/deny lists so they aren't prompted for every `ls`.

---

## Category 8: Developer Experience & Tooling

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #29053 | MCP Client: Native support for connecting to external MCP servers | 14 | Use MCP ecosystem natively |
| #37057 | RTK exec proxy — compress tool output to save context tokens | 1 | Token/cost management |
| #12297 | sessions_kill and sessions_cleanup tools | 4 | Lifecycle management |
| #8079 | Proxy configuration option for browser tool | 5 | Corporate network support |
| #9959 | Session list and switch from chat interface | 0 | UX improvement |
| #22278 | Publish openclaw.json JSON Schema to docs + auto-regenerate | 11 | IDE tooling |

**Signal:** MCP native client is a hot request (14 comments). The community built a workaround skill (Mcporter, 53.7k downloads), confirming demand. Token compression is being solved at the community level too.

---

## Summary: Feature Request Priority Matrix

| Rank | Category | Demand Signal |
|------|----------|---------------|
| 1 | Persistent vector/semantic memory | 368k+154k skill downloads, issue #14049 |
| 2 | i18n / localization | 120 comments on #3460 |
| 3 | Linux/Windows desktop app | #75 oldest open issue, 78 comments |
| 4 | Real-time voice conversation | 15 comments #7200, social proof |
| 5 | Native MCP client | 14 comments #29053, 53.7k workaround downloads |
| 6 | Multi-user / RBAC | #8081, growing team use cases |
| 7 | LLM provider breadth (Vertex, DeepSeek) | Multiple issues, cost-driven |
| 8 | Exec security granularity | Multiple issues |
| 9 | Channel expansion (Rocket.Chat, WeChat Work) | Multiple issues |
| 10 | Context/token compression | #37057 |
