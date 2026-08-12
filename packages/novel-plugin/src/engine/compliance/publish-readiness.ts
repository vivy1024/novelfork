/** 投稿风险自检聚合。 */

import type {
  BookAiTasteReport,
  BookSensitiveScanResult,
  ComplianceEvidence,
  ContinuityCheckResult,
  ContinuityIssue,
  FormatCheckResult,
  PublishReadinessReport,
  PublishReadinessStatus,
  SupportedPlatform,
} from "./types.js";
import { assessBookAiTaste, type ChapterAiTasteInput } from "./ai-taste-assessment.js";
import { checkFormat, type BookFormatConfig, type FormatChapterInput } from "./format-checker.js";
import { NOVELFORK_RISK_RULE_PACK, CHAPTER_AUDIT_RULE_SOURCE, LOCAL_FORMAT_RULE_SOURCE, LOCAL_SENSITIVE_RULE_SOURCE } from "./rule-pack.js";
import { scanBook } from "./sensitive-scanner.js";

export interface PublishReadinessChapterInput extends FormatChapterInput {
  readonly aiTasteScore?: number;
  readonly status?: string;
  readonly auditIssues?: ReadonlyArray<string> | unknown;
}

function countWords(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length;
}

function resolveStatus(highRiskCount: number, warnCount: number): PublishReadinessStatus {
  if (highRiskCount > 0) return "needs-review";
  if (warnCount > 0) return "has-warnings";
  return "ready";
}

function collectEvidence(
  sensitiveScan: BookSensitiveScanResult,
  aiTaste: BookAiTasteReport,
  formatCheck: FormatCheckResult,
  continuity: ContinuityCheckResult,
): ComplianceEvidence[] {
  const evidence: ComplianceEvidence[] = [];
  for (const chapter of sensitiveScan.chapters) {
    for (const hit of chapter.hits) {
      for (const position of hit.positions) {
        evidence.push({
          ruleId: `sensitive:${hit.category}:${hit.word}`,
          rulePackId: NOVELFORK_RISK_RULE_PACK.id,
          source: LOCAL_SENSITIVE_RULE_SOURCE,
          severity: hit.severity === "block" ? "high" : hit.severity === "warn" ? "medium" : "low",
          chapterNumber: hit.chapterNumber,
          chapterTitle: hit.chapterTitle,
          message: `命中本地风险词“${hit.word}”。`,
          matchedText: hit.word,
          offset: position.offset,
          paragraph: position.paragraph,
          context: position.context,
          ...(hit.suggestion ? { suggestion: hit.suggestion } : {}),
        });
      }
    }
  }

  for (const chapter of aiTaste.chapters) {
    if (chapter.evidence) evidence.push(chapter.evidence);
  }

  for (const issue of formatCheck.issues) {
    evidence.push({
      ruleId: `format:${issue.type}`,
      rulePackId: NOVELFORK_RISK_RULE_PACK.id,
      source: LOCAL_FORMAT_RULE_SOURCE,
      severity: issue.severity === "block" ? "high" : issue.severity === "warn" ? "medium" : "low",
      ...(issue.chapterNumber ? { chapterNumber: issue.chapterNumber } : {}),
      message: issue.message,
      ...(issue.detail ? { context: issue.detail } : {}),
      ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
    });
  }

  if (continuity.status === "has-issues") {
    for (const issue of continuity.issues) {
      evidence.push({
        ruleId: `continuity:${issue.category}`,
        rulePackId: NOVELFORK_RISK_RULE_PACK.id,
        source: CHAPTER_AUDIT_RULE_SOURCE,
        severity: issue.severity === "critical" ? "high" : "medium",
        chapterNumber: issue.chapterNumber,
        message: issue.message,
        suggestion: "回到对应章节与经纬/叙事记忆核对后再决定是否修改。",
      });
    }
  }
  return evidence;
}

export function checkPublishReadiness(
  bookId: string,
  platform: SupportedPlatform,
  chapters: ReadonlyArray<PublishReadinessChapterInput>,
  bookConfig: BookFormatConfig = {},
): PublishReadinessReport {
  const sensitiveScan = scanBook(
    chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      content: chapter.content,
    })),
    platform,
  );

  const aiInputs: ChapterAiTasteInput[] = chapters.map((chapter) => ({
    chapterNumber: chapter.chapterNumber,
    chapterTitle: chapter.title,
    wordCount: countWords(chapter.content),
    aiTasteScore: chapter.aiTasteScore ?? 0,
  }));
  const aiTaste = assessBookAiTaste(bookId, aiInputs, platform);
  const formatCheck = checkFormat(chapters, bookConfig, platform);
  const continuity = buildContinuityCheck(chapters);
  const evidence = collectEvidence(sensitiveScan, aiTaste, formatCheck, continuity);

  const totalBlockCount = evidence.filter((item) => item.severity === "high").length;
  const totalWarnCount = evidence.filter((item) => item.severity === "medium").length;
  const totalSuggestCount = evidence.filter((item) => item.severity === "low").length;

  return {
    platform,
    status: resolveStatus(totalBlockCount, totalWarnCount),
    rulePack: NOVELFORK_RISK_RULE_PACK,
    evidence,
    sensitiveScan,
    aiTaste,
    formatCheck,
    continuity,
    totalBlockCount,
    totalWarnCount,
    totalSuggestCount,
  };
}

const AUDIT_ISSUE_PATTERN = /^\[(critical|warning)\]\s*([^：:]+)[：:](.+)$/;

function buildContinuityCheck(chapters: ReadonlyArray<PublishReadinessChapterInput>): ContinuityCheckResult {
  const hasAnyAuditField = chapters.some((chapter) => chapter.auditIssues !== undefined);
  if (!hasAnyAuditField) return { status: "unknown", reason: "缺少审计数据，连续性线索无法计算。" };
  if (chapters.some((chapter) => chapter.auditIssues !== undefined && !Array.isArray(chapter.auditIssues))) {
    return { status: "unknown", reason: "审计数据格式不符合预期。" };
  }

  const chaptersWithAudit = chapters.filter((chapter) => Array.isArray(chapter.auditIssues));
  if (chaptersWithAudit.length === 0) return { status: "unknown", reason: "缺少审计数据，连续性线索无法计算。" };

  const issues: ContinuityIssue[] = [];
  for (const chapter of chaptersWithAudit) {
    if (!Array.isArray(chapter.auditIssues)) continue;
    for (const raw of chapter.auditIssues) {
      if (typeof raw !== "string") return { status: "unknown", reason: "审计数据格式不符合预期。" };
      const match = raw.match(AUDIT_ISSUE_PATTERN);
      if (!match) continue;
      issues.push({
        chapterNumber: chapter.chapterNumber,
        severity: match[1] === "critical" ? "critical" : "warning",
        category: match[2].trim(),
        message: match[3].trim(),
      });
    }
  }

  if (issues.length === 0) {
    return { status: "passed", source: "chapter-audit-issues", checkedChapterCount: chaptersWithAudit.length, issueCount: 0, score: 1 };
  }

  const blockCount = issues.filter((issue) => issue.severity === "critical").length;
  const warnCount = issues.filter((issue) => issue.severity === "warning").length;
  return {
    status: "has-issues",
    source: "chapter-audit-issues",
    checkedChapterCount: chaptersWithAudit.length,
    issueCount: issues.length,
    blockCount,
    warnCount,
    score: Math.max(0, Math.min(1, 1 - issues.length / chaptersWithAudit.length)),
    issues,
  };
}
