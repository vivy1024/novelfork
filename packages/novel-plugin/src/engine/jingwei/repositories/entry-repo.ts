import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type {
  CreateStoryJingweiEntryInput,
  JingweiEntryLifecycle,
  JingweiEntryStatus,
  JingweiLayer,
  JingweiPriorityTier,
  JingweiVisibilityRule,
  StoryJingweiEntryRecord,
  UpdateStoryJingweiEntryInput,
} from "../types.js";
import { resolveCategory } from "../read-model/category-map.js";

/**
 * 条目乐观并发冲突（T-24）：调用方带着过期的 expectedVersion 写入时抛出。
 * 引擎层只表达领域事实（带 code），由路由层映射为 409，引擎不依赖 HTTP 层。
 */
export class EntryVersionConflictError extends Error {
  readonly code = "ENTRY_VERSION_CONFLICT";
  /** 后台写入被拒时的冲突详情（T-24）：由调用方补全后交给待处理队列。 */
  staleWrite?: {
    readonly reason: string;
    readonly info: {
      readonly kind: "version-mismatch" | "created-after-read";
      readonly entryId: string;
      readonly category: string;
      readonly title: string;
      readonly expectedVersion: number;
      readonly currentVersion: number;
      readonly changedBy: string;
      readonly changedFields: readonly string[];
    };
  };
  constructor(
    readonly entryId: string,
    readonly expectedVersion: number,
    readonly currentVersion: number,
  ) {
    super(`条目 ${entryId} 已在别处更新：提交时的版本是 ${expectedVersion}，当前版本是 ${currentVersion}。`);
    this.name = "EntryVersionConflictError";
  }
}
import type {
  ConflictStatus,
  EntryRevision,
  EntrySource,
  JingweiRevisionRecord,
  JingweiRevisionSnapshot,
} from "./collaborative-types.js";
import { removeEntryFts, syncEntryFts, type FtsSyncFields } from "../search/fts-index.js";
import {
  deduplicateSourceRefs,
  mergeAliases,
  mergeSourceRefs,
  resolveEntryKey,
  type EntrySourceRef,
} from "../entry-identity.js";

interface StoryJingweiEntryRow {
  id: string;
  book_id: string;
  section_id: string;
  title: string;
  content_md: string;
  summary_md?: string | null;
  category?: string | null;
  fields_json?: string | null;
  custom_fields_json: string;
  parent_id?: string | null;
  sort_order?: number | null;
  lifecycle?: string | null;
  status?: string | null;
  version?: number | null;
  tags_json: string;
  aliases_json: string;
  related_chapter_numbers_json: string;
  related_entry_ids_json: string;
  visibility_rule_json: string;
  participates_in_ai: number;
  token_budget: number | null;
  priority_tier?: JingweiPriorityTier;
  layer?: JingweiLayer;
  importance?: number;
  summary_l0?: string | null;
  entry_key?: string | null;
  source_refs_json?: string | null;
  source?: string;
  revision_history?: string;
  conflict_status?: string;
  conflict_detail?: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface JingweiRevisionRow {
  id: string;
  entry_id: string;
  book_id: string;
  content_md: string;
  category: string | null;
  layer: string | null;
  snapshot_json?: string | null;
  reason: string | null;
  changed_by: string;
  created_at: number;
}

const identityColumnCache = new WeakMap<object, boolean>();

function hasEntryIdentityColumns(storage: StorageDatabase): boolean {
  const cached = identityColumnCache.get(storage.sqlite);
  if (cached !== undefined) return cached;
  const rows = storage.sqlite.prepare(`PRAGMA table_info("story_jingwei_entry")`).all() as Array<{ name: string }>;
  const has = rows.some((row) => row.name === "entry_key") && rows.some((row) => row.name === "source_refs_json");
  identityColumnCache.set(storage.sqlite, has);
  return has;
}

function selectColumns(storage: StorageDatabase): string {
  const identity = hasEntryIdentityColumns(storage)
    ? `"entry_key", COALESCE("source_refs_json", '[]') AS "source_refs_json",`
    : `'' AS "entry_key", '[]' AS "source_refs_json",`;
  return `
  "id", "book_id", "section_id", "title", "content_md", "summary_md", "category", "fields_json",
  "custom_fields_json", "parent_id", "sort_order", "lifecycle", "status", "version", "tags_json", "aliases_json",
  "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json", "participates_in_ai", "token_budget",
  COALESCE("priority_tier", 'auto') AS "priority_tier", COALESCE("layer", 'dynamic') AS "layer",
  COALESCE("importance", 40) AS "importance", "summary_l0", ${identity}
  COALESCE("source", 'user') AS "source",
  COALESCE("revision_history", '[]') AS "revision_history", COALESCE("conflict_status", 'none') AS "conflict_status",
  "conflict_detail", "created_at", "updated_at", "deleted_at"
`;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function normalizeLifecycle(value: string | null | undefined): JingweiEntryLifecycle {
  return value === "archived" || value === "inactive" || value === "retired" ? value : "active";
}

function normalizeStatus(value: string | null | undefined): JingweiEntryStatus {
  return value === "draft" || value === "needs-review" ? value : "confirmed";
}

function normalizeLayer(value: string | null | undefined): JingweiLayer {
  return value === "canon" || value === "reference" ? value : "dynamic";
}

function toEntry(row: StoryJingweiEntryRow): StoryJingweiEntryRecord {
  const fields = parseJson<Record<string, unknown>>(row.fields_json, {});
  const customFields = parseJson<Record<string, unknown>>(row.custom_fields_json, {});
  return {
    id: row.id,
    bookId: row.book_id,
    sectionId: row.section_id,
    title: row.title,
    contentMd: row.content_md,
    summaryMd: row.summary_md ?? null,
    category: row.category?.trim() || "unclassified",
    fields,
    customFields,
    parentId: row.parent_id ?? null,
    sortOrder: row.sort_order ?? 0,
    lifecycle: normalizeLifecycle(row.lifecycle),
    status: normalizeStatus(row.status),
    version: row.version ?? 1,
    tags: parseJson<string[]>(row.tags_json, []),
    aliases: parseJson<string[]>(row.aliases_json, []),
    relatedChapterNumbers: parseJson<number[]>(row.related_chapter_numbers_json, []),
    relatedEntryIds: parseJson<string[]>(row.related_entry_ids_json, []),
    visibilityRule: parseJson<JingweiVisibilityRule>(row.visibility_rule_json, { type: "tracked" }),
    participatesInAi: Boolean(row.participates_in_ai),
    tokenBudget: row.token_budget,
    priorityTier: row.priority_tier ?? "auto",
    layer: normalizeLayer(row.layer),
    importance: typeof row.importance === "number" ? row.importance : 40,
    summaryL0: row.summary_l0 ?? null,
    entryKey: row.entry_key?.trim() || null,
    sourceRefs: parseJson<EntrySourceRef[]>(row.source_refs_json, []),
    source: (row.source ?? "user") as EntrySource,
    revisionHistory: parseJson<EntryRevision[]>(row.revision_history, []),
    conflictStatus: (row.conflict_status ?? "none") as ConflictStatus,
    conflictDetail: row.conflict_detail ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}

function snapshotEntry(entry: StoryJingweiEntryRecord): JingweiRevisionSnapshot {
  return {
    title: entry.title,
    contentMd: entry.contentMd,
    summaryMd: entry.summaryMd ?? null,
    category: entry.category,
    layer: entry.layer,
    status: entry.status,
    fields: entry.fields,
    tags: entry.tags,
    aliases: entry.aliases,
    entryKey: entry.entryKey ?? null,
    sourceRefs: [...(entry.sourceRefs ?? [])],
    relatedChapterNumbers: entry.relatedChapterNumbers,
    relatedEntryIds: entry.relatedEntryIds,
    visibilityRule: entry.visibilityRule,
    participatesInAi: entry.participatesInAi,
    tokenBudget: entry.tokenBudget,
    priorityTier: entry.priorityTier,
    importance: entry.importance,
    summaryL0: entry.summaryL0 ?? null,
    sectionId: entry.sectionId,
    parentId: entry.parentId,
    sortOrder: entry.sortOrder,
    lifecycle: entry.lifecycle,
  };
}

function toRevision(row: JingweiRevisionRow): JingweiRevisionRecord {
  return {
    id: row.id,
    entryId: row.entry_id,
    bookId: row.book_id,
    contentMd: row.content_md,
    category: row.category,
    layer: row.layer,
    snapshot: parseJson<JingweiRevisionSnapshot | null>(row.snapshot_json, null),
    reason: row.reason,
    changedBy: row.changed_by,
    createdAt: new Date(row.created_at),
  };
}

function readEntry(storage: StorageDatabase, bookId: string, id: string): StoryJingweiEntryRecord | null {
  const row = storage.sqlite.prepare(`
    SELECT ${selectColumns(storage)}
    FROM "story_jingwei_entry"
    WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
  `).get(bookId, id) as StoryJingweiEntryRow | undefined;
  return row ? toEntry(row) : null;
}

function insertRevision(
  storage: StorageDatabase,
  entry: StoryJingweiEntryRecord,
  input: { reason?: string | null; changedBy: string; createdAt: number },
): string {
  const revisionId = crypto.randomUUID();
  storage.sqlite.prepare(`
    INSERT INTO "jingwei_revision" (
      "id", "entry_id", "book_id", "content_md", "category", "layer", "snapshot_json", "reason", "changed_by", "created_at"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    revisionId,
    entry.id,
    entry.bookId,
    entry.contentMd,
    entry.category,
    entry.layer,
    JSON.stringify(snapshotEntry(entry)),
    input.reason ?? null,
    input.changedBy,
    input.createdAt,
  );
  return revisionId;
}

/**
 * 解析写入的 fields：
 * - `fields`：显式整体替换（编辑器提交完整字段集的场景，语义最强）
 * - `fieldsPatch` / `customFields`：增量合并 —— 只覆盖给定键，绝不清掉 fallback 里的其他键。
 *   伏笔看板拖拽等局部更新走这条路；整删替换会把 name/description/plantedChapter 等未传入字段全部抹掉。
 */
function resolveFields(
  input: { fields?: Record<string, unknown>; customFields?: Record<string, unknown>; fieldsPatch?: Record<string, unknown> },
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  if (input.fields) return input.fields;
  if (input.fieldsPatch) return { ...fallback, ...input.fieldsPatch };
  if (input.customFields) return { ...fallback, ...input.customFields };
  return fallback;
}

/** 把条目映射为 FTS 同步字段（写入侧与业务操作同一事务调用） */
function toFtsFields(entry: StoryJingweiEntryRecord): FtsSyncFields {
  return {
    entryId: entry.id,
    bookId: entry.bookId,
    title: entry.title,
    aliases: entry.aliases,
    tags: entry.tags,
    keywords: entry.visibilityRule.keywords ?? [],
    summaryMd: entry.summaryMd ?? null,
    contentMd: entry.contentMd,
    updatedAt: entry.updatedAt,
    status: entry.status,
  };
}

// ---------------------------------------------------------------------------
// 跨书引用守卫（T-12）
// ---------------------------------------------------------------------------

/** 三段式解释，与 handlers/diagnostic-explanation.ts 的 DiagnosticExplanation 同形（引擎层不反向依赖 handlers）。 */
export interface JingweiReferenceExplanation {
  readonly whatHappened: string;
  readonly whyItMatters: string;
  readonly suggestedAction: string;
}

export type JingweiReferenceErrorCode =
  | "JINGWEI_ENTRY_NOT_FOUND"
  | "JINGWEI_SECTION_NOT_IN_BOOK"
  | "JINGWEI_PARENT_NOT_IN_BOOK"
  | "JINGWEI_PARENT_CYCLE";

/**
 * 条目引用越界（T-12）：分区、父条目、关联/依赖/推进的目标条目必须属于同一本书，父子关系不能成环。
 * 引擎层只表达领域事实（code + explanation），路由层按 code 映射 HTTP 状态。
 * 「不存在」与「属于别的书」统一成同一个 code 与文案，不让调用方借此探测别的书里有没有某个 id。
 */
export class JingweiReferenceError extends Error {
  constructor(
    readonly code: JingweiReferenceErrorCode,
    readonly explanation: JingweiReferenceExplanation,
  ) {
    super(explanation.whatHappened);
    this.name = "JingweiReferenceError";
  }
}

export function entryNotInBookError(entryId: string): JingweiReferenceError {
  return new JingweiReferenceError("JINGWEI_ENTRY_NOT_FOUND", {
    whatHappened: `条目 ${entryId} 不在本书中（不存在、已删除，或属于另一本书）。`,
    whyItMatters: "关联、依赖与状态推进只能连接同一本书的条目；跨书连接会把两本书的设定串在一起，并泄露另一本书的条目。",
    suggestedAction: "刷新经纬面板，确认条目仍在本书后，从本书条目中重新选择。",
  });
}

export function sectionNotInBookError(sectionId: string): JingweiReferenceError {
  return new JingweiReferenceError("JINGWEI_SECTION_NOT_IN_BOOK", {
    whatHappened: `分区 ${sectionId} 不在本书中（不存在、已删除，或属于另一本书）。`,
    whyItMatters: "条目只能放进本书自己的分区；放进别的书的分区会让两本书的设定互相串门，并泄露另一本书的结构。",
    suggestedAction: "刷新经纬面板后从本书现有分区中重新选择，或改用 category 让系统按分类找到或新建本书分区。",
  });
}

function parentNotInBookError(parentId: string): JingweiReferenceError {
  return new JingweiReferenceError("JINGWEI_PARENT_NOT_IN_BOOK", {
    whatHappened: `父条目 ${parentId} 不在本书中（不存在、已删除，或属于另一本书）。`,
    whyItMatters: "层级树只能在同一本书内组织；挂到别的书的条目下会把两本书的设定串在一起，并泄露另一本书的条目。",
    suggestedAction: "刷新经纬面板后，从本书现有条目中重新选择父条目，或把它设为顶层条目。",
  });
}

function parentCycleError(entryId: string, parentId: string): JingweiReferenceError {
  return new JingweiReferenceError("JINGWEI_PARENT_CYCLE", {
    whatHappened: `不能把条目 ${entryId} 挂到 ${parentId} 下面：那是它自己，或是它的下级条目。`,
    whyItMatters: "父子关系成环后层级树没有根，树形展示与按层级注入上下文都会丢条目或陷入死循环。",
    suggestedAction: "先把那个下级条目移到别处，再移动本条目；或选择一个不在本条目之下的父条目。",
  });
}

/**
 * 分区只校验归属，不排除本书已软删的分区：叙述者写入按 key 取分区时不排除软删
 * （jingwei-write-handler），在这里收紧会改变同书内的既有行为；要守住的边界是“不跨书”。
 */
function assertSectionInBook(storage: StorageDatabase, bookId: string, sectionId: string): void {
  const row = storage.sqlite.prepare(`
    SELECT 1 AS "found" FROM "story_jingwei_section" WHERE "id" = ? AND "book_id" = ?
  `).get(sectionId, bookId);
  if (!row) throw sectionNotInBookError(sectionId);
}

/**
 * 父条目必须是本书的条目，且不能是自己或自己的后代。沿 parent_id 往上走，走到自己即成环；
 * visited 防止历史数据里已有的环让循环停不下来。新挂父条目要求父条目未删除；
 * 回退修订（requireLive=false）允许回到当时合法、后来被删的同书父条目。
 */
function assertParentAllowed(
  storage: StorageDatabase,
  bookId: string,
  entryId: string,
  parentId: string,
  options: { readonly requireLive: boolean },
): void {
  if (parentId === entryId) throw parentCycleError(entryId, parentId);
  const parentOf = storage.sqlite.prepare(`
    SELECT "parent_id", "deleted_at" FROM "story_jingwei_entry" WHERE "id" = ? AND "book_id" = ?
  `);
  const parent = parentOf.get(parentId, bookId) as { parent_id: string | null; deleted_at: number | null } | undefined;
  if (!parent || (options.requireLive && parent.deleted_at !== null)) throw parentNotInBookError(parentId);
  const visited = new Set<string>([parentId]);
  let cursor = parent.parent_id;
  while (cursor) {
    if (cursor === entryId) throw parentCycleError(entryId, parentId);
    if (visited.has(cursor)) break;
    visited.add(cursor);
    cursor = (parentOf.get(cursor, bookId) as { parent_id: string | null } | undefined)?.parent_id ?? null;
  }
}

/**
 * relatedEntryIds 只保留属于本书的 id（含本书已软删的，删除状态由读取侧处理）。
 * 选择过滤而不是整体拒绝：这是一组软关联，读取侧本就要容忍失效 id；批量导入、合并与叙述者写入时
 * 夹带一个失效 id 不该让整次写入失败。安全上要保证的是：别的书的 id 永远不会落库。
 * 代价是同一批里尚未创建的本书条目也会被滤掉，需要先建条目再补关联。
 */
function filterRelatedEntryIds(storage: StorageDatabase, bookId: string, ids: readonly string[] | null | undefined): string[] {
  const candidates = (ids ?? []).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (candidates.length === 0) return [];
  const unique = [...new Set(candidates)];
  const owned = new Set<string>();
  for (let offset = 0; offset < unique.length; offset += 500) {
    const chunk = unique.slice(offset, offset + 500);
    const rows = storage.sqlite.prepare(`
      SELECT "id" FROM "story_jingwei_entry" WHERE "book_id" = ? AND "id" IN (${chunk.map(() => "?").join(", ")})
    `).all(bookId, ...chunk) as Array<{ id: string }>;
    for (const row of rows) owned.add(row.id);
  }
  return candidates.filter((id) => owned.has(id));
}

export function createStoryJingweiEntryRepository(storage: StorageDatabase) {
  const repo = {
    async create(input: CreateStoryJingweiEntryInput): Promise<StoryJingweiEntryRecord> {
      // T-12：先校验引用归属，越界时一行都不写。
      assertSectionInBook(storage, input.bookId, input.sectionId);
      if (input.parentId) assertParentAllowed(storage, input.bookId, input.id, input.parentId, { requireLive: true });
      const relatedEntryIds = filterRelatedEntryIds(storage, input.bookId, input.relatedEntryIds);
      const fields = resolveFields(input, {});
      const sectionCategory = storage.sqlite.prepare(`
        SELECT "key", "builtin_kind" FROM "story_jingwei_section" WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(input.bookId, input.sectionId) as { key: string; builtin_kind: string | null } | undefined;
      const category: string | null =
        input.category && input.category.trim()
          ? input.category.trim()
          : (typeof fields.category === "string" && fields.category.trim()
              ? fields.category.trim()
              : (resolveCategory(sectionCategory?.builtin_kind ?? sectionCategory?.key ?? "unclassified") ?? null));
      const nextStatus = input.status ?? "confirmed";
      const nextParticipatesInAi = nextStatus === "needs-review" ? false : Boolean(input.participatesInAi);
      const entryKey = resolveEntryKey({
        entryKey: input.entryKey,
        category: category ?? "unclassified",
        title: input.title,
        fields,
      });
      const aliases = mergeAliases([], input.aliases ?? [], input.title);
      const sourceRefs = deduplicateSourceRefs(input.sourceRefs ?? []);
      const identityColumns = hasEntryIdentityColumns(storage);
      const insertColumns = [
        `"id"`, `"book_id"`, `"section_id"`, `"title"`, `"content_md"`, `"summary_md"`, `"category"`, `"fields_json"`,
        `"custom_fields_json"`, `"parent_id"`, `"sort_order"`, `"lifecycle"`, `"status"`, `"version"`, `"tags_json"`, `"aliases_json"`,
        `"related_chapter_numbers_json"`, `"related_entry_ids_json"`, `"visibility_rule_json"`, `"participates_in_ai"`, `"token_budget"`,
        `"priority_tier"`, `"layer"`, `"importance"`, `"summary_l0"`, `"source"`, `"revision_history"`, `"conflict_status"`,
        `"conflict_detail"`, `"created_at"`, `"updated_at"`, `"deleted_at"`,
      ];
      const insertValues: unknown[] = [
        input.id,
        input.bookId,
        input.sectionId,
        input.title,
        input.contentMd,
        input.summaryMd ?? null,
        category,
        serializeJson(fields),
        serializeJson(fields),
        input.parentId ?? null,
        input.sortOrder ?? 0,
        input.lifecycle ?? "active",
        nextStatus,
        input.version ?? 1,
        serializeJson(input.tags),
        serializeJson(aliases),
        serializeJson(input.relatedChapterNumbers),
        serializeJson(relatedEntryIds),
        serializeJson(input.visibilityRule),
        nextParticipatesInAi ? 1 : 0,
        input.tokenBudget ?? null,
        input.priorityTier ?? "auto",
        input.layer ?? "dynamic",
        typeof input.importance === "number" ? input.importance : 40,
        input.summaryL0 ?? null,
        input.source ?? "user",
        "[]",
        input.conflictStatus ?? "none",
        input.conflictDetail ?? null,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
        null,
      ];
      if (identityColumns) {
        insertColumns.splice(25, 0, `"entry_key"`, `"source_refs_json"`);
        insertValues.splice(25, 0, entryKey, serializeJson(sourceRefs));
      }
      storage.sqlite.prepare(`
        INSERT INTO "story_jingwei_entry" (${insertColumns.join(", ")})
        VALUES (${insertColumns.map(() => "?").join(", ")})
      `).run(...insertValues);
      const created = readEntry(storage, input.bookId, input.id);
      if (!created) throw new Error("Inserted story jingwei entry could not be read back.");
      syncEntryFts(storage, toFtsFields(created));
      return created;
    },

    async getById(bookId: string, id: string): Promise<StoryJingweiEntryRecord | null> {
      return readEntry(storage, bookId, id);
    },

    /** 批量按 ID 取行（检索候选场景用，避免 N 次单条查询） */
    async listByIds(bookId: string, ids: readonly string[]): Promise<Map<string, StoryJingweiEntryRecord>> {
      const result = new Map<string, StoryJingweiEntryRecord>();
      if (ids.length === 0) return result;
      const placeholders = ids.map(() => "?").join(", ");
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns(storage)}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ? AND "id" IN (${placeholders}) AND "deleted_at" IS NULL
      `).all(bookId, ...ids) as StoryJingweiEntryRow[];
      for (const row of rows) {
        const entry = toEntry(row);
        result.set(entry.id, entry);
      }
      return result;
    },

    async listByBook(bookId: string): Promise<StoryJingweiEntryRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns(storage)}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "sort_order" ASC, "updated_at" DESC, "title" ASC
      `).all(bookId) as StoryJingweiEntryRow[];
      return rows.map(toEntry);
    },

    async listBySection(bookId: string, sectionId: string): Promise<StoryJingweiEntryRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns(storage)}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ? AND "section_id" = ? AND "deleted_at" IS NULL
        ORDER BY "sort_order" ASC, "updated_at" DESC, "title" ASC
      `).all(bookId, sectionId) as StoryJingweiEntryRow[];
      return rows.map(toEntry);
    },

    async listForAi(
      bookId: string,
      sectionIds: readonly string[],
      options: { category?: string | null; limit?: number; offset?: number } = {},
    ): Promise<StoryJingweiEntryRecord[]> {
      if (sectionIds.length === 0) return [];
      const placeholders = sectionIds.map(() => "?").join(", ");
      const clauses = [
        `"book_id" = ?`,
        `"section_id" IN (${placeholders})`,
        `"deleted_at" IS NULL`,
        `"participates_in_ai" = 1`,
        `COALESCE("status", 'confirmed') = 'confirmed'`,
        `COALESCE("lifecycle", 'active') NOT IN ('archived', 'inactive', 'retired')`,
      ];
      const params: unknown[] = [bookId, ...sectionIds];
      if (options.category !== undefined && options.category !== null) {
        clauses.push(`COALESCE("category", 'unclassified') = ?`);
        params.push(options.category);
      }
      const orderClause = `ORDER BY "sort_order" ASC, "updated_at" DESC, "title" ASC`;
      let sql = `SELECT ${selectColumns(storage)}\nFROM "story_jingwei_entry"\nWHERE ${clauses.join("\n  AND ")}\n${orderClause}`;
      if (options.limit !== undefined || options.offset !== undefined) {
        const limit = options.limit ?? 1000;
        const offset = options.offset ?? 0;
        sql += `\nLIMIT ? OFFSET ?`;
        params.push(limit, offset);
      }
      const rows = storage.sqlite.prepare(sql).all(...params) as StoryJingweiEntryRow[];
      return rows.map(toEntry);
    },

    async listRevisions(bookId: string, entryId: string): Promise<JingweiRevisionRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT "id", "entry_id", "book_id", "content_md", "category", "layer", "snapshot_json", "reason", "changed_by", "created_at"
        FROM "jingwei_revision"
        WHERE "book_id" = ? AND "entry_id" = ?
        ORDER BY "created_at" DESC, "id" DESC
      `).all(bookId, entryId) as JingweiRevisionRow[];
      return rows.map(toRevision);
    },

    async update(bookId: string, id: string, updates: UpdateStoryJingweiEntryInput): Promise<StoryJingweiEntryRecord | null> {
      const current = readEntry(storage, bookId, id);
      if (!current) return null;

      // T-12：只拦截本次新写入的引用（与现值相同则放过），历史数据不阻断无关编辑。
      if (updates.sectionId !== undefined && updates.sectionId !== current.sectionId) {
        assertSectionInBook(storage, bookId, updates.sectionId);
      }
      if (updates.parentId !== undefined && updates.parentId !== null && updates.parentId !== current.parentId) {
        assertParentAllowed(storage, bookId, id, updates.parentId, { requireLive: true });
      }
      const nextRelatedEntryIds = updates.relatedEntryIds !== undefined
        ? filterRelatedEntryIds(storage, bookId, updates.relatedEntryIds)
        : current.relatedEntryIds;

      const source: EntrySource = updates.source ?? "user";
      const changedFields = Object.keys(updates).filter((key) => !["source", "updatedAt", "revisionReason", "changedBy"].includes(key));
      const hasChanges = changedFields.length > 0;
      const fields = resolveFields(updates, current.fields);
      const nextStatus = updates.status ?? current.status;
      const nextParticipatesInAi = nextStatus === "needs-review"
        ? false
        : (updates.participatesInAi ?? current.participatesInAi);
      const nextTitle = updates.title ?? current.title;
      const nextCategory = updates.category ?? current.category;
      const nextEntryKey = resolveEntryKey(
        { entryKey: updates.entryKey, category: nextCategory, title: nextTitle, fields },
        { entryKey: current.entryKey },
      );
      const nextAliases = updates.aliases !== undefined
        ? mergeAliases([], updates.aliases, nextTitle)
        : current.aliases;
      const nextSourceRefs = updates.sourceRefs !== undefined
        ? mergeSourceRefs(current.sourceRefs ?? [], updates.sourceRefs)
        : (current.sourceRefs ?? []);
      const updatedAt = updates.updatedAt ?? (hasChanges ? new Date() : current.updatedAt);

      let conflictStatus: ConflictStatus = updates.conflictStatus ?? current.conflictStatus ?? "none";
      let conflictDetail: string | null = updates.conflictDetail ?? current.conflictDetail ?? null;
      if ((source === "agent-write" || source === "auto-settle") && current.source === "user") {
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        if (current.updatedAt.getTime() > fiveMinutesAgo) {
          conflictStatus = "pending";
          conflictDetail = `agent(${source}) 修改了 ${changedFields.join("/")}，但用户在 5 分钟内编辑过此条目`;
        }
      }

      const run = storage.sqlite.transaction(() => {
        if (hasChanges) {
          insertRevision(storage, current, {
            reason: updates.revisionReason ?? source,
            changedBy: updates.changedBy ?? source,
            createdAt: updatedAt.getTime(),
          });
        }
        const identityColumns = hasEntryIdentityColumns(storage);
        const setClauses = [
          `"section_id" = ?`, `"title" = ?`, `"content_md" = ?`, `"summary_md" = ?`, `"category" = ?`, `"fields_json" = ?`,
          `"custom_fields_json" = ?`, `"parent_id" = ?`, `"sort_order" = ?`, `"lifecycle" = ?`, `"status" = ?`, `"tags_json" = ?`,
          `"aliases_json" = ?`, `"related_chapter_numbers_json" = ?`, `"related_entry_ids_json" = ?`, `"visibility_rule_json" = ?`,
          `"participates_in_ai" = ?`, `"token_budget" = ?`, `"priority_tier" = ?`, `"layer" = ?`, `"importance" = ?`, `"summary_l0" = ?`,
        ];
        const values: unknown[] = [
          updates.sectionId ?? current.sectionId,
          nextTitle,
          updates.contentMd ?? current.contentMd,
          updates.summaryMd ?? current.summaryMd ?? null,
          nextCategory,
          serializeJson(fields),
          serializeJson(fields),
          updates.parentId !== undefined ? updates.parentId : current.parentId,
          updates.sortOrder ?? current.sortOrder,
          updates.lifecycle ?? current.lifecycle,
          nextStatus,
          serializeJson(updates.tags ?? current.tags),
          serializeJson(nextAliases),
          serializeJson(updates.relatedChapterNumbers ?? current.relatedChapterNumbers),
          serializeJson(nextRelatedEntryIds),
          serializeJson(updates.visibilityRule ?? current.visibilityRule),
          nextParticipatesInAi ? 1 : 0,
          updates.tokenBudget !== undefined ? updates.tokenBudget : current.tokenBudget,
          updates.priorityTier ?? current.priorityTier,
          updates.layer ?? current.layer,
          updates.importance ?? current.importance,
          updates.summaryL0 !== undefined ? updates.summaryL0 : current.summaryL0 ?? null,
        ];
        if (identityColumns) {
          setClauses.push(`"entry_key" = ?`, `"source_refs_json" = ?`);
          values.push(nextEntryKey, serializeJson(nextSourceRefs));
        }
        setClauses.push(`"source" = ?`, `"conflict_status" = ?`, `"conflict_detail" = ?`, `"version" = COALESCE("version", 1) + ?`, `"updated_at" = ?`);
        values.push(source, conflictStatus, conflictDetail, hasChanges ? 1 : 0, updatedAt.getTime(), bookId, id);
        // 乐观并发（T-24）：带 expectedVersion 时把版本条件写进 WHERE，库中版本不符则一行都不写。
        // 用 COALESCE 与 readEntry 的 row.version ?? 1 语义保持一致，避免旧库 NULL 版本被误判为冲突。
        const versionGuard = updates.expectedVersion !== undefined;
        if (versionGuard) values.push(updates.expectedVersion);
        const result = storage.sqlite.prepare(`
          UPDATE "story_jingwei_entry"
          SET ${setClauses.join(", ")}
          WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL${versionGuard ? ` AND COALESCE("version", 1) = ?` : ""}
        `).run(...values);
        if (versionGuard && result.changes === 0) {
          // 在事务内抛出，整个写入（含上面已插入的修订记录）一并回滚，不留半截状态。
          throw new EntryVersionConflictError(id, updates.expectedVersion!, current.version);
        }
        const updated = readEntry(storage, bookId, id);
        if (updated) syncEntryFts(storage, toFtsFields(updated));
      });
      run();
      return readEntry(storage, bookId, id);
    },

    async revertToRevision(
      bookId: string,
      entryId: string,
      revisionId: string,
      options: { changedBy?: string; reason?: string; updatedAt?: Date } = {},
    ): Promise<StoryJingweiEntryRecord | null> {
      const current = readEntry(storage, bookId, entryId);
      if (!current) return null;
      const row = storage.sqlite.prepare(`
        SELECT "id", "entry_id", "book_id", "content_md", "category", "layer", "snapshot_json", "reason", "changed_by", "created_at"
        FROM "jingwei_revision"
        WHERE "id" = ? AND "entry_id" = ? AND "book_id" = ?
      `).get(revisionId, entryId, bookId) as JingweiRevisionRow | undefined;
      if (!row) return null;

      const target = toRevision(row);
      const snapshot: JingweiRevisionSnapshot = target.snapshot ?? {
        ...snapshotEntry(current),
        contentMd: target.contentMd,
        category: target.category ?? current.category,
        layer: normalizeLayer(target.layer),
      };
      const updatedAt = options.updatedAt ?? new Date();
      const changedBy = options.changedBy ?? "user";
      // T-12：回退同样不得引入跨书分区/父条目或成环（旧父条目可能已被挂到本条目之下）。
      if (snapshot.sectionId !== current.sectionId) assertSectionInBook(storage, bookId, snapshot.sectionId);
      if (snapshot.parentId && snapshot.parentId !== current.parentId) {
        assertParentAllowed(storage, bookId, entryId, snapshot.parentId, { requireLive: false });
      }
      const revertRelatedEntryIds = filterRelatedEntryIds(storage, bookId, snapshot.relatedEntryIds);

      const run = storage.sqlite.transaction(() => {
        insertRevision(storage, current, {
          reason: options.reason ?? "revert",
          changedBy,
          createdAt: updatedAt.getTime(),
        });
        const revertEntryKey = snapshot.entryKey ?? current.entryKey ?? resolveEntryKey({
          category: snapshot.category,
          title: snapshot.title,
          fields: snapshot.fields,
        });
        const revertSourceRefs = snapshot.sourceRefs ?? current.sourceRefs ?? [];
        const identityColumns = hasEntryIdentityColumns(storage);
        const setClauses = [
          `"section_id" = ?`, `"title" = ?`, `"content_md" = ?`, `"summary_md" = ?`, `"category" = ?`, `"fields_json" = ?`,
          `"custom_fields_json" = ?`, `"parent_id" = ?`, `"sort_order" = ?`, `"lifecycle" = ?`, `"status" = ?`, `"tags_json" = ?`,
          `"aliases_json" = ?`, `"related_chapter_numbers_json" = ?`, `"related_entry_ids_json" = ?`, `"visibility_rule_json" = ?`,
          `"participates_in_ai" = ?`, `"token_budget" = ?`, `"priority_tier" = ?`, `"layer" = ?`, `"importance" = ?`, `"summary_l0" = ?`,
        ];
        const values: unknown[] = [
          snapshot.sectionId,
          snapshot.title,
          snapshot.contentMd,
          snapshot.summaryMd,
          snapshot.category,
          serializeJson(snapshot.fields),
          serializeJson(snapshot.fields),
          snapshot.parentId,
          snapshot.sortOrder,
          snapshot.lifecycle,
          snapshot.status,
          serializeJson(snapshot.tags),
          serializeJson(snapshot.aliases),
          serializeJson(snapshot.relatedChapterNumbers),
          serializeJson(revertRelatedEntryIds),
          serializeJson(snapshot.visibilityRule),
          snapshot.participatesInAi && snapshot.status !== "needs-review" ? 1 : 0,
          snapshot.tokenBudget,
          snapshot.priorityTier,
          snapshot.layer,
          snapshot.importance,
          snapshot.summaryL0,
        ];
        if (identityColumns) {
          setClauses.push(`"entry_key" = ?`, `"source_refs_json" = ?`);
          values.push(revertEntryKey, serializeJson(revertSourceRefs));
        }
        setClauses.push(`"source" = ?`, `"conflict_status" = 'none'`, `"conflict_detail" = NULL`, `"version" = COALESCE("version", 1) + 1`, `"updated_at" = ?`);
        values.push(changedBy, updatedAt.getTime(), bookId, entryId);
        storage.sqlite.prepare(`
          UPDATE "story_jingwei_entry"
          SET ${setClauses.join(", ")}
          WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
        `).run(...values);
        const reverted = readEntry(storage, bookId, entryId);
        if (reverted) syncEntryFts(storage, toFtsFields(reverted));
      });
      run();
      return readEntry(storage, bookId, entryId);
    },

    async retire(
      bookId: string,
      id: string,
      options: { reason: string; changedBy?: string; retiredAt?: Date },
    ): Promise<boolean> {
      const current = readEntry(storage, bookId, id);
      if (!current) return false;
      const retiredAt = options.retiredAt ?? new Date();
      const run = storage.sqlite.transaction(() => {
        insertRevision(storage, current, {
          reason: options.reason,
          changedBy: options.changedBy ?? "agent-retire",
          createdAt: retiredAt.getTime(),
        });
        storage.sqlite.prepare(`
          UPDATE "story_jingwei_entry"
          SET "participates_in_ai" = 0, "status" = 'needs-review', "lifecycle" = 'archived',
            "deleted_at" = ?, "conflict_status" = 'none', "conflict_detail" = ?,
            "version" = COALESCE("version", 1) + 1, "updated_at" = ?
          WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
        `).run(retiredAt.getTime(), options.reason, retiredAt.getTime(), bookId, id);
        removeEntryFts(storage, id);
      });
      run();
      return true;
    },

    async softDelete(bookId: string, id: string, deletedAt = new Date()): Promise<boolean> {
      const current = readEntry(storage, bookId, id);
      if (!current) return false;
      const run = storage.sqlite.transaction(() => {
        insertRevision(storage, current, { reason: "soft-delete", changedBy: "user", createdAt: deletedAt.getTime() });
        storage.sqlite.prepare(`
          UPDATE "story_jingwei_entry"
          SET "deleted_at" = ?, "lifecycle" = 'archived', "version" = COALESCE("version", 1) + 1, "updated_at" = ?
          WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
          `).run(deletedAt.getTime(), deletedAt.getTime(), bookId, id);
        removeEntryFts(storage, id);
      });
      run();
      return true;
    },
  };

  return repo;
}
