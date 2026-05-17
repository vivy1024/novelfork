import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { buildJingweiContext } from "../engine/jingwei/context/build-jingwei-context.js";
import type { JingweiContextResult } from "../engine/jingwei/types.js";

export interface JingweiReadContextInput {
  bookId: string;
  categories?: string[];
  chapterNumber?: number;
  sceneText?: string;
}

export interface JingweiReadContextResult {
  ok: boolean;
  summary: string;
  data?: {
    bookId: string;
    items: JingweiContextResult["items"];
    totalTokens: number;
    droppedEntryIds: string[];
    sectionStats: JingweiContextResult["sectionStats"];
    /** md 文件 fallback 内容（当 SQLite 为空时） */
    fileContents?: Array<{ fileName: string; content: string }>;
  };
  error?: string;
}

/**
 * 读取书籍的经纬上下文——使用 buildJingweiContext 按可见性规则过滤。
 *
 * - global 条目始终注入
 * - tracked 条目仅在 sceneText 中匹配标题/别名时注入
 * - nested 条目仅在被已注入条目关联时级联注入
 * - visibleAfterChapter / visibleUntilChapter 控制时间窗口
 * - token budget 控制总量（默认 8000）
 *
 * Fallback: 当 SQLite 条目为空时，从 storyDir/*.md 文件读取内容。
 */
export async function handleJingweiReadContext(
  input: JingweiReadContextInput,
  booksDir?: string,
): Promise<JingweiReadContextResult> {
  const { bookId, chapterNumber, sceneText } = input;

  try {
    const result = await buildJingweiContext({
      bookId,
      currentChapter: chapterNumber,
      sceneText,
      tokenBudget: 8000,
    });

    // 如果 SQLite 有数据，正常返回
    if (result.items.length > 0) {
      const itemCount = result.items.length;
      const droppedCount = result.droppedEntryIds.length;
      const summary = droppedCount > 0
        ? `已读取 ${itemCount} 条经纬条目（${result.totalTokens} tokens），${droppedCount} 条因预算限制被省略。`
        : `已读取 ${itemCount} 条经纬条目（${result.totalTokens} tokens）。`;

      return {
        ok: true,
        summary,
        data: {
          bookId,
          items: result.items,
          totalTokens: result.totalTokens,
          droppedEntryIds: result.droppedEntryIds,
          sectionStats: result.sectionStats,
        },
      };
    }

    // Fallback: SQLite 为空，从 md 文件读取
    const fileContents = await readJingweiFilesFromDisk(bookId, booksDir);
    if (fileContents.length > 0) {
      const totalChars = fileContents.reduce((sum, f) => sum + f.content.length, 0);
      const estimatedTokens = Math.ceil(totalChars / 2);
      return {
        ok: true,
        summary: `已从经纬文件读取 ${fileContents.length} 个文件（约 ${estimatedTokens} tokens）。提示：结构化条目为空，当前使用 md 文件 fallback。`,
        data: {
          bookId,
          items: [],
          totalTokens: estimatedTokens,
          droppedEntryIds: [],
          sectionStats: result.sectionStats,
          fileContents,
        },
      };
    }

    return {
      ok: true,
      summary: "经纬为空——没有结构化条目，也没有经纬文件。",
      data: {
        bookId,
        items: [],
        totalTokens: 0,
        droppedEntryIds: [],
        sectionStats: result.sectionStats,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: "read-failed",
      summary: `读取经纬失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 从 storyDir 读取经纬 md 文件内容 */
async function readJingweiFilesFromDisk(bookId: string, booksDir?: string): Promise<Array<{ fileName: string; content: string }>> {
  const results: Array<{ fileName: string; content: string }> = [];
  const resolvedBooksDir = booksDir ?? join(process.cwd(), "books");
  const storyDir = join(resolvedBooksDir, bookId, "story");

  if (!existsSync(storyDir)) return results;

  const PRIORITY_FILES = ["story_bible.md", "volume_outline.md", "character_matrix.md", "current_state.md", "setting_guide.md", "book_rules.md"];

  try {
    const allFiles = await readdir(storyDir);
    const mdFiles = allFiles.filter(f => f.endsWith(".md"));
    // 按优先级排序
    const sorted = mdFiles.sort((a, b) => {
      const ai = PRIORITY_FILES.indexOf(a);
      const bi = PRIORITY_FILES.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    let totalChars = 0;
    const MAX_CHARS = 16000; // 约 8000 tokens

    for (const file of sorted) {
      if (totalChars >= MAX_CHARS) break;
      try {
        const content = await readFile(join(storyDir, file), "utf-8");
        if (content.trim().length > 10) {
          results.push({ fileName: file, content: content.slice(0, MAX_CHARS - totalChars) });
          totalChars += content.length;
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* directory read failure */ }

  return results;
}
