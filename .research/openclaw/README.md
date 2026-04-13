# OpenClaw Research Index

> Competitive intelligence on OpenClaw (openclaw.ai) — the leading open-source personal AI agent platform.
> Research date: April 9, 2026.

---

## Files in This Folder

| File | Contents |
|------|----------|
| [github-feature-requests.md](./github-feature-requests.md) | All open feature requests, categorised by theme, ranked by community engagement |
| [github-bugs.md](./github-bugs.md) | Top open bugs, categorised by type, ranked by pain intensity |
| [clawhub-popular-skills.md](./clawhub-popular-skills.md) | Top 25 ClawHub skills by download count with category analysis |
| [gap-analysis.md](./gap-analysis.md) | **Primary output**: what users want most that OpenClaw doesn't provide, with NUVEX implications |

---

## Key Numbers (April 2026)

| Metric | Value |
|--------|-------|
| GitHub stars | ~71k (71.2k forks seen in issues page) |
| Open issues | 11,365 |
| Closed issues | 15,985 |
| Skills on ClawHub | 49,730 |
| Most downloaded skill | self-improving-agent (368k) |
| Highest-comment feature req | #3460 i18n (120 comments) |
| Oldest open issue | #75 Linux/Windows app (Jan 1) |

---

## Top-Line Findings

1. **Self-learning memory** is the single biggest user demand (522k combined downloads for two workaround skills). OpenClaw's memory is flat-file only; no feedback loop, no episodic learning.

2. **Structured / semantic memory** (157k ontology skill) — users need to query their agents knowledge graph, not just raw files.

3. **i18n** (120 comments on a single issue) — massive non-English user base is underserved. Chinese market especially large (Baidu skills, 75k + 75k + 28k).

4. **Office documents** (132k across Word/Excel/PPT skills) — business users need agents that edit real documents, not just spit out markdown.

5. **Web search** (175k across 3 skills, no clear winner) — no built-in search means users install competing skills and get fragmented results.

6. **MCP client** (53.7k + 14-comment issue) — the 2026 tool protocol standard is a workaround, not native.

7. **Free LLM routing** (54.4k) — the paid-subscription requirement is a friction point; users want cost management baked in.

8. **Linux/Windows desktop** — oldest open GitHub issue; CLI works but onboarding is developer-only.

---

## NUVEX Strategic Takeaways

- OpenClaw competes on **personal productivity + ease of use + community ecosystem**.
- NUVEX competes on **enterprise governance + multi-agent org structures + production reliability**.
- The top gaps in OpenClaw (self-learning memory, semantic memory, multi-user RBAC) are either **NUVEX's existing strengths** (RBAC via divisions.yaml) or **high-value features to build** (vector memory, self-improvement loop).
- For feature priority in NUVEX, the skill download data is the most honest signal: people vote with installs, not GitHub reactions. **522k self-learning downloads cannot be ignored.**
