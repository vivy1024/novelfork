import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { getJingweiCategoryAliases, sqlInPlaceholders } from "../../jingwei/category-compat.js";
import { estimateTokens } from "../../jingwei/context/token-budget.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "../types.js";

export interface RecentSummaryChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  readonly currentChapter?: number;
  /** 注入最近 N 章的手动摘要，默认 3。 */
  readonly limit?: number;
  /** 正文在结算后又被改过的章：摘要照样注入，但标明可能过期、以正文为准。 */
  readonly staleChapters?: readonly number[];
}

interface RawSummaryRow {
  readonly id: string;
  readonly title: string;
  readonly fields_json: string;
  readonly updated_at: number;
}

function parseFieldsJson(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** chapterNumber 容错：数字或字符串数字均可；缺失时回退到标题「第N章」提取。 */
function toChapterNumber(value: unknown, fallbackTitle: string): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/u.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    }
  }
  const titleMatch = /第\s*(\d+)\s*章/u.exec(fallbackTitle);
  return titleMatch?.[1] ? Number(titleMatch[1]) : undefined;
}

/** 去掉标题里重复的「第N章」前缀，避免渲染成「第25章《第25章 xxx》」。 */
function cleanSummaryTitle(chapter: number, rawTitle: string): string {
  return rawTitle
    .replace(new RegExp(`^第\\s*${chapter}\\s*章([：:\\s《]+)?`, "u"), "")
    .replace(/[》]\s*$/u, "")
    .trim();
}

function buildSummaryTitleAndContent(chapter: number, rawTitle: string, summary: string): { readonly title: string; readonly content: string } {
  const cleanedTitle = cleanSummaryTitle(chapter, rawTitle);
  return cleanedTitle
    ? { title: `第${chapter}章《${cleanedTitle}》`, content: `第${chapter}章《${cleanedTitle}》：${summary}` }
    : { title: `第${chapter}章摘要`, content: `第${chapter}章：${summary}` };
}

/**
 * 近章手动剧情摘要通道：读取经纬 chapter-summaries 类目（fields_json 含
 * chapterNumber/title/summary），按章节号倒序取最近几条注入写作上下文。
 *
 * 容错纪律：该类目是作者手动维护的增强信息，任何失败（表不存在/JSON 损坏/
 * 查询异常）都只跳过本通道，绝不阻断整体叙事召回。
 */
export function createRecentSummaryChannel(): NarrativeRetrievalChannel<RecentSummaryChannelInput> {
  return {
    name: "recent-summary",
    async run(input) {
      try {
        const limit = Math.max(1, input.limit ?? 3);
        const categories = getJingweiCategoryAliases("chapter-summaries");
        // fields_json 里才有 chapterNumber，无法在 SQL 精确排序；
        // 先按 updated_at 倒序粗筛一批，再在 JS 里按章节号精确排序。
        const rows = input.storage.sqlite.prepare(
          `SELECT id, title, fields_json, updated_at FROM story_jingwei_entry
           WHERE book_id = ?
             AND category IN (${sqlInPlaceholders(categories)})
             AND deleted_at IS NULL
             AND COALESCE(status, 'confirmed') = 'confirmed'
             AND participates_in_ai = 1
           ORDER BY updated_at DESC LIMIT 50`
        ).all(input.bookId, ...categories) as Array<RawSummaryRow>;

        const cards: NarrativeContextCard[] = [];
        for (const row of rows) {
          const fields = parseFieldsJson(row.fields_json);
          const chapter = toChapterNumber(fields.chapterNumber ?? fields.chapter_number, row.title);
          const summary = typeof fields.summary === "string" ? fields.summary.trim() : "";
          // 解析不出章号或摘要为空的条目跳过，不产出半残卡片。
          if (chapter === undefined || !summary) continue;

          const rawTitle = typeof fields.title === "string" && fields.title.trim() ? fields.title.trim() : row.title;
          const built = buildSummaryTitleAndContent(chapter, rawTitle, summary);
          const stale = input.staleChapters?.includes(chapter) ?? false;
          const title = built.title;
          const content = stale ? `${built.content}（注意：本章正文在结算后被改过，这段摘要可能已过期，与正文冲突时以正文为准。）` : built.content;
          cards.push(NarrativeContextCardSchema.parse({
            id: `recent-summary:${input.bookId}:${row.id}`,
            bookId: input.bookId,
            sourceType: "chapter-summary",
            sourceId: row.id,
            channel: "recent-summary",
            title,
            content,
            brief: content.slice(0, 180),
            tags: stale ? ["chapter-summary", "recent-summary", "stale"] : ["chapter-summary", "recent-summary"],
            entities: [],
            priority: Math.max(1, (input.currentChapter !== undefined
              ? Math.max(10, 85 - Math.max(0, input.currentChapter - chapter) * 5)
              : 70) - (stale ? 20 : 0)),
            importance: 70,
            accessCount: 0,
            validFromChapter: chapter,
            validUntilChapter: chapter,
            reason: stale
              ? "近章剧情摘要；本章正文在结算后被改过，摘要可能过期，已降低优先级并标注。"
              : "近章手动剧情摘要（chapter-summaries 类目），保持前情连续。",
            estimatedTokens: Math.max(1, estimateTokens(content)),
          }));
        }

        cards.sort((a, b) => (b.validUntilChapter ?? 0) - (a.validUntilChapter ?? 0));
        const result = cards.slice(0, limit);
        if (result.length === 0) {
          return { status: "skipped", cards: [], warnings: ["recent-summary channel 为空：chapter-summaries 类目没有可用的章节摘要。"] };
        }
        return { cards: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.debug(`[recent-summary] 通道召回失败，跳过不阻断：${message}`);
        return {
          status: "skipped",
          cards: [],
          warnings: [`recent-summary channel 失败已跳过：${message}`],
        };
      }
    },
  };
}
