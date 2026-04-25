import type { StorageDatabase } from "../../storage/db.js";
import type {
  CreateStoryJingweiEntryInput,
  JingweiVisibilityRule,
  StoryJingweiEntryRecord,
  UpdateStoryJingweiEntryInput,
} from "../types.js";

interface StoryJingweiEntryRow {
  id: string;
  book_id: string;
  section_id: string;
  title: string;
  content_md: string;
  tags_json: string;
  aliases_json: string;
  custom_fields_json: string;
  related_chapter_numbers_json: string;
  related_entry_ids_json: string;
  visibility_rule_json: string;
  participates_in_ai: number;
  token_budget: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const selectColumns = `
  "id", "book_id", "section_id", "title", "content_md", "tags_json", "aliases_json",
  "custom_fields_json", "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json",
  "participates_in_ai", "token_budget", "created_at", "updated_at", "deleted_at"
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
    tags: parseJson<string[]>(row.tags_json, []),
    aliases: parseJson<string[]>(row.aliases_json, []),
    customFields: parseJson<Record<string, unknown>>(row.custom_fields_json, {}),
    relatedChapterNumbers: parseJson<number[]>(row.related_chapter_numbers_json, []),
    relatedEntryIds: parseJson<string[]>(row.related_entry_ids_json, []),
    visibilityRule: parseJson<JingweiVisibilityRule>(row.visibility_rule_json, { type: "tracked" }),
    participatesInAi: Boolean(row.participates_in_ai),
    tokenBudget: row.token_budget,
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
          "id", "book_id", "section_id", "title", "content_md", "tags_json", "aliases_json",
          "custom_fields_json", "related_chapter_numbers_json", "related_entry_ids_json", "visibility_rule_json",
          "participates_in_ai", "token_budget", "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        input.id,
        input.bookId,
        input.sectionId,
        input.title,
        input.contentMd,
        serializeJson(input.tags),
        serializeJson(input.aliases),
        serializeJson(input.customFields),
        serializeJson(input.relatedChapterNumbers),
        serializeJson(input.relatedEntryIds),
        serializeJson(input.visibilityRule),
        input.participatesInAi ? 1 : 0,
        input.tokenBudget,
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

      storage.sqlite.prepare(`
        UPDATE "story_jingwei_entry"
        SET "section_id" = ?, "title" = ?, "content_md" = ?, "tags_json" = ?, "aliases_json" = ?,
          "custom_fields_json" = ?, "related_chapter_numbers_json" = ?, "related_entry_ids_json" = ?,
          "visibility_rule_json" = ?, "participates_in_ai" = ?, "token_budget" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(
        updates.sectionId ?? current.sectionId,
        updates.title ?? current.title,
        updates.contentMd ?? current.contentMd,
        serializeJson(updates.tags ?? current.tags),
        serializeJson(updates.aliases ?? current.aliases),
        serializeJson(updates.customFields ?? current.customFields),
        serializeJson(updates.relatedChapterNumbers ?? current.relatedChapterNumbers),
        serializeJson(updates.relatedEntryIds ?? current.relatedEntryIds),
        serializeJson(updates.visibilityRule ?? current.visibilityRule),
        (updates.participatesInAi ?? current.participatesInAi) ? 1 : 0,
        updates.tokenBudget ?? current.tokenBudget,
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
