/**
 * 经纬结构性账本存储 —— 卷纲 / 伏笔 / 章摘要的唯一权威源。
 *
 * 这三类对象此前散落在 story/*.json 与 md 文件里，导致同一事实有多个权威源。
 * 现在统一以经纬条目（story_jingwei_entry）为权威：
 *   - 结构化数据存 fields_json
 *   - contentMd 作作者可读正文
 *   - story/*.md 降级为导出物，不再被读取
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getJingweiCategoryAliases, sqlInPlaceholders } from "../engine/jingwei/category-compat.js";
import { ensureNarrativeMemorySchema } from "../engine/narrative-memory/storage.js";
import {
  generateEntryKey,
  resolveEntryKey,
  mergeSourceRefs,
  mergeAliases,
  type EntrySourceRef,
} from "../engine/jingwei/entry-identity.js";
import { EntryVersionConflictError } from "../engine/jingwei/repositories/entry-repo.js";
import type { LedgerStaleWrite, LedgerStaleWriteInfo } from "../engine/jingwei/ledger-conflict-store.js";

export type { LedgerStaleWrite, LedgerStaleWriteInfo } from "../engine/jingwei/ledger-conflict-store.js";


export function ensureJingweiLedgerSchema(storage: StorageDatabase): void {
  ensureNarrativeMemorySchema(storage);
  storage.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS story_jingwei_section (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      "order" INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      show_in_sidebar INTEGER DEFAULT 1,
      participates_in_ai INTEGER DEFAULT 1,
      default_visibility TEXT DEFAULT 'tracked',
      fields_json TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(book_id, key)
    );

    CREATE TABLE IF NOT EXISTS story_jingwei_entry (
      id TEXT PRIMARY KEY,
      section_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      layer TEXT NOT NULL DEFAULT 'canon',
      status TEXT NOT NULL DEFAULT 'confirmed',
      content_md TEXT,
      fields_json TEXT,
      sort_order INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS jingwei_revision (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      content_md TEXT NOT NULL,
      category TEXT,
      layer TEXT,
      reason TEXT,
      changed_by TEXT DEFAULT 'user',
      created_at INTEGER NOT NULL,
      snapshot_json TEXT
    );
  `);
}

/**
 * 账本可写入的经纬分类。
 * outline / foreshadowing / chapter-summaries 是结构性账本；
 * 其余为拆书产物落地的静态设定分类（一律 needs-review，待作者确认）。
 */
export type LedgerKind =
  | "outline"
  | "foreshadowing"
  | "chapter-summaries"
  | "characters"
  | "relationships"
  | "world-model"
  | "locations"
  | "factions"
  | "power-system"
  | "props"
  | "rules";

/** 账本条目：结构化字段 + 可读正文。 */
export interface LedgerEntry {
  readonly id: string;
  readonly title: string;
  readonly contentMd: string;
  readonly fields: Record<string, unknown>;
  readonly layer: string;
  readonly status: string;
  readonly updatedAt: number;
  /** 乐观并发版本（T-24）：读到的这一版必须原样回传 expectedVersion。 */
  readonly version: number;
}

/**
 * 冲突出口抛出的错误：与 entry-repo 的乐观并发错误同一个类型（都是 ENTRY_VERSION_CONFLICT），
 * 额外带上机器这一版想写的内容，供路由层转成待处理项。
 */
export function createStaleWriteConflictError(pending: LedgerStaleWrite): EntryVersionConflictError {
  const error = new EntryVersionConflictError(
    pending.info.entryId,
    pending.info.expectedVersion,
    pending.info.currentVersion,
  );
  error.staleWrite = pending;
  return error;
}

export interface LedgerWriteInput {
  readonly bookId: string;
  readonly category: LedgerKind;
  readonly title: string;
  readonly contentMd: string;
  readonly fields: Record<string, unknown>;
  /** 默认 confirmed；机器抽取的草案传 needs-review。 */
  readonly status?: "draft" | "confirmed" | "needs-review";
  readonly reason?: string;
  readonly changedBy?: string;
  readonly now?: () => Date;
  readonly entryKey?: string;
  readonly aliases?: readonly string[];
  readonly sourceRefs?: readonly EntrySourceRef[];
  /** 乐观并发：调用方读到的条目版本。库中版本不符则视为作者已改过，不覆盖作者已保存的内容。 */
  readonly expectedVersion?: number;
  /**
   * 后台自动写入的冲突出口（T-24）：库里版本与机器读到的不符时调用，
   * 机器这一版不落库，由调用方把它放进待处理队列交给作者核对。传了它就不会抛冲突。
   */
  readonly onStaleWrite?: (conflict: LedgerStaleWrite) => void;}

const CATEGORY_NAMES: Record<LedgerKind, string> = {
  outline: "卷纲/大纲",
  foreshadowing: "伏笔",
  "chapter-summaries": "章节摘要",
  characters: "角色",
  relationships: "关系",
  "world-model": "世界模型",
  locations: "地点",
  factions: "势力",
  "power-system": "能力体系",
  props: "道具资源",
  rules: "写作规则",
};

function parseFields(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function tableHasColumn(storage: StorageDatabase, table: string, column: string): boolean {
  const rows = storage.sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureSection(storage: StorageDatabase, bookId: string, category: LedgerKind): string {
  ensureJingweiLedgerSchema(storage);
  const existing = storage.sqlite.prepare(
    `SELECT id FROM story_jingwei_section WHERE book_id = ? AND key = ?`,
  ).get(bookId, category) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const now = Date.now();
  storage.sqlite.prepare(`
    INSERT INTO story_jingwei_section (
      id, book_id, key, name, description, "order", enabled, show_in_sidebar,
      participates_in_ai, default_visibility, fields_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', 0, 1, 1, 1, 'tracked', '[]', ?, ?)
  `).run(id, bookId, category, CATEGORY_NAMES[category] ?? category, now, now);
  return id;
}

/** 账本条目所在分区是否参与 AI（section 默认 enabled=0 时仍允许条目被工具读取）。 */
function ledgerSummary(title: string, fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).slice(0, 4).join(", ");
  return keys ? `${title}（${keys}）` : title;
}

function recordLedgerRevision(
  storage: StorageDatabase,
  bookId: string,
  entryId: string,
  input: { reason: string; changedBy: string; createdAt: number },
): void {
  const row = storage.sqlite.prepare(`
    SELECT * FROM story_jingwei_entry
    WHERE id = ? AND book_id = ? AND deleted_at IS NULL
  `).get(entryId, bookId) as Record<string, unknown> | undefined;
  if (!row) return;

  const parseArray = (value: unknown): unknown[] => {
    if (typeof value !== "string") return [];
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const snapshot = {
    title: String(row.title ?? ""),
    contentMd: String(row.content_md ?? ""),
    summaryMd: typeof row.summary_md === "string" ? row.summary_md : null,
    category: String(row.category ?? "unclassified"),
    layer: row.layer === "canon" || row.layer === "reference" ? row.layer : "dynamic",
    status: row.status === "draft" || row.status === "needs-review" ? row.status : "confirmed",
    fields: parseFields(row.fields_json),
    tags: parseArray(row.tags_json),
    aliases: parseArray(row.aliases_json),
    relatedChapterNumbers: parseArray(row.related_chapter_numbers_json),
    relatedEntryIds: parseArray(row.related_entry_ids_json),
    visibilityRule: parseFields(row.visibility_rule_json),
    participatesInAi: row.participates_in_ai !== 0,
    tokenBudget: typeof row.token_budget === "number" ? row.token_budget : null,
    priorityTier: typeof row.priority_tier === "string" ? row.priority_tier : "auto",
    importance: typeof row.importance === "number" ? row.importance : 40,
    summaryL0: typeof row.summary_l0 === "string" ? row.summary_l0 : null,
    sectionId: String(row.section_id ?? ""),
    parentId: typeof row.parent_id === "string" ? row.parent_id : null,
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 0,
    lifecycle: typeof row.lifecycle === "string" ? row.lifecycle : "active",
  };
  if (tableHasColumn(storage, "jingwei_revision", "snapshot_json")) {
    storage.sqlite.prepare(`
      INSERT INTO jingwei_revision (
        id, entry_id, book_id, content_md, category, layer, snapshot_json, reason, changed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      entryId,
      bookId,
      snapshot.contentMd,
      snapshot.category,
      snapshot.layer,
      JSON.stringify(snapshot),
      input.reason,
      input.changedBy,
      input.createdAt,
    );
    return;
  }
  storage.sqlite.prepare(`
    INSERT INTO jingwei_revision (
      id, entry_id, book_id, content_md, category, layer, reason, changed_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    entryId,
    bookId,
    snapshot.contentMd,
    snapshot.category,
    snapshot.layer,
    input.reason,
    input.changedBy,
    input.createdAt,
  );
}

/** 读取某分类下的全部账本条目（未删除），支持 category 兼容别名。 */
export function listLedgerEntries(
  storage: StorageDatabase,
  bookId: string,
  category: LedgerKind,
): LedgerEntry[] {
  try {
    const categories = getJingweiCategoryAliases(category);
    const placeholders = sqlInPlaceholders(categories);
    // 旧库可能还没有 version 列（迁移未覆盖的老书）：缺列时按 1 读，不能让整个查询崩掉。
    const versionExpr = tableHasColumn(storage, "story_jingwei_entry", "version") ? `COALESCE(version, 1)` : `1`;
    const rows = storage.sqlite.prepare(`
      SELECT id, title, content_md AS contentMd, fields_json AS fieldsJson,
             layer, status, updated_at AS updatedAt, ${versionExpr} AS version
      FROM story_jingwei_entry
      WHERE book_id = ? AND category IN (${placeholders}) AND deleted_at IS NULL
      ORDER BY sort_order ASC, updated_at DESC
    `).all(bookId, ...categories) as Array<{
      id: string;
      title: string;
      contentMd: string | null;
      fieldsJson: string | null;
      layer: string | null;
      status: string | null;
      updatedAt: number | null;
      version: number | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      contentMd: row.contentMd ?? "",
      fields: parseFields(row.fieldsJson),
      layer: row.layer ?? "dynamic",
      status: row.status ?? "confirmed",
      updatedAt: row.updatedAt ?? 0,
      version: row.version ?? 1,
    }));
  } catch {
    return [];
  }
}

/** 读取账本单条（按 title 精确匹配，账本条目 title 具唯一语义）。 */
export function findLedgerEntryByTitle(
  storage: StorageDatabase,
  bookId: string,
  category: LedgerKind,
  title: string,
  entryKey?: string | null,
): LedgerEntry | null {
  const targetKey = resolveEntryKey({ entryKey, category, title });
  const entries = listLedgerEntries(storage, bookId, category);
  if (tableHasColumn(storage, "story_jingwei_entry", "entry_key")) {
     const byKey = storage.sqlite.prepare(`
       SELECT id FROM story_jingwei_entry
       WHERE book_id = ? AND entry_key = ? AND deleted_at IS NULL
       LIMIT 1
     `).get(bookId, targetKey) as { id: string } | undefined;
     if (byKey) {
       return entries.find((e) => e.id === byKey.id) ?? null;
     }
  }
  return entries.find((entry) => entry.title === title) ?? null;
}

/** 按 ID 查找账本条目。 */
export function findLedgerEntryById(
  storage: StorageDatabase,
  bookId: string,
  entryId: string,
): LedgerEntry | null {
  try {
    const versionExpr = tableHasColumn(storage, "story_jingwei_entry", "version") ? `COALESCE(version, 1)` : `1`;
    const row = storage.sqlite.prepare(`
      SELECT id, title, content_md AS contentMd, fields_json AS fieldsJson,
             layer, status, updated_at AS updatedAt, ${versionExpr} AS version
      FROM story_jingwei_entry
      WHERE book_id = ? AND id = ? AND deleted_at IS NULL
    `).get(bookId, entryId) as {
      id: string;
      title: string;
      contentMd: string | null;
      fieldsJson: string | null;
      layer: string | null;
      status: string | null;
      updatedAt: number | null;
      version: number | null;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      contentMd: row.contentMd ?? "",
      fields: parseFields(row.fieldsJson),
      layer: row.layer ?? "dynamic",
      status: row.status ?? "confirmed",
      updatedAt: row.updatedAt ?? 0,
      version: row.version ?? 1,
    };
  } catch {
    return null;
  }
}

/**
 * machine 写入的版本是否已经过期（T-24「VS Code 式」处理）。
 *
 * expectedVersion 是机器读到的版本：
 * - 没传（undefined）表示调用方不做版本校对，一律放行；
 * - 0 表示机器读到的是「还没有这条」，现在却已有条目 → 两边同时在建同一条（created-after-read）；
 * - 想写的版本与库中版本不符 → 作者在机器读完之后改过，机器这一版作废（version-mismatch）。
 */
function staleWriteFor(
  input: LedgerWriteInput,
  currentVersion: number | undefined,
  entryId: string,
  title: string,
): LedgerStaleWriteInfo | undefined {
  const expectedVersion = input.expectedVersion;
  if (expectedVersion === undefined) return undefined;
  // 库里还没有条目、机器也不是在「新建」语义下（expectedVersion 非 0）：不是并发冲突，放行。
  if (currentVersion === undefined && expectedVersion !== 0) return undefined;
  if (currentVersion !== undefined && currentVersion === expectedVersion) return undefined;
  return {
    kind: expectedVersion === 0 ? "created-after-read" : "version-mismatch",
    entryId,
    category: input.category,
    title,
    expectedVersion,
    currentVersion: currentVersion ?? 1,
    changedBy: input.changedBy ?? "auto-settle",
    changedFields: ["title", "contentMd", ...Object.keys(input.fields ?? {})],
  };
}

/**
 * upsert 账本条目：同 title 更新，否则插入。
 * 账本分类固定 layer=dynamic（分类表态已声明 allowCanon=false）。
 */
export function upsertLedgerEntry(
  storage: StorageDatabase,
  input: LedgerWriteInput,
): LedgerEntry {
  const { bookId, category, title } = input;
  const sectionId = ensureSection(storage, bookId, category);
  const now = (input.now?.() ?? new Date()).getTime();
  const status = input.status ?? "confirmed";
  const fieldsJson = JSON.stringify(input.fields ?? {});
  const existing = findLedgerEntryByTitle(storage, bookId, category, title, input.entryKey);

  const targetKey = resolveEntryKey({ entryKey: input.entryKey, category, title, fields: input.fields });

  if (existing) {
    // 后台自动写入（T-24）：机器带着读到的版本进来，库里的版本已经变了就说明作者改过，
    // 机器这一版不落库（VS Code 式：不覆盖作者内容），把冲突交给待处理队列由作者核对。
    const stale = staleWriteFor(input, existing.version, existing.id, existing.title);
    if (stale) {
      const pending: LedgerStaleWrite = { reason: input.reason ?? "ledger-upsert", info: stale };
      // 没有待处理队列的调用方（作者显式操作之外的路径）不能静默丢写入，照旧抛冲突。
      if (!input.onStaleWrite) throw createStaleWriteConflictError(pending);
      input.onStaleWrite(pending);
      return { ...existing, version: stale.currentVersion };
    }
    let finalKey = targetKey;
    let nextAliases = input.aliases ? mergeAliases([], input.aliases) : [];
    let nextSourceRefs = input.sourceRefs ? mergeSourceRefs([], input.sourceRefs) : [];
    if (tableHasColumn(storage, "story_jingwei_entry", "entry_key")) {
      const row = storage.sqlite.prepare(`SELECT entry_key, aliases_json, source_refs_json FROM story_jingwei_entry WHERE id = ? AND book_id = ?`).get(existing.id, bookId) as any;
      finalKey = resolveEntryKey({ entryKey: input.entryKey, category, title, fields: input.fields }, { entryKey: row?.entry_key });
      const parseArray = (val: any) => {
          if (typeof val !== "string") return [];
          try {
              const p = JSON.parse(val);
              return Array.isArray(p) ? p : [];
          } catch {
              return [];
          }
      };
      nextAliases = input.aliases ? mergeAliases(parseArray(row?.aliases_json), input.aliases) : parseArray(row?.aliases_json);
      nextSourceRefs = input.sourceRefs ? mergeSourceRefs(parseArray(row?.source_refs_json), input.sourceRefs) : parseArray(row?.source_refs_json);
    }

    const updateClauses = [
      "title = ?",
      "content_md = ?",
      "fields_json = ?",
      "custom_fields_json = ?",
      "status = ?",
      "layer = 'dynamic'",
      "updated_at = ?",
    ];
    const updateValues: unknown[] = [input.title ?? existing.title, input.contentMd, fieldsJson, fieldsJson, status, now];
    if (tableHasColumn(storage, "story_jingwei_entry", "source")) {
      updateClauses.push("source = ?");
      updateValues.push(input.changedBy ?? "auto-settle");
    }
    if (tableHasColumn(storage, "story_jingwei_entry", "version")) {
      updateClauses.push("version = COALESCE(version, 1) + 1");
    }
    if (tableHasColumn(storage, "story_jingwei_entry", "entry_key")) {
      updateClauses.push("entry_key = ?");
      updateValues.push(finalKey);
    }
    if (tableHasColumn(storage, "story_jingwei_entry", "aliases_json")) {
      updateClauses.push("aliases_json = ?");
      updateValues.push(JSON.stringify(nextAliases));
    }
    if (tableHasColumn(storage, "story_jingwei_entry", "source_refs_json")) {
      updateClauses.push("source_refs_json = ?");
      updateValues.push(JSON.stringify(nextSourceRefs));
    }
    const run = storage.sqlite.transaction(() => {
      if (input.expectedVersion !== undefined) {
        const current = storage.sqlite.prepare<{ version: number | null }>(
          `SELECT COALESCE(version, 1) AS version FROM story_jingwei_entry WHERE id = ? AND book_id = ?`,
        ).get(existing.id, bookId);
        const currentVersion = current?.version ?? 1;
        if (currentVersion !== input.expectedVersion) {
          throw new EntryVersionConflictError(existing.id, input.expectedVersion, currentVersion);
        }
      }
      recordLedgerRevision(storage, bookId, existing.id, {
        reason: input.reason ?? "ledger-upsert",
        changedBy: input.changedBy ?? "auto-settle",
        createdAt: now,
      });
      storage.sqlite.prepare(`
        UPDATE story_jingwei_entry
        SET ${updateClauses.join(", ")}
        WHERE id = ? AND book_id = ?
      `).run(...updateValues, existing.id, bookId);
    });
    run();
    return { ...existing, title: input.title ?? existing.title, contentMd: input.contentMd, fields: input.fields, status, updatedAt: now, version: existing.version + 1 };
  }

  // 机器读到「还没有这条」时才新建：作者已经在库里建了同名条目说明两边都在动同一条，
  // 机器不再插一条也不覆盖，把冲突交给待处理队列。
  const createdAfterRead = staleWriteFor(input, undefined, "", title);
  if (createdAfterRead) {
    const current = findLedgerEntryByTitle(storage, bookId, category, title, input.entryKey);
    if (current) {
      const info = { ...createdAfterRead, entryId: current.id, title: current.title, currentVersion: current.version };
      const pending: LedgerStaleWrite = { reason: input.reason ?? "ledger-upsert", info };
      if (!input.onStaleWrite) throw createStaleWriteConflictError(pending);
      input.onStaleWrite(pending);
      return current;
    }
  }

  const id = crypto.randomUUID();
  const finalKey = resolveEntryKey({ entryKey: input.entryKey, category, title, fields: input.fields });
  const nextAliases = input.aliases ? mergeAliases([], input.aliases) : [];
  const nextSourceRefs = input.sourceRefs ? mergeSourceRefs([], input.sourceRefs) : [];

  const insertColumns = [
    "id", "book_id", "section_id", "category", "title", "content_md", "summary_md",
    "tags_json", "aliases_json", "custom_fields_json", "fields_json",
    "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json",
    "participates_in_ai", "token_budget", "layer", "priority_tier", "importance",
    "status", "lifecycle", "sort_order", "created_at", "updated_at", "deleted_at",
  ];
  const insertValues: unknown[] = [
    id,
    bookId,
    sectionId,
    category,
    title,
    input.contentMd,
    ledgerSummary(title, input.fields ?? {}),
    "[]",
    JSON.stringify(nextAliases),
    fieldsJson,
    fieldsJson,
    "[]",
    "[]",
    '{"type":"tracked"}',
    status === "needs-review" ? 0 : 1,
    null,
    "dynamic",
    "auto",
    40,
    status,
    "active",
    0,
    now,
    now,
    null,
  ];
  if (tableHasColumn(storage, "story_jingwei_entry", "source")) {
    insertColumns.push("source");
    insertValues.push("auto-settle");
  }
  if (tableHasColumn(storage, "story_jingwei_entry", "version")) {
    insertColumns.push("version");
    insertValues.push(1);
  }
  if (tableHasColumn(storage, "story_jingwei_entry", "entry_key")) {
    insertColumns.push("entry_key");
    insertValues.push(finalKey);
  }
  if (tableHasColumn(storage, "story_jingwei_entry", "source_refs_json")) {
    insertColumns.push("source_refs_json");
    insertValues.push(JSON.stringify(nextSourceRefs));
  }
  storage.sqlite.prepare(`
    INSERT INTO story_jingwei_entry (${insertColumns.map((column) => `"${column}"`).join(", ")})
    VALUES (${insertColumns.map(() => "?").join(", ")})
  `).run(...insertValues);

  return {
    id,
    title,
    contentMd: input.contentMd,
    fields: input.fields,
    layer: "dynamic",
    status,
    updatedAt: now,
    version: 1,
  };
}

/** 软删除账本条目。 */
export function softDeleteLedgerEntry(
  storage: StorageDatabase,
  bookId: string,
  entryId: string,
  now = Date.now(),
): boolean {
  let changes = 0;
  const updateClauses = ["deleted_at = ?", "lifecycle = 'archived'", "updated_at = ?"];
  const updateValues: unknown[] = [now, now];
  if (tableHasColumn(storage, "story_jingwei_entry", "source")) updateClauses.push("source = 'auto-settle'");
  if (tableHasColumn(storage, "story_jingwei_entry", "version")) updateClauses.push("version = COALESCE(version, 1) + 1");
  const run = storage.sqlite.transaction(() => {
    recordLedgerRevision(storage, bookId, entryId, {
      reason: "ledger-soft-delete",
      changedBy: "auto-settle",
      createdAt: now,
    });
    const result = storage.sqlite.prepare(`
      UPDATE story_jingwei_entry
      SET ${updateClauses.join(", ")}
      WHERE id = ? AND book_id = ? AND deleted_at IS NULL
    `).run(...updateValues, entryId, bookId);
    changes = result.changes;
  });
  run();
  return changes > 0;
}

/**
 * 将经纬中的伏笔条目导出为作者可读的 pending_hooks.md（单向派生视图）。
 * 导出失败不影响权威 DB。
 */
export async function exportPendingHooksMarkdown(
  storage: StorageDatabase,
  bookId: string,
  bookRoot: string,
): Promise<void> {
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const entries = listLedgerEntries(storage, bookId, "foreshadowing");
    const lines = ["# 伏笔追踪", ""];
    for (const entry of entries) {
      const isDone = entry.fields.status === "paid_off" || entry.fields.status === "resolved";
      const plantedChapter = typeof entry.fields.plantedChapter === "number" ? entry.fields.plantedChapter : null;
      const payoffChapter = typeof entry.fields.payoffChapter === "number" ? entry.fields.payoffChapter : null;
      let suffix = "";
      if (isDone) {
        suffix = payoffChapter ? `（兑现于第${payoffChapter}章）` : "（已兑现）";
      } else if (plantedChapter) {
        suffix = `（埋设于第${plantedChapter}章）`;
      }
      lines.push(`- [${isDone ? "x" : " "}] ${entry.title}${suffix}`);
    }
    const hooksPath = join(bookRoot, "story", "pending_hooks.md");
    await mkdir(dirname(hooksPath), { recursive: true });
    await writeFile(hooksPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
  } catch {
    // 派生视图导出失败不得破坏权威 DB 流程
  }
}
