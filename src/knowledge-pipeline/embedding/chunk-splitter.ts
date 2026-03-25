// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — V0.9.6: Chunk Splitter
 *
 * Splits text chunks that exceed an embedder's token limit.
 * Splits at paragraph boundaries (\\n\\n), then sentence boundaries (. ),
 * never mid-word. Each part is guaranteed to be ≤ maxTokens.
 */

import { countTokens } from "../types.js";

/** Safety margin: use 50% of maxTokens as the actual limit. */
const SAFETY_FACTOR = 0.5;

/**
 * Returns the effective token limit for an embedder (maxTokens × 0.8).
 */
export function chunkLimit(maxTokens: number): number {
  return Math.floor(maxTokens * SAFETY_FACTOR);
}

/**
 * Splits text into parts where each part has ≤ limit tokens.
 * Splits at paragraph (\\n\\n), then sentence (. / ! / ?), then word boundaries.
 * Always returns at least one part.
 */
export function splitText(text: string, limit: number): string[] {
  if (countTokens(text) <= limit) return [text];

  const parts: string[] = [];

  // Try paragraph splits first
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    const candidate = current.length > 0 ? current + "\n\n" + para : para;
    if (countTokens(candidate) <= limit) {
      current = candidate;
    } else {
      if (current.length > 0) {
        parts.push(current.trim());
        current = "";
      }
      // Para itself may be too large → split by sentence
      if (countTokens(para) <= limit) {
        current = para;
      } else {
        const sentenceParts = splitBySentence(para, limit);
        for (let i = 0; i < sentenceParts.length - 1; i++) {
          parts.push(sentenceParts[i]!.trim());
        }
        current = sentenceParts[sentenceParts.length - 1] ?? "";
      }
    }
  }

  if (current.trim().length > 0) parts.push(current.trim());

  // Safety: if any part still exceeds limit (e.g. single sentence), force-split by word
  return parts.flatMap((p) => (countTokens(p) > limit ? splitByWord(p, limit) : [p]));
}

function splitBySentence(text: string, limit: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";

  for (const sent of sentences) {
    const candidate = current.length > 0 ? current + " " + sent : sent;
    if (countTokens(candidate) <= limit) {
      current = candidate;
    } else {
      if (current.length > 0) parts.push(current);
      current = countTokens(sent) <= limit ? sent : splitByWord(sent, limit).join(" ");
    }
  }

  if (current.length > 0) parts.push(current);
  return parts.length > 0 ? parts : [text];
}

function splitByWord(text: string, limit: number): string[] {
  const words = text.split(/\s+/);
  const parts: string[] = [];
  let current: string[] = [];

  for (const word of words) {
    current.push(word);
    if (countTokens(current.join(" ")) > limit) {
      if (current.length > 1) {
        current.pop();
        parts.push(current.join(" "));
        current = [word];
      } else {
        // Single word exceeds limit — include it anyway
        parts.push(current.join(" "));
        current = [];
      }
    }
  }

  if (current.length > 0) parts.push(current.join(" "));
  return parts.length > 0 ? parts : [text];
}
