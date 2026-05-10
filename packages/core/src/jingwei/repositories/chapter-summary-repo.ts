import type { StorageDatabase } from "../../storage/db.js";
import type { BibleChapterSummaryRecord, CreateBibleChapterSummaryInput, UpdateBibleChapterSummaryInput } from "../types.js";

interface BibleChapterSummaryRow {
  id: string;
  book_id: string;
  chapter_number: number;
  title: string;
  summary: string;
  word_count: number;
  key_events_json: string;
  appearing_character_ids_json: string;
  pov: string;
  metadata_json: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toChapterSummary(row: BibleChapterSummaryRow): BibleChapterSummaryRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterNumber: row.chapter_number,
    title: row.title,
    summary: row.summary,
    wordCount: row.word_count,
    keyEventsJson: row.key_events_json,
    appearingCharacterIdsJson: row.appearing_character_ids_json,
    pov: row.pov,
    metadataJson: row.metadata_json,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}

const selectColumns = `
  "id", "book_id", "chapter_number", "title", "summary", "word_count", "key_events_json",
  "appearing_character_ids_json", "pov", "metadata_json", "created_at", "updated_at", "deleted_at"
`;

export function createBibleChapterSummaryRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateBibleChapterSummaryInput): Promise<BibleChapterSummaryRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_chapter_summary" (
          "id", "book_id", "chapter_number", "title", "summary", "word_count", "key_events_json",
          "appearing_character_ids_json", "pov", "metadata_json", "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        input.id,
        input.bookId,
        input.chapterNumber,
        input.title,
        input.summary,
        input.wordCount,
        input.keyEventsJson,
        input.appearingCharacterIdsJson,
        input.pov,
        input.metadataJson,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted Bible chapter summary could not be read back.");
      return created;
    },

    async upsert(input: CreateBibleChapterSummaryInput): Promise<BibleChapterSummaryRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_chapter_summary" (
          "id", "book_id", "chapter_number", "title", "summary", "word_count", "key_events_json",
          "appearing_character_ids_json", "pov", "metadata_json", "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT("book_id", "chapter_number") DO UPDATE SET
          "id" = excluded."id",
          "title" = excluded."title",
          "summary" = excluded."summary",
          "word_count" = excluded."word_count",
          "key_events_json" = excluded."key_events_json",
          "appearing_character_ids_json" = excluded."appearing_character_ids_json",
          "pov" = excluded."pov",
          "metadata_json" = excluded."metadata_json",
          "updated_at" = excluded."updated_at",
          "deleted_at" = NULL
      `).run(
        input.id,
        input.bookId,
        input.chapterNumber,
        input.title,
        input.summary,
        input.wordCount,
        input.keyEventsJson,
        input.appearingCharacterIdsJson,
        input.pov,
        input.metadataJson,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const saved = await this.getByChapter(input.bookId, input.chapterNumber);
      if (!saved) throw new Error("Upserted Bible chapter summary could not be read back.");
      return saved;
    },

    async getById(bookId: string, id: string): Promise<BibleChapterSummaryRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_chapter_summary"
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(bookId, id) as BibleChapterSummaryRow | undefined;
      return row ? toChapterSummary(row) : null;
    },

    async getByChapter(bookId: string, chapterNumber: number): Promise<BibleChapterSummaryRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_chapter_summary"
        WHERE "book_id" = ? AND "chapter_number" = ? AND "deleted_at" IS NULL
      `).get(bookId, chapterNumber) as BibleChapterSummaryRow | undefined;
      return row ? toChapterSummary(row) : null;
    },

    async listByBook(bookId: string): Promise<BibleChapterSummaryRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_chapter_summary"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "chapter_number" ASC
      `).all(bookId) as BibleChapterSummaryRow[];
      return rows.map(toChapterSummary);
    },

    async update(bookId: string, id: string, updates: UpdateBibleChapterSummaryInput): Promise<BibleChapterSummaryRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "bible_chapter_summary"
        SET "title" = ?, "summary" = ?, "word_count" = ?, "key_events_json" = ?,
          "appearing_character_ids_json" = ?, "pov" = ?, "metadata_json" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(
        updates.title ?? current.title,
        updates.summary ?? current.summary,
        updates.wordCount ?? current.wordCount,
        updates.keyEventsJson ?? current.keyEventsJson,
        updates.appearingCharacterIdsJson ?? current.appearingCharacterIdsJson,
        updates.pov ?? current.pov,
        updates.metadataJson ?? current.metadataJson,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },

    async softDelete(bookId: string, id: string, deletedAt = new Date()): Promise<boolean> {
      const result = storage.sqlite.prepare(`
        UPDATE "bible_chapter_summary"
        SET "deleted_at" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(deletedAt.getTime(), deletedAt.getTime(), bookId, id);
      return result.changes > 0;
    },
  };
}
