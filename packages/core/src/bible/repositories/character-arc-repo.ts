import type { StorageDatabase } from "../../storage/db.js";
import type { BibleCharacterArcRecord, CreateBibleCharacterArcInput, UpdateBibleCharacterArcInput } from "../types.js";

interface BibleCharacterArcRow {
  id: string;
  book_id: string;
  character_id: string;
  arc_type: string;
  starting_state: string;
  ending_state: string;
  key_turning_points_json: string;
  current_position: string;
  visibility_rule_json: string;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

function toCharacterArc(row: BibleCharacterArcRow): BibleCharacterArcRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    characterId: row.character_id,
    arcType: row.arc_type,
    startingState: row.starting_state,
    endingState: row.ending_state,
    keyTurningPointsJson: row.key_turning_points_json,
    currentPosition: row.current_position,
    visibilityRuleJson: row.visibility_rule_json,
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

const selectColumns = `
  "id", "book_id", "character_id", "arc_type", "starting_state", "ending_state",
  "key_turning_points_json", "current_position", "visibility_rule_json", "deleted_at", "created_at", "updated_at"
`;

export function createBibleCharacterArcRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateBibleCharacterArcInput): Promise<BibleCharacterArcRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_character_arc" (
          "id", "book_id", "character_id", "arc_type", "starting_state", "ending_state",
          "key_turning_points_json", "current_position", "visibility_rule_json", "deleted_at", "created_at", "updated_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(
        input.id,
        input.bookId,
        input.characterId,
        input.arcType,
        input.startingState,
        input.endingState,
        input.keyTurningPointsJson,
        input.currentPosition,
        input.visibilityRuleJson,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted Bible character arc could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<BibleCharacterArcRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_character_arc"
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(bookId, id) as BibleCharacterArcRow | undefined;
      return row ? toCharacterArc(row) : null;
    },

    async listByBook(bookId: string): Promise<BibleCharacterArcRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_character_arc"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "id" ASC
      `).all(bookId) as BibleCharacterArcRow[];
      return rows.map(toCharacterArc);
    },

    async listByCharacter(bookId: string, characterId: string): Promise<BibleCharacterArcRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_character_arc"
        WHERE "book_id" = ? AND "character_id" = ? AND "deleted_at" IS NULL
        ORDER BY "updated_at" DESC, "id" ASC
      `).all(bookId, characterId) as BibleCharacterArcRow[];
      return rows.map(toCharacterArc);
    },

    async update(bookId: string, id: string, updates: UpdateBibleCharacterArcInput): Promise<BibleCharacterArcRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "bible_character_arc"
        SET "arc_type" = ?, "starting_state" = ?, "ending_state" = ?, "key_turning_points_json" = ?,
          "current_position" = ?, "visibility_rule_json" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(
        updates.arcType ?? current.arcType,
        updates.startingState ?? current.startingState,
        updates.endingState ?? current.endingState,
        updates.keyTurningPointsJson ?? current.keyTurningPointsJson,
        updates.currentPosition ?? current.currentPosition,
        updates.visibilityRuleJson ?? current.visibilityRuleJson,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },

    async softDelete(bookId: string, id: string, deletedAt = new Date()): Promise<boolean> {
      const result = storage.sqlite.prepare(`
        UPDATE "bible_character_arc"
        SET "deleted_at" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(deletedAt.getTime(), deletedAt.getTime(), bookId, id);
      return result.changes > 0;
    },
  };
}
