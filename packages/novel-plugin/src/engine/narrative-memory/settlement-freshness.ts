/**
 * 章节结算新鲜度（T4.2 正文接纳）。
 *
 * 任何入口改了章节正文（写作台、Runtime 编辑器与文件回退、Agent 写工具、外部编辑器），
 * 章节对账都会把最新正文指纹写进 chapters/index.json 的 contentHash；结算台账记着结算时的指纹。
 * 两者用同一个 chapterContentFingerprint，比较即可判断记忆是否过期，不需要重读正文。
 *
 * 状态是现算的派生视图，不落盘：过期的章，其事实、事件与经纬章摘要都视为可能过期，
 * 直到重新结算。
 */

import type { StorageDatabase } from "@vivy1024/novelfork-core";
import { readChapterIndex } from "../writing-resource/chapter-layout.js";
import { ensureSettlementLedgerSchema } from "./settlement-idempotency.js";

export type ChapterSettlementFreshnessStatus = "fresh" | "stale" | "unsettled" | "unknown";

export interface ChapterSettlementFreshness {
  readonly chapterNumber: number;
  readonly title: string;
  readonly status: ChapterSettlementFreshnessStatus;
  readonly settledAt?: string;
  /** 章节索引最后一次记录的修改时间。 */
  readonly updatedAt?: string;
}

export interface BookSettlementFreshness {
  readonly chapters: readonly ChapterSettlementFreshness[];
  readonly staleChapters: readonly number[];
  readonly unsettledChapters: readonly number[];
}

export async function readBookSettlementFreshness(
  storage: StorageDatabase,
  bookId: string,
  bookRoot: string,
): Promise<BookSettlementFreshness> {
  ensureSettlementLedgerSchema(storage);
  const index = await readChapterIndex(bookRoot);
  const rows = storage.sqlite
    .prepare<{ chapter_number: number; content_fingerprint: string; settled_at: string }>(
      "SELECT chapter_number, content_fingerprint, settled_at FROM narrative_chapter_settlement WHERE book_id = ?",
    )
    .all(bookId);
  const settledByChapter = new Map(rows.map((row) => [row.chapter_number, row] as const));

  const chapters = [...index]
    .sort((a, b) => a.number - b.number)
    .map((entry): ChapterSettlementFreshness => {
      const settled = settledByChapter.get(entry.number);
      const base = {
        chapterNumber: entry.number,
        title: entry.title,
        ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
      };
      if (!settled) return { ...base, status: "unsettled" };
      // 旧索引还没有指纹（对账补齐之前）：如实标「未知」，不冒充新鲜或过期。
      if (typeof entry.contentHash !== "string" || !entry.contentHash) {
        return { ...base, status: "unknown", settledAt: settled.settled_at };
      }
      return {
        ...base,
        status: entry.contentHash === settled.content_fingerprint ? "fresh" : "stale",
        settledAt: settled.settled_at,
      };
    });

  return {
    chapters,
    staleChapters: chapters.filter((chapter) => chapter.status === "stale").map((chapter) => chapter.chapterNumber),
    unsettledChapters: chapters.filter((chapter) => chapter.status === "unsettled").map((chapter) => chapter.chapterNumber),
  };
}
