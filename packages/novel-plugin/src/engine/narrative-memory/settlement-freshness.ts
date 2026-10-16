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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { listChapterFiles, readChapterIndex } from "../writing-resource/chapter-layout.js";
import { chapterContentFingerprint, ensureSettlementLedgerSchema } from "./settlement-idempotency.js";

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

  // 指纹按磁盘正文现算，不信索引里的 contentHash：回退改了文件后索引仍可能是回退前的旧值（对账还没跑）。
  // 按章号而非索引 fileName 找文件，使回退造成的改名或移动也能被识别；同号多份时取排序后的第一份，结果确定。
  const diskFileByNumber = new Map<number, string>();
  for (const file of await listChapterFiles(bookRoot)) {
    if (!diskFileByNumber.has(file.number)) diskFileByNumber.set(file.number, join(bookRoot, file.relativePath));
  }

  const chapters = await Promise.all([...index]
    .sort((a, b) => a.number - b.number)
    .map(async (entry): Promise<ChapterSettlementFreshness> => {
      const settled = settledByChapter.get(entry.number);
      const base = {
        chapterNumber: entry.number,
        title: entry.title,
        ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
      };
      if (!settled) return { ...base, status: "unsettled" };
      const diskPath = diskFileByNumber.get(entry.number);
      const content = diskPath ? await readFile(diskPath, "utf8").catch(() => null) : null;
      // 正文读不到（缺失或损坏）：如实标「未知」，不冒充新鲜或过期。
      if (content === null) {
        return { ...base, status: "unknown", settledAt: settled.settled_at };
      }
      return {
        ...base,
        status: chapterContentFingerprint(content) === settled.content_fingerprint ? "fresh" : "stale",
        settledAt: settled.settled_at,
      };
    }));

  return {
    chapters,
    staleChapters: chapters.filter((chapter) => chapter.status === "stale").map((chapter) => chapter.chapterNumber),
    unsettledChapters: chapters.filter((chapter) => chapter.status === "unsettled").map((chapter) => chapter.chapterNumber),
  };
}
