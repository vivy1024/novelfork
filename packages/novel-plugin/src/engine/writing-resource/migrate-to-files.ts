/**
 * SQLite writing_resource → 正式章节文件迁移。
 *
 * 只迁移已经接受的正式章节；candidate/draft 历史记录不再迁移到运行时文件结构。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { countChineseWords, type WritingResourceRow } from "./types.js";

function padNumber(n: number, len = 4): string {
  return String(n).padStart(len, "0");
}

function sanitizeTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 50) || "未命名";
}

export interface MigrationResult {
  chapters: number;
  skipped: boolean;
}

export async function migrateWritingResourcesToFiles(
  storage: StorageDatabase,
  resolveBookDir: (bookId: string) => string,
): Promise<MigrationResult> {
  const rows = storage.sqlite.prepare(
    `SELECT DISTINCT book_id FROM writing_resource WHERE deleted_at IS NULL AND type = 'chapter' AND status = 'accepted'`
  ).all() as { book_id: string }[];

  let totalChapters = 0;

  for (const { book_id: bookId } of rows) {
    const bookDir = resolveBookDir(bookId);
    const markerFile = join(bookDir, ".writing-resource-migrated");
    if (existsSync(markerFile)) continue;

    const accepted = storage.sqlite.prepare(
      `SELECT * FROM writing_resource WHERE book_id = ? AND deleted_at IS NULL AND type = 'chapter' AND status = 'accepted' ORDER BY COALESCE(chapter_number, 999999), updated_at DESC`
    ).all(bookId) as WritingResourceRow[];
    if (accepted.length > 0) {
      const chaptersDir = join(bookDir, "chapters");
      await mkdir(chaptersDir, { recursive: true });

      const indexEntries = accepted.map((resource) => ({
        number: resource.chapter_number ?? 0,
        title: resource.title,
        fileName: `${padNumber(resource.chapter_number ?? 0)}_${sanitizeTitle(resource.title)}.md`,
        wordCount: resource.word_count || countChineseWords(resource.content),
        updatedAt: new Date(resource.updated_at).toISOString(),
      })).sort((left, right) => left.number - right.number);

      for (const entry of indexEntries) {
        const resource = accepted.find((item) => item.chapter_number === entry.number);
        if (resource) await writeFile(join(chaptersDir, entry.fileName), resource.content, "utf-8");
      }
      await writeFile(join(chaptersDir, "index.json"), JSON.stringify(indexEntries, null, 2), "utf-8");
      totalChapters += accepted.length;
    }

    await writeFile(markerFile, new Date().toISOString(), "utf-8");
  }

  return { chapters: totalChapters, skipped: rows.length === 0 };
}
