/**
 * memory.settle_chapter — 单章章后结算，是 pipeline.write 落盘后的正常结算路径。
 *
 * 与 memory.settle_range（历史补结算）的分工：
 * - settle_chapter：一章一次，正文来源必须是**已落盘**的正式章节；是写章闭环的正常步骤。
 * - settle_range：范围补救，用于回填历史空洞。
 *
 * 为什么坚持从已落盘正文读取，而不接受调用方传入的正文字符串：
 * 「先保存正文，再更新记忆」的顺序由此变成**数据依赖**而不是代码书写顺序的约定。
 * 章节没落盘 → 这里读不到 → 结算必然失败，不可能出现「记忆里有、正文没有」的错位。
 * 这同时给 P5 结算幂等留出清晰边界：结算的输入只有 (bookId, chapterNumber) 与已落盘正文。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

import type { ChapterEventExtractorInput } from "../engine/narrative-memory/chapter-event-extractor.js";
import type { ChapterSettlementResult } from "../engine/narrative-memory/settlement-risk-gate.js";
import { handleChapterRead } from "./chapter-read.js";
import { settleConfirmedChapter } from "./chapter-settlement-service.js";

/** 工具名与 renderer 的单一来源；tool-registry 的声明必须与之一致（见 memory-settle-chapter.test.ts）。 */
export const SETTLE_CHAPTER_TOOL_NAME = "memory.settle_chapter";
/** 复用已在 Studio 侧表态过的 Narrative Memory 管理渲染器，不新增未注册的 renderer 名。 */
export const SETTLE_CHAPTER_TOOL_RENDERER = "narrative-memory.admin";

export interface MemorySettleChapterInput {
  readonly bookId: string;
  /** 可信书籍根目录，由宿主绑定注入；不接受模型提供。 */
  readonly bookRoot: string;
  readonly chapterNumber: number;
  readonly title?: string;
  /**
   * 正文未变时强制重新结算。默认 false，即同章同内容会被幂等跳过。
   * 只在上一次抽取确实漏抽/抽错时使用。
   */
  readonly force?: boolean;
  readonly storage?: StorageDatabase;
  readonly llmExtractor?: ChapterEventExtractorInput["llmExtractor"];
  readonly now?: () => Date;
}

export interface MemorySettleChapterResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly error?: string;
  readonly chapterNumber: number;
  readonly settlement?: ChapterSettlementResult;
  /**
   * 重复结算被幂等跳过时为 true。
   * 注意 ok 仍然是 true：这是可预期的正常结果，不是工具调用失败 ——
   * 报成失败会让 agent 无限重试，报成普通成功又会让作者以为记忆被更新过。
   */
  readonly alreadySettled?: boolean;
}

/** 幂等跳过时把 explanation 三段式展开成 summary，面板与叙述者不必按 code 自造文案。 */
function summarizeSettlement(chapterNumber: number, settlement: ChapterSettlementResult): string {
  if (settlement.status === "skipped") {
    if (settlement.skipReason === "already-settled" && settlement.explanation) {
      return [
        `发生了什么：${settlement.explanation.whatHappened}`,
        `为什么要看：${settlement.explanation.whyItMatters}`,
        `建议怎么做：${settlement.explanation.suggestedAction}`,
      ].join("\n");
    }
    return `第${chapterNumber}章未结算：${settlement.warnings[0] ?? "结算被跳过"}。`;
  }
  const resettled = settlement.idempotency?.outcome === "resettled";
  return [
    resettled
      ? `第${chapterNumber}章正文已改写，重新结算完成（第 ${settlement.idempotency?.settlementCount ?? 2} 次）：抽取 ${settlement.extracted} 条事件，`
      : `第${chapterNumber}章章后结算完成：抽取 ${settlement.extracted} 条事件，`,
    `直接应用 ${settlement.autoApplied} 条，进入待审 ${settlement.pending} 条`,
    settlement.highRiskPending > 0 ? `（其中高风险待审 ${settlement.highRiskPending} 条）` : "",
    "。",
    resettled && (settlement.idempotency?.authorDecidedPreserved ?? 0) > 0
      ? `已保留你此前裁决过的 ${settlement.idempotency?.authorDecidedPreserved} 条事件。`
      : "",
  ].join("");
}

export async function handleMemorySettleChapter(input: MemorySettleChapterInput): Promise<MemorySettleChapterResult> {
  const bookId = input.bookId?.trim();
  const chapterNumber = Math.trunc(input.chapterNumber);

  if (!bookId) {
    return { ok: false, error: "missing-book-id", summary: "缺少 bookId。", chapterNumber };
  }
  if (!input.bookRoot?.trim()) {
    return { ok: false, error: "missing-book-root", summary: "缺少可信 bookRoot，无法读取已落盘正文。", chapterNumber };
  }
  if (!Number.isFinite(chapterNumber) || chapterNumber < 1) {
    return { ok: false, error: "invalid-chapter", summary: "chapterNumber 必须是 ≥1 的整数。", chapterNumber };
  }

  const storage = input.storage ?? getStorageDatabase();

  // 只结算已落盘正文：这一步同时充当「保存先于结算」的硬校验。
  const read = await handleChapterRead(
    { bookId, chapterNumber },
    undefined,
    { bookRoot: input.bookRoot, storage },
  );
  if (!read.ok || !read.data?.content?.trim()) {
    return {
      ok: false,
      error: "chapter-not-persisted",
      summary: [
        `发生了什么：第${chapterNumber}章没有可读的已落盘正文，章后结算无法进行。`,
        "为什么要看：结算只允许基于正式章节正文；否则叙事记忆会记下正文里并不存在的事实。",
        `建议怎么做：先确认第${chapterNumber}章正文已保存成功，再重新执行 ${SETTLE_CHAPTER_TOOL_NAME}。`,
      ].join("\n"),
      chapterNumber,
    };
  }

  const settlement = await settleConfirmedChapter(
    {
      bookId,
      chapterId: `chapter:${chapterNumber}`,
      chapterNumber,
      title: input.title?.trim() || `第${chapterNumber}章`,
      content: read.data.content,
      confirmedAt: (input.now?.() ?? new Date()).toISOString(),
      ...(input.force ? { force: true } : {}),
    },
    {
      storage,
      bookRoot: input.bookRoot,
      ...(input.llmExtractor ? { llmExtractor: input.llmExtractor } : {}),
      ...(input.now ? { now: input.now } : {}),
    },
  );

  const alreadySettled = settlement.status === "skipped" && settlement.skipReason === "already-settled";
  return {
    ok: true,
    summary: summarizeSettlement(chapterNumber, settlement),
    chapterNumber,
    settlement,
    ...(alreadySettled ? { alreadySettled: true } : {}),
  };
}
