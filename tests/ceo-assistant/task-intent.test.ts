// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

/**
 * Tests for task intent parser — CEO Assistant
 */

import { describe, it, expect } from "vitest";
import { parseTaskIntent, isDienstschluss } from "../../src/ceo-assistant/task-intent.js";

// ---------------------------------------------------------------------------
// parseTaskIntent
// ---------------------------------------------------------------------------

describe("parseTaskIntent — add_task", () => {
  it("parses 'Remind me to X by Y'", () => {
    const r = parseTaskIntent("Remind me to check the audit results by Friday");
    expect(r.type).toBe("add_task");
    expect(r.title).toContain("check the audit results");
    expect(r.deadline).toContain("Friday");
  });

  it("parses 'Remember to X'", () => {
    const r = parseTaskIntent("Remember to schedule the team meeting");
    expect(r.type).toBe("add_task");
    expect(r.title).toBe("schedule the team meeting");
  });

  it("parses 'Add task: X'", () => {
    const r = parseTaskIntent("Add task: write monthly report");
    expect(r.type).toBe("add_task");
    expect(r.title).toContain("write monthly report");
  });

  it("parses 'todo: X'", () => {
    const r = parseTaskIntent("todo: review vendor contracts");
    expect(r.type).toBe("add_task");
    expect(r.title).toBe("review vendor contracts");
  });

  it("parses 'Create task X'", () => {
    const r = parseTaskIntent("Create task: prepare board presentation");
    expect(r.type).toBe("add_task");
    expect(r.title).toContain("prepare board presentation");
  });
});

describe("parseTaskIntent — list_tasks", () => {
  it("parses 'What's on my list?'", () => {
    expect(parseTaskIntent("What's on my list?").type).toBe("list_tasks");
  });

  it("parses 'What's pending?'", () => {
    expect(parseTaskIntent("What's pending?").type).toBe("list_tasks");
  });

  it("parses 'Show my tasks'", () => {
    expect(parseTaskIntent("Show my tasks").type).toBe("list_tasks");
  });

  it("parses 'Task list'", () => {
    expect(parseTaskIntent("Task list").type).toBe("list_tasks");
  });

  it("parses 'Open tasks'", () => {
    expect(parseTaskIntent("Open tasks").type).toBe("list_tasks");
  });
});

describe("parseTaskIntent — complete_task", () => {
  it("parses 'Done with X'", () => {
    const r = parseTaskIntent("Done with the Docker rebuild");
    expect(r.type).toBe("complete_task");
    expect(r.title).toContain("Docker rebuild");
  });

  it("parses 'Finished with X'", () => {
    const r = parseTaskIntent("Finished with the monthly report");
    expect(r.type).toBe("complete_task");
    expect(r.title).toContain("monthly report");
  });

  it("parses 'Mark X as done'", () => {
    const r = parseTaskIntent("Mark Docker rebuild as done");
    expect(r.type).toBe("complete_task");
  });
});

describe("parseTaskIntent — cancel_task", () => {
  it("parses 'Cancel X'", () => {
    const r = parseTaskIntent("Cancel the monitoring task");
    expect(r.type).toBe("cancel_task");
    expect(r.title).toContain("monitoring task");
  });

  it("parses 'Remove X from the list'", () => {
    const r = parseTaskIntent("Remove quarterly review from the list");
    expect(r.type).toBe("cancel_task");
  });
});

describe("parseTaskIntent — overdue_tasks", () => {
  it("parses 'What's overdue?'", () => {
    expect(parseTaskIntent("What's overdue?").type).toBe("overdue_tasks");
  });

  it("parses 'What am I late on?'", () => {
    expect(parseTaskIntent("What am I late on?").type).toBe("overdue_tasks");
  });

  it("parses 'Late tasks'", () => {
    expect(parseTaskIntent("Late tasks").type).toBe("overdue_tasks");
  });
});

describe("parseTaskIntent — update_priority", () => {
  it("parses 'Change priority of X to P1'", () => {
    const r = parseTaskIntent("Change priority of Docker rebuild to P1");
    expect(r.type).toBe("update_priority");
    expect(r.priority).toBe("P1");
    expect(r.title).toContain("Docker rebuild");
  });
});

describe("parseTaskIntent — dienstschluss", () => {
  it("parses 'Dienstschluss'", () => {
    expect(parseTaskIntent("Dienstschluss").type).toBe("dienstschluss");
  });

  it("parses 'wrap up'", () => {
    expect(parseTaskIntent("Let's wrap up").type).toBe("dienstschluss");
  });

  it("parses 'end session'", () => {
    expect(parseTaskIntent("End session").type).toBe("dienstschluss");
  });

  it("parses 'that's it for today'", () => {
    expect(parseTaskIntent("That's it for today").type).toBe("dienstschluss");
  });
});

describe("parseTaskIntent — unknown", () => {
  it("returns unknown for general questions", () => {
    expect(parseTaskIntent("How does SIDJUA work?").type).toBe("unknown");
  });

  it("returns unknown for empty string", () => {
    expect(parseTaskIntent("").type).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// isDienstschluss
// ---------------------------------------------------------------------------

describe("isDienstschluss", () => {
  it("returns true for 'Dienstschluss'", () => {
    expect(isDienstschluss("Dienstschluss")).toBe(true);
  });

  it("returns true for 'wrap up'", () => {
    expect(isDienstschluss("Wrap up")).toBe(true);
  });

  it("returns true for 'end session'", () => {
    expect(isDienstschluss("end session")).toBe(true);
  });

  it("returns false for regular messages", () => {
    expect(isDienstschluss("Hello there")).toBe(false);
    expect(isDienstschluss("Add task: check email")).toBe(false);
  });
});
