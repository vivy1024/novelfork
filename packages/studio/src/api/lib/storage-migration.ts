/**
 * 存储迁移工具 — 首次启动时将 exe 目录的书籍数据迁移到 ~/.novelfork/
 *
 * 迁移条件：
 * 1. ~/.novelfork/books/ 不存在或为空
 * 2. exe 所在目录有 books/ 且非空
 *
 * 迁移内容：books/、novelfork.json、novelfork.log
 */

import { existsSync, readdirSync, renameSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { resolveRuntimeStoragePath } from "./runtime-storage-paths.js";

function getExeDir(): string | null {
  if (process.execPath?.endsWith(".exe")) {
    return dirname(process.execPath);
  }
  return null;
}

function isDirNonEmpty(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    const entries = readdirSync(dir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * 递归移动目录内容（Windows 跨盘 rename 会失败，用 copy+delete）
 */
function moveDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      moveDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
  // 复制完成后删除源目录
  rmSync(src, { recursive: true, force: true });
}

export interface MigrationResult {
  migrated: boolean;
  source?: string;
  items: string[];
}

/**
 * 检测并执行从 exe 目录到 ~/.novelfork/ 的数据迁移
 * 应在 startStudioServer 之前调用
 */
export function migrateStorageIfNeeded(): MigrationResult {
  const runtimeDir = resolveRuntimeStoragePath();
  const targetBooksDir = join(runtimeDir, "books");
  const exeDir = getExeDir();

  // 如果目标 books/ 已有数据，不迁移
  if (isDirNonEmpty(targetBooksDir)) {
    return { migrated: false, items: [] };
  }

  // 没有 exe 目录（开发模式），检查 cwd
  const sourceDir = exeDir || process.cwd();
  const sourceBooksDir = join(sourceDir, "books");

  if (!isDirNonEmpty(sourceBooksDir)) {
    // 也检查 cwd/dist/books（开发模式）
    const devBooksDir = join(process.cwd(), "dist", "books");
    if (!isDirNonEmpty(devBooksDir)) {
      return { migrated: false, items: [] };
    }
    // 从 dist/books 迁移
    return doMigration(join(process.cwd(), "dist"), runtimeDir);
  }

  return doMigration(sourceDir, runtimeDir);
}

function doMigration(sourceDir: string, targetDir: string): MigrationResult {
  const items: string[] = [];

  mkdirSync(targetDir, { recursive: true });

  // 迁移 books/
  const sourceBooksDir = join(sourceDir, "books");
  const targetBooksDir = join(targetDir, "books");
  if (isDirNonEmpty(sourceBooksDir) && !isDirNonEmpty(targetBooksDir)) {
    try {
      moveDir(sourceBooksDir, targetBooksDir);
      items.push("books/");
    } catch (err) {
      console.warn(`[migration] Failed to move books/: ${err}`);
    }
  }

  // 迁移 novelfork.json
  const sourceConfig = join(sourceDir, "novelfork.json");
  const targetConfig = join(targetDir, "novelfork.json");
  if (existsSync(sourceConfig) && !existsSync(targetConfig)) {
    try {
      copyFileSync(sourceConfig, targetConfig);
      rmSync(sourceConfig, { force: true });
      items.push("novelfork.json");
    } catch (err) {
      console.warn(`[migration] Failed to move novelfork.json: ${err}`);
    }
  }

  // 迁移 novelfork.log
  const sourceLog = join(sourceDir, "novelfork.log");
  const targetLog = join(targetDir, "novelfork.log");
  if (existsSync(sourceLog) && !existsSync(targetLog)) {
    try {
      copyFileSync(sourceLog, targetLog);
      rmSync(sourceLog, { force: true });
      items.push("novelfork.log");
    } catch (err) {
      console.warn(`[migration] Failed to move novelfork.log: ${err}`);
    }
  }

  if (items.length > 0) {
    console.log(`[migration] Migrated data from ${sourceDir} to ${targetDir}: ${items.join(", ")}`);
  }

  return { migrated: items.length > 0, source: sourceDir, items };
}
