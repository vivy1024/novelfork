import type { StorageDatabase } from "../../storage/db.js";
import type { CoreShiftRecord, CreateCoreShiftInput, UpdateCoreShiftInput } from "../types.js";

interface CoreShiftRow {
  id: string;
  book_id: string;
  target_type: string;
  target_id: string;
  from_snapshot_json: string;
  to_snapshot_json: string;
  triggered_by: string;
  chapter_at: number;
  affected_chapters_json: string;
  impact_analysis_json: string;
  status: CoreShiftRecord["status"];
  created_at: number;
  applied_at: number | null;
}

const selectColumns = `
  "id", "book_id", "target_type", "target_id", "from_snapshot_json", "to_snapshot_json",
  "triggered_by", "chapter_at", "affected_chapters_json", "impact_analysis_json", "status", "created_at", "applied_at"
`;

function toCoreShift(row: CoreShiftRow): CoreShiftRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    targetType: row.target_type as CoreShiftRecord["targetType"],
    targetId: row.target_id,
    fromSnapshotJson: row.from_snapshot_json,
    toSnapshotJson: row.to_snapshot_json,
    triggeredBy: row.triggered_by as CoreShiftRecord["triggeredBy"],
    chapterAt: row.chapter_at,
    affectedChaptersJson: row.affected_chapters_json,
    impactAnalysisJson: row.impact_analysis_json,
    status: row.status,
    createdAt: new Date(row.created_at),
    appliedAt: row.applied_at === null ? null : new Date(row.applied_at),
  };
}

export function createCoreShiftRepository(storage: StorageDatabase) {
  return {
    async create(input: CreateCoreShiftInput): Promise<CoreShiftRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "core_shift" (
          "id", "book_id", "target_type", "target_id", "from_snapshot_json", "to_snapshot_json",
          "triggered_by", "chapter_at", "affected_chapters_json", "impact_analysis_json", "status", "created_at", "applied_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.bookId,
        input.targetType,
        input.targetId,
        input.fromSnapshotJson,
        input.toSnapshotJson,
        input.triggeredBy,
        input.chapterAt,
        input.affectedChaptersJson,
        input.impactAnalysisJson,
        input.status,
        input.createdAt.getTime(),
        input.appliedAt?.getTime() ?? null,
      );
      const created = await this.getById(input.bookId, input.id);
      if (!created) throw new Error("Inserted core shift could not be read back.");
      return created;
    },

    async getById(bookId: string, id: string): Promise<CoreShiftRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "core_shift"
        WHERE "book_id" = ? AND "id" = ?
      `).get(bookId, id) as CoreShiftRow | undefined;
      return row ? toCoreShift(row) : null;
    },

    async listByBook(bookId: string, status?: CoreShiftRecord["status"]): Promise<CoreShiftRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "core_shift"
        WHERE "book_id" = ? AND (? IS NULL OR "status" = ?)
        ORDER BY "created_at" DESC
      `).all(bookId, status ?? null, status ?? null) as CoreShiftRow[];
      return rows.map(toCoreShift);
    },

    async update(bookId: string, id: string, updates: UpdateCoreShiftInput): Promise<CoreShiftRecord | null> {
      const current = await this.getById(bookId, id);
      if (!current) return null;
      storage.sqlite.prepare(`
        UPDATE "core_shift"
        SET "from_snapshot_json" = ?, "to_snapshot_json" = ?, "triggered_by" = ?, "chapter_at" = ?,
          "affected_chapters_json" = ?, "impact_analysis_json" = ?, "status" = ?, "applied_at" = ?
        WHERE "book_id" = ? AND "id" = ?
      `).run(
        updates.fromSnapshotJson ?? current.fromSnapshotJson,
        updates.toSnapshotJson ?? current.toSnapshotJson,
        updates.triggeredBy ?? current.triggeredBy,
        updates.chapterAt ?? current.chapterAt,
        updates.affectedChaptersJson ?? current.affectedChaptersJson,
        updates.impactAnalysisJson ?? current.impactAnalysisJson,
        updates.status ?? current.status,
        updates.appliedAt === undefined ? current.appliedAt?.getTime() ?? null : updates.appliedAt?.getTime() ?? null,
        bookId,
        id,
      );
      return this.getById(bookId, id);
    },
  };
}
