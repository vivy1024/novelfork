import { buildJingweiBrief } from "../engine/jingwei/read-model/build-jingwei-brief.js";
import { readJingweiCategory } from "../engine/jingwei/read-model/read-jingwei-category.js";
import { searchJingwei } from "../engine/jingwei/read-model/search-jingwei.js";
import type {
  JingweiBriefIndex,
  JingweiContextItem,
  JingweiContextResult,
  JingweiReadBriefResult,
  JingweiReadCategoryResult,
  JingweiSearchResult,
  JingweiReadableItem,
} from "../engine/jingwei/types.js";

export interface JingweiReadContextInput {
  bookId: string;
  categories?: string[];
  chapterNumber?: number;
  sceneText?: string;
  chapterIntent?: string;
  mode?: "auto" | "core" | "relevant" | "full";
}

export interface JingweiReadContextResult {
  ok: boolean;
  summary: string;
  data?: {
    bookId: string;
    items: JingweiContextItem[];
    totalTokens: number;
    droppedEntryIds: string[];
    sectionStats: JingweiContextResult["sectionStats"];
    coreBrief?: JingweiReadableItem[];
    index?: JingweiBriefIndex;
    recommendedReads?: Array<{ category: string; reason: string }>;
  };
  error?: string;
}

export interface JingweiReadBriefInput {
  bookId: string;
  chapterNumber?: number;
  sceneText?: string;
  chapterIntent?: string;
  tokenBudget?: number;
}

export interface JingweiReadBriefResponse {
  ok: boolean;
  summary: string;
  data?: JingweiReadBriefResult;
  error?: string;
}

export interface JingweiReadCategoryInput {
  bookId: string;
  category: string;
  chapterNumber?: number;
  sceneText?: string;
  page?: number;
  limit?: number;
  tokenBudget?: number;
  detailLevel?: "summary" | "normal" | "full";
}

export interface JingweiReadCategoryResponse {
  ok: boolean;
  summary: string;
  data?: JingweiReadCategoryResult;
  error?: string;
}

export interface JingweiSearchInput {
  bookId: string;
  query: string;
  categories?: string[];
  chapterNumber?: number;
  tokenBudget?: number;
  limit?: number;
}

export interface JingweiSearchResponse {
  ok: boolean;
  summary: string;
  data?: JingweiSearchResult;
  error?: string;
}

function toLegacyContextItem(item: JingweiReadableItem): JingweiContextItem {
  return {
    id: item.id,
    entryId: item.entryId,
    sectionId: item.sectionId,
    sectionKey: item.sectionKey,
    sectionName: item.sectionName,
    title: item.title,
    text: item.contentMd,
    source: item.source,
    priority: item.priority,
    estimatedTokens: item.estimatedTokens,
  };
}

function buildSectionStats(items: readonly JingweiReadableItem[]) {
  const map = new Map<string, { sectionId: string; sectionName: string; count: number }>();
  for (const item of items) {
    const current = map.get(item.sectionId) ?? { sectionId: item.sectionId, sectionName: item.sectionName, count: 0 };
    current.count += 1;
    map.set(item.sectionId, current);
  }
  return [...map.values()];
}

function legacySummary(result: { items: readonly JingweiReadableItem[]; estimatedTokens: number; droppedEntryIds: readonly string[] }) {
  const itemCount = result.items.length;
  return result.droppedEntryIds.length > 0
    ? `已读取 ${itemCount} 条经纬条目（${result.estimatedTokens} tokens），${result.droppedEntryIds.length} 条因预算限制被省略。`
    : `已读取 ${itemCount} 条经纬条目（${result.estimatedTokens} tokens）。`;
}

export async function handleJingweiReadBrief(input: JingweiReadBriefInput, _booksDir?: string): Promise<JingweiReadBriefResponse> {
  try {
    const result = await buildJingweiBrief(input);
    return {
      ok: true,
      summary: result.droppedEntryIds.length > 0
        ? `已读取核心包 ${result.coreBrief.length} 条，${result.droppedEntryIds.length} 条内容因预算限制被省略。`
        : `已读取核心包 ${result.coreBrief.length} 条。`,
      data: result,
    };
  } catch (error) {
    return {
      ok: false,
      summary: `读取经纬核心包失败：${error instanceof Error ? error.message : String(error)}`,
      error: "read-brief-failed",
    };
  }
}

export async function handleJingweiReadCategory(input: JingweiReadCategoryInput, _booksDir?: string): Promise<JingweiReadCategoryResponse> {
  try {
    const result = await readJingweiCategory(input);
    return {
      ok: true,
      summary: result.droppedEntryIds.length > 0
        ? `已读取 ${result.returnedCount} 条 ${result.category} 条目，${result.droppedEntryIds.length} 条内容因预算限制被省略。`
        : `已读取 ${result.returnedCount} 条 ${result.category} 条目。`,
      data: result,
    };
  } catch (error) {
    return {
      ok: false,
      summary: `读取经纬分类失败：${error instanceof Error ? error.message : String(error)}`,
      error: "read-category-failed",
    };
  }
}

export async function handleJingweiSearch(input: JingweiSearchInput, _booksDir?: string): Promise<JingweiSearchResponse> {
  try {
    const result = await searchJingwei(input);
    return {
      ok: true,
      summary: result.droppedEntryIds.length > 0
        ? `搜索到 ${result.returnedCount} 条相关经纬条目，${result.droppedEntryIds.length} 条内容因预算限制被省略。`
        : `搜索到 ${result.returnedCount} 条相关经纬条目。`,
      data: result,
    };
  } catch (error) {
    return {
      ok: false,
      summary: `搜索经纬失败：${error instanceof Error ? error.message : String(error)}`,
      error: "search-failed",
    };
  }
}

/**
 * 读取书籍的经纬上下文——兼容入口。
 *
 * - auto/core/relevant 会返回核心包 + 目录摘要 + 兼容 items
 * - full 不再表示无界全量读取，而是返回目录与分页建议
 */
export async function handleJingweiReadContext(
  input: JingweiReadContextInput,
  _booksDir?: string,
): Promise<JingweiReadContextResult> {
  const { bookId, chapterNumber, sceneText, chapterIntent } = input;
  const mode = input.mode === "core" || input.mode === "relevant" || input.mode === "full" ? input.mode : "auto";

  try {
    const result = await buildJingweiBrief({
      bookId,
      chapterNumber,
      sceneText,
      chapterIntent,
      tokenBudget: mode === "full" ? 4000 : undefined,
    });

    const legacyItems = result.coreBrief.map(toLegacyContextItem);
    const summary = result.droppedEntryIds.length > 0
      ? `已读取 ${legacyItems.length} 条经纬条目（${result.estimatedTokens} tokens），${result.droppedEntryIds.length} 条因预算限制被省略。`
      : `已读取 ${legacyItems.length} 条经纬条目（${result.estimatedTokens} tokens）。`;

    if (mode === "full") {
      return {
        ok: true,
        summary: `${summary} 当前已改为目录化读取，请继续按分类读取细节。`,
        data: {
          bookId,
          items: legacyItems,
          totalTokens: result.estimatedTokens,
          droppedEntryIds: result.droppedEntryIds,
          sectionStats: buildSectionStats(result.coreBrief),
          coreBrief: result.coreBrief,
          index: result.index,
          recommendedReads: result.recommendedReads,
        },
      };
    }

    return {
      ok: true,
      summary,
      data: {
        bookId,
        items: legacyItems,
        totalTokens: result.estimatedTokens,
        droppedEntryIds: result.droppedEntryIds,
        sectionStats: buildSectionStats(result.coreBrief),
        coreBrief: result.coreBrief,
        index: result.index,
        recommendedReads: result.recommendedReads,
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
