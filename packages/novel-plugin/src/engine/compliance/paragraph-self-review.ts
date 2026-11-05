/** 只读的段落级表达自审：复用去套话引擎的规则命中，不改写正文。 */
import { deslopText } from "../filter/deslop/deslop-engine.js";
import type { DeslopOptions } from "../filter/deslop/types.js";
import { tokenizeChineseText, type TextSegment } from "../filter/engine/tokenizer.js";
import { findDialogueRanges, maskDialogue, overlapsDialogue, type DialogueRange } from "./dialogue-spans.js";

export const PARAGRAPH_SELF_REVIEW_METHODOLOGY =
  "仅按现有确定性规则定位叙述里的表达线索（引号内对白不检查），命中需结合语境复核；不估算 AI 生成概率或人工写作比例，也不代表平台审核结论。";

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
  /** 包含命中的原句（只取叙述部分，不含引号内对白）；连续句式规则可覆盖数句，始终逐字摘自原文。 */
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

/**
 * 叙述里的省略号按密度判定：同一段内、任意 ELLIPSIS_CLUSTER_WINDOW 字的叙述里
 * 出现至少 ELLIPSIS_CLUSTER_MIN 处才算命中，命中的是这一串里的每一处。
 *
 * 理由：省略号在叙述里偶尔用来表示语气拖长、思绪中断，是正常写法；成问题的是
 * 习惯性连用、句句拖尾。2026-10 真模型验收（《阿Ｑ正傳》9 章）里旧规则逐个命中，
 * 112 条自审结果有 94 条是省略号，几乎全是对白和零散的正常用法，淹没了真问题。
 * 窗口 200 字约等于一个中等自然段，3 处是「连用」而不是「用过」的最低门槛。
 */
export const ELLIPSIS_CLUSTER_MIN = 3;
export const ELLIPSIS_CLUSTER_WINDOW = 200;
const ELLIPSIS_RULE_ID = "ellipsis";

interface RawHit {
  readonly start: number;
  readonly end: number;
  readonly ruleId: string;
  readonly reason: string;
  readonly source: ParagraphSelfReviewIssue["source"];
  readonly suggestion?: string;
}

/** 只保留落在密集串里的省略号命中，并把原因改写成密度说明。 */
function keepDenseEllipsis(hits: readonly RawHit[]): RawHit[] {
  const ellipsis = hits.filter((hit) => hit.ruleId === ELLIPSIS_RULE_ID).sort((a, b) => a.start - b.start);
  const dense = new Set<RawHit>();
  for (let index = 0; index + ELLIPSIS_CLUSTER_MIN - 1 < ellipsis.length; index += 1) {
    const last = ellipsis[index + ELLIPSIS_CLUSTER_MIN - 1]!;
    if (last.start - ellipsis[index]!.start > ELLIPSIS_CLUSTER_WINDOW) continue;
    let cursor = index;
    while (cursor < ellipsis.length && ellipsis[cursor]!.start - ellipsis[index]!.start <= ELLIPSIS_CLUSTER_WINDOW) {
      dense.add(ellipsis[cursor]!);
      cursor += 1;
    }
  }
  return hits.flatMap((hit) => {
    if (hit.ruleId !== ELLIPSIS_RULE_ID) return [hit];
    if (!dense.has(hit)) return [];
    return [{
      ...hit,
      reason: `叙述里 ${ELLIPSIS_CLUSTER_WINDOW} 字内连用 ${ELLIPSIS_CLUSTER_MIN} 处以上省略号，停顿拖沓；偶尔一处不算问题，酌情删减到最需要停顿的地方`,
    }];
  });
}

/**
 * 原句证据：先取命中所在的句子，再收窄到命中两侧最近的对白之间，
 * 让证据只含叙述、仍逐字摘自原文（叙述者拿它当 sourceText 定位）。
 */
function narrationEvidence(
  paragraphText: string,
  sentences: readonly TextSegment[],
  dialogue: readonly DialogueRange[],
  start: number,
  end: number,
): string {
  const covered = sentences.filter((sentence) => sentence.start < end && sentence.end > start);
  let from = covered.length > 0 ? covered[0]!.start : start;
  let to = covered.length > 0 ? covered[covered.length - 1]!.end : end;
  for (const range of dialogue) {
    if (range.end <= start && range.end > from) from = range.end;
    if (range.start >= end && range.start < to) to = range.start;
  }
  return paragraphText.slice(from, to).trim();
}

/**
 * 按已有 tokenizer 的空行段落口径逐段运行 deslopText。弱化副词的预算也按段
 * 计算，以免跨段命中被误标到另一段；结果只取原文上的命中，绝不应用改写。
 *
 * 引号内的对白一律不检查：先把对白遮成等长占位符再跑规则（偏移不变），
 * 仍与对白区间有交集的命中（如跨过对白的连续句式）整条丢弃。
 * 人文化与润色都约定对白不动，自审若命中台词，叙述者就会照建议改掉人物原话。
 */
export function reviewChapterParagraphs(
  chapterText: string,
  options: DeslopOptions = {},
): ParagraphSelfReviewResult {
  const paragraphs: readonly TextSegment[] = tokenizeChineseText(chapterText).paragraphs;
  const issues: ParagraphSelfReviewIssue[] = [];

  paragraphs.forEach((paragraph, index) => {
    const dialogue = findDialogueRanges(paragraph.text);
    const narration = maskDialogue(paragraph.text, dialogue);
    const result = deslopText(narration, options);
    const sentences = tokenizeChineseText(paragraph.text).sentences;
    const location = { paragraph: index + 1, paragraphStart: paragraph.start, paragraphEnd: paragraph.end };

    const hits: RawHit[] = [
      ...result.edits.map((edit): RawHit => ({ start: edit.start, end: edit.end, ruleId: edit.rule, reason: edit.reason, source: "deslop-edit" })),
      ...result.manualFlags.map((flag): RawHit => ({
        start: flag.start, end: flag.end, ruleId: flag.rule, reason: flag.reason, source: "deslop-manual-flag", suggestion: flag.instruction,
      })),
    ].filter((hit) => !overlapsDialogue(dialogue, hit.start, hit.end));

    for (const hit of keepDenseEllipsis(hits)) {
      issues.push({
        ...location,
        start: paragraph.start + hit.start,
        end: paragraph.start + hit.end,
        matchedText: paragraph.text.slice(hit.start, hit.end),
        evidence: narrationEvidence(paragraph.text, sentences, dialogue, hit.start, hit.end),
        ruleId: hit.ruleId,
        reason: hit.reason,
        source: hit.source,
        ...(hit.suggestion ? { suggestion: hit.suggestion } : {}),
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

/** 同一规则命中同一原句的若干处，归并成一条；保留首处命中作代表。 */
export interface GroupedSelfReviewIssue {
  readonly issue: ParagraphSelfReviewIssue;
  /** 这一句被同一规则命中的处数（≥1）。 */
  readonly hitCount: number;
  /** 出现这句的段落号，升序去重（同一句原文在多段重复出现时不止一个）。 */
  readonly paragraphs: readonly number[];
}

/**
 * 按「规则 + 证据原句」归并命中，顺序取每组首处命中的先后。
 *
 * 一句里有两个破折号时规则会命中两处，证据却是同一句；逐条交给叙述者会得到两条重叠候选
 * （一条改整句、一条改半句）。候选回到正文按 sourceText 文本定位，同一原句即便出现在不同段落
 * 也只能落成一条，所以归并键不含段落。reviewChapterParagraphs 的结果本身保持逐处命中。
 */
export function groupSelfReviewIssues(issues: readonly ParagraphSelfReviewIssue[]): GroupedSelfReviewIssue[] {
  const groups = new Map<string, { issue: ParagraphSelfReviewIssue; hitCount: number; paragraphs: Set<number> }>();
  for (const issue of issues) {
    const key = `${issue.ruleId}\u0000${issue.evidence}`;
    const group = groups.get(key);
    if (group) {
      group.hitCount += 1;
      group.paragraphs.add(issue.paragraph);
    } else {
      groups.set(key, { issue, hitCount: 1, paragraphs: new Set([issue.paragraph]) });
    }
  }
  return [...groups.values()].map((group) => ({
    issue: group.issue,
    hitCount: group.hitCount,
    paragraphs: [...group.paragraphs].sort((a, b) => a - b),
  }));
}
