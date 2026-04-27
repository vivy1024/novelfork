import type { StorageDatabase } from "../../storage/db.js";
import { writingLogs } from "../../storage/schema.js";
import type { DailyProgress, ProgressConfig, WritingLog } from "./progress-types.js";

interface SumRow { readonly total_words: number }
interface DateSumRow { readonly date: string; readonly total_words: number }
interface RecentRow { readonly total_words: number; readonly day_count: number }

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

export async function getDailyProgress(
  storage: StorageDatabase,
  config: ProgressConfig,
  options?: {
    readonly today?: string;
    readonly totalChaptersWritten?: number;
  },
): Promise<DailyProgress> {
  const today = options?.today ?? toDateString(new Date());

  const todayRow = storage.sqlite.prepare(
    `SELECT COALESCE(SUM(word_count), 0) AS total_words FROM writing_log WHERE date = ?`,
  ).get(today) as SumRow | null;
  const todayWritten = todayRow?.total_words ?? 0;
  const todayCompleted = todayWritten >= config.dailyTarget;

  const weekStart = getWeekStart(today);
  const weekRow = storage.sqlite.prepare(
    `SELECT COALESCE(SUM(word_count), 0) AS total_words FROM writing_log WHERE date >= ? AND date <= ?`,
  ).get(weekStart, today) as SumRow | null;
  const weeklyTarget = config.weeklyTarget ?? config.dailyTarget * 7;
  const weekWritten = weekRow?.total_words ?? 0;

  const streak = calculateStreak(storage, config.dailyTarget, today);
  const last30 = getLast30Days(storage, today);
  const estimatedCompletionDate = estimateCompletion(storage, config, options?.totalChaptersWritten, today);

  return {
    today: { written: todayWritten, target: config.dailyTarget, completed: todayCompleted },
    thisWeek: { written: weekWritten, target: weeklyTarget },
    streak,
    last30Days: last30,
    ...(estimatedCompletionDate ? { estimatedCompletionDate } : {}),
  };
}

export async function getProgressTrend(
  storage: StorageDatabase,
  days: number = 30,
  today?: string,
): Promise<ReadonlyArray<{ readonly date: string; readonly wordCount: number }>> {
  const endDate = today ?? toDateString(new Date());
  const startDate = addDays(endDate, -(days - 1));
  const rows = storage.sqlite.prepare(
    `SELECT date, COALESCE(SUM(word_count), 0) AS total_words FROM writing_log WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date`,
  ).all(startDate, endDate) as DateSumRow[];
  return rows.map((row) => ({ date: row.date, wordCount: row.total_words }));
}

function calculateStreak(
  storage: StorageDatabase,
  dailyTarget: number,
  today: string,
): number {
  let streak = 0;
  let currentDate = today;
  const stmt = storage.sqlite.prepare(
    `SELECT COALESCE(SUM(word_count), 0) AS total_words FROM writing_log WHERE date = ?`,
  );

  for (let i = 0; i < 365; i += 1) {
    const row = stmt.get(currentDate) as SumRow | null;
    if ((row?.total_words ?? 0) >= dailyTarget) {
      streak += 1;
      currentDate = addDays(currentDate, -1);
    } else {
      break;
    }
  }
  return streak;
}

function getLast30Days(
  storage: StorageDatabase,
  today: string,
): Array<{ readonly date: string; readonly wordCount: number }> {
  const startDate = addDays(today, -29);
  const rows = storage.sqlite.prepare(
    `SELECT date, COALESCE(SUM(word_count), 0) AS total_words FROM writing_log WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date DESC`,
  ).all(startDate, today) as DateSumRow[];
  return rows.map((row) => ({ date: row.date, wordCount: row.total_words }));
}

function estimateCompletion(
  storage: StorageDatabase,
  config: ProgressConfig,
  totalChaptersWritten?: number,
  today?: string,
): string | undefined {
  if (!config.totalChaptersTarget || !config.avgWordsPerChapter) return undefined;
  const chaptersWritten = totalChaptersWritten ?? 0;
  const remaining = Math.max(0, config.totalChaptersTarget - chaptersWritten);
  if (remaining === 0) return undefined;
  const remainingWords = remaining * config.avgWordsPerChapter;

  const last7Start = addDays(today ?? toDateString(new Date()), -6);
  const recent = storage.sqlite.prepare(
    `SELECT COALESCE(SUM(word_count), 0) AS total_words, COUNT(DISTINCT date) AS day_count FROM writing_log WHERE date >= ?`,
  ).get(last7Start) as RecentRow | null;

  const dailyAvg = (recent?.day_count ?? 0) > 0
    ? (recent?.total_words ?? 0) / (recent?.day_count ?? 1)
    : config.dailyTarget;

  if (dailyAvg <= 0) return undefined;
  const daysNeeded = Math.ceil(remainingWords / dailyAvg);
  return addDays(today ?? toDateString(new Date()), daysNeeded);
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getWeekStart(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  const dayOfWeek = date.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return addDays(dateStr, -mondayOffset);
}
