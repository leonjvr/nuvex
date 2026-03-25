/**
 * Integration: Peer consultation
 *
 * T2 agent creates consultation task for peer T2.
 * Peer responds.
 * Original agent receives consultation response.
 * Sub-task counter NOT incremented.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../../src/utils/db.js";
import { TaskStore }        from "../../../src/tasks/store.js";
import { TaskEventBus }     from "../../../src/tasks/event-bus.js";
import { TaskStateMachine } from "../../../src/tasks/state-machine.js";
import { ResultStore }      from "../../../src/tasks/result-store.js";
import { TaskRouter }       from "../../../src/tasks/router.js";
import type { Database } from "../../../src/utils/db.js";

let tmpDir: string;
let db: Database;
let store: TaskStore;
let eventBus: TaskEventBus;
let sm: TaskStateMachine;
let resultStore: ResultStore;
let router: TaskRouter;

beforeEach(() => {
  tmpDir      = mkdtempSync(join(tmpdir(), "sidjua-peer-test-"));
  db          = openDatabase(join(tmpDir, "tasks.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  store       = new TaskStore(db);
  store.initialize();
  eventBus    = new TaskEventBus(db);
  sm          = new TaskStateMachine(store, eventBus);
  resultStore = new ResultStore(tmpDir);
  router      = new TaskRouter(store, eventBus, resultStore);
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Peer consultation — horizontal routing", () => {
  it("consultation response routed to requester, counter not incremented", async () => {
    // Root task
    const root = store.create({
      title: "Root", description: "d", division: "engineering",
      type: "root", tier: 1, token_budget: 50000, cost_budget: 5.0,
    });

    // T2 requester task (the main work task)
    let t2Requester = store.create({
      title: "Implement feature X", description: "Needs security consultation",
      division: "engineering", type: "delegation", tier: 2,
      parent_id: root.id, root_id: root.id,
      token_budget: 10000, cost_budget: 1.0,
      assigned_agent: "agent-requester",
      sub_tasks_expected: 1, // expects 1 delegation result (not consultation)
    });
    t2Requester = await sm.transition(t2Requester, "PENDING");
    t2Requester = await sm.transition(t2Requester, "ASSIGNED", { agent_id: "agent-requester" });
    t2Requester = await sm.transition(t2Requester, "RUNNING");

    // Requester creates a peer consultation task
    let consultation = store.create({
      title: "Security advice for feature X",
      description: "Is this approach secure?",
      division: "engineering",
      type: "consultation",
      tier: 2, // Same tier — peer consultation
      parent_id: t2Requester.id, root_id: root.id,
      token_budget: 1000, cost_budget: 0.1,
      assigned_agent: "agent-security-peer",
    });

    // Requester goes to WAITING (for its 1 expected delegation result — not the consultation)
    t2Requester = await sm.transition(t2Requester, "WAITING");

    // Peer agent processes the consultation
    consultation = await sm.transition(consultation, "PENDING");
    consultation = await sm.transition(consultation, "ASSIGNED", { agent_id: "agent-security-peer" });
    consultation = await sm.transition(consultation, "RUNNING");
    consultation = await sm.transition(consultation, "DONE", {
      result_summary: "Approach is secure with these modifications...",
    });

    // Peer routes consultation response back to requester
    await router.routeConsultation(
      consultation,
      "Your approach is secure. Add rate limiting to the auth endpoint.",
    );

    // Verify: sub_tasks_received NOT incremented
    const requesterState = store.get(t2Requester.id)!;
    expect(requesterState.sub_tasks_received).toBe(0);

    // Verify: CONSULTATION_RESPONSE event emitted to requester agent
    const events = await eventBus.consume("agent-requester");
    const consultEvents = events.filter((e) => e.event_type === "CONSULTATION_RESPONSE");
    expect(consultEvents).toHaveLength(1);
    expect(consultEvents[0]?.data["response"]).toContain("rate limiting");
    expect(consultEvents[0]?.data["consultation_task_id"]).toBe(consultation.id);

    // Parent completion check: still 0/1 (consultation doesn't count)
    const completion = await router.checkParentCompletion(t2Requester.id);
    expect(completion.complete).toBe(false);
    expect(completion.received).toBe(0);
    expect(completion.expected).toBe(1);
  });

  it("consultation does not appear in parent completion pending list", async () => {
    const root = store.create({
      title: "Root", description: "d", division: "engineering",
      type: "root", tier: 1, token_budget: 50000, cost_budget: 5.0,
    });

    const t2Raw = store.create({
      title: "Main work", description: "d", division: "engineering",
      type: "delegation", tier: 2,
      parent_id: root.id, root_id: root.id,
      token_budget: 10000, cost_budget: 1.0,
      assigned_agent: "agent-main",
      sub_tasks_expected: 1,
    });
    // Bypass state machine transitions for test setup simplicity
    const t2 = store.update(t2Raw.id, { status: "RUNNING" });

    // Create consultation child
    store.create({
      title: "Consult peer", description: "d", division: "engineering",
      type: "consultation", tier: 2,
      parent_id: t2.id, root_id: root.id,
      token_budget: 500, cost_budget: 0.05,
    });

    const completion = await router.checkParentCompletion(t2.id);
    // Consultation is excluded from pending count
    expect(completion.pending).toHaveLength(0);
  });
});
