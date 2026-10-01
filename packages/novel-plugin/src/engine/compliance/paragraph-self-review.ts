/** 只读的段落级表达自审：复用去套话引擎的规则命中，不改写正文。 */
import { deslopText } from "../filter/deslop/deslop-engine.js";
import type { DeslopOptions } from "../filter/deslop/types.js";
import { tokenizeChineseText, type TextSegment } from "../filter/engine/tokenizer.js";

export const PARAGRAPH_SELF_REVIEW_METHODOLOGY =
  "仅按现有确定性规则定位表达线索，命中需结合语境复核；不估算 AI 生成概率或人工写作比例，也不代表平台审核结论。";

export interface ParagraphSelfReviewIssue {
  /** 正文中的第几个非空段落，从 1 开始；段落按空行分隔。 */
  readonly paragraph: number;
  /** 段落在原始章节正文中的范围，起点含、终点不含。 */
  readonly paragraphStart: number;
  readonly paragraphEnd: number;
  /** 命中在原始章节正文中的范围，起点含、终点不含。 */
  readonly start: number;
  readonly end: number;
  readonly matchedText: string;
  /** 包含命中的原句；连续句式规则可覆盖数句，始终逐字摘自原文。 */
  readonly evidence: string;
  readonly ruleId: string;
  readonly reason: string;
  readonly source: "deslop-edit" | "deslop-manual-flag";
  /** 需要语义判断的规则给出原有改写指示，仅供作者参考。 */
  readonly suggestion?: string;
}

export interface ParagraphSelfReviewResult {
  readonly status: "empty-input" | "clear" | "issues-found";
  readonly message: string;
  readonly paragraphCount: number;
  readonly issues: readonly ParagraphSelfReviewIssue[];
  readonly methodology: string;
}

function originalSentence(paragraphText: string, sentences: readonly TextSegment[], start: number, end: number): string {
  const covered = sentences.filter((sentence) => sentence.start < end && sentence.end > start);
  if (covered.length === 0) return paragraphText.slice(start, end);
  return paragraphText.slice(covered[0]!.start, covered[covered.length - 1]!.end);
}

/**
 * 按已有 tokenizer 的空行段落口径逐段运行 deslopText。弱化副词的预算也按段
 * 计算，以免跨段命中被误标到另一段；结果只取原文上的命中，绝不应用改写。
 */
export function reviewChapterParagraphs(
  chapterText: string,
  options: DeslopOptions = {},
): ParagraphSelfReviewResult {
  const paragraphs: readonly TextSegment[] = tokenizeChineseText(chapterText).paragraphs;
  const issues: ParagraphSelfReviewIssue[] = [];

  paragraphs.forEach((paragraph, index) => {
    const result = deslopText(paragraph.text, options);
    const sentences = tokenizeChineseText(paragraph.text).sentences;
    const location = { paragraph: index + 1, paragraphStart: paragraph.start, paragraphEnd: paragraph.end };

    for (const edit of result.edits) {
      issues.push({
        ...location,
        start: paragraph.start + edit.start,
        end: paragraph.start + edit.end,
        matchedText: paragraph.text.slice(edit.start, edit.end),
        evidence: originalSentence(paragraph.text, sentences, edit.start, edit.end),
        ruleId: edit.rule,
        reason: edit.reason,
        source: "deslop-edit",
      });
    }
    for (const flag of result.manualFlags) {
      issues.push({
        ...location,
        start: paragraph.start + flag.start,
        end: paragraph.start + flag.end,
        matchedText: paragraph.text.slice(flag.start, flag.end),
        evidence: originalSentence(paragraph.text, sentences, flag.start, flag.end),
        ruleId: flag.rule,
        reason: flag.reason,
        source: "deslop-manual-flag",
        suggestion: flag.instruction,
      });
    }
  });

  issues.sort((a, b) => a.start - b.start || a.end - b.end || a.ruleId.localeCompare(b.ruleId));
  const status = paragraphs.length === 0 ? "empty-input" : issues.length === 0 ? "clear" : "issues-found";
  const message = status === "empty-input"
    ? "暂无正文可检查。"
    : status === "clear"
      ? "未发现现有规则可定位的表达问题；请仍结合上下文审稿。"
      : `已定位 ${issues.length} 处规则命中，请结合上下文复核。`;

  return { status, message, paragraphCount: paragraphs.length, issues, methodology: PARAGRAPH_SELF_REVIEW_METHODOLOGY };
}
