/**
 * SQLite → 文件系统迁移脚本
 *
 * 读取 writing_resource 表的所有记录：
 *   - accepted → chapters/{0001_标题}.md + chapters/index.json
 *   - 其他(status=draft/candidate/rejected/archived) → drafts/{id}.md + drafts/index.json
 *
 * 迁移完成后写入 .migration-done 标记文件，避免重复执行。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { createWritingResourceRepository } from "./repository.js";
import { countChineseWords } from "./types.js";

function padNumber(n: number, len = 4): string {
  return String(n).padStart(len, "0");
}

function sanitizeTitle(title: string): string {
  return title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").trim().slice(0, 50) || "未命名";
}

export interface MigrationResult {
  chapters: number;
  drafts: number;
  skipped: boolean;
}

export async function migrateWritingResourcesToFiles(
  storage: StorageDatabase,
  resolveBookDir: (bookId: string) => string,
): Promise<MigrationResult> {
  const repo = createWritingResourceRepository(storage);

  // 查所有 book_id（去重）
  const rows = storage.sqlite.prepare(
    `SELECT DISTINCT book_id FROM writing_resource WHERE deleted_at IS NULL`
  ).all() as { book_id: string }[];

  let totalChapters = 0;
  let totalDrafts = 0;

  for (const { book_id: bookId } of rows) {
    const bookDir = resolveBookDir(bookId);
    const markerFile = join(bookDir, ".writing-resource-migrated");
    if (existsSync(markerFile)) continue;

    const resources = repo.list(bookId, { includeDeleted: false });

    // 分流
    const accepted = resources.filter(r => r.status === "accepted");
    const drafts = resources.filter(r => r.status !== "accepted");

    // 迁移章节
    if (accepted.length > 0) {
      const chaptersDir = join(bookDir, "chapters");
      await mkdir(chaptersDir, { recursive: true });

      const indexEntries = accepted.map(r => ({
        number: r.chapterNumber ?? 0,
        title: r.title,
        fileName: `${padNumber(r.chapterNumber ?? 0)}_${sanitizeTitle(r.title)}.md`,
        wordCount: r.wordCount || countChineseWords(r.content),
        updatedAt: new Date(r.updatedAt).toISOString(),
      })).sort((a, b) => a.number - b.number);

      for (const entry of indexEntries) {
        const resource = accepted.find(r => r.chapterNumber === entry.number);
        if (resource) {
          await writeFile(join(chaptersDir, entry.fileName), resource.content, "utf-8");
        }
      }
      await writeFile(join(chaptersDir, "index.json"), JSON.stringify(indexEntries, null, 2), "utf-8");
      totalChapters += accepted.length;
    }

    // 迁移草稿
    if (drafts.length > 0) {
      const draftsDir = join(bookDir, "drafts");
      await mkdir(draftsDir, { recursive: true });

      const indexEntries = drafts.map(r => ({
        id: r.id,
        title: r.title,
        fileName: `${r.id}.md`,
        chapterNumber: r.chapterNumber,
        wordCount: r.wordCount || countChineseWords(r.content),
        status: r.status,
        source: r.source,
        parentId: r.parentId,
        version: r.version,
        metadata: r.metadata,
        createdAt: new Date(r.createdAt).toISOString(),
        updatedAt: new Date(r.updatedAt).toISOString(),
        acceptedAt: r.acceptedAt ? new Date(r.acceptedAt).toISOString() : null,
      }));

      for (const entry of indexEntries) {
        const resource = drafts.find(r => r.id === entry.id);
        if (resource) {
          await writeFile(join(draftsDir, entry.fileName), resource.content, "utf-8");
        }
      }
      await writeFile(join(draftsDir, "index.json"), JSON.stringify(indexEntries, null, 2), "utf-8");
      totalDrafts += drafts.length;
    }

    // 标记迁移完成
    await writeFile(markerFile, new Date().toISOString(), "utf-8");
  }

  return { chapters: totalChapters, drafts: totalDrafts, skipped: rows.length === 0 };
}
