import { getStorageDatabase } from "@vivy1024/novelfork-core/storage";

export interface VolumeSummary {
  id: string;
  bookId: string;
  volumeNumber: number;
  summary: string;
  tokenCount: number;
  createdAt: number;
}

/**
 * Get or generate volume summary for chapters [startChapter, endChapter].
 * Volume = every 30 chapters.
 */
export async function getVolumeSummary(bookId: string, volumeNumber: number): Promise<VolumeSummary | null> {
  const storage = getStorageDatabase();
  const row = storage.sqlite.prepare(
    "SELECT id, book_id, volume_number, summary, token_count, created_at FROM jingwei_volume_summaries WHERE book_id = ? AND volume_number = ?"
  ).get(bookId, volumeNumber) as { id: string; book_id: string; volume_number: number; summary: string; token_count: number; created_at: number } | undefined;
  if (!row) return null;
  return { id: row.id, bookId: row.book_id, volumeNumber: row.volume_number, summary: row.summary, tokenCount: row.token_count, createdAt: row.created_at };
}

export async function saveVolumeSummary(bookId: string, volumeNumber: number, summary: string): Promise<void> {
  const storage = getStorageDatabase();
  const id = `vol-${bookId}-${volumeNumber}`;
  const tokenCount = Math.ceil(summary.length / 4);
  storage.sqlite.prepare(
    "INSERT OR REPLACE INTO jingwei_volume_summaries (id, book_id, volume_number, summary, token_count, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, bookId, volumeNumber, summary, tokenCount, Date.now());
}

/**
 * Build the recursive summary context for a given chapter.
 * Returns: current + previous volume summaries + recent 5 chapter summaries.
 * Total budget: ~5000 tokens.
 */
export async function buildRecursiveSummaryContext(bookId: string, currentChapter: number): Promise<string> {
  const storage = getStorageDatabase();

  const currentVolume = Math.ceil(currentChapter / 30);

  // Volume summaries (current + previous)
  const volumeSummaries: string[] = [];
  for (let v = Math.max(1, currentVolume - 1); v <= currentVolume; v++) {
    const vol = await getVolumeSummary(bookId, v);
    if (vol) volumeSummaries.push(`【第${v}卷摘要】${vol.summary}`);
  }

  // Recent 5 chapter summaries
  const recentChapters = storage.sqlite.prepare(
    "SELECT chapter_number, summary FROM bible_chapter_summary WHERE book_id = ? AND chapter_number <= ? ORDER BY chapter_number DESC LIMIT 5"
  ).all(bookId, currentChapter) as Array<{ chapter_number: number; summary: string }>;

  const chapterSummaries = recentChapters
    .reverse()
    .map(c => `【第${c.chapter_number}章】${c.summary}`)
    .join("\n");

  const parts: string[] = [];
  if (volumeSummaries.length > 0) parts.push(volumeSummaries.join("\n"));
  if (chapterSummaries) parts.push(chapterSummaries);

  return parts.join("\n\n");
}

/**
 * Generate a volume summary by compressing chapter summaries.
 * Called after every 30th chapter is written.
 */
export function buildVolumeSummaryPrompt(chapterSummaries: string[]): string {
  return `请将以下${chapterSummaries.length}章的摘要压缩为一段800字以内的卷级摘要，保留：主要剧情推进、角色状态变化、重要伏笔、关键转折。不要列举每章内容，而是提炼整卷的核心脉络。\n\n${chapterSummaries.join("\n\n")}`;
}
