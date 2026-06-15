import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import type {
  CreateStoryJingweiEntryInput,
  JingweiVisibilityRule,
  StoryJingweiEntryRecord,
  UpdateStoryJingweiEntryInput,
} from "../types.js";
import type { EntrySource, EntryRevision, ConflictStatus } from "./collaborative-types.js";

interface StoryJingweiEntryRow {
  id: string;
  book_id: string;
  section_id: string;
  title: string;
  content_md: string;
  summary_md?: string | null;
  tags_json: string;
  aliases_json: string;
  custom_fields_json: string;
  related_chapter_numbers_json: string;
  related_entry_ids_json: string;
  visibility_rule_json: string;
  participates_in_ai: number;
  token_budget: number | null;
  priority_tier?: "core" | "relevant" | "reference" | "auto";
  layer?: "canon" | "dynamic" | "reference";
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

const selectColumns = `
  "id", "book_id", "section_id", "title", "content_md", "summary_md", "tags_json", "aliases_json",
  "custom_fields_json", "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json",
  "participates_in_ai", "token_budget", COALESCE("priority_tier", 'auto') AS "priority_tier", COALESCE("layer", 'dynamic') AS "layer", COALESCE("importance", 40) AS "importance", "summary_l0", COALESCE("source", 'user') AS "source", COALESCE("revision_history", '[]') AS "revision_history", COALESCE("conflict_status", 'none') AS "conflict_status", "conflict_detail", "created_at", "updated_at", "deleted_at"
`;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function toEntry(row: StoryJingweiEntryRow): StoryJingweiEntryRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    sectionId: row.section_id,
    title: row.title,
    contentMd: row.content_md,
    summaryMd: row.summary_md ?? null,
    tags: parseJson<string[]>(row.tags_json, []),
    aliases: parseJson<string[]>(row.aliases_json, []),
    customFields: parseJson<Record<string, unknown>>(row.custom_fields_json, {}),
    relatedChapterNumbers: parseJson<number[]>(row.related_chapter_numbers_json, []),
    relatedEntryIds: parseJson<string[]>(row.related_entry_ids_json, []),
    visibilityRule: parseJson<JingweiVisibilityRule>(row.visibility_rule_json, { type: "tracked" }),
    participatesInAi: Boolean(row.participates_in_ai),
    tokenBudget: row.token_budget,
    priorityTier: row.priority_tier ?? "auto",
    layer: (row.layer as "canon" | "dynamic" | "reference") ?? "dynamic",
    importance: typeof row.importance === "number" ? row.importance : 40,
    summaryL0: row.summary_l0 ?? null,
    source: (row.source ?? "user") as EntrySource,
    revisionHistory: parseJson<EntryRevision[]>(row.revision_history ?? "[]", []),
    conflictStatus: (row.conflict_status ?? "none") as ConflictStatus,
    conflictDetail: row.conflict_detail ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}

export function createStoryJingweiEntryRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateStoryJingweiEntryInput): Promise<StoryJingweiEntryRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "story_jingwei_entry" (
          "id", "book_id", "section_id", "title", "content_md", "summary_md", "tags_json", "aliases_json",
          "custom_fields_json", "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json",
          "participates_in_ai", "token_budget", "priority_tier", "importance", "summary_l0", "source", "revision_history", "conflict_status", "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        input.id,
        input.bookId,
        input.sectionId,
        input.title,
        input.contentMd,
        input.summaryMd ?? null,
        serializeJson(input.tags),
        serializeJson(input.aliases),
        serializeJson(input.customFields),
        serializeJson(input.relatedChapterNumbers),
        serializeJson(input.relatedEntryIds),
        serializeJson(input.visibilityRule),
        input.participatesInAi ? 1 : 0,
        input.tokenBudget,
        input.priorityTier ?? "auto",
        typeof input.importance === "number" ? input.importance : 40,
        input.summaryL0 ?? null,
        (input as any).source ?? "user",
        JSON.stringify((input as any).revisionHistory ?? []),
        (input as any).conflictStatus ?? "none",
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted story jingwei entry could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<StoryJingweiEntryRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(bookId, id) as StoryJingweiEntryRow | undefined;
      return row ? toEntry(row) : null;
    },

    async listByBook(bookId: string): Promise<StoryJingweiEntryRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "title" ASC
      `).all(bookId) as StoryJingweiEntryRow[];
      return rows.map(toEntry);
    },

    async listBySection(bookId: string, sectionId: string): Promise<StoryJingweiEntryRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ? AND "section_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "title" ASC
      `).all(bookId, sectionId) as StoryJingweiEntryRow[];
      return rows.map(toEntry);
    },

    async listForAi(bookId: string, sectionIds: readonly string[]): Promise<StoryJingweiEntryRecord[]> {
      if (sectionIds.length === 0) return [];
      const placeholders = sectionIds.map(() => "?").join(", ");
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "story_jingwei_entry"
        WHERE "book_id" = ? AND "section_id" IN (${placeholders}) AND "deleted_at" IS NULL AND "participates_in_ai" = 1
        ORDER BY "updated_at" DESC, "title" ASC
      `).all(bookId, ...sectionIds) as StoryJingweiEntryRow[];
      return rows.map(toEntry);
    },

    async update(bookId: string, id: string, updates: UpdateStoryJingweiEntryInput): Promise<StoryJingweiEntryRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;

      // 协同维护：来源 + 修订历史 + 冲突检测
      const source: string = (updates as any).source ?? "user";
      const now = new Date().toISOString();
      const changedFields = Object.keys(updates).filter(k => k !== "source" && k !== "updatedAt");
      const newRevision = { timestamp: now, source, changedFields };
      const currentHistory = (current as any).revisionHistory ?? [];
      const newRevisionHistory = [...currentHistory.slice(-19), newRevision]; // 最多保留 20 条

      // 冲突检测：agent 写入时如果最近一次修改来自 user 且在 5 分钟内
      let conflictStatus: string = (current as any).conflictStatus ?? "none";
      let conflictDetail: string | null = (current as any).conflictDetail ?? null;
      if ((source === "agent-write" || source === "auto-settle") && (current as any).source === "user") {
        const lastUserEdit = new Date((current as any).updatedAt ?? current.updatedAt).getTime();
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        if (lastUserEdit > fiveMinutesAgo) {
          conflictStatus = "pending";
          conflictDetail = `agent(${source}) 修改了 ${changedFields.join("/")}，但用户在 5 分钟内编辑过此条目`;
        }
      }

      storage.sqlite.prepare(`
        UPDATE "story_jingwei_entry"
        SET "section_id" = ?, "title" = ?, "content_md" = ?, "summary_md" = ?, "tags_json" = ?, "aliases_json" = ?,
          "custom_fields_json" = ?, "related_chapter_numbers_json" = ?, "related_entry_ids_json" = ?,
          "visibility_rule_json" = ?, "participates_in_ai" = ?, "token_budget" = ?, "priority_tier" = ?, "importance" = ?, "summary_l0" = ?,
          "source" = ?, "revision_history" = ?, "conflict_status" = ?, "conflict_detail" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(
        updates.sectionId ?? current.sectionId,
        updates.title ?? current.title,
        updates.contentMd ?? current.contentMd,
        updates.summaryMd ?? current.summaryMd ?? null,
        serializeJson(updates.tags ?? current.tags),
        serializeJson(updates.aliases ?? current.aliases),
        serializeJson(updates.customFields ?? current.customFields),
        serializeJson(updates.relatedChapterNumbers ?? current.relatedChapterNumbers),
        serializeJson(updates.relatedEntryIds ?? current.relatedEntryIds),
        serializeJson(updates.visibilityRule ?? current.visibilityRule),
        (updates.participatesInAi ?? current.participatesInAi) ? 1 : 0,
        updates.tokenBudget ?? current.tokenBudget,
        updates.priorityTier ?? current.priorityTier,
        updates.importance ?? current.importance ?? 40,
        updates.summaryL0 ?? current.summaryL0 ?? null,
        source,
        JSON.stringify(newRevisionHistory),
        conflictStatus,
        conflictDetail,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },

    async softDelete(bookId: string, id: string, deletedAt = new Date()): Promise<boolean> {
      const result = storage.sqlite.prepare(`
        UPDATE "story_jingwei_entry"
        SET "deleted_at" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(deletedAt.getTime(), deletedAt.getTime(), bookId, id);
      return result.changes > 0;
    },
  };
}
