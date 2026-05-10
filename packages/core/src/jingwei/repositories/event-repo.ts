import type { StorageDatabase } from "../../storage/db.js";
import type { BibleEventRecord, CreateBibleEventInput, UpdateBibleEventInput } from "../types.js";

interface BibleEventRow {
  id: string;
  book_id: string;
  name: string;
  event_type: string;
  chapter_start: number | null;
  chapter_end: number | null;
  summary: string;
  related_character_ids_json: string;
  visibility_rule_json: string;
  foreshadow_state: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toEvent(row: BibleEventRow): BibleEventRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    name: row.name,
    eventType: row.event_type,
    chapterStart: row.chapter_start,
    chapterEnd: row.chapter_end,
    summary: row.summary,
    relatedCharacterIdsJson: row.related_character_ids_json,
    visibilityRuleJson: row.visibility_rule_json,
    foreshadowState: row.foreshadow_state,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}

const selectColumns = `
  "id", "book_id", "name", "event_type", "chapter_start", "chapter_end", "summary",
  "related_character_ids_json", "visibility_rule_json", "foreshadow_state", "created_at", "updated_at", "deleted_at"
`;

export function createBibleEventRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateBibleEventInput): Promise<BibleEventRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_event" (
          "id", "book_id", "name", "event_type", "chapter_start", "chapter_end", "summary",
          "related_character_ids_json", "visibility_rule_json", "foreshadow_state", "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        input.id,
        input.bookId,
        input.name,
        input.eventType,
        input.chapterStart,
        input.chapterEnd,
        input.summary,
        input.relatedCharacterIdsJson,
        input.visibilityRuleJson,
        input.foreshadowState,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted Bible event could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<BibleEventRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_event"
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(bookId, id) as BibleEventRow | undefined;
      return row ? toEvent(row) : null;
    },

    async listByBook(bookId: string): Promise<BibleEventRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_event"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "name" ASC
      `).all(bookId) as BibleEventRow[];
      return rows.map(toEvent);
    },

    async update(bookId: string, id: string, updates: UpdateBibleEventInput): Promise<BibleEventRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "bible_event"
        SET "name" = ?, "event_type" = ?, "chapter_start" = ?, "chapter_end" = ?, "summary" = ?,
          "related_character_ids_json" = ?, "visibility_rule_json" = ?, "foreshadow_state" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(
        updates.name ?? current.name,
        updates.eventType ?? current.eventType,
        updates.chapterStart ?? current.chapterStart,
        updates.chapterEnd ?? current.chapterEnd,
        updates.summary ?? current.summary,
        updates.relatedCharacterIdsJson ?? current.relatedCharacterIdsJson,
        updates.visibilityRuleJson ?? current.visibilityRuleJson,
        updates.foreshadowState ?? current.foreshadowState,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },

    async softDelete(bookId: string, id: string, deletedAt = new Date()): Promise<boolean> {
      const result = storage.sqlite.prepare(`
        UPDATE "bible_event"
        SET "deleted_at" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(deletedAt.getTime(), deletedAt.getTime(), bookId, id);
      return result.changes > 0;
    },
  };
}
