/**
 * Publish-readiness aggregation.
 */

import type {
  BookAiRatioReport,
  BookSensitiveScanResult,
  FormatCheckResult,
  PublishReadinessReport,
  PublishReadinessStatus,
  SupportedPlatform,
} from "./types.js";
import { estimateBookAiRatio, type ChapterAiScoreInput } from "./ai-ratio-estimator.js";
import { checkFormat, type BookFormatConfig, type FormatChapterInput } from "./format-checker.js";
import { scanBook } from "./sensitive-scanner.js";

export interface PublishReadinessChapterInput extends FormatChapterInput {
  readonly aiTasteScore?: number;
}

function countWords(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length;
}

function resolveStatus(blockCount: number, warnCount: number): PublishReadinessStatus {
  if (blockCount > 0) return "blocked";
  if (warnCount > 0) return "has-warnings";
  return "ready";
}

export function checkPublishReadiness(
  bookId: string,
  platform: SupportedPlatform,
  chapters: ReadonlyArray<PublishReadinessChapterInput>,
  bookConfig: BookFormatConfig = {},
): PublishReadinessReport {
  const sensitiveScan: BookSensitiveScanResult = scanBook(
    chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      content: chapter.content,
    })),
    platform,
  );

  const aiInputs: ChapterAiScoreInput[] = chapters.map((chapter) => ({
    chapterNumber: chapter.chapterNumber,
    chapterTitle: chapter.title,
    wordCount: countWords(chapter.content),
    aiTasteScore: chapter.aiTasteScore ?? 0,
  }));
  const aiRatio: BookAiRatioReport = estimateBookAiRatio(bookId, aiInputs, platform);

  const formatCheck: FormatCheckResult = checkFormat(chapters, bookConfig, platform);

  const totalBlockCount = sensitiveScan.totalBlockCount + formatCheck.blockCount;
  const totalWarnCount = sensitiveScan.totalWarnCount + formatCheck.warnCount + aiRatio.chapters.filter((c) => c.isAboveThreshold).length;
  const totalSuggestCount = sensitiveScan.totalSuggestCount + formatCheck.suggestCount;

  return {
    platform,
    status: resolveStatus(totalBlockCount, totalWarnCount),
    sensitiveScan,
    aiRatio,
    formatCheck,
    totalBlockCount,
    totalWarnCount,
    totalSuggestCount,
  };
}
