/**
 * 书籍存储目录解析 — 决定正式章节落盘到哪个目录。
 *
 * 优先级：
 *   1. 绑定目录（.novelfork-project-init.json 的 repositoryPath，若目录存在）
 *   2. 默认 {projectRoot}/books/{bookId}
 *
 * 绑定目录让用户能用外部编辑器修改、Git 追踪章节文件。
 */
import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface ProjectInitRecord {
  repositoryPath?: string;
}

/** 默认存储目录：{projectRoot}/books/{bookId} */
function defaultBookDir(projectRoot: string, bookId: string): string {
  return join(projectRoot, "books", bookId);
}

/** 读取书籍的绑定目录记录 */
function readBindingPath(projectRoot: string, bookId: string): string | null {
  const initPath = join(defaultBookDir(projectRoot, bookId), ".novelfork-project-init.json");
  try {
    const raw = readFileSync(initPath, "utf-8");
    const record = JSON.parse(raw) as ProjectInitRecord;
    if (record.repositoryPath && existsSync(record.repositoryPath)) {
      return record.repositoryPath;
    }
  } catch { /* no binding record */ }
  return null;
}

/**
 * 同步解析书籍存储目录。
 * 绑定目录存在则返回绑定目录，否则返回默认 books 目录。
 */
export function resolveBookStorageDir(projectRoot: string, bookId: string): string {
  return readBindingPath(projectRoot, bookId) ?? defaultBookDir(projectRoot, bookId);
}

/** 异步版本（读绑定记录用 async fs） */
export async function resolveBookStorageDirAsync(projectRoot: string, bookId: string): Promise<string> {
  const initPath = join(defaultBookDir(projectRoot, bookId), ".novelfork-project-init.json");
  try {
    const raw = await readFile(initPath, "utf-8");
    const record = JSON.parse(raw) as ProjectInitRecord;
    if (record.repositoryPath && existsSync(record.repositoryPath)) {
      return record.repositoryPath;
    }
  } catch { /* no binding record */ }
  return defaultBookDir(projectRoot, bookId);
}
