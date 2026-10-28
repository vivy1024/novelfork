import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";

import { estimateTokens } from "../../jingwei/context/token-budget.js";
import { loadConfirmedChapterSummaries } from "../chapter-summary-source.js";
import type { NarrativeRetrievalChannel } from "../channels.js";
import { NarrativeContextCardSchema, type NarrativeContextCard } from "../types.js";

export interface RecentSummaryChannelInput {
  readonly storage: StorageDatabase;
  readonly bookId: string;
  /** 写/修第 N 章：只注入 N 之前的章摘要（从 N-1 往前取），不混入「未来」章节。 */
  readonly currentChapter?: number;
  /** 注入最近 N 章的手动摘要，默认 3。 */
  readonly limit?: number;
  /** 下限（含）：层级摘要启用时传当前卷起始章，近章只在本卷内取，卷外由卷摘要卡承担。 */
  readonly minChapter?: number;
  /** 正文在结算后又被改过的章：摘要照样注入，但标明可能过期、以正文为准。 */
  readonly staleChapters?: readonly number[];
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
        const rows = loadConfirmedChapterSummaries(input.storage, input.bookId, {
          ...(input.currentChapter !== undefined ? { beforeChapter: input.currentChapter } : {}),
          ...(input.minChapter !== undefined ? { minChapter: input.minChapter } : {}),
          limit,
        });

        const cards: NarrativeContextCard[] = [];
        for (const row of rows) {
          const { chapter, summary } = row;

          const rawTitle = row.fieldTitle || row.title;
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
