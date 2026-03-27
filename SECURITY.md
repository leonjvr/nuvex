# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

Only the latest patch release receives security updates. Upgrade promptly when a new version is published.

## Reporting a Vulnerability

**We take security seriously.** SIDJUA is a governance-first agent platform — security issues undermine the core product promise.

### Preferred: Zammad (private, tracked)

Submit a **confidential** ticket at **[tickets.sidjua.com](https://tickets.sidjua.com)**

This is the fastest path. Zammad tickets are private by default, triaged within 24 hours on business days, and tracked through resolution. Include:

- Description of the vulnerability
- Steps to reproduce (if applicable)
- Affected version(s)
- Impact assessment (what an attacker could achieve)

### Alternative: GitHub Security Advisory (private)

Use GitHub's **private vulnerability reporting** via the **Security** tab of this repository. This creates a private advisory visible only to maintainers.

### Alternative: Discord (lower priority)

Report in the **#security** channel on our [Discord server](https://discord.gg/C79wEYgaKc). Discord reports are polled and transferred to Zammad for tracking. Response time may be longer than direct Zammad submission.

### What NOT to do

- **Do not** open a public GitHub issue for security vulnerabilities
- **Do not** post exploit details in public Discord channels
- **Do not** disclose publicly before a fix is available

## Response Timeline

- **Acknowledgment:** Within 48 hours of receipt
- **Triage and severity assessment:** Within 5 business days
- **Fix for Critical/High:** Targeted within 14 days
- **Fix for Medium/Low:** Included in the next scheduled patch release
- **Disclosure:** Coordinated with the reporter after the fix is released

## Severity Classification

- **Critical:** Remote code execution, authentication bypass, secret exfiltration
- **High:** Privilege escalation, governance bypass, SSRF, cross-division data leak
- **Medium:** Information disclosure, denial of service, logging/audit gaps
- **Low:** Hardening improvements, documentation mismatches, defense-in-depth enhancements

## Scope

The following components are in scope for security reports:

- SIDJUA core (CLI, API server, orchestrator, governance pipeline)
- Agent lifecycle, task admission, tool execution paths
- Secrets management and encrypted storage
- Authentication and authorization (scoped tokens, RBAC)
- Web Management Console (GUI)
- Docker image and deployment configuration
- Official documentation where it creates false security expectations

Out of scope: third-party LLM provider APIs, user-supplied agent configurations, and self-inflicted misconfigurations on user-controlled infrastructure.

## Recognition

We credit security researchers in release notes (with permission). If you would like to be credited, include your preferred name and optional link in your report.

## Audit History

SIDJUA undergoes regular multi-provider security audits. Results from xAI, OpenAI, and other providers are used to continuously harden the codebase. The governance-by-architecture approach means many traditional vulnerability classes are structurally mitigated.
