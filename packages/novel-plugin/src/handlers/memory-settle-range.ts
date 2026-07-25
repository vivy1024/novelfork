/**
 * memory.settle_range — 对历史章节批量/补结算 Narrative Memory。
 * 包装 settleConfirmedChapter，不重写抽取逻辑。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { getStorageDatabase } from "@vivy1024/novelfork-core";

import type { ChapterSettlementResult } from "../engine/narrative-memory/settlement-risk-gate.js";
import type { ChapterEventExtractorInput } from "../engine/narrative-memory/chapter-event-extractor.js";
import { handleChapterRead } from "./chapter-read.js";
import { settleConfirmedChapter } from "./chapter-settlement-service.js";

export interface MemorySettleRangeInput {
  readonly bookId: string;
  readonly fromChapter: number;
  readonly toChapter: number;
  /** 正文来源：accepted-resources 优先正式资源，否则回落 chapters/*.md */
  readonly source?: "accepted-resources" | "chapter-files";
  readonly dryRun?: boolean;
  readonly bookRoot?: string;
  readonly storage?: StorageDatabase;
  readonly llmExtractor?: ChapterEventExtractorInput["llmExtractor"];
  readonly now?: () => Date;
}

export interface MemorySettleRangeChapterResult {
  readonly chapterNumber: number;
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly reason?: string;
  readonly settlement?: ChapterSettlementResult;
}

export interface MemorySettleRangeResult {
  readonly ok: boolean;
  readonly bookId: string;
  readonly fromChapter: number;
  readonly toChapter: number;
  readonly dryRun: boolean;
  readonly chaptersAttempted: number;
  readonly chaptersSettled: number;
  readonly chaptersSkipped: number;
  readonly totalExtracted: number;
  readonly totalAutoApplied: number;
  readonly totalPending: number;
  readonly results: readonly MemorySettleRangeChapterResult[];
  readonly summary: string;
  readonly error?: string;
}

function fail(error: string, summary: string, partial?: Partial<MemorySettleRangeResult>): MemorySettleRangeResult {
  return {
    ok: false,
    bookId: partial?.bookId ?? "",
    fromChapter: partial?.fromChapter ?? 0,
    toChapter: partial?.toChapter ?? 0,
    dryRun: partial?.dryRun ?? false,
    chaptersAttempted: partial?.chaptersAttempted ?? 0,
    chaptersSettled: partial?.chaptersSettled ?? 0,
    chaptersSkipped: partial?.chaptersSkipped ?? 0,
    totalExtracted: partial?.totalExtracted ?? 0,
    totalAutoApplied: partial?.totalAutoApplied ?? 0,
    totalPending: partial?.totalPending ?? 0,
    results: partial?.results ?? [],
    summary,
    error,
  };
}

export async function handleMemorySettleRange(input: MemorySettleRangeInput): Promise<MemorySettleRangeResult> {
  const bookId = input.bookId?.trim();
  if (!bookId) return fail("missing-book-id", "缺少 bookId。");
  if (!input.bookRoot?.trim()) return fail("missing-book-root", "缺少可信 bookRoot，无法读取章节正文。", { bookId });

  const fromChapter = Math.trunc(input.fromChapter);
  const toChapter = Math.trunc(input.toChapter);
  if (!Number.isFinite(fromChapter) || !Number.isFinite(toChapter) || fromChapter < 1 || toChapter < fromChapter) {
    return fail("invalid-range", "fromChapter/toChapter 无效：需满足 1 ≤ from ≤ to。", { bookId, fromChapter, toChapter });
  }
  if (toChapter - fromChapter > 200) {
    return fail("range-too-large", "单次 settle_range 最多 200 章，请缩小范围。", { bookId, fromChapter, toChapter });
  }

  const dryRun = Boolean(input.dryRun);
  const storage = input.storage ?? getStorageDatabase();
  const results: MemorySettleRangeChapterResult[] = [];
  let chaptersSettled = 0;
  let chaptersSkipped = 0;
  let totalExtracted = 0;
  let totalAutoApplied = 0;
  let totalPending = 0;

  for (let chapterNumber = fromChapter; chapterNumber <= toChapter; chapterNumber++) {
    const read = await handleChapterRead(
      { bookId, chapterNumber },
      undefined,
      { bookRoot: input.bookRoot, storage },
    );

    if (!read.ok || !read.data?.content?.trim()) {
      chaptersSkipped += 1;
      results.push({
        chapterNumber,
        ok: false,
        skipped: true,
        reason: read.summary || "章节正文不存在或为空。",
      });
      continue;
    }

    if (dryRun) {
      chaptersSkipped += 1;
      results.push({
        chapterNumber,
        ok: true,
        skipped: true,
        reason: `dryRun：将结算第 ${chapterNumber} 章（${read.data.wordCount} 字）。`,
      });
      continue;
    }

    const settlement = await settleConfirmedChapter(
      {
        bookId,
        chapterId: `settle-range:${bookId}:${chapterNumber}`,
        chapterNumber,
        title: `第${chapterNumber}章`,
        content: read.data.content,
        confirmedAt: (input.now?.() ?? new Date()).toISOString(),
      },
      {
        storage,
        bookRoot: input.bookRoot,
        llmExtractor: input.llmExtractor,
        now: input.now,
      },
    );

    if (settlement.status === "skipped") {
      chaptersSkipped += 1;
      results.push({
        chapterNumber,
        ok: true,
        skipped: true,
        reason: settlement.warnings[0] ?? "跳过结算",
        settlement,
      });
      continue;
    }

    chaptersSettled += 1;
    totalExtracted += settlement.extracted;
    totalAutoApplied += settlement.autoApplied;
    totalPending += settlement.pending;
    results.push({
      chapterNumber,
      ok: true,
      settlement,
    });
  }

  const chaptersAttempted = toChapter - fromChapter + 1;
  return {
    ok: true,
    bookId,
    fromChapter,
    toChapter,
    dryRun,
    chaptersAttempted,
    chaptersSettled,
    chaptersSkipped,
    totalExtracted,
    totalAutoApplied,
    totalPending,
    results,
    summary: dryRun
      ? `dryRun：范围内 ${chaptersAttempted} 章，可结算 ${results.filter((item) => item.reason?.startsWith("dryRun")).length} 章，缺正文 ${results.filter((item) => item.skipped && !item.reason?.startsWith("dryRun")).length} 章。`
      : `已结算 ${chaptersSettled}/${chaptersAttempted} 章：抽取 ${totalExtracted}，自动沉淀 ${totalAutoApplied}，pending ${totalPending}，跳过 ${chaptersSkipped}。`,
  };
}
