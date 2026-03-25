// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Integration Gateway — HTTP Adapters Tests (#503)
 *
 * Covers:
 *   - BaseHttpAdapter: buildUrl, validateParams, hasAction, execute
 *   - N8nAdapter, GithubAdapter, SlackAdapter
 *   - adapter-loader: env-var substitution, YAML loading, registry wiring
 *   - URL param / body param separation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir }    from "node:os";
import { join }      from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { BaseHttpAdapter }   from "../../src/integration-gateway/adapters/base-adapter.js";
import { N8nAdapter }        from "../../src/integration-gateway/adapters/n8n-adapter.js";
import { GithubAdapter }     from "../../src/integration-gateway/adapters/github-adapter.js";
import { SlackAdapter }      from "../../src/integration-gateway/adapters/slack-adapter.js";
import { loadAdapters, substituteEnvVars } from "../../src/integration-gateway/adapters/adapter-loader.js";
import { HttpExecutor }      from "../../src/integration-gateway/http-executor.js";
import { AdapterRegistry }   from "../../src/integration-gateway/adapter-registry.js";
import type { AdapterDefinition, AdapterAction, ExecutorResponse } from "../../src/integration-gateway/types.js";
import { setGlobalLevel, resetLogger } from "../../src/core/logger.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => setGlobalLevel("error"));
afterEach(() => resetLogger());

/** Build a mock ExecutorResponse */
function mockResponse(status = 200, data: unknown = {}): ExecutorResponse {
  return { success: status >= 200 && status < 300, statusCode: status, data, executionMs: 5 };
}

/** Create a mock HttpExecutor */
function mockExecutor(response: ExecutorResponse = mockResponse()): HttpExecutor {
  const exec = { execute: vi.fn().mockResolvedValue(response) } as unknown as HttpExecutor;
  return exec;
}

/** Minimal AdapterDefinition */
function makeDefinition(overrides: Partial<AdapterDefinition> = {}): AdapterDefinition {
  return {
    name:     "test-service",
    type:     "deterministic",
    protocol: "rest",
    base_url: "https://api.example.com",
    enabled:  true,
    actions: {
      doThing: {
        method: "GET",
        path:   "/things/{id}",
        params: {
          id:   { type: "string", required: true },
          note: { type: "string", required: false },
        },
        governance: { require_approval: false, budget_per_call: 0, risk_level: "low" },
      },
      postThing: {
        method: "POST",
        path:   "/things/{id}",
        params: {
          id:    { type: "string", required: true },
          title: { type: "string", required: true },
          count: { type: "number", required: false },
        },
        governance: { require_approval: false, budget_per_call: 0, risk_level: "low" },
      },
    },
    ...overrides,
  };
}

// Concrete subclass for testing the abstract base
class TestAdapter extends BaseHttpAdapter {
  constructor(definition: AdapterDefinition, executor: HttpExecutor) {
    super(definition, executor);
  }
}

// ---------------------------------------------------------------------------
// BaseHttpAdapter — buildUrl
// ---------------------------------------------------------------------------

describe("BaseHttpAdapter.buildUrl", () => {
  const action: AdapterAction = {
    method: "GET",
    path:   "/repos/{owner}/{repo}/issues",
    governance: { require_approval: false, budget_per_call: 0, risk_level: "low" },
  };

  it("1. substitutes a single path parameter", () => {
    const def = makeDefinition({ base_url: "https://api.github.com" });
    const adapter = new TestAdapter(def, mockExecutor());
    const singleParam: AdapterAction = {
      ...action,
      path: "/things/{id}",
    };
    const url = adapter.buildUrl(singleParam, { id: "42" });
    expect(url).toBe("https://api.github.com/things/42");
  });

  it("2. substitutes multiple path parameters", () => {
    const def = makeDefinition({ base_url: "https://api.github.com" });
    const adapter = new TestAdapter(def, mockExecutor());
    const url = adapter.buildUrl(action, { owner: "acme", repo: "core" });
    expect(url).toBe("https://api.github.com/repos/acme/core/issues");
  });

  it("2b. encodes special characters in path params", () => {
    const def = makeDefinition({ base_url: "https://api.github.com" });
    const adapter = new TestAdapter(def, mockExecutor());
    const url = adapter.buildUrl(action, { owner: "my org", repo: "my repo" });
    expect(url).toBe("https://api.github.com/repos/my%20org/my%20repo/issues");
  });
});

// ---------------------------------------------------------------------------
// BaseHttpAdapter — validateParams
// ---------------------------------------------------------------------------

describe("BaseHttpAdapter.validateParams", () => {
  const def = makeDefinition();
  const adapter = new TestAdapter(def, mockExecutor());
  const action = def.actions["postThing"]!;

  it("3. catches missing required parameter", () => {
    const errors = adapter.validateParams(action, { id: "1" }); // missing title
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Missing required parameter: title/);
  });

  it("4. accepts valid params with correct types", () => {
    const errors = adapter.validateParams(action, { id: "1", title: "Hello" });
    expect(errors).toHaveLength(0);
  });

  it("5. type mismatch → error", () => {
    const errors = adapter.validateParams(action, { id: "1", title: "Hello", count: "oops" });
    expect(errors.some(e => e.includes("count"))).toBe(true);
    expect(errors.some(e => e.includes("number"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BaseHttpAdapter — hasAction / getAction
// ---------------------------------------------------------------------------

describe("BaseHttpAdapter.hasAction", () => {
  const def = makeDefinition();
  const adapter = new TestAdapter(def, mockExecutor());

  it("6. true for defined action", () => {
    expect(adapter.hasAction("doThing")).toBe(true);
  });

  it("7. false for unknown action", () => {
    expect(adapter.hasAction("nonExistent")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// n8n adapter
// ---------------------------------------------------------------------------

const N8N_DEF: AdapterDefinition = {
  name:     "n8n",
  type:     "deterministic",
  protocol: "rest",
  base_url: "https://n8n.example.com",
  enabled:  true,
  auth: { type: "api_key", header: "X-N8N-API-KEY", secret_ref: "n8n-api-key" },
  actions: {
    trigger_workflow: {
      method: "POST",
      path:   "/api/v1/workflows/{workflow_id}/execute",
      params: {
        workflow_id: { type: "string", required: true },
        payload:     { type: "object", required: false },
      },
      governance: { require_approval: "conditional", budget_per_call: 0, risk_level: "medium" },
    },
    list_workflows: {
      method: "GET",
      path:   "/api/v1/workflows",
      governance: { require_approval: false, budget_per_call: 0, risk_level: "low" },
    },
  },
};

describe("N8nAdapter", () => {
  it("8. trigger_workflow builds correct URL with workflow_id", () => {
    const adapter = new N8nAdapter(N8N_DEF, mockExecutor());
    const actionDef = adapter.getAction("trigger_workflow")!;
    const url = adapter.buildUrl(actionDef, { workflow_id: "abc123" });
    expect(url).toBe("https://n8n.example.com/api/v1/workflows/abc123/execute");
  });

  it("9. trigger_workflow sends POST (captured via mock executor)", async () => {
    const exec = mockExecutor(mockResponse(200, { executionId: "exec-1" }));
    const adapter = new N8nAdapter(N8N_DEF, exec);
    await adapter.execute("trigger_workflow", { workflow_id: "wf-1", payload: { key: "val" } }, "api-key", "req-001");
    expect(exec.execute).toHaveBeenCalledOnce();
    const req = (exec.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.action.method).toBe("POST");
    expect(req.params.workflow_id).toBe("wf-1");
  });

  it("10. list_workflows sends GET request", async () => {
    const exec = mockExecutor(mockResponse(200, []));
    const adapter = new N8nAdapter(N8N_DEF, exec);
    await adapter.execute("list_workflows", {}, "api-key", "req-002");
    expect(exec.execute).toHaveBeenCalledOnce();
    const req = (exec.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.action.method).toBe("GET");
  });

  it("11. API key header is set in adapter definition", () => {
    const adapter = new N8nAdapter(N8N_DEF, mockExecutor());
    expect(adapter["definition"].auth?.type).toBe("api_key");
    expect(adapter["definition"].auth?.header).toBe("X-N8N-API-KEY");
  });
});

// ---------------------------------------------------------------------------
// GitHub adapter
// ---------------------------------------------------------------------------

const GITHUB_DEF: AdapterDefinition = {
  name:     "github",
  type:     "deterministic",
  protocol: "rest",
  base_url: "https://api.github.com",
  enabled:  true,
  auth: { type: "bearer", secret_ref: "github-token" },
  actions: {
    list_issues: {
      method: "GET",
      path:   "/repos/{owner}/{repo}/issues",
      params: {
        owner: { type: "string", required: true },
        repo:  { type: "string", required: true },
        state: { type: "string", required: false },
      },
      governance: { require_approval: false, budget_per_call: 0, risk_level: "low" },
    },
    create_issue: {
      method: "POST",
      path:   "/repos/{owner}/{repo}/issues",
      params: {
        owner: { type: "string", required: true },
        repo:  { type: "string", required: true },
        title: { type: "string", required: true },
        body:  { type: "string", required: false },
      },
      governance: { require_approval: false, budget_per_call: 0, risk_level: "medium" },
    },
    create_release: {
      method: "POST",
      path:   "/repos/{owner}/{repo}/releases",
      params: {
        owner:    { type: "string", required: true },
        repo:     { type: "string", required: true },
        tag_name: { type: "string", required: true },
        name:     { type: "string", required: true },
      },
      governance: { require_approval: true, budget_per_call: 0, risk_level: "high" },
    },
  },
};

describe("GithubAdapter", () => {
  it("12. list_issues builds correct URL with owner + repo", () => {
    const adapter = new GithubAdapter(GITHUB_DEF, mockExecutor());
    const actionDef = adapter.getAction("list_issues")!;
    const url = adapter.buildUrl(actionDef, { owner: "acme", repo: "core" });
    expect(url).toBe("https://api.github.com/repos/acme/core/issues");
  });

  it("13. create_issue sends POST with title and body params", async () => {
    const exec = mockExecutor(mockResponse(201, { id: 42 }));
    const adapter = new GithubAdapter(GITHUB_DEF, exec);
    await adapter.execute("create_issue", { owner: "acme", repo: "core", title: "Bug!", body: "desc" }, "tok", "req-g-001");
    expect(exec.execute).toHaveBeenCalledOnce();
    const req = (exec.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.action.method).toBe("POST");
    expect(req.params.title).toBe("Bug!");
    expect(req.params.body).toBe("desc");
  });

  it("14. create_release has require_approval = true", () => {
    const adapter = new GithubAdapter(GITHUB_DEF, mockExecutor());
    const rel = adapter.getAction("create_release")!;
    expect(rel.governance.require_approval).toBe(true);
  });

  it("15. extraHeaders include Accept: application/vnd.github+json", async () => {
    const exec = mockExecutor();
    const adapter = new GithubAdapter(GITHUB_DEF, exec);
    await adapter.execute("list_issues", { owner: "o", repo: "r" }, "tok", "req-g-002");
    const req = (exec.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.extraHeaders?.["Accept"]).toBe("application/vnd.github+json");
  });

  it("16. extraHeaders include X-GitHub-Api-Version header", async () => {
    const exec = mockExecutor();
    const adapter = new GithubAdapter(GITHUB_DEF, exec);
    await adapter.execute("list_issues", { owner: "o", repo: "r" }, "tok", "req-g-003");
    const req = (exec.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.extraHeaders?.["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });
});

// ---------------------------------------------------------------------------
// Slack adapter
// ---------------------------------------------------------------------------

const SLACK_DEF: AdapterDefinition = {
  name:     "slack",
  type:     "deterministic",
  protocol: "rest",
  base_url: "https://slack.com/api",
  enabled:  true,
  auth: { type: "bearer", secret_ref: "slack-bot-token" },
  actions: {
    post_message: {
      method: "POST",
      path:   "/chat.postMessage",
      params: {
        channel:   { type: "string", required: true },
        text:      { type: "string", required: true },
        thread_ts: { type: "string", required: false },
      },
      governance: { require_approval: false, budget_per_call: 0, risk_level: "medium" },
    },
    list_channels: {
      method: "GET",
      path:   "/conversations.list",
      governance: { require_approval: false, budget_per_call: 0, risk_level: "low" },
    },
    upload_file: {
      method: "POST",
      path:   "/files.upload",
      params: {
        channels: { type: "string", required: true },
        content:  { type: "string", required: true },
        filename: { type: "string", required: true },
      },
      governance: { require_approval: true, budget_per_call: 0, risk_level: "medium" },
    },
  },
};

describe("SlackAdapter", () => {
  it("17. post_message sends to /chat.postMessage", async () => {
    const exec = mockExecutor(mockResponse(200, { ok: true }));
    const adapter = new SlackAdapter(SLACK_DEF, exec);
    await adapter.execute("post_message", { channel: "#general", text: "Hello" }, "xoxb-tok", "req-s-001");
    const req = (exec.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.action.path).toBe("/chat.postMessage");
    expect(req.action.method).toBe("POST");
  });

  it("18. post_message passes channel and text in params", async () => {
    const exec = mockExecutor();
    const adapter = new SlackAdapter(SLACK_DEF, exec);
    await adapter.execute("post_message", { channel: "#eng", text: "Deploy done" }, "tok", "req-s-002");
    const req = (exec.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.params.channel).toBe("#eng");
    expect(req.params.text).toBe("Deploy done");
  });

  it("19. upload_file has require_approval = true", () => {
    const adapter = new SlackAdapter(SLACK_DEF, mockExecutor());
    const uf = adapter.getAction("upload_file")!;
    expect(uf.governance.require_approval).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AdapterLoader
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  const dir = join(tmpdir(), `igw-loader-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

const VALID_ADAPTER_YAML = `
name: test-svc
type: deterministic
protocol: rest
base_url: "https://api.test.com"
auth:
  type: bearer
  secret_ref: "test-token"
actions:
  fetch_data:
    method: GET
    path: "/data/{id}"
    params:
      id:
        type: string
        required: true
    governance:
      require_approval: false
      budget_per_call: 0.00
      risk_level: low
enabled: true
`;

const DISABLED_ADAPTER_YAML = `
name: disabled-svc
type: deterministic
protocol: rest
base_url: "https://api.disabled.com"
auth:
  type: none
  secret_ref: "none"
actions:
  do_thing:
    method: GET
    path: "/thing"
    governance:
      require_approval: false
      budget_per_call: 0.00
      risk_level: low
enabled: false
`;

describe("AdapterLoader", () => {
  it("20. loads all YAML from directory", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "svc1.yaml"), VALID_ADAPTER_YAML);
    await writeFile(join(dir, "svc2.yaml"), VALID_ADAPTER_YAML.replace("test-svc", "test-svc-2"));

    const registry = new AdapterRegistry();
    const count = await loadAdapters(dir, registry);
    expect(count).toBe(2);
    expect(registry.getAdapter("test-svc")).toBeDefined();
    expect(registry.getAdapter("test-svc-2")).toBeDefined();
  });

  it("21. registers disabled adapters (hasAdapter returns false, getAdapter returns def)", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "disabled.yaml"), DISABLED_ADAPTER_YAML);

    const registry = new AdapterRegistry();
    const count = await loadAdapters(dir, registry);
    expect(count).toBe(1); // registered (even though disabled)
    expect(registry.hasAdapter("disabled-svc")).toBe(false); // hasAdapter checks enabled
    const def = registry.getAdapter("disabled-svc");
    expect(def).toBeDefined();
    expect(def!.enabled).toBe(false);
  });

  it("22. substitutes environment variables in base_url", async () => {
    const dir = await makeTmpDir();
    const yaml = VALID_ADAPTER_YAML.replace(
      '"https://api.test.com"',
      '"${TEST_IGW_BASE_URL}"',
    );
    await writeFile(join(dir, "env-svc.yaml"), yaml);

    process.env["TEST_IGW_BASE_URL"] = "https://custom.host.internal";
    try {
      const registry = new AdapterRegistry();
      await loadAdapters(dir, registry);
      const def = registry.getAdapter("test-svc");
      expect(def!.base_url).toBe("https://custom.host.internal");
    } finally {
      delete process.env["TEST_IGW_BASE_URL"];
    }
  });

  it("23. skips malformed YAML (logs warn, does not throw)", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "bad.yaml"), "name: only-name\n# missing everything else");

    const registry = new AdapterRegistry();
    const count = await loadAdapters(dir, registry);
    expect(count).toBe(0); // skipped
    expect(registry.listAdapters()).toHaveLength(0);
  });

  it("24. registers loaded adapters with the registry", async () => {
    const dir = await makeTmpDir();
    await writeFile(join(dir, "reg.yaml"), VALID_ADAPTER_YAML);

    const registry = new AdapterRegistry();
    await loadAdapters(dir, registry);
    const def = registry.getAdapter("test-svc");
    expect(def).toBeDefined();
    expect(def!.name).toBe("test-svc");
    expect(def!.protocol).toBe("rest");
    expect(def!.actions["fetch_data"]).toBeDefined();
  });

  it("22b. missing env var is substituted with empty string", () => {
    delete process.env["MISSING_IGW_VAR"];
    const result = substituteEnvVars('base_url: "${MISSING_IGW_VAR}/path"');
    expect(result).toBe('base_url: "/path"');
  });
});

// ---------------------------------------------------------------------------
// URL param / body param separation
// ---------------------------------------------------------------------------

describe("URL param vs body param separation", () => {
  it("25. URL params are extracted from the path; non-URL params remain in params", async () => {
    // We test this through the executor mock — params flow through as-is;
    // HttpExecutor (already tested) performs the split into URL vs body.
    const exec = mockExecutor(mockResponse(201));
    const def = makeDefinition({
      base_url: "https://api.github.com",
      actions: {
        create_issue: {
          method: "POST",
          path:   "/repos/{owner}/{repo}/issues",
          params: {
            owner: { type: "string", required: true },
            repo:  { type: "string", required: true },
            title: { type: "string", required: true },
          },
          governance: { require_approval: false, budget_per_call: 0, risk_level: "medium" },
        },
      },
    });
    const adapter = new TestAdapter(def, exec);

    // buildUrl should embed owner + repo but NOT title
    const actionDef = adapter.getAction("create_issue")!;
    const url = adapter.buildUrl(actionDef, { owner: "acme", repo: "core", title: "Bug" });
    expect(url).toContain("acme");
    expect(url).toContain("core");
    expect(url).not.toContain("Bug"); // title is a body param, not a URL param

    // execute passes all params to HttpExecutor, which splits internally
    await adapter.execute("create_issue", { owner: "acme", repo: "core", title: "Bug" }, null, "req-sep");
    const req = (exec.execute as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(req.params).toEqual({ owner: "acme", repo: "core", title: "Bug" });
    // Verify URL built by executor doesn't include title
    // (HttpExecutor is tested separately; here we confirm params are passed correctly)
    expect(req.actionName).toBe("create_issue");
  });

  it("25b. substituteEnvVars handles multiple placeholders in one string", () => {
    process.env["IGW_HOST"] = "api.example.com";
    process.env["IGW_PORT"] = "443";
    try {
      const result = substituteEnvVars("https://${IGW_HOST}:${IGW_PORT}/path");
      expect(result).toBe("https://api.example.com:443/path");
    } finally {
      delete process.env["IGW_HOST"];
      delete process.env["IGW_PORT"];
    }
  });
});
