import type { StorageDatabase } from "../../storage/db.js";
import type { BookHealthSummary } from "./health-types.js";

interface AuditRow {
  readonly continuity_passed: number;
  readonly continuity_issue_count: number;
  readonly ai_taste_score: number;
  readonly hook_health_issues: number;
  readonly long_span_fatigue_issues: number;
  readonly sensitive_word_count: number;
  readonly rhythm_diversity_score: number;
}

interface AggRow {
  readonly total_chapters: number;
  readonly total_words: number;
  readonly avg_ai_taste: number;
  readonly total_sensitive: number;
  readonly passed_count: number;
  readonly avg_rhythm: number;
  readonly total_hook_issues: number;
  readonly total_hooks_resolved: number;
}

export function buildBookHealthSummary(
  storage: StorageDatabase,
  bookId: string,
): BookHealthSummary {
  // Aggregate from chapter_audit_log
  const agg = storage.sqlite.prepare(
    `SELECT
       COUNT(*) AS total_chapters,
       COALESCE(SUM(continuity_issue_count), 0) AS total_words,
       COALESCE(AVG(ai_taste_score), 0) AS avg_ai_taste,
       COALESCE(SUM(sensitive_word_count), 0) AS total_sensitive,
       COALESCE(SUM(CASE WHEN continuity_passed = 1 THEN 1 ELSE 0 END), 0) AS passed_count,
       COALESCE(AVG(rhythm_diversity_score), 0) AS avg_rhythm,
       COALESCE(SUM(hook_health_issues), 0) AS total_hook_issues,
       0 AS total_hooks_resolved
     FROM chapter_audit_log
     WHERE book_id = ?`,
  ).get(bookId) as AggRow | null;

  const totalChapters = agg?.total_chapters ?? 0;
  const passedCount = agg?.passed_count ?? 0;
  const consistencyScore = totalChapters > 0 ? passedCount / totalChapters : 1;

  // Total words from writing_log
  const wordRow = storage.sqlite.prepare(
    `SELECT COALESCE(SUM(word_count), 0) AS total_words FROM writing_log WHERE book_id = ?`,
  ).get(bookId) as { total_words: number } | null;
  const totalWords = wordRow?.total_words ?? 0;

  // AI taste trend (per chapter)
  const trendRows = storage.sqlite.prepare(
    `SELECT ai_taste_score FROM chapter_audit_log WHERE book_id = ? ORDER BY chapter_number ASC`,
  ).all(bookId) as Array<{ ai_taste_score: number }>;
  const aiTasteTrend = trendRows.map((r) => r.ai_taste_score);

  // Hook recovery rate: resolved / (resolved + open issues)
  const totalHookIssues = agg?.total_hook_issues ?? 0;
  const hookRecoveryRate = totalHookIssues > 0 ? 0 : 1;

  return {
    totalChapters,
    totalWords,
    consistencyScore,
    hookRecoveryRate,
    pendingHooks: [],
    aiTasteAvg: agg?.avg_ai_taste ?? 0,
    aiTasteTrend,
    pacingDiversityScore: agg?.avg_rhythm ?? 0,
    emotionCurve: [],
    sensitiveWordTotal: agg?.total_sensitive ?? 0,
    stalledConflicts: [],
    hookDebtWarnings: [],
    fatigueWarnings: [],
    povGapWarnings: [],
  };
}
