import type { StorageDatabase } from "../../storage/db.js";
import { createCoreShiftRepository } from "../repositories/core-shift-repo.js";
import type { CoreShiftRecord } from "../types.js";
import { analyzeCoreShiftImpact } from "./impact-analysis.js";

export interface ProposeCoreShiftInput {
  id?: string;
  bookId: string;
  targetType: CoreShiftRecord["targetType"];
  targetId: string;
  fromSnapshot: Record<string, unknown>;
  toSnapshot: Record<string, unknown>;
  triggeredBy: CoreShiftRecord["triggeredBy"];
  chapterAt: number;
  createdAt?: Date;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function applyPremiseSnapshot(storage: StorageDatabase, bookId: string, snapshot: Record<string, unknown>, now: Date): void {
  const current = storage.sqlite.prepare(`SELECT * FROM "bible_premise" WHERE "book_id" = ?`).get(bookId) as { id?: string; theme_json?: string; target_readers?: string; unique_hook?: string; genre_tags_json?: string; created_at?: number } | undefined;
  const id = String(snapshot.id ?? current?.id ?? crypto.randomUUID());
  storage.sqlite.prepare(`
    INSERT INTO "bible_premise" (
      "id", "book_id", "logline", "theme_json", "tone", "target_readers", "unique_hook", "genre_tags_json", "created_at", "updated_at"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT("book_id") DO UPDATE SET
      "logline" = excluded."logline",
      "theme_json" = excluded."theme_json",
      "tone" = excluded."tone",
      "target_readers" = excluded."target_readers",
      "unique_hook" = excluded."unique_hook",
      "genre_tags_json" = excluded."genre_tags_json",
      "updated_at" = excluded."updated_at"
  `).run(
    id,
    bookId,
    String(snapshot.logline ?? ""),
    JSON.stringify(snapshot.theme ?? parseJsonObject(current?.theme_json ?? "[]")),
    String(snapshot.tone ?? ""),
    String(snapshot.targetReaders ?? current?.target_readers ?? ""),
    String(snapshot.uniqueHook ?? current?.unique_hook ?? ""),
    JSON.stringify(snapshot.genreTags ?? parseJsonObject(current?.genre_tags_json ?? "[]")),
    current?.created_at ?? now.getTime(),
    now.getTime(),
  );
}

function markAffectedChapters(storage: StorageDatabase, bookId: string, shiftId: string, chapters: number[], now: Date): void {
  for (const chapter of chapters) {
    const row = storage.sqlite.prepare(`
      SELECT "id", "metadata_json" FROM "bible_chapter_summary"
      WHERE "book_id" = ? AND "chapter_number" = ? AND "deleted_at" IS NULL
    `).get(bookId, chapter) as { id: string; metadata_json: string } | undefined;
    if (!row) continue;
    const metadata = parseJsonObject(row.metadata_json);
    const current = Array.isArray(metadata.coreShiftReviewRequired) ? metadata.coreShiftReviewRequired.map(String) : [];
    metadata.coreShiftReviewRequired = [...new Set([...current, shiftId])];
    storage.sqlite.prepare(`
      UPDATE "bible_chapter_summary"
      SET "metadata_json" = ?, "updated_at" = ?
      WHERE "book_id" = ? AND "id" = ?
    `).run(JSON.stringify(metadata), now.getTime(), bookId, row.id);
  }
}

export async function proposeCoreShift(storage: StorageDatabase, input: ProposeCoreShiftInput): Promise<CoreShiftRecord> {
  const createdAt = input.createdAt ?? new Date();
  const impact = await analyzeCoreShiftImpact(storage, {
    bookId: input.bookId,
    targetType: input.targetType,
    targetId: input.targetId,
    snapshot: input.toSnapshot,
  });
  return createCoreShiftRepository(storage).create({
    id: input.id ?? crypto.randomUUID(),
    bookId: input.bookId,
    targetType: input.targetType,
    targetId: input.targetId,
    fromSnapshotJson: JSON.stringify(input.fromSnapshot),
    toSnapshotJson: JSON.stringify(input.toSnapshot),
    triggeredBy: input.triggeredBy,
    chapterAt: input.chapterAt,
    affectedChaptersJson: JSON.stringify(impact.affectedChapters),
    impactAnalysisJson: JSON.stringify(impact),
    status: "proposed",
    createdAt,
    appliedAt: null,
  });
}

export async function acceptCoreShift(storage: StorageDatabase, bookId: string, shiftId: string, appliedAt = new Date()): Promise<CoreShiftRecord | null> {
  const repo = createCoreShiftRepository(storage);
  const shift = await repo.getById(bookId, shiftId);
  if (!shift) return null;
  const run = storage.sqlite.transaction(() => {
    if (shift.targetType === "premise") {
      applyPremiseSnapshot(storage, bookId, JSON.parse(shift.toSnapshotJson) as Record<string, unknown>, appliedAt);
    }
    markAffectedChapters(storage, bookId, shiftId, JSON.parse(shift.affectedChaptersJson) as number[], appliedAt);
    storage.sqlite.prepare(`UPDATE "core_shift" SET "status" = 'applied', "applied_at" = ? WHERE "book_id" = ? AND "id" = ?`).run(appliedAt.getTime(), bookId, shiftId);
  });
  run();
  return repo.getById(bookId, shiftId);
}

export async function rejectCoreShift(storage: StorageDatabase, bookId: string, shiftId: string, rejectedAt = new Date()): Promise<CoreShiftRecord | null> {
  const repo = createCoreShiftRepository(storage);
  const shift = await repo.getById(bookId, shiftId);
  if (!shift) return null;
  storage.sqlite.prepare(`UPDATE "core_shift" SET "status" = 'rejected', "applied_at" = ? WHERE "book_id" = ? AND "id" = ?`).run(rejectedAt.getTime(), bookId, shiftId);
  return repo.getById(bookId, shiftId);
}
