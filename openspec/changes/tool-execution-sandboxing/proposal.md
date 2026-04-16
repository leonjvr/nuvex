## Why

NUVEX currently runs tool scripts and plugin code in subprocesses that share the host OS user, filesystem, and network. A malicious or buggy skill script can read arbitrary files, consume unbounded CPU/memory, or make network calls outside governance control. The governed plugin architecture (V1) uses SDK-level permission enforcement — a plugin without `network` permission simply doesn't get an `http_client`, but it can `import httpx` directly. The skill architecture deferred sandbox/Docker isolation in favour of subprocess isolation.

For a true AI Operating System, every tool execution must be isolated at the OS level — not just at the SDK level. This change adds per-execution sandboxing using Linux namespaces and seccomp profiles, giving each tool call its own restricted environment with filesystem, network, and resource limits enforced by the kernel.

**Priority: HIGH** — This is the biggest security gap in the current architecture. Without it, any skill script can break out of SDK-level permission grants.

## What Changes

- **New `src/brain/sandbox/` module** — Container-like isolation for tool subprocess execution using `nsjail` (lightweight, Google-maintained namespace jail) or fallback to `unshare` + `seccomp-bpf`.
- **Per-execution filesystem mount** — Each tool call gets a read-only bind mount of the agent workspace + a writable scratch overlay. No access to `/data/` root, other agent workspaces, or host system files.
- **Network namespace isolation** — Tool scripts run in a network namespace with no connectivity by default. Only tools from plugins with `network` permission get a veth bridge to the host network, rate-limited via `tc`.
- **Resource limits (cgroups v2)** — Per-execution CPU time limit, memory limit, and PID limit. Configurable per skill in SKILL.md frontmatter.
- **Seccomp profile enforcement** — The existing `seccomp-profile.json` (currently applied to Docker containers) is adapted for per-tool-call enforcement, blocking dangerous syscalls (ptrace, mount, reboot, etc.).
- **Fallback mode** — When running outside Linux (macOS dev, Windows WSL without namespace support), fall back to current subprocess isolation with a logged warning.

### Amendment to Existing Specs

This change **amends** the following existing implemented features:

- **Section 8 (Tool Execution)** — `src/brain/tools/executor.py` subprocess launcher gains sandbox wrapper
- **Governed Plugin Architecture (§3 Plugin Loader)** — Plugin tool execution routed through sandbox
- **Skill Architecture (§6 Skill Environment Injection)** — Skill script execution sandboxed
- **Agent Coordination Scratchpad (§35)** — Scratch dir mounted as writable overlay in sandbox

## Capabilities

### New Capabilities
- `tool-sandbox-runtime`: per-execution namespace jail with filesystem, network, and resource isolation
- `sandbox-config`: per-skill and per-plugin sandbox resource limits declared in SKILL.md frontmatter and plugin manifest

### Modified Capabilities
- `tool-execution`: executor.py wraps subprocess launch in sandbox when available
- `plugin-permissions`: plugin `network` permission now enforced at network namespace level, not just SDK level
- `skill-system`: skill scripts get OS-level sandboxing; SKILL.md gains `sandbox` frontmatter block

## Impact

- **Tool executor** — All subprocess launches go through sandbox wrapper. ~20ms overhead per tool call for namespace setup.
- **Plugin system** — Plugins with `network` permission get bridged network; without it, network calls fail at kernel level.
- **Skill frontmatter** — Optional `sandbox:` block in SKILL.md for resource overrides.
- **Docker containers** — nsjail installed in Dockerfile.brain; seccomp profile applied per-execution rather than per-container.
- **Non-Linux** — Sandbox is a no-op on macOS/Windows; logs a warning per invocation.
