import type { StorageDatabase } from "../../storage/db.js";
import type { AiTasteLevel, CreateStoredFilterReportInput, StoredFilterReportRecord, ZhuqueStatus } from "../types.js";

interface FilterReportRow {
  id: string;
  book_id: string;
  chapter_number: number;
  ai_taste_score: number;
  level: AiTasteLevel;
  hit_counts_json: string;
  zhuque_score: number | null;
  zhuque_status: ZhuqueStatus | null;
  details: string;
  engine_version: string;
  scanned_at: number;
}

const selectColumns = `
  "id", "book_id", "chapter_number", "ai_taste_score", "level", "hit_counts_json",
  "zhuque_score", "zhuque_status", "details", "engine_version", "scanned_at"
`;

function toRecord(row: FilterReportRow): StoredFilterReportRecord {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterNumber: row.chapter_number,
    aiTasteScore: row.ai_taste_score,
    level: row.level,
    hitCountsJson: row.hit_counts_json,
    zhuqueScore: row.zhuque_score,
    zhuqueStatus: row.zhuque_status,
    details: row.details,
    engineVersion: row.engine_version,
    scannedAt: new Date(row.scanned_at),
  };
}

export function createFilterReportRepository(storage: StorageDatabase) {
  return {
    async insert(input: CreateStoredFilterReportInput): Promise<StoredFilterReportRecord> {
      storage.sqlite.prepare(`
        INSERT INTO "filter_report" (
          "id", "book_id", "chapter_number", "ai_taste_score", "level", "hit_counts_json",
          "zhuque_score", "zhuque_status", "details", "engine_version", "scanned_at"
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.bookId,
        input.chapterNumber,
        input.aiTasteScore,
        input.level,
        input.hitCountsJson,
        input.zhuqueScore,
        input.zhuqueStatus,
        input.details,
        input.engineVersion,
        input.scannedAt.getTime(),
      );
      const created = await this.getById(input.id);
      if (!created) throw new Error("Inserted filter report could not be read back.");
      return created;
    },

    async getById(id: string): Promise<StoredFilterReportRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "filter_report"
        WHERE "id" = ?
      `).get(id) as FilterReportRow | undefined;
      return row ? toRecord(row) : null;
    },

    async listByBook(bookId: string): Promise<StoredFilterReportRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "filter_report"
        WHERE "book_id" = ?
        ORDER BY "chapter_number" ASC, "scanned_at" DESC
      `).all(bookId) as FilterReportRow[];
      return rows.map(toRecord);
    },

    async listByChapter(bookId: string, chapterNumber: number): Promise<StoredFilterReportRecord[]> {
      const rows = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "filter_report"
        WHERE "book_id" = ? AND "chapter_number" = ?
        ORDER BY "scanned_at" DESC
      `).all(bookId, chapterNumber) as FilterReportRow[];
      return rows.map(toRecord);
    },

    async latestByChapter(bookId: string, chapterNumber: number): Promise<StoredFilterReportRecord | null> {
      const row = storage.sqlite.prepare(`
        SELECT ${selectColumns}
        FROM "filter_report"
        WHERE "book_id" = ? AND "chapter_number" = ?
        ORDER BY "scanned_at" DESC
        LIMIT 1
      `).get(bookId, chapterNumber) as FilterReportRow | undefined;
      return row ? toRecord(row) : null;
    },
  };
}
