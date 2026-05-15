/**
 * Publish-readiness aggregation.
 */

import type {
  BookAiRatioReport,
  BookSensitiveScanResult,
  ContinuityCheckResult,
  ContinuityIssue,
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
  readonly status?: string;
  readonly auditIssues?: ReadonlyArray<string> | unknown;
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

  const continuity = buildContinuityCheck(chapters);

  const continuityBlockCount = continuity.status === "has-issues" ? continuity.blockCount : 0;
  const continuityWarnCount = continuity.status === "has-issues" ? continuity.warnCount : 0;

  const totalBlockCount = sensitiveScan.totalBlockCount + formatCheck.blockCount + continuityBlockCount;
  const totalWarnCount = sensitiveScan.totalWarnCount + formatCheck.warnCount + aiRatio.chapters.filter((c) => c.isAboveThreshold).length + continuityWarnCount;
  const totalSuggestCount = sensitiveScan.totalSuggestCount + formatCheck.suggestCount;

  return {
    platform,
    status: resolveStatus(totalBlockCount, totalWarnCount),
    sensitiveScan,
    aiRatio,
    formatCheck,
    continuity,
    totalBlockCount,
    totalWarnCount,
    totalSuggestCount,
  };
}

const AUDIT_ISSUE_PATTERN = /^\[(critical|warning)\]\s*([^：:]+)[：:](.+)$/;

function buildContinuityCheck(chapters: ReadonlyArray<PublishReadinessChapterInput>): ContinuityCheckResult {
  const hasAnyAuditField = chapters.some((ch) => ch.auditIssues !== undefined);
  if (!hasAnyAuditField) {
    return { status: "unknown", reason: "缺少审计数据，连续性指标无法计算。" };
  }

  const hasMalformed = chapters.some((ch) => ch.auditIssues !== undefined && !Array.isArray(ch.auditIssues));
  if (hasMalformed) {
    return { status: "unknown", reason: "审计数据格式不符合预期。" };
  }

  const chaptersWithAudit = chapters.filter((ch) => Array.isArray(ch.auditIssues));
  if (chaptersWithAudit.length === 0) {
    return { status: "unknown", reason: "缺少审计数据，连续性指标无法计算。" };
  }

  const issues: ContinuityIssue[] = [];
  for (const ch of chaptersWithAudit) {
    if (!Array.isArray(ch.auditIssues)) continue;
    for (const raw of ch.auditIssues) {
      if (typeof raw !== "string") {
        return { status: "unknown", reason: "审计数据格式不符合预期。" };
      }
      const match = raw.match(AUDIT_ISSUE_PATTERN);
      if (match && match[1] === "critical") {
        issues.push({
          chapterNumber: ch.chapterNumber,
          severity: "critical",
          category: match[2].trim(),
          message: match[3].trim(),
        });
      }
    }
  }

  if (issues.length === 0) {
    return { status: "passed", source: "chapter-audit-issues", checkedChapterCount: chaptersWithAudit.length, issueCount: 0, score: 1 };
  }

  const blockCount = issues.filter((i) => i.severity === "critical").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  const score = 1 - issues.length / chaptersWithAudit.length;

  return {
    status: "has-issues",
    source: "chapter-audit-issues",
    checkedChapterCount: chaptersWithAudit.length,
    issueCount: issues.length,
    blockCount,
    warnCount,
    score: Math.max(0, Math.min(1, score)),
    issues,
  };
}
