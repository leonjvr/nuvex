# SIDJUA V1 Security Limitations

## Trusted Operator Model

SIDJUA V1 operates under a **trusted operator** security model:
- The operator (person installing and configuring SIDJUA) is trusted
- External API access is untrusted (authenticated via API keys)
- LLM providers are assumed to be well-behaved (compliant models)

## Known Limitations

### --wait Mode (Governance Bypass) — B6

The `--wait` CLI flag creates an inline agent execution that bypasses the
orchestrator governance pipeline. This is intended for debugging only.
Budget limits are still enforced. A `governance_bypass` warning is emitted
to the log on every `--wait` invocation.

Full governance in `--wait` mode is planned for a future Enterprise release.

**Mitigation:** Use `--wait` only in development environments. In production,
always use the orchestrator (`sidjua start`) which enforces the full
Pre-Action Governance Pipeline (5 stages: Forbidden → Approval → Budget →
Classification → Policy).

### IPC Without Encryption — B7

Inter-process communication uses Unix domain sockets. The containing directory
is created with owner-only permissions (0700) so other local users cannot
connect. All incoming connections are logged to the audit trail under the
`ipc_connection` event. Unknown command types are rejected with an error
response before any processing occurs.

This is sufficient for single-node, single-operator deployments but does not
protect against other processes running as the **same OS user**. Enterprise
multi-node deployments will use mTLS for inter-service communication.

**Mitigation:** Run SIDJUA under a dedicated service account with no other
processes sharing that UID. Use Linux namespaces or containers to further
isolate the orchestrator process.

### Sandbox Provider "none" — H7

When configured with sandbox provider `"none"`, agents execute with full
host privileges (no filesystem, network, or process isolation). This is
logged to stderr as a `sandbox_check` audit warning, and `sidjua sandbox check`
requires the `--force` flag to acknowledge the risk explicitly.

Container-based isolation is available via the Docker sandbox provider.
Namespace-based isolation is available via the Bubblewrap sandbox provider.

**Mitigation:** Set `sandbox.provider: "bubblewrap"` or `"docker"` in
`divisions.yaml`. See `sidjua sandbox check` for dependency verification.

### Module System

Modules execute with full Node.js privileges. There is no code signing
or sandboxing for modules in V1. Only install modules from trusted sources.
Module marketplace with verification is planned for a future release.

### Discord Gateway

The Discord gateway daemon operates outside the orchestrator governance
pipeline. Destructive operations (channel/member management) are disabled
by default. Enable only with explicit configuration.

The gateway logs are written to `.system/modules/discord/` and can be
reviewed for unexpected activity.

## Reporting Security Issues

Report security vulnerabilities at: https://github.com/sidjua/sidjua/security/advisories

Do NOT open public GitHub issues for security vulnerabilities.
