import type { StorageDatabase } from "../../storage/db.js";
import type { BibleWorldModelRecord, CreateBibleWorldModelInput, UpdateBibleWorldModelInput } from "../types.js";

interface BibleWorldModelRow {
  id: string;
  book_id: string;
  economy_json: string;
  society_json: string;
  geography_json: string;
  power_system_json: string;
  culture_json: string;
  timeline_json: string;
  updated_at: number;
}

function toWorldModel(row: BibleWorldModelRow): BibleWorldModelRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    economyJson: row.economy_json,
    societyJson: row.society_json,
    geographyJson: row.geography_json,
    powerSystemJson: row.power_system_json,
    cultureJson: row.culture_json,
    timelineJson: row.timeline_json,
    updatedAt: new Date(row.updated_at),
  };
}

const selectColumns = `
  "id", "book_id", "economy_json", "society_json", "geography_json",
  "power_system_json", "culture_json", "timeline_json", "updated_at"
`;

export function createBibleWorldModelRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateBibleWorldModelInput): Promise<BibleWorldModelRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_world_model" (
          "id", "book_id", "economy_json", "society_json", "geography_json",
          "power_system_json", "culture_json", "timeline_json", "updated_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.bookId,
        input.economyJson,
        input.societyJson,
        input.geographyJson,
        input.powerSystemJson,
        input.cultureJson,
        input.timelineJson,
        input.updatedAt.getTime(),
      );
      const created = await this.getByBook(input.bookId);
      if (!created) throw new Error("Inserted Bible world model could not be read back.");
      return created;
    },

    async upsert(input: CreateBibleWorldModelInput): Promise<BibleWorldModelRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_world_model" (
          "id", "book_id", "economy_json", "society_json", "geography_json",
          "power_system_json", "culture_json", "timeline_json", "updated_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT("book_id") DO UPDATE SET
          "id" = excluded."id",
          "economy_json" = excluded."economy_json",
          "society_json" = excluded."society_json",
          "geography_json" = excluded."geography_json",
          "power_system_json" = excluded."power_system_json",
          "culture_json" = excluded."culture_json",
          "timeline_json" = excluded."timeline_json",
          "updated_at" = excluded."updated_at"
      `).run(
        input.id,
        input.bookId,
        input.economyJson,
        input.societyJson,
        input.geographyJson,
        input.powerSystemJson,
        input.cultureJson,
        input.timelineJson,
        input.updatedAt.getTime(),
      );
      const saved = await this.getByBook(input.bookId);
      if (!saved) throw new Error("Upserted Bible world model could not be read back.");
      return saved;
    },

    async getByBook(bookId: string): Promise<BibleWorldModelRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_world_model"
        WHERE "book_id" = ?
      `).get(bookId) as BibleWorldModelRow | undefined;
      return row ? toWorldModel(row) : null;
    },

    async update(bookId: string, updates: UpdateBibleWorldModelInput): Promise<BibleWorldModelRecord | null> {
      const current = await this.getByBook(bookId);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "bible_world_model"
        SET "economy_json" = ?, "society_json" = ?, "geography_json" = ?, "power_system_json" = ?,
          "culture_json" = ?, "timeline_json" = ?, "updated_at" = ?
        WHERE "book_id" = ?
      `).run(
        updates.economyJson ?? current.economyJson,
        updates.societyJson ?? current.societyJson,
        updates.geographyJson ?? current.geographyJson,
        updates.powerSystemJson ?? current.powerSystemJson,
        updates.cultureJson ?? current.cultureJson,
        updates.timelineJson ?? current.timelineJson,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
      );
      return this.getByBook(bookId);
    },
  };
}
