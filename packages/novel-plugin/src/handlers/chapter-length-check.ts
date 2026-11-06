/**
 * 章节正文的字数硬范围校验（唯一口径）。
 *
 * pipeline.write 落盘前、工作流正文候选提交时都用这一份：两处口径不一致，就会出现
 * 「审校过、作者批准、落盘才被字数拒」的死路——作者批准的正文永远落不了盘。
 * 硬范围以本书设置（book.json 的 chapterWordCount / language）为准，不受模型蓝图影响。
 */

import { buildLengthSpec, countChapterLength, isOutsideHardRange } from "@vivy1024/novelfork-core";

export interface ChapterLengthRule {
  /** 本书单章目标字数（book.json 的 chapterWordCount）。 */
  readonly chapterWordCount: number;
  readonly language?: "zh" | "en";
}

export interface ChapterLengthViolation {
  readonly count: number;
  readonly target: number;
  readonly hardMin: number;
  readonly hardMax: number;
  readonly countingMode: "zh_chars" | "en_words";
  /** 低于下限为负（还差多少），高于上限为正（超出多少）。 */
  readonly delta: number;
  readonly unit: string;
}

/** 正文在硬范围内返回 null；否则返回实际长度、范围与差额。 */
export function checkChapterHardLength(content: string, rule: ChapterLengthRule): ChapterLengthViolation | null {
  const spec = buildLengthSpec(rule.chapterWordCount, rule.language === "en" ? "en" : "zh");
  const count = countChapterLength(content.trim(), spec.countingMode);
  if (!isOutsideHardRange(count, spec)) return null;
  return {
    count,
    target: spec.target,
    hardMin: spec.hardMin,
    hardMax: spec.hardMax,
    countingMode: spec.countingMode,
    delta: count < spec.hardMin ? count - spec.hardMin : count - spec.hardMax,
    unit: spec.countingMode === "en_words" ? " words" : "字",
  };
}

/** 差额的人话说法：「还差 574字」/「超出 120字」。 */
export function describeLengthGap(violation: ChapterLengthViolation): string {
  return violation.delta < 0
    ? `还差 ${-violation.delta}${violation.unit}才到下限`
    : `超出上限 ${violation.delta}${violation.unit}`;
}
