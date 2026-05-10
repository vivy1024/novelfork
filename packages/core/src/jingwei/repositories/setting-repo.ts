import type { StorageDatabase } from "../../storage/db.js";
import type { BibleSettingRecord, CreateBibleSettingInput, UpdateBibleSettingInput } from "../types.js";

interface BibleSettingRow {
  id: string;
  book_id: string;
  category: string;
  name: string;
  content: string;
  visibility_rule_json: string;
  nested_refs_json: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

function toSetting(row: BibleSettingRow): BibleSettingRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    category: row.category,
    name: row.name,
    content: row.content,
    visibilityRuleJson: row.visibility_rule_json,
    nestedRefsJson: row.nested_refs_json,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}

const selectColumns = `
  "id", "book_id", "category", "name", "content", "visibility_rule_json", "nested_refs_json",
  "created_at", "updated_at", "deleted_at"
`;

export function createBibleSettingRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateBibleSettingInput): Promise<BibleSettingRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_setting" (
          "id", "book_id", "category", "name", "content", "visibility_rule_json", "nested_refs_json",
          "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        input.id,
        input.bookId,
        input.category,
        input.name,
        input.content,
        input.visibilityRuleJson,
        input.nestedRefsJson,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted Bible setting could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<BibleSettingRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_setting"
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(bookId, id) as BibleSettingRow | undefined;
      return row ? toSetting(row) : null;
    },

    async listByBook(bookId: string): Promise<BibleSettingRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_setting"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "name" ASC
      `).all(bookId) as BibleSettingRow[];
      return rows.map(toSetting);
    },

    async update(bookId: string, id: string, updates: UpdateBibleSettingInput): Promise<BibleSettingRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "bible_setting"
        SET "category" = ?, "name" = ?, "content" = ?, "visibility_rule_json" = ?, "nested_refs_json" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(
        updates.category ?? current.category,
        updates.name ?? current.name,
        updates.content ?? current.content,
        updates.visibilityRuleJson ?? current.visibilityRuleJson,
        updates.nestedRefsJson ?? current.nestedRefsJson,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },

    async softDelete(bookId: string, id: string, deletedAt = new Date()): Promise<boolean> {
      const result = storage.sqlite.prepare(`
        UPDATE "bible_setting"
        SET "deleted_at" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(deletedAt.getTime(), deletedAt.getTime(), bookId, id);
      return result.changes > 0;
    },
  };
}
