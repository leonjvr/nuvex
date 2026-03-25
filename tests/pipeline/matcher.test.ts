/**
 * Tests for src/pipeline/matcher.ts
 */

import { describe, it, expect } from "vitest";
import { matchAction } from "../../src/pipeline/matcher.js";

describe("matchAction", () => {
  describe("wildcard *", () => {
    it("matches any action type", () => {
      expect(matchAction("email.send",    "*")).toBe(true);
      expect(matchAction("data.delete",   "*")).toBe(true);
      expect(matchAction("contract.sign", "*")).toBe(true);
      expect(matchAction("unknown",       "*")).toBe(true);
    });
  });

  describe("glob pattern (prefix.*)", () => {
    it("matches actions with matching prefix", () => {
      expect(matchAction("data.delete", "data.*")).toBe(true);
      expect(matchAction("data.export", "data.*")).toBe(true);
      expect(matchAction("data.import", "data.*")).toBe(true);
    });

    it("does NOT match the bare prefix itself", () => {
      expect(matchAction("data",    "data.*")).toBe(false);
    });

    it("does NOT match a different prefix", () => {
      expect(matchAction("email.send", "data.*")).toBe(false);
    });

    it("does NOT match a partial prefix overlap", () => {
      expect(matchAction("datastore.write", "data.*")).toBe(false);
    });

    it("matches purchase.* patterns", () => {
      expect(matchAction("purchase.initiate", "purchase.*")).toBe(true);
    });

    it("matches contract.* patterns", () => {
      expect(matchAction("contract.sign",  "contract.*")).toBe(true);
      expect(matchAction("contract.draft", "contract.*")).toBe(true);
    });
  });

  describe("exact match", () => {
    it("matches identical action type", () => {
      expect(matchAction("email.send",    "email.send")).toBe(true);
      expect(matchAction("contract.sign", "contract.sign")).toBe(true);
    });

    it("does NOT match different action type", () => {
      expect(matchAction("email.draft", "email.send")).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(matchAction("Email.Send", "email.send")).toBe(false);
    });

    it("does NOT match prefix without dot", () => {
      expect(matchAction("email", "email.send")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("empty pattern does not match", () => {
      expect(matchAction("email.send", "")).toBe(false);
    });

    it("empty action type does not match non-wildcard", () => {
      expect(matchAction("", "email.send")).toBe(false);
    });

    it("empty action type matches wildcard *", () => {
      expect(matchAction("", "*")).toBe(true);
    });
  });
});
