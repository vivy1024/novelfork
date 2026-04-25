import type { StorageDatabase } from "../../storage/db.js";
import type { BiblePremiseRecord, CreateBiblePremiseInput, UpdateBiblePremiseInput } from "../types.js";

interface BiblePremiseRow {
  id: string;
  book_id: string;
  logline: string;
  theme_json: string;
  tone: string;
  target_readers: string;
  unique_hook: string;
  genre_tags_json: string;
  created_at: number;
  updated_at: number;
}

function toPremise(row: BiblePremiseRow): BiblePremiseRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    logline: row.logline,
    themeJson: row.theme_json,
    tone: row.tone,
    targetReaders: row.target_readers,
    uniqueHook: row.unique_hook,
    genreTagsJson: row.genre_tags_json,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const selectColumns = `
  "id", "book_id", "logline", "theme_json", "tone", "target_readers", "unique_hook",
  "genre_tags_json", "created_at", "updated_at"
`;

export function createBiblePremiseRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateBiblePremiseInput): Promise<BiblePremiseRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_premise" (
          "id", "book_id", "logline", "theme_json", "tone", "target_readers", "unique_hook",
          "genre_tags_json", "created_at", "updated_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.bookId,
        input.logline,
        input.themeJson,
        input.tone,
        input.targetReaders,
        input.uniqueHook,
        input.genreTagsJson,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getByBook(input.bookId);
      if (!created) throw new Error("Inserted Bible premise could not be read back.");
      return created;
    },

    async upsert(input: CreateBiblePremiseInput): Promise<BiblePremiseRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_premise" (
          "id", "book_id", "logline", "theme_json", "tone", "target_readers", "unique_hook",
          "genre_tags_json", "created_at", "updated_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT("book_id") DO UPDATE SET
          "id" = excluded."id",
          "logline" = excluded."logline",
          "theme_json" = excluded."theme_json",
          "tone" = excluded."tone",
          "target_readers" = excluded."target_readers",
          "unique_hook" = excluded."unique_hook",
          "genre_tags_json" = excluded."genre_tags_json",
          "created_at" = excluded."created_at",
          "updated_at" = excluded."updated_at"
      `).run(
        input.id,
        input.bookId,
        input.logline,
        input.themeJson,
        input.tone,
        input.targetReaders,
        input.uniqueHook,
        input.genreTagsJson,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const saved = await this.getByBook(input.bookId);
      if (!saved) throw new Error("Upserted Bible premise could not be read back.");
      return saved;
    },

    async getByBook(bookId: string): Promise<BiblePremiseRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_premise"
        WHERE "book_id" = ?
      `).get(bookId) as BiblePremiseRow | undefined;
      return row ? toPremise(row) : null;
    },

    async listByBook(bookId: string): Promise<BiblePremiseRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_premise"
        WHERE "book_id" = ?
        ORDER BY "updated_at" DESC
      `).all(bookId) as BiblePremiseRow[];
      return rows.map(toPremise);
    },

    async update(bookId: string, updates: UpdateBiblePremiseInput): Promise<BiblePremiseRecord | null> {
      const current = await this.getByBook(bookId);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "bible_premise"
        SET "logline" = ?, "theme_json" = ?, "tone" = ?, "target_readers" = ?, "unique_hook" = ?,
          "genre_tags_json" = ?, "updated_at" = ?
        WHERE "book_id" = ?
      `).run(
        updates.logline ?? current.logline,
        updates.themeJson ?? current.themeJson,
        updates.tone ?? current.tone,
        updates.targetReaders ?? current.targetReaders,
        updates.uniqueHook ?? current.uniqueHook,
        updates.genreTagsJson ?? current.genreTagsJson,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
      );
      return this.getByBook(bookId);
    },
  };
}
