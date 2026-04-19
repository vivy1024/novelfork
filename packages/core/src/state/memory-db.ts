/**
 * Temporal memory database for NovelFork truth files.
 *
 * Uses Node.js built-in SQLite (node:sqlite, Node 22+).
 * Stores facts with temporal validity (valid_from/valid_until chapter numbers),
 * enabling precise queries like "what did character X know in chapter 5?"
 *
 * Backward compatible: existing markdown truth files are still the primary
 * persistence layer. MemoryDB is an acceleration index built alongside them.
 */

import { join } from "node:path";
import { createSqliteDatabase } from "./sqlite-driver.js";

const FACT_SELECT_COLUMNS = `
  id,
  subject,
  predicate,
  object,
  valid_from_chapter AS validFromChapter,
  valid_until_chapter AS validUntilChapter,
  source_chapter AS sourceChapter
`;

export interface Fact {
  readonly id?: number;
  readonly subject: string;
  readonly predicate: string;
  readonly object: string;
  readonly validFromChapter: number;
  readonly validUntilChapter: number | null;
  readonly sourceChapter: number;
}

export interface StoredSummary {
  readonly chapter: number;
  readonly title: string;
  readonly characters: string;
  readonly events: string;
  readonly stateChanges: string;
  readonly hookActivity: string;
  readonly mood: string;
  readonly chapterType: string;
}

export interface StoredHook {
  readonly hookId: string;
  readonly startChapter: number;
  readonly type: string;
  readonly status: string;
  readonly lastAdvancedChapter: number;
  readonly expectedPayoff: string;
  readonly payoffTiming?: string;
  readonly expectedResolveChapter?: number;
  readonly notes: string;
}

export interface ChapterSnapshot {
  readonly id?: number;
  readonly chapterId: string;
  readonly content: string;
  readonly createdAt: number;
  readonly triggerType: string;
  readonly description?: string;
  readonly parentId?: number;
}

// ---------------------------------------------------------------------------
// World Info / Lorebook
// ---------------------------------------------------------------------------

export interface WorldEntry {
  readonly id?: number;
  readonly dimension: string;
  readonly name: string;
  readonly keywords: string;
  readonly content: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly sourceChapter: number | null;
}

export interface WorldDimension {
  readonly id?: number;
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly builtIn: boolean;
}

export class MemoryDB {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  constructor(bookDir: string) {
    const dbPath = join(bookDir, "story", "memory.db");
    this.db = createSqliteDatabase(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        valid_from_chapter INTEGER NOT NULL,
        valid_until_chapter INTEGER,
        source_chapter INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chapter_summaries (
        chapter INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        characters TEXT NOT NULL DEFAULT '',
        events TEXT NOT NULL DEFAULT '',
        state_changes TEXT NOT NULL DEFAULT '',
        hook_activity TEXT NOT NULL DEFAULT '',
        mood TEXT NOT NULL DEFAULT '',
        chapter_type TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS hooks (
        hook_id TEXT PRIMARY KEY,
        start_chapter INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        last_advanced_chapter INTEGER NOT NULL DEFAULT 0,
        expected_payoff TEXT NOT NULL DEFAULT '',
        payoff_timing TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS chapter_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chapter_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        trigger_type TEXT NOT NULL,
        description TEXT,
        parent_id INTEGER,
        FOREIGN KEY (parent_id) REFERENCES chapter_snapshots(id)
      );

      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_valid ON facts(valid_from_chapter, valid_until_chapter);
      CREATE INDEX IF NOT EXISTS idx_facts_source ON facts(source_chapter);
      CREATE INDEX IF NOT EXISTS idx_hooks_status ON hooks(status);
      CREATE INDEX IF NOT EXISTS idx_hooks_last_advanced ON hooks(last_advanced_chapter);
      CREATE INDEX IF NOT EXISTS idx_snapshots_chapter ON chapter_snapshots(chapter_id, created_at DESC);
    `);

    // --- World Info / Lorebook tables (Phase 4) ---
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world_dimensions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        built_in INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS world_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dimension TEXT NOT NULL,
        name TEXT NOT NULL,
        keywords TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        source_chapter INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (dimension) REFERENCES world_dimensions(key)
      );

      CREATE INDEX IF NOT EXISTS idx_world_entries_dimension ON world_entries(dimension);
      CREATE INDEX IF NOT EXISTS idx_world_entries_enabled ON world_entries(enabled, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_world_entries_keywords ON world_entries(keywords);
    `);

    // Seed built-in dimensions if empty
    this.seedBuiltInDimensions();

    this.ensureColumn("hooks", "payoff_timing", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("hooks", "expected_resolve_chapter", "INTEGER");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch {
      // Column already exists on existing databases.
    }
  }

  private seedBuiltInDimensions(): void {
    const builtIn: ReadonlyArray<{ key: string; label: string; description: string }> = [
      { key: "characters", label: "角色", description: "人物设定、属性、关系" },
      { key: "hooks", label: "伏笔", description: "叙事钩子、悬念、回收计划" },
      { key: "items", label: "道具", description: "重要物品、法宝、装备" },
      { key: "timeline", label: "时间线", description: "关键事件时间节点" },
      { key: "factions", label: "势力", description: "门派、组织、阵营" },
      { key: "physics", label: "物理规则", description: "修炼体系、战力规则、世界法则" },
      { key: "economy", label: "经济", description: "货币、交易、资源体系" },
      { key: "geography", label: "地理", description: "地图、地点、空间关系" },
      { key: "materials", label: "材料", description: "灵材、配方、炼制素材" },
    ];
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO world_dimensions (key, label, description, built_in) VALUES (?, ?, ?, 1)`,
    );
    for (const dim of builtIn) {
      stmt.run(dim.key, dim.label, dim.description);
    }
  }

  // ---------------------------------------------------------------------------
  // Facts (temporal)
  // ---------------------------------------------------------------------------

  /** Add a new fact. */
  addFact(fact: Omit<Fact, "id">): number {
    const stmt = this.db.prepare(
      `INSERT INTO facts (subject, predicate, object, valid_from_chapter, valid_until_chapter, source_chapter)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const result = stmt.run(
      fact.subject, fact.predicate, fact.object,
      fact.validFromChapter, fact.validUntilChapter ?? null, fact.sourceChapter,
    );
    return Number(result.lastInsertRowid);
  }

  /** Invalidate a fact (set valid_until). */
  invalidateFact(id: number, untilChapter: number): void {
    this.db.prepare(
      "UPDATE facts SET valid_until_chapter = ? WHERE id = ?",
    ).run(untilChapter, id);
  }

  /** Get all currently valid facts (valid_until is null). */
  getCurrentFacts(): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE valid_until_chapter IS NULL
       ORDER BY subject, predicate`,
    ).all() as unknown as Fact[];
  }

  /** Get facts about a specific subject that are valid at a given chapter. */
  getFactsAt(subject: string, chapter: number): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject = ? AND valid_from_chapter <= ?
       AND (valid_until_chapter IS NULL OR valid_until_chapter > ?)
       ORDER BY predicate`,
    ).all(subject, chapter, chapter) as unknown as Fact[];
  }

  /** Get all facts about a subject (including historical). */
  getFactHistory(subject: string): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject = ?
       ORDER BY valid_from_chapter`,
    ).all(subject) as unknown as Fact[];
  }

  /** Search facts by predicate (e.g., all "location" facts). */
  getFactsByPredicate(predicate: string): ReadonlyArray<Fact> {
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE predicate = ? AND valid_until_chapter IS NULL
       ORDER BY subject`,
    ).all(predicate) as unknown as Fact[];
  }

  /** Get facts relevant to a set of character names. */
  getFactsForCharacters(names: ReadonlyArray<string>): ReadonlyArray<Fact> {
    if (names.length === 0) return [];
    const placeholders = names.map(() => "?").join(",");
    return this.db.prepare(
      `SELECT ${FACT_SELECT_COLUMNS}
       FROM facts
       WHERE subject IN (${placeholders}) AND valid_until_chapter IS NULL
       ORDER BY subject, predicate`,
    ).all(...names) as unknown as Fact[];
  }

  replaceCurrentFacts(facts: ReadonlyArray<Omit<Fact, "id">>): void {
    this.db.exec("DELETE FROM facts WHERE valid_until_chapter IS NULL");
    for (const fact of facts) {
      this.addFact(fact);
    }
  }

  resetFacts(): void {
    this.db.exec("DELETE FROM facts");
  }

  // ---------------------------------------------------------------------------
  // Chapter summaries
  // ---------------------------------------------------------------------------

  /** Upsert a chapter summary. */
  upsertSummary(summary: StoredSummary): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO chapter_summaries (chapter, title, characters, events, state_changes, hook_activity, mood, chapter_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      summary.chapter, summary.title, summary.characters, summary.events,
      summary.stateChanges, summary.hookActivity, summary.mood, summary.chapterType,
    );
  }

  replaceSummaries(summaries: ReadonlyArray<StoredSummary>): void {
    this.db.exec("DELETE FROM chapter_summaries");
    for (const summary of summaries) {
      this.upsertSummary(summary);
    }
  }

  /** Get summaries for a range of chapters. */
  getSummaries(fromChapter: number, toChapter: number): ReadonlyArray<StoredSummary> {
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       WHERE chapter >= ? AND chapter <= ?
       ORDER BY chapter`,
    ).all(fromChapter, toChapter) as unknown as StoredSummary[];
  }

  /** Get summaries matching any of the given character names. */
  getSummariesByCharacters(names: ReadonlyArray<string>): ReadonlyArray<StoredSummary> {
    if (names.length === 0) return [];
    const conditions = names.map(() => "characters LIKE ?").join(" OR ");
    const params = names.map((n) => `%${n}%`);
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       WHERE ${conditions}
       ORDER BY chapter`,
    ).all(...params) as unknown as StoredSummary[];
  }

  /** Get total chapter count. */
  getChapterCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM chapter_summaries").get() as unknown as { count: number };
    return row.count;
  }

  /** Get the most recent N summaries. */
  getRecentSummaries(count: number): ReadonlyArray<StoredSummary> {
    return this.db.prepare(
      `SELECT
         chapter,
         title,
         characters,
         events,
         state_changes AS stateChanges,
         hook_activity AS hookActivity,
         mood,
         chapter_type AS chapterType
       FROM chapter_summaries
       ORDER BY chapter DESC
       LIMIT ?`,
    ).all(count) as unknown as ReadonlyArray<StoredSummary>;
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  upsertHook(hook: StoredHook): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO hooks (hook_id, start_chapter, type, status, last_advanced_chapter, expected_payoff, payoff_timing, expected_resolve_chapter, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      hook.hookId,
      hook.startChapter,
      hook.type,
      hook.status,
      hook.lastAdvancedChapter,
      hook.expectedPayoff,
      hook.payoffTiming ?? "",
      hook.expectedResolveChapter ?? null,
      hook.notes,
    );
  }

  replaceHooks(hooks: ReadonlyArray<StoredHook>): void {
    this.db.exec("DELETE FROM hooks");
    for (const hook of hooks) {
      this.upsertHook(hook);
    }
  }

  getActiveHooks(): ReadonlyArray<StoredHook> {
    return this.db.prepare(
      `SELECT
         hook_id AS hookId,
         start_chapter AS startChapter,
         type,
         status,
         last_advanced_chapter AS lastAdvancedChapter,
         expected_payoff AS expectedPayoff,
         payoff_timing AS payoffTiming,
         expected_resolve_chapter AS expectedResolveChapter,
         notes
       FROM hooks
       WHERE lower(status) NOT IN ('resolved', 'closed', '已回收', '已解决')
       ORDER BY last_advanced_chapter DESC, start_chapter DESC, hook_id ASC`,
    ).all() as unknown as ReadonlyArray<StoredHook>;
  }

  getAllHooks(): ReadonlyArray<StoredHook> {
    return this.db.prepare(
      `SELECT
         hook_id AS hookId,
         start_chapter AS startChapter,
         type,
         status,
         last_advanced_chapter AS lastAdvancedChapter,
         expected_payoff AS expectedPayoff,
         payoff_timing AS payoffTiming,
         expected_resolve_chapter AS expectedResolveChapter,
         notes
       FROM hooks
       ORDER BY start_chapter DESC, hook_id ASC`,
    ).all() as unknown as ReadonlyArray<StoredHook>;
  }

  getOverdueHooks(currentChapter: number): ReadonlyArray<StoredHook> {
    return this.db.prepare(
      `SELECT
         hook_id AS hookId,
         start_chapter AS startChapter,
         type,
         status,
         last_advanced_chapter AS lastAdvancedChapter,
         expected_payoff AS expectedPayoff,
         payoff_timing AS payoffTiming,
         expected_resolve_chapter AS expectedResolveChapter,
         notes
       FROM hooks
       WHERE lower(status) NOT IN ('resolved', 'closed', '已回收', '已解决')
       AND expected_resolve_chapter IS NOT NULL
       AND expected_resolve_chapter < ?
       ORDER BY expected_resolve_chapter ASC`,
    ).all(currentChapter) as unknown as ReadonlyArray<StoredHook>;
  }

  getPendingHooks(currentChapter: number): ReadonlyArray<StoredHook> {
    return this.db.prepare(
      `SELECT
         hook_id AS hookId,
         start_chapter AS startChapter,
         type,
         status,
         last_advanced_chapter AS lastAdvancedChapter,
         expected_payoff AS expectedPayoff,
         payoff_timing AS payoffTiming,
         expected_resolve_chapter AS expectedResolveChapter,
         notes
       FROM hooks
       WHERE lower(status) NOT IN ('resolved', 'closed', '已回收', '已解决')
       AND expected_resolve_chapter IS NOT NULL
       AND expected_resolve_chapter >= ?
       ORDER BY expected_resolve_chapter ASC`,
    ).all(currentChapter) as unknown as ReadonlyArray<StoredHook>;
  }

  getHookById(hookId: string): StoredHook | null {
    const result = this.db.prepare(
      `SELECT
         hook_id AS hookId,
         start_chapter AS startChapter,
         type,
         status,
         last_advanced_chapter AS lastAdvancedChapter,
         expected_payoff AS expectedPayoff,
         payoff_timing AS payoffTiming,
         expected_resolve_chapter AS expectedResolveChapter,
         notes
       FROM hooks
       WHERE hook_id = ?`,
    ).get(hookId) as unknown as StoredHook | undefined;
    return result ?? null;
  }

  updateHookStatus(hookId: string, status: string): void {
    this.db.prepare("UPDATE hooks SET status = ? WHERE hook_id = ?").run(status, hookId);
  }

  deleteHook(hookId: string): void {
    this.db.prepare("DELETE FROM hooks WHERE hook_id = ?").run(hookId);
  }

  // ---------------------------------------------------------------------------
  // Chapter Snapshots
  // ---------------------------------------------------------------------------

  /** Create a new snapshot and auto-cleanup old ones. */
  createSnapshot(
    chapterId: string,
    content: string,
    triggerType: string,
    description?: string,
    parentId?: number,
  ): number {
    const createdAt = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO chapter_snapshots (chapter_id, content, created_at, trigger_type, description, parent_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const result = stmt.run(chapterId, content, createdAt, triggerType, description ?? null, parentId ?? null);
    const snapshotId = Number(result.lastInsertRowid);

    // Auto-cleanup: keep only the 50 most recent snapshots for this chapter
    this.deleteOldSnapshots(chapterId, 50);

    return snapshotId;
  }

  /** Get snapshots for a chapter, ordered by most recent first. */
  getSnapshots(chapterId: string, limit = 50): ReadonlyArray<ChapterSnapshot> {
    return this.db.prepare(
      `SELECT
         id,
         chapter_id AS chapterId,
         content,
         created_at AS createdAt,
         trigger_type AS triggerType,
         description,
         parent_id AS parentId
       FROM chapter_snapshots
       WHERE chapter_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(chapterId, limit) as unknown as ChapterSnapshot[];
  }

  /** Get a specific snapshot's content. */
  getSnapshotContent(snapshotId: number): ChapterSnapshot | null {
    const result = this.db.prepare(
      `SELECT
         id,
         chapter_id AS chapterId,
         content,
         created_at AS createdAt,
         trigger_type AS triggerType,
         description,
         parent_id AS parentId
       FROM chapter_snapshots
       WHERE id = ?`,
    ).get(snapshotId) as unknown as ChapterSnapshot | undefined;
    return result ?? null;
  }

  /** Get all snapshots for a chapter as a flat list with parentId, for tree construction. */
  getSnapshotTree(chapterId: string): ReadonlyArray<ChapterSnapshot> {
    return this.db.prepare(
      `SELECT
         id,
         chapter_id AS chapterId,
         content,
         created_at AS createdAt,
         trigger_type AS triggerType,
         description,
         parent_id AS parentId
       FROM chapter_snapshots
       WHERE chapter_id = ?
       ORDER BY created_at ASC`,
    ).all(chapterId) as unknown as ChapterSnapshot[];
  }

  /** Create a branch snapshot from an existing snapshot. */
  createBranch(
    sourceSnapshotId: number,
    content: string,
    description?: string,
  ): number {
    const source = this.getSnapshotContent(sourceSnapshotId);
    if (!source) {
      throw new Error(`Source snapshot ${sourceSnapshotId} not found`);
    }
    return this.createSnapshot(
      source.chapterId,
      content,
      "branch",
      description,
      sourceSnapshotId,
    );
  }

  /** Delete old snapshots, keeping only the most recent N. */
  deleteOldSnapshots(chapterId: string, keepCount = 50): void {
    this.db.prepare(
      `DELETE FROM chapter_snapshots
       WHERE chapter_id = ?
       AND id NOT IN (
         SELECT id FROM chapter_snapshots
         WHERE chapter_id = ?
         ORDER BY created_at DESC
         LIMIT ?
       )`,
    ).run(chapterId, chapterId, keepCount);
  }

  // ---------------------------------------------------------------------------
  // World Dimensions
  // ---------------------------------------------------------------------------

  /** Get all dimensions (built-in + custom). */
  getDimensions(): ReadonlyArray<WorldDimension> {
    return this.db.prepare(
      `SELECT id, key, label, description, built_in AS builtIn
       FROM world_dimensions ORDER BY built_in DESC, key`,
    ).all() as unknown as WorldDimension[];
  }

  /** Add a custom dimension. */
  addDimension(dim: Omit<WorldDimension, "id" | "builtIn">): void {
    this.db.prepare(
      `INSERT OR IGNORE INTO world_dimensions (key, label, description, built_in) VALUES (?, ?, ?, 0)`,
    ).run(dim.key, dim.label, dim.description);
  }

  /** Remove a custom dimension and its entries. */
  removeDimension(key: string): void {
    this.db.prepare("DELETE FROM world_entries WHERE dimension = ?").run(key);
    this.db.prepare("DELETE FROM world_dimensions WHERE key = ? AND built_in = 0").run(key);
  }

  // ---------------------------------------------------------------------------
  // World Entries (Lorebook)
  // ---------------------------------------------------------------------------

  private readonly WORLD_ENTRY_COLUMNS = `
    id, dimension, name, keywords, content, priority,
    enabled, source_chapter AS sourceChapter
  `;

  /** Add a world entry. */
  addWorldEntry(entry: Omit<WorldEntry, "id">): number {
    const result = this.db.prepare(
      `INSERT INTO world_entries (dimension, name, keywords, content, priority, enabled, source_chapter)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.dimension, entry.name, entry.keywords, entry.content,
      entry.priority, entry.enabled ? 1 : 0, entry.sourceChapter ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  /** Update a world entry. */
  updateWorldEntry(id: number, updates: Partial<Omit<WorldEntry, "id">>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    if (updates.dimension !== undefined) { fields.push("dimension = ?"); values.push(updates.dimension); }
    if (updates.name !== undefined) { fields.push("name = ?"); values.push(updates.name); }
    if (updates.keywords !== undefined) { fields.push("keywords = ?"); values.push(updates.keywords); }
    if (updates.content !== undefined) { fields.push("content = ?"); values.push(updates.content); }
    if (updates.priority !== undefined) { fields.push("priority = ?"); values.push(updates.priority); }
    if (updates.enabled !== undefined) { fields.push("enabled = ?"); values.push(updates.enabled ? 1 : 0); }
    if (updates.sourceChapter !== undefined) { fields.push("source_chapter = ?"); values.push(updates.sourceChapter); }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE world_entries SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  }

  /** Delete a world entry. */
  deleteWorldEntry(id: number): void {
    this.db.prepare("DELETE FROM world_entries WHERE id = ?").run(id);
  }

  /** Get all entries for a dimension. */
  getEntriesByDimension(dimension: string): ReadonlyArray<WorldEntry> {
    return this.db.prepare(
      `SELECT ${this.WORLD_ENTRY_COLUMNS}
       FROM world_entries WHERE dimension = ? AND enabled = 1
       ORDER BY priority DESC, name`,
    ).all(dimension) as unknown as WorldEntry[];
  }

  /** Get all enabled entries. */
  getAllEntries(): ReadonlyArray<WorldEntry> {
    return this.db.prepare(
      `SELECT ${this.WORLD_ENTRY_COLUMNS}
       FROM world_entries WHERE enabled = 1
       ORDER BY priority DESC, dimension, name`,
    ).all() as unknown as WorldEntry[];
  }

  /** Get all entries (including disabled) for management UI. */
  getAllEntriesUnfiltered(): ReadonlyArray<WorldEntry> {
    return this.db.prepare(
      `SELECT ${this.WORLD_ENTRY_COLUMNS}
       FROM world_entries
       ORDER BY dimension, priority DESC, name`,
    ).all() as unknown as WorldEntry[];
  }

  /**
   * Keyword-triggered retrieval: find entries whose keywords match any of the given terms.
   * This is the core Lorebook/World Info retrieval mechanism.
   */
  findEntriesByKeywords(terms: ReadonlyArray<string>): ReadonlyArray<WorldEntry> {
    if (terms.length === 0) return [];
    const lowerTerms = terms.map((t) => t.toLowerCase());
    // Fetch all enabled entries and filter in JS for flexible keyword matching
    const all = this.getAllEntries();
    return all.filter((entry) => {
      const entryKeywords = entry.keywords.toLowerCase().split(",").map((k) => k.trim());
      const entryName = entry.name.toLowerCase();
      return lowerTerms.some((term) =>
        entryName.includes(term) || entryKeywords.some((kw) => kw.length > 0 && term.includes(kw)),
      );
    });
  }

  /** Bulk import entries (replaces all entries in a dimension). */
  replaceEntriesInDimension(dimension: string, entries: ReadonlyArray<Omit<WorldEntry, "id">>): void {
    this.db.prepare("DELETE FROM world_entries WHERE dimension = ?").run(dimension);
    for (const entry of entries) {
      this.addWorldEntry({ ...entry, dimension });
    }
  }

  /** Get entry count per dimension. */
  getEntryCountByDimension(): ReadonlyArray<{ dimension: string; count: number }> {
    return this.db.prepare(
      `SELECT dimension, COUNT(*) as count FROM world_entries
       GROUP BY dimension ORDER BY dimension`,
    ).all() as unknown as ReadonlyArray<{ dimension: string; count: number }>;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
