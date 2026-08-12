import type { StorageDatabase } from "@vivy1024/novelfork-core/storage";
import { writingLogs } from "@vivy1024/novelfork-core/storage";
import type { WritingLog } from "./writing-log-types.js";

export async function recordChapterCompletion(
  storage: StorageDatabase,
  log: WritingLog,
): Promise<void> {
  storage.db
    .insert(writingLogs)
    .values({
      bookId: log.bookId,
      chapterNumber: log.chapterNumber,
      wordCount: log.wordCount,
      completedAt: log.completedAt,
      date: log.date,
    })
    .run();
}

