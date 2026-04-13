// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Götz Kohlberg. All rights reserved.
// Dual licensed: AGPL-3.0 + SIDJUA Commercial License. See LICENSE.

/**
 * SIDJUA — Phase 8: MemoryManager
 *
 * 3-level memory system (V1: file-based, no vector DB).
 *
 * Level 1 — Short-term:  divisions/<division>/agents/<agent-id>/memory.md
 *   Per agent instance. Appended after each task. Truncated at 10KB.
 *   Serialized in checkpoints.
 *
 * Level 2 — Long-term:  divisions/<division>/agents/<definition-id>/experience.md
 *   Per AgentDefinition. Accumulated across restarts. Keyword search in V1.
 *
 * Level 3 — Pool:       divisions/<division>/knowledge/pool.md
 *   Division-wide knowledge base. Read-only in V1 (manual curation).
 *   Agent can suggest additions → logged for human review.
 */

import { readFile, writeFile, appendFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { sha256hex } from "../core/crypto-utils.js";
import type {
  AgentDefinition,
  MemoryEntry,
  MemoryLifecycleConfig,
  MemoryHealthReport,
  MemoryTier,
  CompactionStrategy,
  ArchivalCandidate,
  ArchivalTag,
  ArchivalResult,
  CompactionResult,
  MigrationResult,
  DeduplicationResult,
  PersistenceCheck,
  HygieneCycleResult,
  MemoryHygieneConfig,
  HygieneRecommendation,
  GovernanceActionLog,
} from "./types.js";
import type { Task } from "../tasks/types.js";
import type { ActionExecutor } from "./action-executor.js";
import { createLogger } from "../core/logger.js";

const logger = createLogger("agent-memory");


const SHORT_TERM_MAX_BYTES = 10 * 1024; // 10KB

const DEFAULT_LIFECYCLE_CONFIG: MemoryLifecycleConfig = {
  short_term_warn_kb: 10,
  short_term_compact_kb: 15,
  short_term_hard_limit_kb: 25,
  skill_file_warn_kb: 6,
  skill_file_compact_kb: 8,
  skill_file_hard_limit_kb: 12,
  long_term_max_entries: 10000,
  dedup_threshold: 0.95,
  archival_target: "file",   // V1: file-based archival (Qdrant = future)
  compaction_strategy: "smart",
};

/** Metadata header required on every archived entry. */
const REQUIRED_ARCHIVAL_TAGS = [
  "source_agent_id",
  "source_tier",
  "archive_timestamp",
  "content_type",
  "original_created_at",
];


export class MemoryManager {
  private readonly agentId: string;
  private readonly definition: AgentDefinition;
  private readonly basePath: string;
  private readonly lifecycleConfig: MemoryLifecycleConfig;
  private readonly executor: ActionExecutor | undefined;

  // Paths
  private readonly shortTermPath: string;
  private readonly longTermPath: string;
  private readonly poolPath: string;

  // In-memory cache of short-term for fast access between file reads
  private _shortTermCache: string | null = null;

  constructor(
    agentId: string,
    definition: AgentDefinition,
    basePath: string,
    config: MemoryLifecycleConfig = DEFAULT_LIFECYCLE_CONFIG,
    executor?: ActionExecutor,
  ) {
    this.agentId = agentId;
    this.definition = definition;
    this.basePath = basePath;
    this.lifecycleConfig = config;
    this.executor = executor;

    this.shortTermPath = join(
      basePath,
      "divisions",
      definition.division,
      "agents",
      agentId,
      "memory.md",
    );
    this.longTermPath = join(
      basePath,
      "divisions",
      definition.division,
      "agents",
      definition.id,
      "experience.md",
    );
    this.poolPath = join(
      basePath,
      "divisions",
      definition.division,
      "knowledge",
      "pool.md",
    );
  }

  // ---------------------------------------------------------------------------
  // Level 1: Short-Term Memory
  // ---------------------------------------------------------------------------

  /** Read the full short-term memory content. */
  async getShortTerm(): Promise<string> {
    if (!existsSync(this.shortTermPath)) return "";
    const content = await readFile(this.shortTermPath, "utf-8");
    this._shortTermCache = content;
    return content;
  }

  /** Overwrite the entire short-term memory. */
  async updateShortTerm(content: string): Promise<void> {
    await ensureDir(dirname(this.shortTermPath));
    await writeFile(this.shortTermPath, content, "utf-8");
    this._shortTermCache = content;
  }

  /**
   * Append an entry to short-term memory.
   * If the file would exceed SHORT_TERM_MAX_BYTES, truncate older entries first
   * (keep the most recent lines).
   */
  async appendShortTerm(entry: string): Promise<void> {
    await ensureDir(dirname(this.shortTermPath));

    const existing = existsSync(this.shortTermPath)
      ? await readFile(this.shortTermPath, "utf-8")
      : "";

    const newEntry = `\n---\n${new Date().toISOString()}\n${entry.trim()}\n`;
    let combined = existing + newEntry;

    // Truncate if over limit (keep tail — most recent entries)
    if (Buffer.byteLength(combined, "utf-8") > SHORT_TERM_MAX_BYTES) {
      combined = truncateToBytes(combined, SHORT_TERM_MAX_BYTES);
    }

    await writeFile(this.shortTermPath, combined, "utf-8");
    this._shortTermCache = combined;
  }

  // ---------------------------------------------------------------------------
  // Level 2: Long-Term Memory (per AgentDefinition, keyword search)
  // ---------------------------------------------------------------------------

  /**
   * Search long-term memory for entries containing any of the query terms.
   * V1: simple keyword search. V1.1: replace with vector similarity.
   */
  async queryLongTerm(query: string, limit = 5): Promise<MemoryEntry[]> {
    if (!existsSync(this.longTermPath)) return [];
    const content = await readFile(this.longTermPath, "utf-8");
    return searchMarkdownEntries(content, query, "long_term", this.definition.id, limit);
  }

  /** Add an experience entry to long-term memory. */
  async addLongTerm(entry: MemoryEntry): Promise<void> {
    await ensureDir(dirname(this.longTermPath));
    const formatted = `\n---\n**${entry.created_at}** [${entry.source}]\n${entry.content.trim()}\n`;
    await appendFile(this.longTermPath, formatted, "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Level 3: Pool Memory (division-wide, read-only in V1)
  // ---------------------------------------------------------------------------

  /**
   * Search pool memory for entries matching the query.
   * V1: simple keyword search in pool.md.
   */
  async queryPool(query: string, limit = 5): Promise<MemoryEntry[]> {
    if (!existsSync(this.poolPath)) return [];
    const content = await readFile(this.poolPath, "utf-8");
    return searchMarkdownEntries(content, query, "pool", undefined, limit);
  }

  /**
   * Suggest an addition to pool memory.
   * V1: logs a suggestion entry to a separate suggestions file for human review.
   * Pool is read-only — suggestions require manual review.
   */
  async addPool(entry: MemoryEntry): Promise<void> {
    const suggestionsPath = join(
      this.basePath,
      "divisions",
      this.definition.division,
      "knowledge",
      "pool-suggestions.md",
    );
    await ensureDir(dirname(suggestionsPath));
    const formatted = `\n---\n**SUGGESTION** ${entry.created_at} [agent: ${this.agentId}]\n${entry.content.trim()}\n`;
    await appendFile(suggestionsPath, formatted, "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Combined search
  // ---------------------------------------------------------------------------

  /**
   * Get relevant memories for a task from all 3 levels.
   * Returns combined Markdown string truncated to maxTokens estimate.
   * V1: simple keyword search. Keyword = task title words + first 100 chars.
   */
  async getRelevantMemories(task: Task, maxTokens: number): Promise<string> {
    const query = `${task.title} ${task.description.slice(0, 100)}`;
    const maxChars = maxTokens * 4; // ~4 chars/token approximation

    const parts: string[] = [];

    // Short-term: most relevant (recent activity)
    const shortTerm = await this.getShortTerm();
    if (shortTerm.trim()) {
      // Take the last portion of short-term that fits
      const stSlice = shortTerm.slice(-Math.floor(maxChars * 0.5));
      parts.push(`## Recent Activity\n${stSlice}`);
    }

    // Long-term: keyword-matched experiences
    const ltEntries = await this.queryLongTerm(query, 3);
    if (ltEntries.length > 0) {
      const ltText = ltEntries.map((e) => e.content).join("\n");
      parts.push(`## Relevant Experience\n${ltText}`);
    }

    // Pool: keyword-matched shared knowledge
    const poolEntries = await this.queryPool(query, 3);
    if (poolEntries.length > 0) {
      const poolText = poolEntries.map((e) => e.content).join("\n");
      parts.push(`## Division Knowledge\n${poolText}`);
    }

    const combined = parts.join("\n\n");
    // Truncate to fit within token budget
    return combined.slice(0, maxChars);
  }

  // ---------------------------------------------------------------------------
  // Checkpoint serialization
  // ---------------------------------------------------------------------------

  /**
   * Serialize the current short-term memory for checkpoint storage.
   */
  serialize(): string {
    return this._shortTermCache ?? "";
  }

  /**
   * Restore short-term memory from checkpoint data.
   * Also writes it back to disk so it's persisted.
   */
  async deserialize(data: string): Promise<void> {
    this._shortTermCache = data;
    if (data.trim()) {
      await this.updateShortTerm(data);
    }
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /** Build a MemoryEntry for long-term storage after task completion. */
  buildExperienceEntry(task: Task, outcome: string): MemoryEntry {
    return {
      id: randomUUID(),
      content: `Task "${task.title}": ${outcome}`,
      source: "long_term",
      agent_id: this.agentId,
      division: this.definition.division,
      task_id: task.id,
      created_at: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Memory Lifecycle: Health Monitoring
  // ---------------------------------------------------------------------------

  /**
   * Get a health report for this agent's memory.
   * Reads file sizes and counts, compares against config thresholds.
   */
  async getMemoryHealth(): Promise<MemoryHealthReport> {
    const now = new Date().toISOString();

    // --- Short-term ---
    let stSizeKb = 0;
    let stEntryCount = 0;
    let stOldest: string | null = null;
    let stNewest: string | null = null;

    if (existsSync(this.shortTermPath)) {
      try {
        const stBytes = (await stat(this.shortTermPath)).size;
        stSizeKb = stBytes / 1024;
        const stContent = this._shortTermCache ?? "";
        if (stContent) {
          const sections = stContent.split(/\n---\n/).filter((s) => s.trim().length > 0);
          stEntryCount = sections.length;
          // Extract timestamps from entries
          const timestamps = sections
            .map((s) => {
              const m = s.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
              return m ? m[1]! : null;
            })
            .filter((t): t is string => t !== null)
            .sort();
          stOldest = timestamps[0] ?? null;
          stNewest = timestamps[timestamps.length - 1] ?? null;
        }
      } catch (e: unknown) {
        logger.debug("agent-memory", "Memory file not readable — skipping", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    const stStatus =
      stSizeKb >= this.lifecycleConfig.short_term_hard_limit_kb
        ? "critical"
        : stSizeKb >= this.lifecycleConfig.short_term_warn_kb
        ? "warning"
        : "healthy";

    // --- Long-term ---
    let ltEntryCount = 0;
    let ltLastArchival: string | null = null;

    if (existsSync(this.longTermPath)) {
      try {
        const ltStat = await stat(this.longTermPath);
        ltLastArchival = new Date(ltStat.mtimeMs).toISOString();
        // Estimate entries by file size (rough: ~500 bytes/entry)
        ltEntryCount = Math.floor(ltStat.size / 500);
      } catch (e: unknown) {
        logger.debug("agent-memory", "Long-term memory file not readable — skipping", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    const ltStatus =
      ltEntryCount >= this.lifecycleConfig.long_term_max_entries
        ? "critical"
        : ltEntryCount >= this.lifecycleConfig.long_term_max_entries * 0.9
        ? "warning"
        : "healthy";

    // --- Pool ---
    let poolSizeKb = 0;
    if (existsSync(this.poolPath)) {
      try {
        poolSizeKb = (await stat(this.poolPath)).size / 1024;
      } catch (e: unknown) {
        logger.debug("agent-memory", "Memory pool file not readable — skipping", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      }
    }
    const poolStatus: "healthy" | "warning" =
      poolSizeKb > 100 ? "warning" : "healthy";

    // --- Skill file ---
    let skillSizeKb = 0;
    if (this.definition.skill_file && existsSync(this.definition.skill_file)) {
      try {
        skillSizeKb = (await stat(this.definition.skill_file)).size / 1024;
      } catch (e: unknown) {
        logger.debug("agent-memory", "Skill file not readable — skipping", { metadata: { error: e instanceof Error ? e.message : String(e) } });
      }
    }

    const skillStatus =
      skillSizeKb >= this.lifecycleConfig.skill_file_hard_limit_kb
        ? "critical"
        : skillSizeKb >= this.lifecycleConfig.skill_file_warn_kb
        ? "warning"
        : "healthy";

    // --- Recommendations ---
    const recommendations: HygieneRecommendation[] = [];

    if (stSizeKb >= this.lifecycleConfig.short_term_compact_kb) {
      recommendations.push({
        priority: stSizeKb >= this.lifecycleConfig.short_term_hard_limit_kb ? "high" : "medium",
        action: "compact",
        tier: "short_term",
        reason: `Short-term memory (${stSizeKb.toFixed(1)} KB) exceeds compact threshold (${this.lifecycleConfig.short_term_compact_kb} KB)`,
        estimated_savings_kb: stSizeKb * 0.4,
      });
    } else if (stSizeKb >= this.lifecycleConfig.short_term_warn_kb) {
      recommendations.push({
        priority: "low",
        action: "archive",
        tier: "short_term",
        reason: `Short-term memory (${stSizeKb.toFixed(1)} KB) approaching warn threshold (${this.lifecycleConfig.short_term_warn_kb} KB)`,
        estimated_savings_kb: stSizeKb * 0.2,
      });
    }

    if (skillSizeKb >= this.lifecycleConfig.skill_file_compact_kb) {
      recommendations.push({
        priority: skillSizeKb >= this.lifecycleConfig.skill_file_hard_limit_kb ? "high" : "medium",
        action: "migrate",
        tier: "long_term",
        reason: `Skill file (${skillSizeKb.toFixed(1)} KB) exceeds compact threshold (${this.lifecycleConfig.skill_file_compact_kb} KB)`,
        estimated_savings_kb: skillSizeKb * 0.5,
      });
    }

    if (ltEntryCount > this.lifecycleConfig.long_term_max_entries * 0.8) {
      recommendations.push({
        priority: "medium",
        action: "deduplicate",
        tier: "long_term",
        reason: `Long-term memory has ${ltEntryCount} entries (limit: ${this.lifecycleConfig.long_term_max_entries})`,
        estimated_savings_kb: 0,
      });
    }

    return {
      agent_id: this.agentId,
      timestamp: now,
      short_term: {
        size_kb: stSizeKb,
        entry_count: stEntryCount,
        status: stStatus,
        oldest_entry: stOldest,
        newest_entry: stNewest,
      },
      long_term: {
        entry_count: ltEntryCount,
        status: ltStatus,
        last_archival: ltLastArchival,
      },
      pool: {
        size_kb: poolSizeKb,
        status: poolStatus,
      },
      skill_file: {
        size_kb: skillSizeKb,
        status: skillStatus,
      },
      recommendations,
    };
  }

  // ---------------------------------------------------------------------------
  // Memory Lifecycle: Archival
  // ---------------------------------------------------------------------------

  /**
   * Archive entries from short-term to long-term or pool.
   * V1: file-based archival (appends to archive.md).
   * ALL archive operations go through Pre-Action Pipeline when executor is provided.
   */
  async archiveFromShortTerm(
    entries: ArchivalCandidate[],
    target: "long_term" | "pool",
  ): Promise<ArchivalResult> {
    if (entries.length === 0) {
      return { archived_count: 0, archived_size_kb: 0, target, entries: [], errors: [] };
    }

    // Check required tags — entries missing content_type or original_created_at
    // cannot be archived (breaks traceability)
    const missingTagEntries = entries.filter(
      (e) => !hasRequiredTags(e, REQUIRED_ARCHIVAL_TAGS),
    );
    if (missingTagEntries.length > 0) {
      return {
        archived_count: 0,
        archived_size_kb: 0,
        target,
        entries: [],
        errors: missingTagEntries.map((e) => ({
          content: e.content.slice(0, 80),
          error: "Missing required archival tags (content_type, original_created_at)",
        })),
      };
    }

    // Check governance if executor is available
    if (this.executor !== undefined) {
      const govResult = await this.executor.executeAction(
        "memory.archive",
        `${this.agentId}/short_term`,
        `Archive ${entries.length} entries to ${target}`,
        null,
      );
      if (!govResult.success) {
        return {
          archived_count: 0,
          archived_size_kb: 0,
          target,
          entries: [],
          errors: entries.map((e) => ({
            content: e.content.slice(0, 80),
            error: govResult.block_reason ?? "Blocked by governance pipeline",
          })),
        };
      }
    }

    const archivePath = this.getArchivePath(target);
    await ensureDir(dirname(archivePath));

    const archivedEntries: ArchivalResult["entries"] = [];
    const errors: ArchivalResult["errors"] = [];
    let totalBytes = 0;

    for (const entry of entries) {
      try {
        const id = randomUUID();
        const contentHash = sha256hex(entry.content);
        const tags = buildArchivalTags(entry, this.agentId, this.definition.tier.toString());

        const formatted =
          `\n---\n` +
          `**ARCHIVED** ${new Date().toISOString()}\n` +
          `id: ${id}\n` +
          `hash: ${contentHash}\n` +
          `type: ${entry.content_type}\n` +
          `original_created_at: ${entry.original_created_at}\n` +
          `tags: ${tags.map((t) => `${t.key}=${t.value}`).join(", ")}\n\n` +
          `${entry.content.trim()}\n`;

        await appendFile(archivePath, formatted, "utf-8");
        totalBytes += Buffer.byteLength(formatted, "utf-8");
        archivedEntries.push({ id, content_hash: contentHash, tags });
      } catch (err) {
        errors.push({
          content: entry.content.slice(0, 80),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      archived_count: archivedEntries.length,
      archived_size_kb: totalBytes / 1024,
      target,
      entries: archivedEntries,
      errors,
    };
  }

  // ---------------------------------------------------------------------------
  // Memory Lifecycle: Compaction
  // ---------------------------------------------------------------------------

  /**
   * Compact short-term memory to reduce its size.
   * - "truncate": keep most recent entries (discard oldest).
   * - "smart": cross-reference with DB, archive persisted content.
   * - "summarize": V1.1 only (throws MemoryError).
   */
  async compactShortTerm(strategy: CompactionStrategy): Promise<CompactionResult> {
    const beforeContent = await this.getShortTerm();
    const beforeSize = Buffer.byteLength(beforeContent, "utf-8") / 1024;

    if (strategy === "summarize") {
      throw new MemoryLifecycleError("UNSUPPORTED_STRATEGY", "Summarize strategy requires V1.1 (LLM call)");
    }

    if (strategy === "truncate") {
      return this.truncateCompaction(beforeContent, beforeSize);
    }

    // Smart compaction
    const entries = this.parseShortTermEntries(beforeContent);
    const candidates: ArchivalCandidate[] = [];
    const retained: string[] = [];

    for (const entry of entries) {
      if (this.mustRetain(entry, this.lifecycleConfig)) {
        retained.push(entry.raw);
        continue;
      }

      // Cross-reference with persistent stores
      const persistence = await this.checkPersistence(entry.content);
      if (persistence.safe_to_remove) {
        candidates.push({
          content: entry.content,
          content_type: entry.type,
          original_created_at: entry.timestamp,
          ...(entry.task_id !== undefined ? { task_id: entry.task_id } : {}),
          persistence_check: persistence,
        });
      } else {
        retained.push(entry.raw);
      }
    }

    // Archive candidates if any
    let archivalResult: ArchivalResult | null = null;
    if (candidates.length > 0) {
      archivalResult = await this.archiveFromShortTerm(candidates, "long_term");
    }

    // Rebuild with retained entries only
    const newContent = retained.join("\n\n");
    await this.updateShortTerm(newContent);

    const afterSize = Buffer.byteLength(newContent, "utf-8") / 1024;
    const errorCount = archivalResult?.errors.length ?? 0;

    return {
      strategy: "smart",
      before_size_kb: beforeSize,
      after_size_kb: afterSize,
      entries_removed: candidates.length - errorCount,
      entries_retained: retained.length,
      entries_archived: archivalResult?.archived_count ?? 0,
      dry_run: false,
    };
  }

  private truncateCompaction(content: string, beforeSize: number): CompactionResult {
    // Keep the tail (most recent entries)
    const maxBytes = (this.lifecycleConfig.short_term_warn_kb * 1024) * 0.7;
    const buf = Buffer.from(content, "utf-8");
    const entries = content.split(/\n---\n/).filter((s) => s.trim().length > 0);

    let kept = entries;
    let removed = 0;

    if (buf.length > maxBytes) {
      // Drop from the front (oldest)
      const target = Math.floor(entries.length * 0.6);
      kept = entries.slice(entries.length - target);
      removed = entries.length - kept.length;
    }

    const newContent = kept.join("\n---\n");
    // Note: we don't actually write here; compactShortTerm calls updateShortTerm.
    // This method returns the result without modifying the file.
    // The actual write is done in compactShortTerm for the "smart" path.
    // For truncate, we need to write too.
    void writeFile(this.shortTermPath, newContent, "utf-8").catch(() => {
      // best effort
    });
    this._shortTermCache = newContent;

    const afterSize = Buffer.byteLength(newContent, "utf-8") / 1024;

    return {
      strategy: "truncate",
      before_size_kb: beforeSize,
      after_size_kb: afterSize,
      entries_removed: removed,
      entries_retained: kept.length,
      entries_archived: 0,
      dry_run: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Memory Lifecycle: Migration
  // ---------------------------------------------------------------------------

  /**
   * Move entries between memory tiers with governance enforcement.
   */
  async migrate(
    entries: MemoryEntry[],
    from: MemoryTier,
    to: MemoryTier,
    tags: ArchivalTag[],
  ): Promise<MigrationResult> {
    if (entries.length === 0) {
      return { migrated_count: 0, from, to, errors: [] };
    }

    // Check governance if executor is available
    if (this.executor !== undefined) {
      const govResult = await this.executor.executeAction(
        "memory.migrate",
        `${from} -> ${to}`,
        `Migrate ${entries.length} entries from ${from} to ${to}`,
        null,
      );
      if (!govResult.success) {
        return {
          migrated_count: 0,
          from,
          to,
          errors: entries.map((e) => ({
            entry_id: e.id,
            error: govResult.block_reason ?? "Blocked by governance pipeline",
          })),
        };
      }
    }

    const errors: MigrationResult["errors"] = [];
    let migratedCount = 0;

    for (const entry of entries) {
      try {
        // Add to target tier
        const migrated: MemoryEntry = {
          ...entry,
          source: to as MemoryEntry["source"],
          created_at: new Date().toISOString(),
        };

        if (to === "long_term") {
          await this.addLongTerm(migrated);
        } else if (to === "pool") {
          await this.addPool(migrated);
        }

        migratedCount++;
      } catch (err) {
        errors.push({
          entry_id: entry.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { migrated_count: migratedCount, from, to, errors };
  }

  // ---------------------------------------------------------------------------
  // Memory Lifecycle: Deduplication
  // ---------------------------------------------------------------------------

  /**
   * Find and remove near-duplicate entries within a tier.
   * V1: exact hash-based deduplication (threshold param noted but 1.0 exact in V1).
   * V1.1: vector-based with cosine similarity threshold.
   */
  async deduplicateWithin(tier: MemoryTier, threshold: number): Promise<DeduplicationResult> {
    if (tier !== "short_term") {
      // V1: only short-term dedup implemented
      return { tier, duplicates_found: 0, duplicates_removed: 0, space_saved_kb: 0 };
    }

    const content = await this.getShortTerm();
    const sections = content.split(/\n---\n/).filter((s) => s.trim().length > 0);
    const beforeSize = Buffer.byteLength(content, "utf-8");

    // V1: exact dedup (threshold=1.0 effectively)
    const seen = new Set<string>();
    const kept: string[] = [];
    let duplicates = 0;

    for (const section of sections) {
      const hash = sha256hex(section.trim());
      if (!seen.has(hash)) {
        seen.add(hash);
        kept.push(section);
      } else {
        // Near-duplicate check (V1: exact; V1.1: cosine similarity >= threshold)
        const similarity = 1.0; // exact match
        if (similarity >= threshold) {
          duplicates++;
        } else {
          kept.push(section);
        }
      }
    }

    if (duplicates > 0) {
      const newContent = kept.join("\n---\n");
      await this.updateShortTerm(newContent);
      const afterSize = Buffer.byteLength(newContent, "utf-8");
      return {
        tier,
        duplicates_found: duplicates,
        duplicates_removed: duplicates,
        space_saved_kb: (beforeSize - afterSize) / 1024,
      };
    }

    return { tier, duplicates_found: 0, duplicates_removed: 0, space_saved_kb: 0 };
  }

  // ---------------------------------------------------------------------------
  // Memory Lifecycle: Persistence check
  // ---------------------------------------------------------------------------

  /**
   * Check if content is already persisted in another store.
   * V1: SHA-256 hash + task DB lookup via basePath.
   */
  async checkPersistence(content: string): Promise<PersistenceCheck> {
    const contentHash = sha256hex(content);
    const persistedIn: PersistenceCheck["persisted_in"] = [];

    // Look for task ID references in content
    const taskRefs = extractTaskRefs(content);

    if (taskRefs.length > 0) {
      // Check tasks.db at system/tasks.db
      const tasksDbPath = join(this.basePath, "system", "tasks.db");
      if (existsSync(tasksDbPath)) {
        try {
          // Dynamic import to avoid circular deps; better-sqlite3 is already a dep
          // Use createRequire for CJS interop in ESM context
          const { createRequire } = await import("node:module");
          const req = createRequire(import.meta.url);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const BetterSQLite = req("better-sqlite3") as any;
          const db = new BetterSQLite(tasksDbPath, { readonly: true }) as {
            prepare(sql: string): { get(...args: unknown[]): unknown };
            close(): void;
          };
          for (const taskId of taskRefs) {
            const row = db.prepare("SELECT id FROM tasks WHERE id = ? AND status IN ('DONE','FAILED','CANCELLED')").get(taskId) as { id: string } | undefined;
            if (row !== undefined) {
              persistedIn.push({ store: "tasks_db", reference_id: row.id });
              break; // found one match is sufficient
            }
          }
          db.close();
        } catch (e: unknown) {
          logger.warn("agent-memory", "DB accessibility check failed — conservative: treating as unsafe", { metadata: { error: e instanceof Error ? e.message : String(e) } });
        }
      }
    }

    const safeToRemove = persistedIn.some((p) => p.store !== "none");

    return {
      content_hash: contentHash,
      persisted_in: persistedIn.length > 0 ? persistedIn : [{ store: "none" }],
      safe_to_remove: safeToRemove,
    };
  }

  // ---------------------------------------------------------------------------
  // Memory Lifecycle: Hygiene cycle
  // ---------------------------------------------------------------------------

  /**
   * Run a full hygiene cycle: health check → compact → archive → dedup.
   * Reports governance actions if executor is available.
   */
  async runHygieneCycle(config: MemoryHygieneConfig): Promise<HygieneCycleResult> {
    const start = Date.now();
    const healthBefore = await this.getMemoryHealth();
    const governanceActions: GovernanceActionLog[] = [];

    let compactionResult: CompactionResult | null = null;
    let archivalResult: ArchivalResult | null = null;
    let dedupResult: DeduplicationResult | null = null;

    // Step 1: Compact if needed
    const stSizeKb = healthBefore.short_term.size_kb;
    if (stSizeKb >= config.thresholds.short_term_compact_kb) {
      const strategy = config.compaction.strategy;

      // Check governance
      if (this.executor !== undefined) {
        const govResult = await this.executor.executeAction(
          "memory.compact",
          `${this.agentId}/short_term`,
          `Compact short-term memory (${stSizeKb.toFixed(1)} KB, strategy=${strategy})`,
          null,
        );
        governanceActions.push({
          action_type: "memory.compact",
          verdict: govResult.success ? "ALLOW" : "BLOCK",
          ...(govResult.block_reason !== undefined ? { reason: govResult.block_reason } : {}),
        });

        if (govResult.success) {
          try {
            compactionResult = await this.compactShortTerm(strategy);
          } catch (err) {
            // Log but continue
            governanceActions.push({
              action_type: "memory.compact",
              verdict: "BLOCK",
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } else {
        try {
          compactionResult = await this.compactShortTerm(strategy);
        } catch (e: unknown) {
          logger.warn("agent-memory", "Summarize strategy failed — skipping memory compaction", { metadata: { error: e instanceof Error ? e.message : String(e) } });
        }
        if (compactionResult !== null) {
          governanceActions.push({ action_type: "memory.compact", verdict: "ALLOW" });
        }
      }
    }

    // Step 2: Deduplication
    if (this.executor !== undefined) {
      const govResult = await this.executor.executeAction(
        "memory.compact",
        `${this.agentId}/short_term/dedup`,
        `Deduplicate short-term memory`,
        null,
      );
      governanceActions.push({
        action_type: "memory.deduplicate",
        verdict: govResult.success ? "ALLOW" : "BLOCK",
        ...(govResult.block_reason !== undefined ? { reason: govResult.block_reason } : {}),
      });
      if (govResult.success) {
        dedupResult = await this.deduplicateWithin("short_term", config.thresholds.dedup_threshold);
      }
    } else {
      dedupResult = await this.deduplicateWithin("short_term", config.thresholds.dedup_threshold);
    }

    const healthAfter = await this.getMemoryHealth();

    return {
      agent_id: this.agentId,
      timestamp: new Date().toISOString(),
      dry_run: false,
      duration_ms: Date.now() - start,
      short_term: compactionResult,
      archival: archivalResult,
      deduplication: dedupResult,
      health_before: healthBefore,
      health_after: healthAfter,
      governance_actions: governanceActions,
    };
  }

  /**
   * Dry run: report what hygiene would do without executing.
   */
  async dryRunHygiene(config: MemoryHygieneConfig): Promise<HygieneCycleResult> {
    const start = Date.now();
    const healthBefore = await this.getMemoryHealth();

    // Simulate compaction result without writing
    let compactionResult: CompactionResult | null = null;
    const stSizeKb = healthBefore.short_term.size_kb;

    if (stSizeKb >= config.thresholds.short_term_compact_kb) {
      const entries = this.parseShortTermEntries(this._shortTermCache ?? "");
      const wouldRetain = entries.filter((e) => this.mustRetain(e, config.thresholds));
      const wouldRemove = entries.length - wouldRetain.length;
      const estimatedAfterKb = stSizeKb * (wouldRetain.length / Math.max(entries.length, 1));

      compactionResult = {
        strategy: config.compaction.strategy,
        before_size_kb: stSizeKb,
        after_size_kb: estimatedAfterKb,
        entries_removed: wouldRemove,
        entries_retained: wouldRetain.length,
        entries_archived: wouldRemove,
        dry_run: true,
      };
    }

    return {
      agent_id: this.agentId,
      timestamp: new Date().toISOString(),
      dry_run: true,
      duration_ms: Date.now() - start,
      short_term: compactionResult,
      archival: null,
      deduplication: null,
      health_before: healthBefore,
      health_after: healthBefore, // unchanged in dry run
      governance_actions: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Private lifecycle helpers
  // ---------------------------------------------------------------------------

  /** Get the file-based archive path for a target tier. */
  private getArchivePath(target: "long_term" | "pool"): string {
    if (target === "pool") {
      return join(this.basePath, "divisions", this.definition.division, "knowledge", "archive.md");
    }
    return join(
      this.basePath,
      "divisions",
      this.definition.division,
      "agents",
      this.agentId,
      "archive.md",
    );
  }

  /**
   * Parse short-term memory into discrete entries.
   * Entries delimited by --- separators.
   */
  private parseShortTermEntries(content: string): ParsedMemoryEntry[] {
    const sections = content.split(/\n---\n/).filter((s) => s.trim().length > 0);
    const now = Date.now();

    return sections.map((section) => {
      const lower = section.toLowerCase();

      // Extract ISO timestamp
      const tsMatch = section.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)/);
      const timestamp = tsMatch ? tsMatch[1]! : new Date().toISOString();
      const ageMs = now - new Date(timestamp).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);

      // Extract task ID references
      const taskIdMatch = section.match(/task[_\s-]?(?:id[:\s]+)?([a-f0-9-]{36})/i);
      const taskId = taskIdMatch ? taskIdMatch[1] : undefined;

      // Infer content type
      let type: ArchivalCandidate["content_type"] = "session";
      if (lower.includes("decision") || lower.includes("decided")) type = "decision";
      else if (lower.includes("task") || lower.includes("executed") || lower.includes("completed")) type = "task_result";
      else if (lower.includes("error") || lower.includes("failed") || lower.includes("crash")) type = "error_log";
      else if (lower.includes("knowledge") || lower.includes("learned") || lower.includes("pattern")) type = "knowledge";

      // Retention signals
      const referencesOpenTask = lower.includes("running") || lower.includes("waiting") || lower.includes("pending");
      const isActiveProject = lower.includes("project") && !lower.includes("completed");
      const isUnresolvedDecision = (lower.includes("decision") || lower.includes("decide")) && !lower.includes("resolved") && !lower.includes("done");
      const isCurrentSession = ageDays < 0.1; // less than 2.4 hours old

      // Session index: rough count by position
      const sectionIdx = sections.indexOf(section);
      const sessionIndex = sections.length - sectionIdx; // 1-indexed from newest

      return {
        raw: section,
        content: section.trim(),
        type,
        timestamp,
        ...(taskId !== undefined ? { task_id: taskId } : {}),
        session_index: sessionIndex,
        age_days: ageDays,
        references_open_task: referencesOpenTask,
        is_active_project: isActiveProject,
        is_unresolved_decision: isUnresolvedDecision,
        is_current_session: isCurrentSession,
      };
    });
  }

  /**
   * Check whether an entry must be retained per lifecycle config.
   */
  private mustRetain(entry: ParsedMemoryEntry, _config: MemoryLifecycleConfig): boolean {
    // always_retain rules (from spec)
    if (entry.references_open_task) return true;
    if (entry.is_active_project) return true;
    if (entry.is_unresolved_decision) return true;
    if (entry.is_current_session) return true;

    // time_based rules (from spec defaults)
    if (entry.type === "decision" && entry.age_days <= 7) return true;
    if (entry.session_index !== undefined && entry.session_index <= 3) return true;
    if (entry.type === "error_log" && entry.age_days <= 3) return true; // 72h

    return false;
  }
}


async function ensureDir(dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Simple keyword search over Markdown content split by `---` separators.
 * Returns entries containing any word from the query, up to `limit`.
 */
function searchMarkdownEntries(
  content: string,
  query: string,
  source: MemoryEntry["source"],
  agentId: string | undefined,
  limit: number,
): MemoryEntry[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3); // skip short words

  const sections = content.split(/\n---\n/).filter((s) => s.trim().length > 0);
  const matches: MemoryEntry[] = [];

  for (const section of sections) {
    if (matches.length >= limit) break;
    const lower = section.toLowerCase();
    const isRelevant = words.length === 0 || words.some((w) => lower.includes(w));
    if (isRelevant) {
      matches.push({
        id: randomUUID(),
        content: section.trim(),
        source,
        ...(agentId !== undefined ? { agent_id: agentId } : {}),
        created_at: new Date().toISOString(),
        relevance_score: scoreRelevance(section, words),
      });
    }
  }

  // Sort by relevance score descending
  matches.sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
  return matches.slice(0, limit);
}

/** Simple relevance score: count of query word occurrences. */
function scoreRelevance(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  return words.reduce((sum, w) => {
    let count = 0;
    let pos = 0;
    while ((pos = lower.indexOf(w, pos)) !== -1) {
      count++;
      pos += w.length;
    }
    return sum + count;
  }, 0);
}

/**
 * Truncate text to approximately maxBytes, keeping the tail (most recent).
 * Truncates at a newline boundary to avoid cutting mid-entry.
 */
function truncateToBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf-8");
  if (buf.length <= maxBytes) return text;
  // Take the tail
  const tail = buf.slice(buf.length - maxBytes);
  const str = tail.toString("utf-8");
  // Find first newline to start at a clean boundary
  const newlineIdx = str.indexOf("\n");
  return newlineIdx !== -1 ? str.slice(newlineIdx + 1) : str;
}


/**
 * Internal representation of a parsed short-term memory entry.
 * Used during compaction / retention analysis.
 */
interface ParsedMemoryEntry {
  raw: string;
  content: string;
  type: ArchivalCandidate["content_type"];
  timestamp: string;
  task_id?: string;
  session_index?: number;
  age_days: number;
  references_open_task: boolean;
  is_active_project: boolean;
  is_unresolved_decision: boolean;
  is_current_session: boolean;
}

/** Error thrown by unsupported memory lifecycle strategies. */
export class MemoryLifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MemoryLifecycleError";
  }
}

/**
 * Verify that a candidate has the data required to build all required archival tags.
 * Required: content_type, original_created_at (source_agent_id/tier always from MemoryManager).
 */
function hasRequiredTags(candidate: ArchivalCandidate, _required: string[]): boolean {
  return (
    typeof candidate.content_type === "string" &&
    candidate.content_type.length > 0 &&
    typeof candidate.original_created_at === "string" &&
    candidate.original_created_at.length > 0
  );
}

/**
 * Build the archival tag array for an entry.
 */
function buildArchivalTags(
  entry: ArchivalCandidate,
  agentId: string,
  tier: string,
): ArchivalTag[] {
  const tags: ArchivalTag[] = [
    { key: "source_agent_id", value: agentId },
    { key: "source_tier", value: tier },
    { key: "archive_timestamp", value: new Date().toISOString() },
    { key: "content_type", value: entry.content_type },
    { key: "original_created_at", value: entry.original_created_at },
  ];
  if (entry.task_id !== undefined) tags.push({ key: "task_id", value: entry.task_id });
  if (entry.project_name !== undefined) tags.push({ key: "project_name", value: entry.project_name });
  return tags;
}

/**
 * Extract potential task ID references (UUIDs) from memory content.
 */
function extractTaskRefs(content: string): string[] {
  const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const matches = content.match(uuidPattern);
  return matches ? [...new Set(matches)] : [];
}
