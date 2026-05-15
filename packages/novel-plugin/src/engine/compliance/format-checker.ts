/**
 * Platform publishing format checker.
 */

import type { FormatCheckResult, FormatIssue, SupportedPlatform } from "./types.js";

export interface FormatChapterInput {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
}

export interface BookFormatConfig {
  readonly title?: string;
  readonly synopsis?: string;
}

const PLATFORM_TOTAL_WORD_WARN: Record<SupportedPlatform, number> = {
  qidian: 100_000,
  jjwxc: 30_000,
  fanqie: 20_000,
  qimao: 20_000,
  generic: 20_000,
};

function countChineseWords(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length;
}

function countIssueSeverity(issues: ReadonlyArray<FormatIssue>, severity: "block" | "warn" | "suggest"): number {
  return issues.filter((issue) => issue.severity === severity).length;
}

function hasValidChapterTitle(title: string): boolean {
  return /^第[一二三四五六七八九十百千万零〇0-9]+章/.test(title.trim()) || title.trim().length >= 2;
}

export function checkFormat(
  chapters: ReadonlyArray<FormatChapterInput>,
  bookConfig: BookFormatConfig = {},
  platform: SupportedPlatform = "generic",
): FormatCheckResult {
  const issues: FormatIssue[] = [];
  let totalWords = 0;

  for (const chapter of chapters) {
    const wordCount = countChineseWords(chapter.content);
    totalWords += wordCount;

    if (!hasValidChapterTitle(chapter.title)) {
      issues.push({
        type: "title-format",
        severity: "suggest",
        chapterNumber: chapter.chapterNumber,
        message: "章节标题格式不规范",
        detail: chapter.title,
        suggestion: "建议使用“第X章 标题”或至少提供清晰章节标题。",
      });
    }

    if (wordCount === 0) {
      issues.push({
        type: "empty-chapter",
        severity: "block",
        chapterNumber: chapter.chapterNumber,
        message: "章节内容为空",
        suggestion: "空白章节应补写或删除后再投稿。",
      });
    } else if (wordCount < 1000) {
      issues.push({
        type: "chapter-too-short",
        severity: "warn",
        chapterNumber: chapter.chapterNumber,
        message: "章节字数偏短",
        detail: `${wordCount} 字`,
        suggestion: "多数网文平台章节建议不低于 1000 字。",
      });
    } else if (wordCount > 8000) {
      issues.push({
        type: "chapter-too-long",
        severity: "suggest",
        chapterNumber: chapter.chapterNumber,
        message: "章节字数偏长",
        detail: `${wordCount} 字`,
        suggestion: "建议拆分为更适合移动端阅读的章节。",
      });
    }

    if (/\n\s*\n\s*\n\s*\n/.test(chapter.content)) {
      issues.push({
        type: "consecutive-blank-lines",
        severity: "suggest",
        chapterNumber: chapter.chapterNumber,
        message: "存在连续空行/空段",
        suggestion: "建议清理连续空行，避免排版异常。",
      });
    }
  }

  const minWords = PLATFORM_TOTAL_WORD_WARN[platform];
  if (totalWords < minWords) {
    issues.push({
      type: "total-word-count",
      severity: "warn",
      message: "全书总字数不足目标平台推荐检查线",
      detail: `${totalWords} / ${minWords} 字`,
      suggestion: "建议达到平台首秀/投稿推荐字数后再提交。",
    });
  }

  if (!bookConfig.synopsis || bookConfig.synopsis.trim().length === 0) {
    issues.push({
      type: "missing-synopsis",
      severity: "warn",
      message: "缺少作品简介",
      suggestion: "投稿前建议准备 100-300 字作品简介。",
    });
  }

  return {
    platform,
    issues,
    totalWords,
    chapterCount: chapters.length,
    avgChapterWords: chapters.length > 0 ? totalWords / chapters.length : 0,
    blockCount: countIssueSeverity(issues, "block"),
    warnCount: countIssueSeverity(issues, "warn"),
    suggestCount: countIssueSeverity(issues, "suggest"),
  };
}
