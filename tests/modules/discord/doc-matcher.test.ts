// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect } from "vitest";
import { DocMatcher, extractKeywords, NO_MATCH_RESPONSE } from "../../../src/modules/discord/handlers/doc-matcher.js";

// ---------------------------------------------------------------------------
// Test docs
// ---------------------------------------------------------------------------

const CLI_DOC = {
  filename: "CLI-REFERENCE.md",
  content: `# CLI Reference

## sidjua init

Initialize a new SIDJUA workspace in the current directory.

\`\`\`bash
sidjua init
\`\`\`

Creates the .system directory and default configuration.

## sidjua apply

Apply the divisions.yaml configuration to provision the workspace.

\`\`\`bash
sidjua apply --work-dir /path/to/workspace
\`\`\`

## sidjua status

Show current workspace status.
`,
};

const TROUBLESHOOT_DOC = {
  filename: "TROUBLESHOOTING.md",
  content: `# Troubleshooting

## Error SYS-404

The SYS-404 error means the requested resource was not found.

Check that the path is correct and the resource exists.

## Error GOV-001

The GOV-001 error indicates a governance policy violation.

Review your policy configuration.
`,
};

const docs = [CLI_DOC, TROUBLESHOOT_DOC];

// ---------------------------------------------------------------------------
// extractKeywords tests
// ---------------------------------------------------------------------------

describe("extractKeywords", () => {
  it("extracts error codes", () => {
    const kws = extractKeywords("Got error SYS-404 and GOV-001 yesterday");
    expect(kws.has("sys-404")).toBe(true);
    expect(kws.has("gov-001")).toBe(true);
  });

  it("extracts sidjua command names", () => {
    const kws = extractKeywords("How do I use sidjua init and sidjua apply?");
    expect(kws.has("sidjua:init")).toBe(true);
    expect(kws.has("sidjua:apply")).toBe(true);
  });

  it("extracts long words", () => {
    const kws = extractKeywords("workspace initialization configuration");
    expect(kws.has("workspace")).toBe(true);
    expect(kws.has("initialization")).toBe(true);
    expect(kws.has("configuration")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DocMatcher tests
// ---------------------------------------------------------------------------

describe("DocMatcher", () => {
  it("finds correct section for 'how do I init'", () => {
    const matcher = new DocMatcher(docs);
    const result  = matcher.match("how do I sidjua init the workspace");
    expect(result).not.toBeNull();
    expect(result!.section.heading).toBe("sidjua init");
    expect(result!.embed.title).toBe("sidjua init");
    expect(result!.embed.footer).toMatchObject({ text: expect.stringContaining("docs") });
  });

  it("finds correct section for 'error SYS-404'", () => {
    const matcher = new DocMatcher(docs);
    const result  = matcher.match("I keep getting error SYS-404");
    expect(result).not.toBeNull();
    expect(result!.section.heading.toLowerCase()).toContain("sys-404");
    expect(result!.embed.description).toContain("not found");
  });

  it("returns null for an unrecognized query", () => {
    const matcher = new DocMatcher(docs);
    const result  = matcher.match("chocolate cake recipe please");
    expect(result).toBeNull();
  });

  it("caps description at 500 chars", () => {
    // Create a doc with a very long section
    const longContent = "word ".repeat(200);
    const longMatcher = new DocMatcher([{
      filename: "long.md",
      content:  `## Long Section\n${longContent}`,
    }]);
    const result = longMatcher.match("word section long");
    expect(result).not.toBeNull();
    expect(result!.embed.description!.length).toBeLessThanOrEqual(500);
  });
});
