# SIDJUA — License Audit

**Last Audited:** 2026-02-28
**Auditor:** Sonnet (T2, Dev Lead)
**Project License:** AGPL-3.0-only
**Audit Scope:** All direct and transitive npm dependencies as of Phase 6 (Provider Layer)
**Status:** ✅ CLEAN — All dependencies AGPL-compatible

---

## Audit Rule (from CLAUDE.md)

Only the following licenses are accepted for SIDJUA V1:

| License | Status |
|---------|--------|
| MIT | ✅ Accepted |
| BSD-2-Clause | ✅ Accepted |
| BSD-3-Clause | ✅ Accepted |
| Apache-2.0 | ✅ Accepted |
| ISC | ✅ Accepted |
| Unlicense | ✅ Accepted |
| CC0-1.0 | ✅ Accepted |
| LGPL-2.1+ | ✅ Accepted |
| LGPL-3.0+ | ✅ Accepted |
| GPL-3.0+ | ✅ Accepted |
| AGPL-3.0 | ✅ Accepted |
| WTFPL | ✅ Accepted (public domain equivalent) |
| 0BSD | ✅ Accepted |
| Proprietary / BUSL / BSL / SSPL | ❌ FORBIDDEN |

---

## Direct Dependencies

### Production

| Package | Version | License | AGPL-Compatible | Notes |
|---------|---------|---------|-----------------|-------|
| `yaml` | 2.8.2 | ISC | ✅ | YAML parser/serializer |
| `better-sqlite3` | 12.6.2 | MIT | ✅ | SQLite3 driver |
| `argon2` | 0.44.0 | MIT | ✅ | Argon2id KDF for secrets encryption key derivation |
| `ssh2` | ^1.x | MIT | ✅ | SSH client for remote environment connectivity (Phase 10.7) |
| `ws` | 8.x | MIT | ✅ | WebSocket client for Discord Gateway (#386) — zero transitive deps |
| `commander` | 14.0.3 | MIT | ✅ | CLI framework for `sidjua apply` / `sidjua status` |
| `@anthropic-ai/sdk` | 0.78.0 | MIT | ✅ | Anthropic Claude API SDK — Phase 6 Provider Layer |
| `openai` | 6.25.0 | Apache-2.0 | ✅ | OpenAI API SDK — Phase 6 Provider Layer |
| `adm-zip` | ^0.5.x | MIT | ✅ | ZIP archive extraction for Claude chat export import (V0.9.3) |
| `@types/adm-zip` | ^0.5.x | MIT | ✅ | TypeScript types for adm-zip |

### Development

| Package | Version | License | AGPL-Compatible | Notes |
|---------|---------|---------|-----------------|-------|
| `typescript` | 5.9.3 | Apache-2.0 | ✅ | TypeScript compiler |
| `vitest` | 4.0.18 | MIT | ✅ | Test runner |
| `tsup` | 8.5.1 | MIT | ✅ | Build tool |
| `@types/node` | 25.3.2 | MIT | ✅ | Node.js type definitions |
| `@types/better-sqlite3` | 7.6.13 | MIT | ✅ | Type definitions for better-sqlite3 |
| `@types/ws` | 8.x | MIT | ✅ | Type definitions for ws package |

---

## Transitive Dependencies

All transitive dependencies were scanned with `npx license-checker` on 2026-02-27.

### By License Group

| License | Package Count | Status |
|---------|--------------|--------|
| MIT | 100 | ✅ |
| ISC | 9 | ✅ |
| Apache-2.0 | 5 | ✅ |
| BSD-3-Clause | 3 | ✅ |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 | ✅ See note on `rc` |
| (MIT OR WTFPL) | 1 | ✅ See note on `expand-template` |
| AGPL-3.0-only | 1 | ✅ This package itself |

### Notable Packages

| Package | License | Note |
|---------|---------|------|
| `rc@1.2.8` | (BSD-2-Clause OR MIT OR Apache-2.0) | Triple-licensed, all options compatible |
| `expand-template@2.0.3` | (MIT OR WTFPL) | WTFPL is public-domain equivalent, fully compatible |
| `esbuild@0.27.3` | MIT | Bundled in tsup, dev-only |
| `vite@7.3.1` | MIT | Bundled in vitest, dev-only |
| `rollup@4.59.0` | MIT | Bundled in tsup, dev-only |

---

## Excluded / Not Adopted

These packages were considered and explicitly rejected:

| Package | License | Reason |
|---------|---------|--------|
| OpenBao | MPL-2.0 + Exhibit B | ⚠️ V2 only — legal review pending (#290) |
| HashiCorp Vault SDK | BSL-1.1 | ❌ FORBIDDEN — not open source since Aug 2023 |
| Doppler SDK | Proprietary | ❌ FORBIDDEN |

---

## V1 Spec Dependency Audit (from SIDJUA-APPLY-TECH-SPEC-V1.md)

| Component | License | AGPL-Compatible | Audited | Notes |
|-----------|---------|-----------------|---------|-------|
| `@anthropic-ai/sandbox-runtime@0.0.40` | Apache-2.0 | ✅ | 2026-03-11 | Phase 19 BubblewrapProvider. Provides bwrap + proxy-based sandbox on Linux/macOS. |
| `duck@0.1.12` | BSD (2-clause text) | ✅ | 2026-03-11 | Transitive dep of `mammoth` (Phase 10.6). License text is BSD-2-Clause equivalent. `license-checker` reports "BSD*" due to missing version number in package.json; confirmed compatible. Exclude from CI gate: `--excludePackages duck@0.1.12`. |
| SQLite | Public Domain | ✅ | 2026-02-23 | Via better-sqlite3 |
| SQLCipher (`@journeyapps/sqlcipher`) | BSD-3-Clause | ✅ | 2026-02-26 | Attempted V1 secrets backend. **Not adopted**: requires `libcrypto.so.1.1` (OpenSSL 1.1) which is unavailable in target environments (OpenSSL 3.x). V1 uses `better-sqlite3` + AES-256-GCM (Node built-in). V1.1 upgrade path preserved via `SecretsProvider` interface. |
| Argon2 (`argon2`) | MIT | ✅ | 2026-02-27 | **Adopted**. KDF for AES-256-GCM key derivation in V1 secrets store. npm package `argon2@0.44.0`. |
| OpenBao | MPL-2.0 + Exhibit B | ⚠️ V2 only | 2026-02-26 | Separate service, legal review pending |
| Infisical | MIT (core) | ✅ (core) | 2026-02-26 | V2 Enterprise PRIMARY candidate |
| CyberArk Conjur OSS | LGPL-3.0 | ✅ | 2026-02-26 | V2 Enterprise Plan C |

---

## Audit Commands

```bash
# Run full license scan:
npx license-checker --json

# Run only-allow check (CI gate):
npx license-checker --onlyAllow \
  'MIT;BSD-2-Clause;BSD-3-Clause;Apache-2.0;ISC;Unlicense;CC0-1.0;\
LGPL-2.1;LGPL-3.0;GPL-3.0;AGPL-3.0;0BSD;CC-BY-4.0;CC-BY-3.0;\
Python-2.0;BlueOak-1.0.0;WTFPL'

# Production-only scan:
npx license-checker --production --json
```

---

## Process

1. Before adding ANY new dependency: check its license manually.
2. Add it to the **Direct Dependencies** table above.
3. Re-run `license-checker --onlyAllow ...` to verify no transitive violations.
4. Update **Last Audited** date.
5. Document in commit message: `chore(deps): add <pkg> (license: <SPDX>)`

Violations block the PR. No exceptions.
