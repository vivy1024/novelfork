/**
 * 章节文件迁移：默认 books 目录 → 绑定目录
 *
 * 场景：之前章节迁移到了 {projectRoot}/books/{bookId}/chapters，
 * 但用户绑定了外部目录（repositoryPath）。本迁移把章节/草稿文件
 * 搬到绑定目录，让用户能用外部编辑器/Git 管理。
 *
 * 幂等：绑定目录已有 chapters/index.json 则跳过。
 */
import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { resolveBookStorageDir } from "./book-storage-resolver.js";

export interface BindingMigrationResult {
  migratedBooks: number;
  movedFiles: number;
}

async function copyDirIfExists(srcDir: string, destDir: string): Promise<number> {
  if (!existsSync(srcDir)) return 0;
  await mkdir(destDir, { recursive: true });
  let count = 0;
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (existsSync(destPath)) continue; // 不覆盖绑定目录已有文件
    await copyFile(srcPath, destPath);
    count++;
  }
  return count;
}

/**
 * 把每本绑定书的章节/草稿从默认 books 目录搬到绑定目录。
 */
export async function migrateChaptersToBindingDir(
  projectRoot: string,
  listBookIds: () => Promise<readonly string[]>,
): Promise<BindingMigrationResult> {
  let migratedBooks = 0;
  let movedFiles = 0;

  const bookIds = await listBookIds();
  for (const bookId of bookIds) {
    const defaultDir = join(projectRoot, "books", bookId);
    const boundDir = resolveBookStorageDir(projectRoot, bookId);

    // 未绑定（boundDir === defaultDir）则无需迁移
    if (boundDir === defaultDir) continue;

    // 幂等标记
    const marker = join(defaultDir, ".chapters-moved-to-binding");
    if (existsSync(marker)) continue;

    const movedChapters = await copyDirIfExists(join(defaultDir, "chapters"), join(boundDir, "chapters"));
    const movedDrafts = await copyDirIfExists(join(defaultDir, "drafts"), join(boundDir, "drafts"));
    movedFiles += movedChapters + movedDrafts;

    if (movedChapters > 0 || movedDrafts > 0) {
      migratedBooks++;
    }

    // 写标记（即使没文件可搬也标记，避免重复扫描）
    try {
      await writeFile(marker, new Date().toISOString(), "utf-8");
    } catch { /* ignore */ }
  }

  return { migratedBooks, movedFiles };
}
