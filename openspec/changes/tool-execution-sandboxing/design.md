## Context

NUVEX runs tool scripts via `subprocess.create_subprocess_shell()` in `src/brain/tools/executor.py`. The subprocess inherits the Brain process's UID, filesystem view, and network access. The governed plugin architecture (implemented) uses SDK-level permission gates — `PluginAPI` only exposes `http_client` to plugins with `network` permission — but a malicious plugin can bypass this by importing libraries directly. The skill architecture runs shell scripts with injected environment variables but no filesystem or network isolation.

Existing infrastructure:
- `src/brain/tools/executor.py` — subprocess launcher with timeout and working directory
- `src/brain/tools/shell_tool.py` — skill script executor with env injection
- `src/brain/tools/builtin.py` — ReadFile, WriteFile, WebFetch, SendMessage (Python-level, not subprocess)
- `src/brain/nodes/execute_tools.py` — GovernedToolNode orchestrating governance → hooks → execution
- `seccomp-profile.json` — container-level seccomp (applies to entire Docker container, not per-tool)
- Scratch dir at `data/threads/<thread_id>/scratch/` (writable per-thread area)

Constraints:
- Must work on Linux (production) with graceful fallback on macOS/Windows (dev)
- Must not break existing tool execution — sandbox is opt-out, not opt-in
- nsjail must be installable in the Brain Docker container without rebuilding base images
- Overhead per tool call must be < 50ms for namespace setup
- Built-in Python tools (ReadFile, WriteFile, WebFetch) are NOT sandboxed — they run in-process and are permission-gated by governance

## Goals / Non-Goals

**Goals:**
- OS-level isolation for every subprocess tool call (skills, plugin shell commands)
- Per-execution filesystem restriction (read-only workspace + writable scratch)
- Per-execution network namespace (no network by default; bridged only with `network` permission)
- Per-execution resource limits (CPU time, memory, PID count) via cgroups v2
- Per-execution seccomp filtering (block dangerous syscalls)
- Configurable resource limits per skill via SKILL.md `sandbox:` frontmatter
- Graceful degradation on platforms without namespace support

**Non-Goals:**
- Sandboxing in-process Python tools (ReadFile, WriteFile, WebFetch) — these are governed by the pipeline
- Sandboxing LLM API calls — these go through the model routing layer
- Full Docker-in-Docker per tool call — too heavy; nsjail is lightweight
- GUI/display isolation — tools are headless
- Persistent sandbox state between tool calls — each call gets a fresh namespace

## Decisions

### 1. Sandbox Engine: nsjail

Use Google's [nsjail](https://github.com/google/nsjail) — a lightweight process isolation tool using Linux namespaces, seccomp-bpf, and cgroups. It's a single binary, supports PID/IPC/NET/MNT/USER namespaces, and can be configured via protobuf config files or CLI flags.

**Why not firejail?** nsjail is more focused on server workloads; firejail targets desktop apps.
**Why not Docker per-call?** Container startup is ~500ms; nsjail namespace setup is ~10ms.
**Why not bubblewrap?** Similar capabilities, but nsjail has better cgroups v2 integration and seccomp-bpf support.

### 2. Filesystem Mount Layout

Each sandboxed tool call sees:

```
/                       (empty tmpfs root)
├── /workspace/         (read-only bind: agent workspace)
├── /scratch/           (read-write bind: thread scratch dir)
├── /tmp/               (writable tmpfs, 50MB limit)
├── /usr/               (read-only bind: system binaries)
├── /lib/               (read-only bind: system libraries)
├── /bin/               (read-only bind: essential binaries)
├── /etc/resolv.conf    (read-only, only if network permitted)
└── /dev/null, /dev/urandom  (minimal device nodes)
```

No access to `/data/`, other agent workspaces, database sockets, or Brain process memory.

### 3. Network Policy

| Plugin Permission | Network Namespace | Effect |
|---|---|---|
| No `network` permission | Isolated (no veth) | All network calls fail with ENETUNREACH |
| `network` permission | Bridged via veth pair | Outbound allowed, rate-limited to 10 Mbps |
| `network:internal` | Bridged, no external | Can reach Brain API and DB only |

### 4. Resource Limits (Defaults)

| Resource | Default | SKILL.md Override Key |
|---|---|---|
| CPU time | 30 seconds | `sandbox.cpu_seconds` |
| Memory | 256 MB | `sandbox.memory_mb` |
| PIDs | 32 | `sandbox.max_pids` |
| Disk (scratch) | From scratch.quota_mb (100 MB) | existing config |
| Tmpfs | 50 MB | Not configurable |

### 5. Seccomp Profile

Adapted from the existing `seccomp-profile.json`, but applied per-nsjail execution:

**Blocked syscalls:** `ptrace`, `mount`, `umount2`, `reboot`, `swapon`, `swapoff`, `init_module`, `finit_module`, `delete_module`, `kexec_load`, `perf_event_open`, `bpf`, `userfaultfd`, `keyctl`, `add_key`, `request_key`

**Allowed:** Standard POSIX (read, write, open, close, mmap, etc.), socket (only if network permitted), fork/clone (up to PID limit).

### 6. Sandbox Configuration in SKILL.md

```yaml
sandbox:
  cpu_seconds: 60       # override default 30s
  memory_mb: 512        # override default 256MB
  max_pids: 64          # override default 32
  network: true         # request network bridge (requires plugin `network` permission)
  allow_paths:          # additional read-only bind mounts
    - /data/shared/models/
```

### 7. Fallback Behaviour

On non-Linux platforms (macOS, Windows/WSL1) or when nsjail binary is not found:
- Execute using current subprocess isolation (no namespace)
- Log `WARN sandbox.unavailable platform=<os> tool=<name>` once per Brain startup
- Emit `tool.execution` event with `sandbox: false` in payload

### 8. Integration with Existing Tool Pipeline

```
GovernedToolNode
  → governance pipeline (unchanged)
  → PreToolUse hooks (unchanged)
  → SandboxExecutor.run(command, workspace_path, scratch_path, permissions, limits)
       → nsjail --config <generated.cfg> -- /bin/sh -c "<command>"
       → capture stdout/stderr, exit code, resource usage
  → PostToolUse hooks (unchanged)
```

The `SandboxExecutor` replaces direct `asyncio.create_subprocess_shell()` calls in `executor.py` and `shell_tool.py`.

## Module Structure

```
src/brain/sandbox/
├── __init__.py
├── executor.py       # SandboxExecutor — main entry point
├── config.py         # SandboxConfig Pydantic model, defaults
├── nsjail.py         # nsjail config generation, binary detection
├── mounts.py         # Filesystem mount layout generation
├── network.py        # Network namespace setup (veth bridge)
├── fallback.py       # Non-Linux fallback executor
└── seccomp.py        # Seccomp profile generation from base template
```

## Testing Strategy

- **Unit tests** run on all platforms (mock nsjail binary detection as False → test fallback path)
- **Integration tests** require Linux with nsjail installed (Docker CI or Linux dev box)
- **Security tests**: verify filesystem escape blocked, network blocked when no permission, PID bomb killed by cgroup
