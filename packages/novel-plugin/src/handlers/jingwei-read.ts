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
 */
export async function handleJingweiReadContext(
  input: JingweiReadContextInput,
  _booksDir?: string,
): Promise<JingweiReadContextResult> {
  const { bookId, chapterNumber, sceneText } = input;

  try {
    const result = await buildJingweiContext({
      bookId,
      currentChapter: chapterNumber,
      sceneText,
      tokenBudget: 8000,
    });

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

    // SQLite 为空，提示用户添加条目
    return {
      ok: true,
      summary: "经纬为空，请通过 jingwei.upsert_entry 工具或 JingweiPanel 添加条目。",
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
