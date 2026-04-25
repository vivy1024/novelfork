import type { StorageDatabase } from "../../storage/db.js";
import type { BibleConflictRecord, CreateBibleConflictInput, UpdateBibleConflictInput } from "../types.js";

interface BibleConflictRow {
  id: string;
  book_id: string;
  name: string;
  type: string;
  scope: string;
  priority: number;
  protagonist_side_json: string;
  antagonist_side_json: string;
  stakes: string;
  root_cause_json: string;
  evolution_path_json: string;
  resolution_state: string;
  resolution_chapter: number | null;
  related_conflict_ids_json: string;
  visibility_rule_json: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

interface ConflictEvolutionNode {
  chapter?: number;
}

function toConflict(row: BibleConflictRow): BibleConflictRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    name: row.name,
    type: row.type,
    scope: row.scope,
    priority: row.priority,
    protagonistSideJson: row.protagonist_side_json,
    antagonistSideJson: row.antagonist_side_json,
    stakes: row.stakes,
    rootCauseJson: row.root_cause_json,
    evolutionPathJson: row.evolution_path_json,
    resolutionState: row.resolution_state,
    resolutionChapter: row.resolution_chapter,
    relatedConflictIdsJson: row.related_conflict_ids_json,
    visibilityRuleJson: row.visibility_rule_json,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at === null ? null : new Date(row.deleted_at),
  };
}

function parseEvolutionPath(value: string): ConflictEvolutionNode[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((node): node is ConflictEvolutionNode => typeof node === "object" && node !== null);
  } catch {
    return [];
  }
}

const selectColumns = `
  "id", "book_id", "name", "type", "scope", "priority", "protagonist_side_json",
  "antagonist_side_json", "stakes", "root_cause_json", "evolution_path_json", "resolution_state",
  "resolution_chapter", "related_conflict_ids_json", "visibility_rule_json", "created_at", "updated_at", "deleted_at"
`;

export function createBibleConflictRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateBibleConflictInput): Promise<BibleConflictRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "bible_conflict" (
          "id", "book_id", "name", "type", "scope", "priority", "protagonist_side_json",
          "antagonist_side_json", "stakes", "root_cause_json", "evolution_path_json", "resolution_state",
          "resolution_chapter", "related_conflict_ids_json", "visibility_rule_json", "created_at", "updated_at", "deleted_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        input.id,
        input.bookId,
        input.name,
        input.type,
        input.scope,
        input.priority,
        input.protagonistSideJson,
        input.antagonistSideJson,
        input.stakes,
        input.rootCauseJson,
        input.evolutionPathJson,
        input.resolutionState,
        input.resolutionChapter,
        input.relatedConflictIdsJson,
        input.visibilityRuleJson,
        input.createdAt.getTime(),
        input.updatedAt.getTime(),
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted Bible conflict could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<BibleConflictRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_conflict"
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).get(bookId, id) as BibleConflictRow | undefined;
      return row ? toConflict(row) : null;
    },

    async listByBook(bookId: string): Promise<BibleConflictRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_conflict"
        WHERE "book_id" = ? AND "deleted_at" IS NULL
        ORDER BY "priority" ASC, "updated_at" DESC, "name" ASC
      `).all(bookId) as BibleConflictRow[];
      return rows.map(toConflict);
    },

    async getActiveConflictsAtChapter(bookId: string, chapter: number): Promise<BibleConflictRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "bible_conflict"
        WHERE "book_id" = ?
          AND "deleted_at" IS NULL
          AND "resolution_state" NOT IN ('resolved', 'deferred')
        ORDER BY "priority" ASC, "updated_at" DESC, "name" ASC
      `).all(bookId) as BibleConflictRow[];

      return rows
        .map(toConflict)
        .filter((conflict) => {
          const path = parseEvolutionPath(conflict.evolutionPathJson);
          const firstChapter = path[0]?.chapter ?? conflict.resolutionChapter ?? 0;
          const lastChapter = conflict.resolutionChapter ?? Number.POSITIVE_INFINITY;
          return chapter >= firstChapter && chapter <= lastChapter;
        })
        .sort((a, b) => a.priority - b.priority || b.updatedAt.getTime() - a.updatedAt.getTime() || a.name.localeCompare(b.name));
    },

    async update(bookId: string, id: string, updates: UpdateBibleConflictInput): Promise<BibleConflictRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;

      storage.sqlite.prepare(`
        UPDATE "bible_conflict"
        SET "name" = ?, "type" = ?, "scope" = ?, "priority" = ?, "protagonist_side_json" = ?,
          "antagonist_side_json" = ?, "stakes" = ?, "root_cause_json" = ?, "evolution_path_json" = ?,
          "resolution_state" = ?, "resolution_chapter" = ?, "related_conflict_ids_json" = ?,
          "visibility_rule_json" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(
        updates.name ?? current.name,
        updates.type ?? current.type,
        updates.scope ?? current.scope,
        updates.priority ?? current.priority,
        updates.protagonistSideJson ?? current.protagonistSideJson,
        updates.antagonistSideJson ?? current.antagonistSideJson,
        updates.stakes ?? current.stakes,
        updates.rootCauseJson ?? current.rootCauseJson,
        updates.evolutionPathJson ?? current.evolutionPathJson,
        updates.resolutionState ?? current.resolutionState,
        updates.resolutionChapter ?? current.resolutionChapter,
        updates.relatedConflictIdsJson ?? current.relatedConflictIdsJson,
        updates.visibilityRuleJson ?? current.visibilityRuleJson,
        (updates.updatedAt ?? current.updatedAt).getTime(),
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },

    async softDelete(bookId: string, id: string, deletedAt = new Date()): Promise<boolean> {
      const result = storage.sqlite.prepare(`
        UPDATE "bible_conflict"
        SET "deleted_at" = ?, "updated_at" = ?
        WHERE "book_id" = ? AND "id" = ? AND "deleted_at" IS NULL
      `).run(deletedAt.getTime(), deletedAt.getTime(), bookId, id);
      return result.changes > 0;
    },
  };
}
