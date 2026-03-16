import { Command } from "commander";
import { StateManager } from "@actalk/inkos-core";
import { loadConfig, findProjectRoot, resolveBookId, log, logError } from "../utils.js";

interface TokenStats {
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokens: number;
  readonly avgTokensPerChapter: number;
  readonly recentTrend: ReadonlyArray<{ readonly chapter: number; readonly totalTokens: number }>;
}

interface AnalyticsData {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly avgWordsPerChapter: number;
  readonly auditPassRate: number;
  readonly topIssueCategories: ReadonlyArray<{ readonly category: string; readonly count: number }>;
  readonly chaptersWithMostIssues: ReadonlyArray<{ readonly chapter: number; readonly issueCount: number }>;
  readonly statusDistribution: Record<string, number>;
  readonly tokenStats?: TokenStats;
}

export function computeAnalytics(
  bookId: string,
  chapters: ReadonlyArray<{
    readonly number: number;
    readonly status: string;
    readonly wordCount: number;
    readonly auditIssues: ReadonlyArray<string>;
    readonly tokenUsage?: {
      readonly promptTokens: number;
      readonly completionTokens: number;
      readonly totalTokens: number;
    };
  }>,
): AnalyticsData {
  const totalChapters = chapters.length;
  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
  const avgWordsPerChapter = totalChapters > 0 ? Math.round(totalWords / totalChapters) : 0;

  // Audit pass rate: chapters that went to ready-for-review or approved on first try
  const passedStatuses = new Set(["ready-for-review", "approved", "published"]);
  const auditedChapters = chapters.filter(
    (ch) => ch.status !== "drafted" && ch.status !== "drafting" && ch.status !== "card-generated",
  );
  const passedChapters = auditedChapters.filter((ch) => passedStatuses.has(ch.status));
  const auditPassRate = auditedChapters.length > 0
    ? Math.round((passedChapters.length / auditedChapters.length) * 100)
    : 100;

  // Issue category extraction
  const categoryCounts = new Map<string, number>();
  for (const ch of chapters) {
    for (const issue of ch.auditIssues) {
      // Issue format: "[severity] description"
      // Try to extract category from the description
      const catMatch = issue.match(/\[(?:critical|warning|info)\]\s*(.+?)[:：]/);
      const category = catMatch?.[1] ?? "未分类";
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }
  const topIssueCategories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([category, count]) => ({ category, count }));

  // Chapters with most issues
  const chaptersWithMostIssues = [...chapters]
    .filter((ch) => ch.auditIssues.length > 0)
    .sort((a, b) => b.auditIssues.length - a.auditIssues.length)
    .slice(0, 5)
    .map((ch) => ({ chapter: ch.number, issueCount: ch.auditIssues.length }));

  // Status distribution
  const statusDistribution: Record<string, number> = {};
  for (const ch of chapters) {
    statusDistribution[ch.status] = (statusDistribution[ch.status] ?? 0) + 1;
  }

  // Token stats
  const chaptersWithUsage = chapters.filter((ch) => ch.tokenUsage);
  let tokenStats: TokenStats | undefined;
  if (chaptersWithUsage.length > 0) {
    const totalPromptTokens = chaptersWithUsage.reduce((sum, ch) => sum + (ch.tokenUsage?.promptTokens ?? 0), 0);
    const totalCompletionTokens = chaptersWithUsage.reduce((sum, ch) => sum + (ch.tokenUsage?.completionTokens ?? 0), 0);
    const totalTokens = chaptersWithUsage.reduce((sum, ch) => sum + (ch.tokenUsage?.totalTokens ?? 0), 0);
    const avgTokensPerChapter = Math.round(totalTokens / chaptersWithUsage.length);

    // Recent 5 chapters trend (sorted by chapter number)
    const recentTrend = [...chaptersWithUsage]
      .sort((a, b) => a.number - b.number)
      .slice(-5)
      .map((ch) => ({ chapter: ch.number, totalTokens: ch.tokenUsage?.totalTokens ?? 0 }));

    tokenStats = {
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      avgTokensPerChapter,
      recentTrend,
    };
  }

  return {
    bookId,
    totalChapters,
    totalWords,
    avgWordsPerChapter,
    auditPassRate,
    topIssueCategories,
    chaptersWithMostIssues,
    statusDistribution,
    tokenStats,
  };
}

export const analyticsCommand = new Command("analytics")
  .alias("stats")
  .description("Show analytics and token stats for a book")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      await loadConfig();
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const chapters = await state.loadChapterIndex(bookId);

      const analytics = computeAnalytics(bookId, chapters);

      if (opts.json) {
        log(JSON.stringify(analytics, null, 2));
      } else {
        log(`Analytics for "${bookId}":`);
        log("");
        log(`  Total chapters: ${analytics.totalChapters}`);
        log(`  Total words: ${analytics.totalWords.toLocaleString()}`);
        log(`  Avg words/chapter: ${analytics.avgWordsPerChapter.toLocaleString()}`);
        log(`  Audit pass rate: ${analytics.auditPassRate}%`);
        log("");

        if (Object.keys(analytics.statusDistribution).length > 0) {
          log("  Status distribution:");
          for (const [status, count] of Object.entries(analytics.statusDistribution)) {
            log(`    ${status}: ${count}`);
          }
          log("");
        }

        if (analytics.tokenStats) {
          log("  Token usage:");
          log(`    Total tokens: ${analytics.tokenStats.totalTokens.toLocaleString()}`);
          log(`    Prompt tokens: ${analytics.tokenStats.totalPromptTokens.toLocaleString()}`);
          log(`    Completion tokens: ${analytics.tokenStats.totalCompletionTokens.toLocaleString()}`);
          log(`    Avg tokens/chapter: ${analytics.tokenStats.avgTokensPerChapter.toLocaleString()}`);
          if (analytics.tokenStats.recentTrend.length > 0) {
            log("    Recent trend:");
            for (const { chapter, totalTokens } of analytics.tokenStats.recentTrend) {
              log(`      Ch.${chapter}: ${totalTokens.toLocaleString()} tokens`);
            }
          }
          log("");
        }

        if (analytics.topIssueCategories.length > 0) {
          log("  Most common issue categories:");
          for (const { category, count } of analytics.topIssueCategories) {
            log(`    ${category}: ${count}`);
          }
          log("");
        }

        if (analytics.chaptersWithMostIssues.length > 0) {
          log("  Chapters with most issues:");
          for (const { chapter, issueCount } of analytics.chaptersWithMostIssues) {
            log(`    Ch.${chapter}: ${issueCount} issues`);
          }
        }
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Analytics failed: ${e}`);
      }
      process.exit(1);
    }
  });
