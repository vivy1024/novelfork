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
import type {
  ConflictStatus,
  EntryRevision,
  EntrySource,
  JingweiRevisionRecord,
  JingweiRevisionSnapshot,
} from "./collaborative-types.js";

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

const selectColumns = `
  "id", "book_id", "section_id", "title", "content_md", "summary_md", "category", "fields_json",
  "custom_fields_json", "parent_id", "sort_order", "lifecycle", "status", "version", "tags_json", "aliases_json",
  "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json", "participates_in_ai", "token_budget",
  COALESCE("priority_tier", 'auto') AS "priority_tier", COALESCE("layer", 'dynamic') AS "layer",
  COALESCE("importance", 40) AS "importance", "summary_l0", COALESCE("source", 'user') AS "source",
  COALESCE("revision_history", '[]') AS "revision_history", COALESCE("conflict_status", 'none') AS "conflict_status",
  "conflict_detail", "created_at", "updated_at", "deleted_at"
`;

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
    SELECT ${selectColumns}
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

function resolveFields(input: { fields?: Record<string, unknown>; customFields?: Record<string, unknown> }, fallback: Record<string, unknown>): Record<string, unknown> {
  return input.fields ?? input.customFields ?? fallback;
}

export function createStoryJingweiEntryRepository(storage: StorageDatabase) {
  const repo = {
    async create(input: CreateStoryJingweiEntryInput): Promise<StoryJingweiEntryRecord> {
      const fields = resolveFields(input, {});
      const sectionCategory = storage.sqlite.prepare(`
        SELECT "key", "builtin_kind" FROM "story_jingwei_section" WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(input.bookId, input.sectionId) as { key: string; builtin_kind: string | null } | undefined;
      const category = input.category
        ?? (typeof fields.category === "string" && fields.category.trim() ? fields.category.trim() : undefined)
        ?? resolveCategory(sectionCategory?.builtin_kind ?? sectionCategory?.key ?? "unclassified");
      storage.sqlite.prepare(`
        INSERT INTO "story_jingwei_entry" (
          "id", "book_id", "section_id", "title", "content_md", "summary_md", "category", "fields_json",
          "custom_fields_json", "parent_id", "sort_order", "lifecycle", "status", "version", "tags_json", "aliases_json",
          "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json", "participates_in_ai", "token_budget",
          "priority_tier", "layer", "importance", "summary_l0", "source", "revision_history", "conflict_status",
          "conflict_detail", "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, NULL)
      `).run(
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
        input.status ?? "confirmed",
        input.version ?? 1,
        serializeJson(input.tags),
        serializeJson(input.aliases),
        serializeJson(input.relatedChapterNumbers),
        serializeJson(input.relatedEntryIds),
        serializeJson(input.visibilityRule),
        input.participatesInAi ? 1 : 0,
        input.tokenBudget,
        input.priorityTier ?? "auto",
        input.layer ?? "dynamic",
        typeof input.importance === "number" ? input.importance : 40,
        input.summaryL0 ?? null,
        input.source ?? "user",
        input.conflictStatus ?? "none",
        input.conflictDetail ?? null,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = readEntry(storage, input.bookId, input.id);
      if (!created) throw new Error("Inserted story jingwei entry could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<StoryJingweiEntryRecord | null> {
      return readEntry(storage, bookId, id);
    },

    async listByBook(bookId: string): Promise<StoryJingweiEntryRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "sort_order" ASC, "updated_at" DESC, "title" ASC
      `).all(bookId) as StoryJingweiEntryRow[];
      return rows.map(toEntry);
    },

    async listBySection(bookId: string, sectionId: string): Promise<StoryJingweiEntryRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ? AND "section_id" = ? AND "deleted_at" IS NULL
        ORDER BY "sort_order" ASC, "updated_at" DESC, "title" ASC
      `).all(bookId, sectionId) as StoryJingweiEntryRow[];
      return rows.map(toEntry);
    },

    async listForAi(bookId: string, sectionIds: readonly string[]): Promise<StoryJingweiEntryRecord[]> {
      if (sectionIds.length === 0) return [];
      const placeholders = sectionIds.map(() => "?").join(", ");
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ?
          AND "section_id" IN (${placeholders})
          AND "deleted_at" IS NULL
          AND "participates_in_ai" = 1
          AND COALESCE("status", 'confirmed') = 'confirmed'
          AND COALESCE("lifecycle", 'active') NOT IN ('archived', 'inactive', 'retired')
        ORDER BY "sort_order" ASC, "updated_at" DESC, "title" ASC
      `).all(bookId, ...sectionIds) as StoryJingweiEntryRow[];
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

      const source: EntrySource = updates.source ?? "user";
      const changedFields = Object.keys(updates).filter((key) => !["source", "updatedAt", "revisionReason", "changedBy"].includes(key));
      const hasChanges = changedFields.length > 0;
      const fields = resolveFields(updates, current.fields);
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
        storage.sqlite.prepare(`
          UPDATE "story_jingwei_entry"
          SET "section_id" = ?, "title" = ?, "content_md" = ?, "summary_md" = ?, "category" = ?, "fields_json" = ?,
            "custom_fields_json" = ?, "parent_id" = ?, "sort_order" = ?, "lifecycle" = ?, "status" = ?, "tags_json" = ?,
            "aliases_json" = ?, "related_chapter_numbers_json" = ?, "related_entry_ids_json" = ?, "visibility_rule_json" = ?,
            "participates_in_ai" = ?, "token_budget" = ?, "priority_tier" = ?, "layer" = ?, "importance" = ?, "summary_l0" = ?,
            "source" = ?, "conflict_status" = ?, "conflict_detail" = ?, "version" = COALESCE("version", 1) + ?, "updated_at" = ?
          WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
        `).run(
          updates.sectionId ?? current.sectionId,
          updates.title ?? current.title,
          updates.contentMd ?? current.contentMd,
          updates.summaryMd ?? current.summaryMd ?? null,
          updates.category ?? current.category,
          serializeJson(fields),
          serializeJson(fields),
          updates.parentId !== undefined ? updates.parentId : current.parentId,
          updates.sortOrder ?? current.sortOrder,
          updates.lifecycle ?? current.lifecycle,
          updates.status ?? current.status,
          serializeJson(updates.tags ?? current.tags),
          serializeJson(updates.aliases ?? current.aliases),
          serializeJson(updates.relatedChapterNumbers ?? current.relatedChapterNumbers),
          serializeJson(updates.relatedEntryIds ?? current.relatedEntryIds),
          serializeJson(updates.visibilityRule ?? current.visibilityRule),
          (updates.participatesInAi ?? current.participatesInAi) ? 1 : 0,
          updates.tokenBudget !== undefined ? updates.tokenBudget : current.tokenBudget,
          updates.priorityTier ?? current.priorityTier,
          updates.layer ?? current.layer,
          updates.importance ?? current.importance,
          updates.summaryL0 !== undefined ? updates.summaryL0 : current.summaryL0 ?? null,
          source,
          conflictStatus,
          conflictDetail,
          hasChanges ? 1 : 0,
          updatedAt.getTime(),
          bookId,
          id,
        );
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

      const run = storage.sqlite.transaction(() => {
        insertRevision(storage, current, {
          reason: options.reason ?? "revert",
          changedBy,
          createdAt: updatedAt.getTime(),
        });
        storage.sqlite.prepare(`
          UPDATE "story_jingwei_entry"
          SET "section_id" = ?, "title" = ?, "content_md" = ?, "summary_md" = ?, "category" = ?, "fields_json" = ?,
            "custom_fields_json" = ?, "parent_id" = ?, "sort_order" = ?, "lifecycle" = ?, "status" = ?, "tags_json" = ?,
            "aliases_json" = ?, "related_chapter_numbers_json" = ?, "related_entry_ids_json" = ?, "visibility_rule_json" = ?,
            "participates_in_ai" = ?, "token_budget" = ?, "priority_tier" = ?, "layer" = ?, "importance" = ?, "summary_l0" = ?,
            "source" = ?, "conflict_status" = 'none', "conflict_detail" = NULL,
            "version" = COALESCE("version", 1) + 1, "updated_at" = ?
          WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
        `).run(
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
          serializeJson(snapshot.relatedEntryIds),
          serializeJson(snapshot.visibilityRule),
          snapshot.participatesInAi ? 1 : 0,
          snapshot.tokenBudget,
          snapshot.priorityTier,
          snapshot.layer,
          snapshot.importance,
          snapshot.summaryL0,
          changedBy,
          updatedAt.getTime(),
          bookId,
          entryId,
        );
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
      });
      run();
      return true;
    },
  };

  return repo;
}
