import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface JingweiReadContextInput {
  bookId: string;
}

export interface JingweiCategory {
  name: string;
  files: Array<{ name: string; content: string }>;
}

export interface JingweiReadContextResult {
  ok: boolean;
  summary: string;
  data?: { bookId: string; categories: JingweiCategory[]; totalFiles: number };
  error?: string;
}

const CATEGORIES = ["角色", "势力", "设定", "伏笔", "大纲", "状态", "规则"];

/**
 * 读取书籍的经纬（jingwei）上下文——包含角色、势力、设定等分类目录下的 .md 文件。
 * 每个文件内容截取前 2000 字符。
 */
export async function handleJingweiReadContext(input: JingweiReadContextInput, booksDir: string): Promise<JingweiReadContextResult> {
  const { bookId } = input;
  const jingweiDir = join(booksDir, bookId, "jingwei");
  const categories: JingweiCategory[] = [];

  try {
    for (const cat of CATEGORIES) {
      const catDir = join(jingweiDir, cat);
      try {
        const files = await readdir(catDir);
        const mdFiles = files.filter(f => f.endsWith(".md"));
        const entries = await Promise.all(mdFiles.map(async (f) => {
          const content = await readFile(join(catDir, f), "utf-8").catch(() => "");
          return { name: f, content: content.slice(0, 2000) };
        }));
        if (entries.length > 0) categories.push({ name: cat, files: entries });
      } catch {
        /* category dir may not exist */
      }
    }

    // Also try root-level jingwei files
    try {
      const rootFiles = await readdir(jingweiDir);
      const rootMd = rootFiles.filter(f => f.endsWith(".md"));
      const rootEntries = await Promise.all(rootMd.map(async (f) => {
        const content = await readFile(join(jingweiDir, f), "utf-8").catch(() => "");
        return { name: f, content: content.slice(0, 2000) };
      }));
      if (rootEntries.length > 0) categories.push({ name: "根目录", files: rootEntries });
    } catch {
      /* jingwei dir may not exist */
    }

    return {
      ok: true,
      summary: `已读取书籍 ${bookId} 的经纬上下文（${categories.length} 个分类）。`,
      data: { bookId, categories, totalFiles: categories.reduce((sum, c) => sum + c.files.length, 0) },
    };
  } catch (error) {
    return { ok: false, error: "read-failed", summary: `读取经纬失败：${error instanceof Error ? error.message : String(error)}` };
  }
}
