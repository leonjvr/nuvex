// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA Discord Module — Documentation Keyword Matcher
 *
 * Keyword-based matching against SIDJUA documentation files.
 *
 * On construction:
 * 1. Splits each doc into sections by ## / ### headings
 * 2. Extracts keywords per section (error codes, command names, long words)
 *
 * On match(query):
 * 1. Extracts keywords from user query
 * 2. Scores each section by keyword overlap
 * 3. Returns best section as a Discord embed, or null if no match
 */

import type { DiscordEmbed } from "../discord-types.js";


export interface DocSection {
  heading:  string;
  content:  string;
  filename: string;
}

export interface MatchResult {
  section: DocSection;
  embed:   DiscordEmbed;
}

interface IndexEntry {
  section:  DocSection;
  keywords: Set<string>;
}


/**
 * Extract searchable keywords from text:
 * - Error codes (e.g. SYS-404, GOV-001)
 * - Command names (e.g. sidjua:init, sidjua:apply)
 * - Words longer than 3 characters
 */
export function extractKeywords(text: string): Set<string> {
  const keywords = new Set<string>();
  const lower    = text.toLowerCase();

  // Error codes: two or more uppercase letters, dash, digits (case-insensitive after lower)
  for (const match of lower.matchAll(/\b([a-z]{2,}-\d+)\b/g)) {
    const kw = match[1];
    if (kw !== undefined) keywords.add(kw);
  }

  // Command names: "sidjua <subcommand>"
  for (const match of lower.matchAll(/sidjua\s+([\w-]+)/g)) {
    const sub = match[1];
    if (sub !== undefined) keywords.add(`sidjua:${sub}`);
  }

  // General words > 3 characters (skip common stop words)
  const STOP_WORDS = new Set(["this", "that", "with", "from", "have", "been", "will", "your", "into", "they", "what", "when", "then", "than"]);
  for (const match of lower.matchAll(/\b([a-z]{4,})\b/g)) {
    const word = match[1];
    if (word !== undefined && !STOP_WORDS.has(word)) {
      keywords.add(word);
    }
  }

  return keywords;
}


function parseSections(
  docs: ReadonlyArray<{ filename: string; content: string }>,
): IndexEntry[] {
  const entries: IndexEntry[] = [];

  for (const doc of docs) {
    const lines = doc.content.split("\n");
    let currentHeading = doc.filename;
    const buffer: string[] = [];

    const flush = (): void => {
      if (buffer.length > 0) {
        const content = buffer.join("\n").trim();
        if (content.length > 0) {
          const section: DocSection = { heading: currentHeading, content, filename: doc.filename };
          entries.push({ section, keywords: extractKeywords(`${currentHeading} ${content}`) });
        }
      }
    };

    for (const line of lines) {
      if (line.startsWith("## ") || line.startsWith("### ")) {
        flush();
        buffer.length = 0;
        currentHeading = line.replace(/^#{2,3}\s+/, "");
      } else {
        buffer.push(line);
      }
    }
    flush();
  }

  return entries;
}


/** Generic response when no doc section matches. */
export const NO_MATCH_RESPONSE =
  "I couldn't find a specific answer to that. " +
  "A team member will help soon. " +
  "In the meantime, check the full docs: https://docs.sidjua.com";

export class DocMatcher {
  private readonly index: IndexEntry[];

  constructor(docs: ReadonlyArray<{ filename: string; content: string }>) {
    this.index = parseSections(docs);
  }

  /**
   * Find the best matching documentation section for the query.
   * Returns null if no section scores > 0.
   */
  match(query: string): MatchResult | null {
    const queryKws = extractKeywords(query);
    if (queryKws.size === 0) return null;

    let bestEntry: IndexEntry | null = null;
    let bestScore = 0;

    for (const entry of this.index) {
      let score = 0;
      for (const kw of queryKws) {
        if (entry.keywords.has(kw)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestEntry = entry;
      }
    }

    if (bestEntry === null || bestScore === 0) return null;

    const excerpt = bestEntry.section.content.slice(0, 500).trimEnd();
    const embed: DiscordEmbed = {
      title:       bestEntry.section.heading,
      description: excerpt,
      color:       0x5865f2,
      footer:      { text: "From SIDJUA docs — full docs at docs.sidjua.com" },
    };

    return { section: bestEntry.section, embed };
  }
}
