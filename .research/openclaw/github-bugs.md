# OpenClaw GitHub — Bugs & Issues (sorted by popularity)

Source: github.com/openclaw/openclaw/issues?q=is:issue+is:open+sort:reactions-desc  
Collected: April 9, 2026

---

## Category 1: UI / Control Panel Bugs

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #44869 | Control UI shows error triangle with no input box when switching to main session | 11 | bug:behavior |

**Impact:** Users lose the ability to interact with their agent until they restart. High-friction UX breakage.

---

## Category 2: Model / Provider Compatibility

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #9837 | Anthropic adaptive thinking / effort param not respected for Opus 4.6 | 12 | Feature/bug hybrid |
| #57430 | "Reasoning is required for this model endpoint" — breaks non-think models | 7 | regression |
| #54844 | github-copilot/gpt-5-mini fails with 400 invalid_request_body | 9 | regression |

**Signal:** Model churn (rapid new releases) frequently breaks compatibility. Regressions from provider API changes are among the most-commented bugs.

---

## Category 3: System Execution / Shell

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #37591 | macOS Node: Missing system.run.prepare command prevents system.run execution | 6 | macOS |
| #41871 | Local Ollama models still hang in 2026.3.8 (retest of #31399) | 5 | Ollama |
| #58691 | tools.exec.ask='off' and tools.exec.security='full' ignored | 0 | Config ignored |

**Signal:** Exec/shell tooling is the core power feature of OpenClaw. Bugs here directly block the main value proposition. Ollama hangs is a recurring issue (#31399 previously, now #41871), suggesting deep flakiness.

---

## Category 4: Docker / Linux Compatibility

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #14593 | Skill install fails in Docker: brew not installed on Linux container | 22 | 22 comments — high pain |

**Signal:** 22 comments is exceptional for a bug. Skills assume macOS (`brew`) and break in Docker/Linux. Given OpenClaw's install-everywhere positioning, this is a critical gap. Users want to run agents on headless Linux servers.

---

## Category 5: Session / Config Bugs

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #23414 | mode="session" requires thread=true — blocks orchestrator pattern on non-Discord channels | 7 | Architecture constraint |
| #58691 | tools.exec.ask='off' config flag silently ignored | 0 | Config not honoured |

**Signal:** Session config complexity creates subtle bugs that are hard to debug. The orchestrator pattern being blocked on non-Discord channels limits multi-agent architectures.

---

## Category 6: Network / Security Middleware

| Issue | Title | Comments | Notes |
|-------|-------|----------|-------|
| #33086 | SSRF protection blocks Discord CDN when behind Clash Verge TUN (fake-ip) | 9 | Network policy |

**Signal:** SSRF protection (a security feature) conflicts with common proxy/VPN setups used in China and corporate environments. 9 comments suggests a sizeable affected group.

---

## Bug Priority Matrix

| Rank | Issue | Severity Signal |
|------|-------|----------------|
| 1 | Skill install fails in Docker (brew assumption) | 22 comments — blocks headless/server deployment |
| 2 | Model regressions (gpt-5-mini, reasoning endpoint) | 9+7 comments — breaks daily use after updates |
| 3 | Control UI error triangle (no input) | 11 comments — hard-blocks interaction |
| 4 | mode="session" requires thread=true | 7 comments — blocks advanced patterns |
| 5 | Ollama hang (recurring) | 5 comments — local model users blocked |
| 6 | SSRF blocks Discord CDN on proxy/VPN | 9 comments — geography-specific |
| 7 | System.run.prepare missing on macOS Node | 6 comments |
| 8 | exec.ask config ignored | silent — unknown blast radius |

---

## Cross-cutting Observations

1. **macOS bias in codebase**: `brew` assumption in skill installs, macOS-only desktop app — Linux users are second-class citizens despite demand.
2. **Regression velocity**: The issue tracker shows repeated regressions against model providers as they push API changes rapidly. OpenClaw needs a provider-compatibility test layer.
3. **Config trust deficit**: Multiple issues where config flags are silently ignored (exec.ask, exec.security). Users can't trust their settings.
4. **Ollama is flaky**: Appears in issue tracker repeatedly. Local model support is wanted but unreliable.
