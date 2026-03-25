// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 SIDJUA. All rights reserved.

import { describe, it, expect } from "vitest";
import { mapOpenClawModel }      from "../../src/import/openclaw-model-mapper.js";

describe("mapOpenClawModel", () => {
  // Known exact mappings
  it("maps anthropic/claude-sonnet-4-5", () => {
    expect(mapOpenClawModel("anthropic/claude-sonnet-4-5")).toEqual({
      provider: "anthropic",
      model:    "claude-sonnet-4-5",
    });
  });

  it("maps anthropic/claude-haiku-3-5", () => {
    expect(mapOpenClawModel("anthropic/claude-haiku-3-5")).toEqual({
      provider: "anthropic",
      model:    "claude-haiku-3-5",
    });
  });

  it("maps anthropic/claude-opus-4-5", () => {
    expect(mapOpenClawModel("anthropic/claude-opus-4-5")).toEqual({
      provider: "anthropic",
      model:    "claude-opus-4-5",
    });
  });

  it("maps openai/gpt-4.1", () => {
    expect(mapOpenClawModel("openai/gpt-4.1")).toEqual({
      provider: "openai",
      model:    "gpt-4.1",
    });
  });

  it("maps openai/gpt-4.1-mini", () => {
    expect(mapOpenClawModel("openai/gpt-4.1-mini")).toEqual({
      provider: "openai",
      model:    "gpt-4.1-mini",
    });
  });

  it("maps google/gemini-2.5-flash", () => {
    expect(mapOpenClawModel("google/gemini-2.5-flash")).toEqual({
      provider: "google",
      model:    "gemini-2.5-flash",
    });
  });

  it("maps groq/llama-3.3-70b-versatile → groq/llama-3.3-70b", () => {
    expect(mapOpenClawModel("groq/llama-3.3-70b-versatile")).toEqual({
      provider: "groq",
      model:    "llama-3.3-70b",
    });
  });

  it("maps mistral/mistral-large-latest → mistral/mistral-large", () => {
    expect(mapOpenClawModel("mistral/mistral-large-latest")).toEqual({
      provider: "mistral",
      model:    "mistral-large",
    });
  });

  it("maps deepseek/deepseek-chat → deepseek/deepseek-v3", () => {
    expect(mapOpenClawModel("deepseek/deepseek-chat")).toEqual({
      provider: "deepseek",
      model:    "deepseek-v3",
    });
  });

  it("maps xai/grok-3", () => {
    expect(mapOpenClawModel("xai/grok-3")).toEqual({
      provider: "xai",
      model:    "grok-3",
    });
  });

  // openrouter pass-through
  it("maps openrouter/* as pass-through", () => {
    expect(mapOpenClawModel("openrouter/meta-llama/llama-3")).toEqual({
      provider: "openrouter",
      model:    "meta-llama/llama-3",
    });
  });

  it("maps openrouter/anthropic/claude-3-haiku", () => {
    const result = mapOpenClawModel("openrouter/anthropic/claude-3-haiku");
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("anthropic/claude-3-haiku");
  });

  // Unknown provider
  it("maps unknown provider → custom", () => {
    expect(mapOpenClawModel("myvendor/my-model")).toEqual({
      provider: "custom",
      model:    "my-model",
    });
  });

  it("maps unknown prefix → custom with full string as model", () => {
    const result = mapOpenClawModel("brandnew/fancy-model");
    expect(result.provider).toBe("custom");
  });

  // No slash — bare model name
  it("maps bare model name (no slash) → custom", () => {
    const result = mapOpenClawModel("gpt-4");
    expect(result.provider).toBe("custom");
    expect(result.model).toBe("gpt-4");
  });

  // Empty string
  it("throws for empty model string", () => {
    expect(() => mapOpenClawModel("")).toThrow("No model configured");
  });

  it("throws for whitespace-only model string", () => {
    expect(() => mapOpenClawModel("   ")).toThrow("No model configured");
  });

  // Whitespace trimming
  it("trims surrounding whitespace from model string", () => {
    expect(mapOpenClawModel("  anthropic/claude-sonnet-4-5  ")).toEqual({
      provider: "anthropic",
      model:    "claude-sonnet-4-5",
    });
  });
});
