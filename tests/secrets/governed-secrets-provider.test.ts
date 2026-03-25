// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  GovernedSecretsProvider,
  SecretAccessDeniedError,
  type SecretAccessContext,
} from "../../src/secrets/governed-secrets-provider.js";
import type { SecretsProvider, SecretMetadata } from "../../src/types/apply.js";

// ---------------------------------------------------------------------------
// Mock inner provider
// ---------------------------------------------------------------------------

const META: SecretMetadata = {
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  last_accessed_at: "2026-01-03T00:00:00Z",
  last_accessed_by: "agent-1",
  rotation_age_days: 30,
  version: 1,
};

function makeInner(): SecretsProvider {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue("secret-value"),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(["key1", "key2"]),
    ensureNamespace: vi.fn().mockResolvedValue(undefined),
    rotate: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn().mockResolvedValue(META),
  };
}

function makeCtx(overrides: Partial<SecretAccessContext> = {}): SecretAccessContext {
  return {
    agentId: "agent-1",
    division: "engineering",
    permissions: ["read_secrets", "write_secrets", "read_secrets_global"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SecretAccessDeniedError
// ---------------------------------------------------------------------------

describe("SecretAccessDeniedError", () => {
  it("has correct name and message", () => {
    const e = new SecretAccessDeniedError("bot-1", "global", "read", "needs permission");
    expect(e.name).toBe("SecretAccessDeniedError");
    expect(e.message).toContain("bot-1");
    expect(e.message).toContain("global");
    expect(e.message).toContain("read");
    expect(e instanceof Error).toBe(true);
  });

  it("exposes structured fields", () => {
    const e = new SecretAccessDeniedError("a", "b", "write", "reason");
    expect(e.agentId).toBe("a");
    expect(e.namespace).toBe("b");
    expect(e.action).toBe("write");
    expect(e.reason).toBe("reason");
  });
});

// ---------------------------------------------------------------------------
// global / providers namespace access
// ---------------------------------------------------------------------------

describe("GovernedSecretsProvider — global/providers namespace", () => {
  it("allows read with read_secrets_global", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ permissions: ["read_secrets_global"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.get("global", "API_KEY")).resolves.toBe("secret-value");
    expect(inner.get).toHaveBeenCalledWith("global", "API_KEY");
  });

  it("denies read without read_secrets_global", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ permissions: ["read_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.get("global", "API_KEY")).rejects.toThrow(SecretAccessDeniedError);
    await expect(gov.get("providers", "key")).rejects.toThrow(SecretAccessDeniedError);
  });

  it("allows write with write_secrets_global", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ permissions: ["write_secrets_global"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.set("global", "k", "v")).resolves.toBeUndefined();
  });

  it("denies write without write_secrets_global", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ permissions: ["write_secrets", "read_secrets_global"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.set("global", "k", "v")).rejects.toThrow(SecretAccessDeniedError);
    await expect(gov.delete("providers", "k")).rejects.toThrow(SecretAccessDeniedError);
  });
});

// ---------------------------------------------------------------------------
// divisions/<code> namespace access
// ---------------------------------------------------------------------------

describe("GovernedSecretsProvider — divisions namespace", () => {
  it("allows read in own division with read_secrets", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ division: "engineering", permissions: ["read_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.get("divisions/engineering", "KEY")).resolves.toBe("secret-value");
  });

  it("denies read in another division", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ division: "engineering", permissions: ["read_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.get("divisions/marketing", "KEY")).rejects.toThrow(SecretAccessDeniedError);
  });

  it("denies read without read_secrets permission", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ division: "engineering", permissions: ["read_secrets_global"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.get("divisions/engineering", "KEY")).rejects.toThrow(SecretAccessDeniedError);
  });

  it("allows write in own division with write_secrets", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ division: "sales", permissions: ["write_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.set("divisions/sales", "k", "v")).resolves.toBeUndefined();
  });

  it("denies write in another division", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ division: "sales", permissions: ["write_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.set("divisions/engineering", "k", "v")).rejects.toThrow(SecretAccessDeniedError);
  });

  it("list delegates after permission check", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ division: "engineering", permissions: ["read_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    const keys  = await gov.list("divisions/engineering");
    expect(keys).toEqual(["key1", "key2"]);
  });
});

// ---------------------------------------------------------------------------
// modules/<id> namespace access
// ---------------------------------------------------------------------------

describe("GovernedSecretsProvider — modules namespace", () => {
  it("allows read with read_secrets", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ permissions: ["read_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.get("modules/discord", "BOT_TOKEN")).resolves.toBe("secret-value");
  });

  it("denies read without read_secrets", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ permissions: ["read_secrets_global"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.get("modules/discord", "BOT_TOKEN")).rejects.toThrow(SecretAccessDeniedError);
  });

  it("allows write with write_secrets", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ permissions: ["write_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.set("modules/slack", "TOKEN", "xoxb-abc")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// system_admin wildcard bypass
// ---------------------------------------------------------------------------

describe("GovernedSecretsProvider — system_admin bypass", () => {
  it("bypasses all checks with '*' permission", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ agentId: "admin", division: "none", permissions: ["*"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);

    await expect(gov.get("global", "k")).resolves.toBe("secret-value");
    await expect(gov.set("providers", "k", "v")).resolves.toBeUndefined();
    await expect(gov.get("divisions/any", "k")).resolves.toBe("secret-value");
    await expect(gov.set("modules/any", "k", "v")).resolves.toBeUndefined();
    expect(inner.get).toHaveBeenCalledTimes(2);
    expect(inner.set).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Unknown namespace
// ---------------------------------------------------------------------------

describe("GovernedSecretsProvider — unknown namespace", () => {
  it("denies access to unrecognised namespace pattern", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ permissions: ["read_secrets", "write_secrets", "read_secrets_global", "write_secrets_global"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.get("completely/unknown/ns", "k")).rejects.toThrow(SecretAccessDeniedError);
  });
});

// ---------------------------------------------------------------------------
// onDeny callback
// ---------------------------------------------------------------------------

describe("GovernedSecretsProvider — onDeny callback", () => {
  it("calls onDeny with correct args on denial", async () => {
    const inner  = makeInner();
    const onDeny = vi.fn();
    const ctx    = makeCtx({ permissions: [] });
    const gov    = new GovernedSecretsProvider(inner, ctx, { onDeny });

    await expect(gov.get("global", "k")).rejects.toThrow(SecretAccessDeniedError);
    expect(onDeny).toHaveBeenCalledOnce();
    const [agentId, namespace, action] = onDeny.mock.calls[0]!;
    expect(agentId).toBe("agent-1");
    expect(namespace).toBe("global");
    expect(action).toBe("read");
  });

  it("does not call onDeny when access is allowed", async () => {
    const inner  = makeInner();
    const onDeny = vi.fn();
    const ctx    = makeCtx({ division: "engineering", permissions: ["read_secrets"] });
    const gov    = new GovernedSecretsProvider(inner, ctx, { onDeny });

    await gov.get("divisions/engineering", "k");
    expect(onDeny).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// rotate + getMetadata delegation
// ---------------------------------------------------------------------------

describe("GovernedSecretsProvider — rotate + getMetadata", () => {
  it("delegates rotate after write check", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ division: "eng", permissions: ["write_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await gov.rotate("divisions/eng", "k", "new-v");
    expect(inner.rotate).toHaveBeenCalledWith("divisions/eng", "k", "new-v");
  });

  it("delegates getMetadata after read check", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ division: "eng", permissions: ["read_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    const meta  = await gov.getMetadata("divisions/eng", "k");
    expect(meta.version).toBe(1);
    expect(inner.getMetadata).toHaveBeenCalledWith("divisions/eng", "k");
  });

  it("denies rotate without write_secrets", async () => {
    const inner = makeInner();
    const ctx   = makeCtx({ division: "eng", permissions: ["read_secrets"] });
    const gov   = new GovernedSecretsProvider(inner, ctx);
    await expect(gov.rotate("divisions/eng", "k", "v")).rejects.toThrow(SecretAccessDeniedError);
  });
});
