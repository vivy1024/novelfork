/**
 * AI content ratio estimator.
 *
 * This does not claim to detect exact AI-authored percentage. It maps existing
 * AI-taste scores into coarse risk bands for platform submission review.
 */

import type { BookAiRatioReport, ChapterAiEstimate, SupportedPlatform } from "./types.js";

export const PLATFORM_AI_THRESHOLDS: Record<SupportedPlatform, number> = {
  qidian: 0,
  jjwxc: 0.05,
  fanqie: 0.2,
  qimao: 0.2,
  generic: 0.2,
};

export const AI_RATIO_METHODOLOGY =
  "基于 AI 味特征分数的粗略估算，不代表精确 AI 生成比例；仅用于投稿前自检，最终以平台实际审核为准。";

export interface ChapterAiScoreInput {
  readonly chapterNumber: number;
  readonly chapterTitle: string;
  readonly wordCount: number;
  readonly aiTasteScore: number; // supports 0-1 or 0-100
}

function normalizeAiScore(aiTasteScore: number): number {
  if (!Number.isFinite(aiTasteScore)) return 0;
  const normalized = aiTasteScore > 1 ? aiTasteScore / 100 : aiTasteScore;
  return Math.max(0, Math.min(1, normalized));
}

export function estimateChapterAiRatio(aiTasteScore: number): number {
  const score = normalizeAiScore(aiTasteScore);
  if (score < 0.2) return 0;
  if (score < 0.4) return 0.1;
  if (score < 0.6) return 0.3;
  if (score < 0.8) return 0.5;
  return 0.7;
}

function classifyLevel(ratio: number, threshold: number): "safe" | "caution" | "danger" {
  if (ratio > threshold) return "danger";
  if (ratio > Math.max(0, threshold * 0.8)) return "caution";
  return "safe";
}

export function estimateChapterAiEstimate(
  input: ChapterAiScoreInput,
  threshold: number,
): ChapterAiEstimate {
  const estimatedAiRatio = estimateChapterAiRatio(input.aiTasteScore);
  return {
    chapterNumber: input.chapterNumber,
    chapterTitle: input.chapterTitle,
    wordCount: input.wordCount,
    aiTasteScore: normalizeAiScore(input.aiTasteScore),
    estimatedAiRatio,
    isAboveThreshold: estimatedAiRatio > threshold,
    level: classifyLevel(estimatedAiRatio, threshold),
  };
}

export function estimateBookAiRatio(
  bookId: string,
  chapters: ReadonlyArray<ChapterAiScoreInput>,
  platform: SupportedPlatform = "generic",
): BookAiRatioReport {
  const platformThreshold = PLATFORM_AI_THRESHOLDS[platform];
  const estimates = chapters.map((chapter) => estimateChapterAiEstimate(chapter, platformThreshold));
  const totalWords = estimates.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const weightedRatio = totalWords > 0
    ? estimates.reduce((sum, chapter) => sum + chapter.estimatedAiRatio * chapter.wordCount, 0) / totalWords
    : 0;

  return {
    bookId,
    chapters: estimates,
    totalWords,
    overallAiRatio: weightedRatio,
    overallLevel: classifyLevel(weightedRatio, platformThreshold),
    platformThreshold,
    platformThresholds: PLATFORM_AI_THRESHOLDS,
    platform,
    methodology: AI_RATIO_METHODOLOGY,
  };
}
