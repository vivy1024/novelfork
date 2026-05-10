import type { StorageDatabase } from "../../storage/db.js";
import type { BibleCharacterRecord, CreateBibleCharacterInput, UpdateBibleCharacterInput } from "../types.js";

interface BibleCharacterRow {
  id: string;
  book_id: string;
  name: string;
  aliases_json: string;
  role_type: string;
  summary: string;
  traits_json: string;
  visibility_rule_json: string;
  first_chapter: number | null;
  last_chapter: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toCharacter(row: BibleCharacterRow): BibleCharacterRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    name: row.name,
    aliasesJson: row.aliases_json,
    roleType: row.role_type,
    summary: row.summary,
    traitsJson: row.traits_json,
    visibilityRuleJson: row.visibility_rule_json,
    firstChapter: row.first_chapter,
    lastChapter: row.last_chapter,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}

const selectColumns = `
  "id", "book_id", "name", "aliases_json", "role_type", "summary", "traits_json",
  "visibility_rule_json", "first_chapter", "last_chapter", "created_at", "updated_at", "deleted_at"
`;

export function createBibleCharacterRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateBibleCharacterInput): Promise<BibleCharacterRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_character" (
          "id", "book_id", "name", "aliases_json", "role_type", "summary", "traits_json",
          "visibility_rule_json", "first_chapter", "last_chapter", "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        input.id,
        input.bookId,
        input.name,
        input.aliasesJson,
        input.roleType,
        input.summary,
        input.traitsJson,
        input.visibilityRuleJson,
        input.firstChapter,
        input.lastChapter,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted Bible character could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<BibleCharacterRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_character"
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(bookId, id) as BibleCharacterRow | undefined;
      return row ? toCharacter(row) : null;
    },

    async listByBook(bookId: string): Promise<BibleCharacterRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_character"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "name" ASC
      `).all(bookId) as BibleCharacterRow[];
      return rows.map(toCharacter);
    },

    async update(bookId: string, id: string, updates: UpdateBibleCharacterInput): Promise<BibleCharacterRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "bible_character"
        SET "name" = ?, "aliases_json" = ?, "role_type" = ?, "summary" = ?, "traits_json" = ?,
          "visibility_rule_json" = ?, "first_chapter" = ?, "last_chapter" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(
        updates.name ?? current.name,
        updates.aliasesJson ?? current.aliasesJson,
        updates.roleType ?? current.roleType,
        updates.summary ?? current.summary,
        updates.traitsJson ?? current.traitsJson,
        updates.visibilityRuleJson ?? current.visibilityRuleJson,
        updates.firstChapter ?? current.firstChapter,
        updates.lastChapter ?? current.lastChapter,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },

    async softDelete(bookId: string, id: string, deletedAt = new Date()): Promise<boolean> {
      const result = storage.sqlite.prepare(`
        UPDATE "bible_character"
        SET "deleted_at" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(deletedAt.getTime(), deletedAt.getTime(), bookId, id);
      return result.changes > 0;
    },
  };
}
