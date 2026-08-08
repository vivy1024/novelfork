/**
 * SQLite writing_resource → 正式章节文件迁移。
 *
 * 只迁移已经接受的正式章节；candidate/draft 历史记录不再迁移到运行时文件结构。
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { chapterRelativePath, volumeDirectoryName, type ChapterVolumeDirectoryResolver } from "./chapter-layout.js";
import { countChineseWords, type WritingResourceRow } from "./types.js";

export interface MigrationResult {
  chapters: number;
  skipped: boolean;
}

export async function migrateWritingResourcesToFiles(
  storage: StorageDatabase,
  resolveBookDir: (bookId: string) => string,
  options?: { readonly resolveChapterVolumeDirectory?: ChapterVolumeDirectoryResolver },
): Promise<MigrationResult> {
  const resolveVolumeDirectory = options?.resolveChapterVolumeDirectory
    ?? (() => volumeDirectoryName(1));
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
      const indexEntries = [] as Array<{
        number: number;
        title: string;
        fileName: string;
        wordCount: number;
        updatedAt: string;
      }>;

      for (const resource of accepted) {
        const number = resource.chapter_number ?? 0;
        const volumeDirectory = await resolveVolumeDirectory(bookId, number);
        const fileName = chapterRelativePath(volumeDirectory, number, resource.title);
        const entry = {
          number,
          title: resource.title,
          fileName,
          wordCount: resource.word_count || countChineseWords(resource.content),
          updatedAt: new Date(resource.updated_at).toISOString(),
        };
        indexEntries.push(entry);
        await mkdir(join(bookDir, "chapters", volumeDirectory), { recursive: true });
        await writeFile(join(bookDir, "chapters", fileName), resource.content, "utf-8");
      }

      indexEntries.sort((left, right) => left.number - right.number);
      await mkdir(join(bookDir, "chapters"), { recursive: true });
      await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify(indexEntries, null, 2), "utf-8");
      totalChapters += accepted.length;
    }

    await writeFile(markerFile, new Date().toISOString(), "utf-8");
  }

  return { chapters: totalChapters, skipped: rows.length === 0 };
}
