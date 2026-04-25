import type { StorageDatabase } from "../../storage/db.js";
import type { BookRecord, BibleMode, CreateBookInput, UpdateBookInput } from "../types.js";

interface BookRow {
  id: string;
  name: string;
  bible_mode: BibleMode;
  current_chapter: number;
  created_at: number;
  updated_at: number;
}

function toBook(row: BookRow): BookRecord {
  return {
    id: row.id,
    name: row.name,
    bibleMode: row.bible_mode,
    currentChapter: row.current_chapter,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function createBookRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateBookInput): Promise<BookRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "book" (
          "id", "name", "bible_mode", "current_chapter", "created_at", "updated_at"
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.name,
        input.bibleMode,
        input.currentChapter,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.id);
      if (!created) throw new Error("Inserted book could not be read back.");
      return created;
    },

    async getById(id: string): Promise<BookRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT "id", "name", "bible_mode", "current_chapter", "created_at", "updated_at"
        FROM "book"
        WHERE "id" = ?
      `).get(id) as BookRow | undefined;
      return row ? toBook(row) : null;
    },

    async list(): Promise<BookRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT "id", "name", "bible_mode", "current_chapter", "created_at", "updated_at"
        FROM "book"
        ORDER BY "updated_at" DESC
      `).all() as BookRow[];
      return rows.map(toBook);
    },

    async update(id: string, updates: UpdateBookInput): Promise<BookRecord | null> {
      const current = await this.getById(id);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "book"
        SET "name" = ?, "bible_mode" = ?, "current_chapter" = ?, "updated_at" = ?
        WHERE "id" = ?
      `).run(
        updates.name ?? current.name,
        updates.bibleMode ?? current.bibleMode,
        updates.currentChapter ?? current.currentChapter,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        id,
      );
      return this.getById(id);
    },
  };
}
