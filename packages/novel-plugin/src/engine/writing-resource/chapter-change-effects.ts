import type { StorageDatabase } from "@vivy1024/novelfork-core";

import { chapterContentFingerprint } from "../narrative-memory/settlement-idempotency.js";
import { markChapterAuditStale } from "../tools/health/audit-log-persist.js";
import { recordChapterCompletion } from "../tools/writing-log.js";

/** 一次章节正文变更：谁写的不重要，写作台、领域工具、叙述者通用工具、外部编辑器都一样。 */
export interface ChapterContentChange {
  readonly chapterNumber: number;
  /** 变更前索引里记录的字数；新出现的章节为 0。 */
  readonly previousWordCount: number;
  readonly wordCount: number;
  readonly content: string;
  /** ISO 时间，写作日志按它的日期归档。 */
  readonly changedAt: string;
}

/**
 * 章节正文变更后的领域附带动作，所有写入入口共用这一处：
 * - 字数正增量记入写作日志（与写作台保存一致，删减不记负数）；
 * - 审计记录的正文指纹与当前正文不一致时标记为过期。
 *
 * 结算是否过期不在这里存：它由结算台账指纹与当前正文现算。
 */
export async function applyChapterContentChange(
  storage: StorageDatabase,
  bookId: string,
  change: ChapterContentChange,
): Promise<void> {
  const delta = change.wordCount - change.previousWordCount;
  if (delta > 0) {
    const hasBook = storage.sqlite.prepare("SELECT 1 AS present FROM book WHERE id = ?").get(bookId);
    if (hasBook) {
      await recordChapterCompletion(storage, {
        bookId,
        chapterNumber: change.chapterNumber,
        wordCount: delta,
        completedAt: change.changedAt,
        date: change.changedAt.slice(0, 10),
      });
    }
  }
  try {
    markChapterAuditStale(storage, bookId, change.chapterNumber, chapterContentFingerprint(change.content));
  } catch {
    // 还没有审计记录（表或行不存在）时无需标记。
  }
}
