// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/** A single provider entry from the approved-providers catalog. */
export interface ApprovedProvider {
  /** Unique stable ID, e.g. "groq-llama70b-free". */
  id:             string;
  /** Provider company name, e.g. "Groq". */
  name:           string;
  /** Model identifier sent to the API, e.g. "llama-3.3-70b-versatile". */
  model:          string;
  /** User-facing display name, e.g. "Groq — Llama 3.3 70B (Free)". */
  display_name:   string;
  /** "free" or "paid". */
  tier:           "free" | "paid";
  /** Quality grade, e.g. "B+" or "A-". */
  quality:        string;
  /** Input price per 1M tokens in USD (0 for free). */
  input_price:    number;
  /** Output price per 1M tokens in USD (0 for free). */
  output_price:   number;
  /** Human-readable rate limit string, e.g. "1,000 req/day". */
  rate_limit:     string;
  /** API base URL (OpenAI-compatible). */
  api_base:       string;
  /** URL for user to sign up / get an API key. */
  signup_url:     string;
  /** One-line info/note shown in the provider card. */
  info:           string;
  /** True if this is the recommended starter option. At most one per catalog. */
  recommended:    boolean;
  /** API compatibility layer; always "openai" in V1. */
  api_compatible: "openai";
}

/** The full approved-providers catalog file shape. */
export interface ProviderCatalog {
  version:       string;
  updated:       string;
  price_ceiling: { input_per_1m: number; output_per_1m: number };
  min_quality:   string;
  providers:     ApprovedProvider[];
}
