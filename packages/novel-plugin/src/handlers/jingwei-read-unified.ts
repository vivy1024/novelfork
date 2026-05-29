/**
 * Unified jingwei.read handler — routes to existing handlers based on scope parameter.
 */
import {
  handleJingweiReadBrief,
  handleJingweiReadCategory,
  handleJingweiSearch,
  type JingweiReadBriefInput,
  type JingweiReadBriefResponse,
  type JingweiReadCategoryInput,
  type JingweiReadCategoryResponse,
  type JingweiSearchInput,
  type JingweiSearchResponse,
} from "./jingwei-read.js";

export interface JingweiReadInput {
  bookId: string;
  scope?: "brief" | "category" | "search";
  category?: string;
  query?: string;
  chapterNumber?: number;
  sceneText?: string;
  chapterIntent?: string;
  tokenBudget?: number;
  detailLevel?: "summary" | "normal" | "full";
  page?: number;
  limit?: number;
}

export type JingweiReadResult = JingweiReadBriefResponse | JingweiReadCategoryResponse | JingweiSearchResponse;

/**
 * 统一经纬读取工具。
 * - scope=brief（默认）：返回核心包+分类目录
 * - scope=category：按分类分页读取
 * - scope=search：按关键词搜索
 */
export async function handleJingweiRead(input: JingweiReadInput): Promise<JingweiReadResult> {
  const scope = input.scope ?? "brief";

  switch (scope) {
    case "brief": {
      const briefInput: JingweiReadBriefInput = {
        bookId: input.bookId,
        chapterNumber: input.chapterNumber,
        sceneText: input.sceneText,
        chapterIntent: input.chapterIntent,
        tokenBudget: input.tokenBudget,
      };
      return handleJingweiReadBrief(briefInput);
    }

    case "category": {
      if (!input.category) {
        return {
          ok: false,
          summary: "scope=category 时 category 参数必填。",
          error: "missing-category",
        };
      }
      const categoryInput: JingweiReadCategoryInput = {
        bookId: input.bookId,
        category: input.category,
        chapterNumber: input.chapterNumber,
        sceneText: input.sceneText,
        page: input.page,
        limit: input.limit,
        tokenBudget: input.tokenBudget,
        detailLevel: input.detailLevel,
      };
      return handleJingweiReadCategory(categoryInput);
    }

    case "search": {
      if (!input.query) {
        return {
          ok: false,
          summary: "scope=search 时 query 参数必填。",
          error: "missing-query",
        };
      }
      const searchInput: JingweiSearchInput = {
        bookId: input.bookId,
        query: input.query,
        chapterNumber: input.chapterNumber,
        tokenBudget: input.tokenBudget,
        limit: input.limit,
      };
      return handleJingweiSearch(searchInput);
    }

    default:
      return {
        ok: false,
        summary: `未知的 scope 值：${scope}。支持 brief | category | search。`,
        error: "invalid-scope",
      };
  }
}
