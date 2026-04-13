## 1. Sandbox Runtime Core

> Spec: `specs/tool-sandbox-runtime/spec.md`
>
> OS-level per-execution isolation using nsjail. Every subprocess tool call runs in its own
> Linux namespace with restricted filesystem, network, and resources.
>
> **Priority: HIGH** — Biggest security gap. SDK-level permissions can be bypassed by importing libraries directly.

- [ ] 1.1 Install nsjail in `Dockerfile.brain` — add build deps, compile from source (or use pre-built binary), verify binary at `/usr/local/bin/nsjail`
- [x] 1.2 Create `src/brain/sandbox/__init__.py` — exports `SandboxExecutor`, `SandboxConfig`, `SandboxResult`
- [x] 1.3 Create `src/brain/sandbox/config.py` — `SandboxConfig` Pydantic model with fields: `cpu_seconds: int = 30`, `memory_mb: int = 256`, `max_pids: int = 32`, `network: bool = False`, `allow_paths: list[str] = []`, `tmpfs_mb: int = 50`
- [ ] 1.4 Create `src/brain/sandbox/nsjail.py` — nsjail binary detection (`shutil.which("nsjail")`), config file generation (protobuf text format), command builder
- [ ] 1.5 Create `src/brain/sandbox/mounts.py` — generate mount configuration: read-only workspace bind, writable scratch bind, writable tmpfs at `/tmp/`, read-only system dirs (`/usr/`, `/lib/`, `/bin/`), minimal `/dev/` nodes
- [ ] 1.6 Create `src/brain/sandbox/network.py` — network namespace setup: no-network by default; veth bridge creation for `network=True`; rate limiting via `tc` at 10 Mbps
- [ ] 1.7 Create `src/brain/sandbox/seccomp.py` — seccomp profile generation from base template; blocked syscalls: ptrace, mount, umount2, reboot, swapon, swapoff, init_module, finit_module, delete_module, kexec_load, perf_event_open, bpf, userfaultfd, keyctl, add_key, request_key
- [x] 1.8 Create `src/brain/sandbox/executor.py` — `SandboxExecutor.run(command, workspace_path, scratch_path, env, config, permissions)` → assembles nsjail config, launches nsjail subprocess, captures stdout/stderr/exit_code, collects resource usage from cgroup stats, returns `SandboxResult`
- [x] 1.9 Create `src/brain/sandbox/fallback.py` — `FallbackExecutor.run()` with identical signature to `SandboxExecutor`; delegates to `asyncio.create_subprocess_shell()`; logs warning on first call
- [x] 1.10 Implement platform detection in `__init__.py` — on import, detect Linux + nsjail available → export `SandboxExecutor`; otherwise → export `FallbackExecutor` as `SandboxExecutor` with startup warning
- [x] 1.11 Create `SandboxResult` model — `stdout: str`, `stderr: str`, `exit_code: int`, `sandbox_active: bool`, `cpu_ms: int`, `memory_peak_mb: float`, `network_bytes_out: int`, `killed_by: str | None` (OOM / timeout / seccomp / None)

## 2. Tool Executor Integration

> Spec: `specs/tool-execution/spec.md`
>
> Amends existing tool executor and shell tool to route through sandbox.
>
> **Priority: HIGH** — Must ship with §1.

- [ ] 2.1 Refactor `src/brain/tools/executor.py` — replace `asyncio.create_subprocess_shell()` with `SandboxExecutor.run()`; pass agent workspace path, thread scratch path, merged env, `SandboxConfig` from tool metadata
- [ ] 2.2 Refactor `src/brain/tools/shell_tool.py` — replace `create_subprocess_shell()` with `SandboxExecutor.run()`; pass skill env from `SkillEnvInjectionHook` into sandbox env
- [ ] 2.3 Update `GovernedToolNode` in `src/brain/nodes/execute_tools.py` — after execution, if `SandboxResult.killed_by == "timeout"`, classify as `ToolExecutionTimeout`; if `killed_by == "oom"`, classify as `ToolExecutionCrash`
- [ ] 2.4 Update `NUVEX_SCRATCH_DIR` injection — inside sandbox, set to `/scratch/` (the in-sandbox mount point); host path transparent to tool
- [ ] 2.5 Update `tool.execution` event payload — add `sandbox: bool`, `sandbox_cpu_ms: int`, `sandbox_memory_peak_mb: float`, `sandbox_network_bytes_out: int` fields

## 3. Sandbox Configuration

> Spec: `specs/sandbox-config/spec.md`
>
> Per-skill and per-plugin sandbox resource limits.
>
> **Priority: MEDIUM** — Depends on §1. Provides fine-grained control.

- [ ] 3.1 Add `sandbox: SandboxConfig | None` field to `SkillMetadata` Pydantic model in `src/brain/skills/parser.py`
- [ ] 3.2 Update `parse_skill_md()` to extract `sandbox:` block from YAML frontmatter and validate via `SandboxConfig`
- [ ] 3.3 Add `sandbox: dict | None` parameter to `@define_plugin()` decorator in `src/nuvex_plugin/__init__.py`
- [ ] 3.4 Update plugin loader to parse `sandbox` dict into `SandboxConfig` and associate with all tools from that plugin
- [ ] 3.5 Add `sandbox_defaults:` block to `config/nuvex.yaml` schema and `src/shared/config.py` — global defaults for all tool calls
- [ ] 3.6 Implement config precedence in `SandboxExecutor`: skill-level > plugin-level > global defaults > hardcoded defaults
- [ ] 3.7 Implement network permission cross-check: if `sandbox.network=True` but plugin lacks `network` permission, deny and log warning

## 4. Dockerfile & Infrastructure

> Infrastructure changes to support sandbox runtime in Docker.
>
> **Priority: HIGH** — Must ship with §1.

- [ ] 4.1 Update `Dockerfile.brain` — install nsjail build dependencies (protobuf-compiler, libnl-route-3-dev, libcap-dev), compile nsjail from source, clean build deps
- [ ] 4.2 Update `Dockerfile.brain` — add `CAP_SYS_ADMIN`, `CAP_NET_ADMIN` capabilities for namespace and network setup (required for nsjail)
- [ ] 4.3 Update `docker-compose.local.yml` — add `cap_add: [SYS_ADMIN, NET_ADMIN]` and `security_opt: [seccomp=unconfined]` to brain-local service (nsjail manages its own seccomp internally)
- [ ] 4.4 Update `docker-compose.yml` (prod) — same capability additions with documentation comment explaining why
- [ ] 4.5 Adapt `seccomp-profile.json` — retain as container-level baseline; document that per-tool seccomp is now handled by nsjail internally

## 5. Testing

> Unit tests run on all platforms (mock nsjail). Integration tests require Linux.
>
> **Priority: HIGH** — Must ship with §1.

- [ ] 5.1 Write unit test: `SandboxConfig` validates all fields with correct defaults; rejects negative values
- [ ] 5.2 Write unit test: nsjail config generation produces valid protobuf text format with correct mount points
- [ ] 5.3 Write unit test: platform detection returns `FallbackExecutor` on non-Linux; returns `SandboxExecutor` on Linux with nsjail
- [ ] 5.4 Write unit test: `FallbackExecutor.run()` delegates to subprocess and returns `SandboxResult(sandbox_active=False)`
- [ ] 5.5 Write unit test: config precedence — skill overrides plugin overrides global overrides defaults
- [ ] 5.6 Write unit test: network permission cross-check — `network=True` without plugin `network` permission → denied, logged
- [ ] 5.7 Write unit test: tool execution event includes sandbox metadata fields
- [ ] 5.8 Write unit test: `SandboxResult.killed_by="timeout"` classified as `ToolExecutionTimeout`; `killed_by="oom"` classified as `ToolExecutionCrash`
- [ ] 5.9 Write integration test (Linux only): skill script in sandbox cannot read `/data/agents/other-agent/`
- [ ] 5.10 Write integration test (Linux only): tool without network permission gets ENETUNREACH on `curl`
- [ ] 5.11 Write integration test (Linux only): fork bomb hits PID limit; sandbox exits without affecting host
- [ ] 5.12 Write integration test (Linux only): tool exceeding CPU limit is killed; `killed_by="timeout"` in result
